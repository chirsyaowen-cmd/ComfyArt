"""Project-local transparent decoration assets discovered through Brave Image Search."""

import asyncio
import hashlib
import io
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
from local_runtime import write_json
from PIL import Image

KEY = re.compile(r"[0-9a-f]{64}")
MAX_BYTES = 12 * 1024 * 1024


# The search service returns third-party URLs. Only fetch files on a provider's
# fixed HTTPS image origin, under its public image path, without redirects.
SOURCES = {
    "Vecteezy": (
        "vecteezy.com/png/",
        r"/png/(\d+)(?:-[^/]*)?/?",
        "static.vecteezy.com",
        r"/system/resources/previews/",
    ),
    "Pngtree": (
        "pngtree.com/freepng/",
        r"/freepng/[^/]*_(\d+)\.html",
        "png.pngtree.com",
        r"/(?:png-clipart|png-vector|element_our)/",
    ),
    "PNGimg": (
        "pngimg.com/image/",
        r"/image/(\d+)/?",
        "pngimg.com",
        r"/(?:uploads|d)/",
    ),
}


def resource_identity(url):
    if not isinstance(url, str):
        return None
    u = urlsplit(url)
    if u.scheme != "https" or u.username or u.password or u.netloc != u.hostname:
        return None
    for name, (scope, pattern, _, _) in SOURCES.items():
        domain = scope.split("/")[0]
        if u.hostname == domain or (u.hostname or "").endswith("." + domain):
            match = re.fullmatch(pattern, u.path)
            if match:
                return name + ":" + match[1]
    return None


def media_url(source, url):
    _, _, host, prefix = SOURCES[source]
    u = urlsplit(url)
    if (
        u.scheme == "https"
        and u.netloc == host
        and not u.query
        and not u.fragment
        and ".." not in u.path
        and re.fullmatch(
            prefix + r"[A-Za-z0-9_./-]+\.(?:png|webp)", u.path, re.IGNORECASE
        )
    ):
        return "https://" + host + u.path
    return None


def transparent_image(raw):
    if len(raw) > MAX_BYTES:
        raise ValueError("PNG exceeds size limit")
    with Image.open(io.BytesIO(raw), formats=["PNG"]) as src:
        if src.width * src.height > 24_000_000 or src.is_animated:
            raise ValueError("Expected a static PNG within the pixel limit")
        image = src.convert("RGBA")
    lo, hi = image.getchannel("A").getextrema()
    if lo == 255 or hi == 0:
        raise ValueError("Image has no usable transparency")
    return image


def store_png(directory, raw, title, page, image_url, origin):
    identity = resource_identity(page)
    if identity is None or origin not in {"search-preview", "uploaded-original"}:
        raise ValueError("Invalid decoration source")
    provider = identity.split(":")[0]
    image = transparent_image(raw)
    digest = hashlib.sha256(raw).hexdigest()
    key = hashlib.sha256((page + origin + digest).encode()).hexdigest()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (key + ".png")
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as f:
            f.write(raw)
        os.replace(f.name, path)
    record = {
        "id": key,
        "title": title,
        "sourcePageUrl": page,
        "imageUrl": image_url,
        "origin": origin,
        "provider": provider,
        "sha256": digest,
        "licenseUrl": {
            "PNGimg": "https://pngimg.com/license/",
            "Pngtree": "https://pngtree.com/legal/service-terms",
            "Vecteezy": "https://www.vecteezy.com/licensing-agreement",
        }[provider],
        "width": image.width,
        "height": image.height,
    }
    write_json(directory / (key + ".json"), record)
    return record


def read_png(directory, key):
    if not isinstance(key, str) or not KEY.fullmatch(key):
        raise ValueError("Invalid PNG asset key")
    try:
        record = json.loads((directory / (key + ".json")).read_text())
        raw = (directory / (key + ".png")).read_bytes()
    except FileNotFoundError as exc:
        raise ValueError("Missing project PNG asset " + key) from exc
    digest = hashlib.sha256(raw).hexdigest()
    page = record["sourcePageUrl"]
    origin = record["origin"]
    identity = resource_identity(page)
    if (
        digest != record["sha256"]
        or record["id"] != key
        or hashlib.sha256((page + origin + digest).encode()).hexdigest() != key
        or identity is None
        or origin not in {"uploaded-original", "search-preview"}
    ):
        raise ValueError("Project PNG asset changed")
    record["provider"] = identity.split(":")[0]
    with Image.open(io.BytesIO(raw), formats=["PNG"]) as image:
        record["width"], record["height"] = image.size
    return record, raw


