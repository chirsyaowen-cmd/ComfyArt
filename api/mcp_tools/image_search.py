import asyncio
import json
import os
from urllib.parse import urlsplit

import aiohttp


ENDPOINT = "https://api.search.brave.com/res/v1/images/search"
MAX_COUNT = 12


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
    return {"images": images}


TOOLS = {
    "search_images": {
        "description": "Search the web for image references. Use imageUrl for the original image, "
                       "thumbnailUrl for the preview and sourcePageUrl to cite its source.",
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
