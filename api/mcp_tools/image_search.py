import asyncio
import hashlib
import io
import ipaddress
import json
import os
import socket
import tempfile
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import aiohttp
from PIL import Image

from ...runtime import DATA
from ..mcp_commands import submit_command
from ._context import BOT_CHAT_ID, PROJECT


ENDPOINT = "https://api.search.brave.com/res/v1/images/search"
MAX_COUNT = 12
MAX_IMAGE_BYTES = 12 * 1024 * 1024
IMAGE_EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif"}


def _public_socket(addr_info):
    family, kind, proto, _, address = addr_info
    ip = ipaddress.ip_address(address[0])
    if not ip.is_global or ip.is_multicast:
        raise OSError("Image downloads require a public address.")
    return socket.socket(family, kind, proto)


def _save_image(data: bytes) -> str:
    with Image.open(io.BytesIO(data), formats=list(IMAGE_EXTENSIONS)) as image:
        if image.width * image.height > 24_000_000:
            raise ValueError("Image exceeds 24 megapixels.")
        extension = IMAGE_EXTENSIONS[image.format]
        image.load()
    filename = f"{hashlib.sha256(data).hexdigest()}.{extension}"
    root = DATA / "input" / "comfyart"
    root.mkdir(parents=True, exist_ok=True)
    target = root / filename
    if not target.exists():
        tmp = tempfile.NamedTemporaryFile(dir=root, delete=False)
        try:
            with tmp:
                tmp.write(data)
            os.replace(tmp.name, target)
        finally:
            Path(tmp.name).unlink(missing_ok=True)
    return "/api/view?" + urlencode({"filename": filename, "subfolder": "comfyart", "type": "input"})


async def _download(session, url, *, redirects=True):
    try:
        async with session.get(url, allow_redirects=redirects, max_redirects=4) as response:
            if response.status != 200:
                return None
            body = bytearray()
            async for chunk in response.content.iter_chunked(65536):
                body.extend(chunk)
                if len(body) > MAX_IMAGE_BYTES:
                    return None
        return await asyncio.to_thread(_save_image, body)
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        return None


async def _download_image(originals, thumbnails, image, limit):
    async with limit:
        local = await _download(originals, image["imageUrl"])
        if local:
            return {**image, "localUrl": local, "savedFrom": "original"}
        preview = urlsplit(image["thumbnailUrl"] or "")
        if preview.netloc == "imgs.search.brave.com" and preview.scheme == "https":
            local = await _download(thumbnails, preview.geturl(), redirects=False)
            if local:
                return {**image, "localUrl": local, "savedFrom": "thumbnail"}
    return None


def _web_url(value):
    if isinstance(value, str):
        try:
            url = urlsplit(value)
            if url.scheme in {"https", "http"} and url.hostname and url.username is None:
                return value
        except ValueError:
            pass
    return None


async def search_images(args: dict) -> dict:
    query = args.get("query")
    count = args.get("count", 6)
    if not isinstance(query, str) or not query.strip():
        raise ValueError("Provide a non-empty image search query.")
    if type(count) is not int or not 1 <= count <= MAX_COUNT:
        raise ValueError(f"count must be an integer between 1 and {MAX_COUNT}.")
    key = os.environ.get("BRAVE_SEARCH_API_KEY", "").strip()
    if not key:
        raise ValueError("Set BRAVE_SEARCH_API_KEY on the ComfyArt server to enable image search.")

    params = {"q": query.strip(), "count": count, "safesearch": "strict"}
    headers = {"Accept": "application/json", "X-Subscription-Token": key}
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=45), trust_env=True) as session:
            async with session.get(ENDPOINT, params=params, headers=headers, allow_redirects=False) as response:
                if response.status != 200:
                    raise ValueError(f"Brave Image Search returned HTTP {response.status}.")
                body = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    body.extend(chunk)
                    if len(body) > 1_000_000:
                        raise ValueError("Brave Image Search response exceeds 1 MB.")
                data = json.loads(body)
    except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
        raise ValueError("Could not read the Brave Image Search response.") from exc

    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise ValueError("Brave Image Search returned an invalid result list.")
    images = []
    seen = set()
    for item in data["results"]:
        if not isinstance(item, dict):
            continue
        properties = item.get("properties")
        thumbnail = item.get("thumbnail")
        original = _web_url(properties.get("url")) if isinstance(properties, dict) else None
        preview = _web_url(thumbnail.get("src")) if isinstance(thumbnail, dict) else None
        source = _web_url(item.get("url"))
        if not original or not source or original in seen:
            continue
        seen.add(original)
        images.append({"title": str(item.get("title") or "")[:500], "thumbnailUrl": preview,
                       "imageUrl": original, "sourcePageUrl": source})
        if len(images) == count:
            break
    if not images:
        return {"images": [], "added": 0}
    timeout = aiohttp.ClientTimeout(total=10)
    # Only Brave's thumbnail service uses the configured proxy. Originals connect to public IPs directly.
    async with (aiohttp.ClientSession(connector=aiohttp.TCPConnector(socket_factory=_public_socket), timeout=timeout) as originals,
                aiohttp.ClientSession(trust_env=True, timeout=timeout) as thumbnails):
        limit = asyncio.Semaphore(4)
        downloads = await asyncio.gather(*(_download_image(originals, thumbnails, image, limit) for image in images))
    saved = [image for image in downloads if image is not None]
    added = 0
    if saved:
        result = await submit_command("add_search_references", {"images": saved}, PROJECT.get(), chat=BOT_CHAT_ID.get())
        added = result["added"]
    return {"images": [local or image for image, local in zip(images, downloads)], "added": added}


TOOLS = {
    "search_images": {
        "description": "Search for images, save images as project references (Brave previews if originals are unavailable) and open the reference panel. "
                       "Use sourcePageUrl for citations. Only results with localUrl were saved.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "count": {"type": "integer", "minimum": 1, "maximum": MAX_COUNT, "default": 6},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        "handler": search_images,
    },
}