async def preview_png(media, url):
    try:
        async with media.get(url, allow_redirects=False) as res:
            if res.status != 200:
                return None
            buf = bytearray()
            async for chunk in res.content.iter_chunked(65536):
                buf.extend(chunk)
                if len(buf) > MAX_BYTES:
                    return None
        raw = bytes(buf)
        with Image.open(io.BytesIO(raw), formats=["PNG", "WEBP"]) as im:
            if im.width * im.height > 24_000_000 or im.is_animated:
                return None
            if im.format == "WEBP":
                out = io.BytesIO()
                im.convert("RGBA").save(out, "PNG")
                raw = out.getvalue()
        transparent_image(raw)
        return raw
    except (
        aiohttp.ClientError,
        TimeoutError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ):
        return None


async def search_png(directory, query, *, allow_previews, provider="Vecteezy"):
    from bind_photos import sheets
    from ComfyArt.api.mcp_tools.image_search import image_results

    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 180:
        raise ValueError("Supply a short keyword query")
    if provider not in SOURCES:
        raise ValueError("Choose Vecteezy, Pngtree or PNGimg")
    results = (
        await image_results(
            "site:" + SOURCES[provider][0] + " " + query.strip() + " transparent PNG", 8
        )
        if os.environ.get("BRAVE_SEARCH_API_KEY")
        else []
    )
    originals_file = directory / "originals.json"
    originals = (
        json.loads(originals_file.read_text()) if originals_file.exists() else {}
    )

    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=15),
        connector=aiohttp.TCPConnector(limit=4),
        trust_env=True,
    ) as media:

        async def one(row):
            page, url = row["sourcePageUrl"], row["imageUrl"]
            identity = resource_identity(page)
            if not identity or not identity.startswith(provider + ":"):
                return None
            if key := originals.get(identity):
                return read_png(directory, key)[0]
            target = media_url(provider, url)
            if not allow_previews or not target:
                return None
            raw = await preview_png(media, target)
            actual = target
            if raw is None:
                thumbnail = urlsplit(row.get("thumbnailUrl") or "")
                if (
                    thumbnail.scheme == "https"
                    and thumbnail.netloc == "imgs.search.brave.com"
                ):
                    actual = thumbnail.geturl()
                    raw = await preview_png(media, actual)
            if raw is None:
                return None
            return store_png(
                directory, raw, row["title"], page, actual, "search-preview"
            )

        records = [r for r in await asyncio.gather(*(one(row) for row in results)) if r]
    unique = {r["id"]: r for r in records}
    # Uploaded originals are also available when Brave omits their exact resource.
    for identity, key in originals.items():
        if not identity.startswith(provider + ":"):
            continue
        unique.setdefault(key, read_png(directory, key)[0])
    if not unique:
        return [], []
    with tempfile.TemporaryDirectory() as tmp:
        rows = []
        for n, record in enumerate(unique.values(), 1):
            im = Image.open(directory / (record["id"] + ".png")).convert("RGBA")
            im.thumbnail((410, 340), Image.Resampling.LANCZOS)
            bg = Image.new("RGBA", im.size, "#dededb")
            bg.alpha_composite(im)
            p = Path(tmp) / f"{n}.jpg"
            bg.convert("RGB").save(p)
            rows.append({"id": f"PNG{n}", "file": str(p)})
        blocks = sheets(rows)
    return list(unique.values()), blocks


def prepare_originals(directory, entries):
    mapping = {}
    for entry in entries:
        page = entry["sourcePageUrl"]
        identity = resource_identity(page)
        if not identity:
            raise ValueError("Expected a Vecteezy, Pngtree or PNGimg resource page")
        record = store_png(
            directory,
            Path(entry["file"]).read_bytes(),
            entry["name"],
            page,
            "",
            "uploaded-original",
        )
        mapping[identity] = record["id"]
    write_json(directory / "originals.json", mapping)


def decoration_keys(design):
    return {
        l["asset"]
        for group in [*design["spreads"], *design["components"]]
        for l in group["layers"]
        if l["kind"] == "png"
    }
