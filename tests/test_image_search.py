import asyncio
import base64
import io
import json

from aiohttp import web
from aiohttp.test_utils import TestServer
import pytest
from PIL import Image
from test_mcp import _answer_commands, _open

from ComfyArt.api.mcp_tools import image_search


async def test_search_images_through_mcp(bot_client, monkeypatch):
    png = io.BytesIO()
    Image.new("RGB", (120, 160), "red").save(png, format="PNG")

    async def brave(request):
        assert request.headers["X-Subscription-Token"] == "test-token"
        assert dict(request.query) == {"q": "黑白拼贴", "count": "2", "safesearch": "strict"}
        row = {"title": "Zine", "url": "https://example.org/zine",
               "properties": {"url": str(server.make_url("/cover"))}}
        bad = {**row, "properties": {"url": str(server.make_url("/not-an-image"))}}
        return web.json_response({"results": [{}, bad, row, row]})

    async def cover(request):
        assert "X-Subscription-Token" not in request.headers
        return web.Response(body=png.getvalue())

    async def invalid(request):
        return web.Response(text="Not an image")

    app = web.Application()
    app.router.add_get("/images", brave)
    app.router.add_get("/cover", cover)
    app.router.add_get("/not-an-image", invalid)
    await _open(bot_client, "other", "other-tab")
    await _open(bot_client, "current")
    async with TestServer(app) as server:
        monkeypatch.setattr(image_search, "ENDPOINT", str(server.make_url("/images")))
        monkeypatch.setattr(image_search, "_public_socket", None)  # allow the fixture's loopback server
        monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "test-token")
        request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                   "params": {"name": "search_images", "arguments": {"query": "黑白拼贴", "count": 2}}}
        call = asyncio.create_task(bot_client.post("/comfyart/mcp?project=current", json=request))
        command, = await _answer_commands(bot_client, lambda _: {"ok": True, "result": {"added": 1}})
        result = (await (await call).json())["result"]
        assert not result["isError"]
        metadata, preview = result["content"]
        data = json.loads(metadata["text"])
        failed, saved = data["images"]
        assert data["added"] == 1 and "localUrl" not in failed
        assert saved == {"title": "Zine", "thumbnailUrl": None, "imageUrl": str(server.make_url("/cover")),
                         "sourcePageUrl": "https://example.org/zine", "localUrl": saved["localUrl"], "savedFrom": "original"}
        assert data["savedReferences"] == [{
            "refId": image_search.reference_id(saved["imageUrl"]), "name": "Zine", "previewNumber": 2,
        }]
        assert preview["type"] == "image" and preview["mimeType"] == "image/jpeg"
        with Image.open(io.BytesIO(base64.b64decode(preview["data"]))) as sheet:
            r, g, b = sheet.getpixel((175, 80))
            assert r > 200 and g < 30 and b < 30
        assert command["action"] == "add_search_references" and command["project"] == "current"
        assert command["args"]["images"] == [saved]
        response = await bot_client.get(saved["localUrl"].removeprefix("/api"))
        assert response.content_type == "image/png" and await response.read() == png.getvalue()


async def test_search_images_without_key(monkeypatch):
    monkeypatch.delenv("BRAVE_SEARCH_API_KEY", raising=False)
    with pytest.raises(ValueError, match="BRAVE_SEARCH_API_KEY"):
        await image_search.search_images({"query": "zine"})
