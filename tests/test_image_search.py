import json

from aiohttp import web
from aiohttp.test_utils import TestServer
import pytest

from ComfyArt.api.mcp_tools import image_search


async def test_search_images_through_mcp(bot_client, monkeypatch):
    row = {"title": "Zine", "url": "https://example.org/zine",
           "properties": {"url": "https://example.org/cover.jpg"},
           "thumbnail": {"src": "https://example.org/small.jpg"}}
    async def brave(request):
        assert request.headers["X-Subscription-Token"] == "test-token"
        assert dict(request.query) == {"q": "黑白拼贴", "count": "2", "safesearch": "strict"}
        return web.json_response({"results": [{}, row, row]})

    app = web.Application()
    app.router.add_get("/images", brave)
    async with TestServer(app) as server:
        monkeypatch.setattr(image_search, "ENDPOINT", str(server.make_url("/images")))
        monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "test-token")
        request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                   "params": {"name": "search_images", "arguments": {"query": "黑白拼贴", "count": 2}}}
        result = (await (await bot_client.post("/comfyart/mcp", json=request)).json())["result"]
    assert not result["isError"]
    assert json.loads(result["content"][0]["text"]) == {"images": [{
        "title": "Zine", "thumbnailUrl": row["thumbnail"]["src"], "imageUrl": row["properties"]["url"],
        "sourcePageUrl": row["url"],
    }]}


async def test_search_images_without_key(monkeypatch):
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    with pytest.raises(ValueError, match="BRAVE_SEARCH_API_KEY"):
        await image_search.search_images({"query": "zine"})
