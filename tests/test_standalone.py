from aiohttp import FormData
from aiohttp.test_utils import TestClient, TestServer

from ComfyArt.__main__ import create_app
from ComfyArt.api import chat_store


async def test_standalone_upload_event_and_project_scope():
    async with TestClient(TestServer(create_app())) as client:
        assert (await client.get("/comfyart/")).status == 200
        data = FormData()
        data.add_field("image", b"project notes", filename="notes.txt")
        ref = await (await client.post("/api/upload/image", data=data)).json()
        response = await client.get("/api/view", params={**ref, "filename": ref["name"]})
        assert await response.read() == b"project notes"
        assert (await client.put("/api/comfyart/settings", json={}, headers={"Origin": "https://example.org"})).status == 403

        async with client.ws_connect("/ws?clientId=browser") as ws:
            await client.post("/api/comfyart/mcp_page", json={"client_id": "browser", "project": "first"})
            chat = chat_store.create_chat(user="default", project="other", provider="deepseek-harness")
            async def call(name, arguments):
                body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                        "params": {"name": name, "arguments": arguments}}
                response = await client.post("/comfyart/mcp", params={"bot_chat": chat["id"]}, json=body)
                return (await response.json())["result"]

            assert (await call("get_canvas", {}))["isError"]
            assert (await call("read_vectorcraft", {"artwork": "a"*64}))["isError"]
            created = await client.post("/api/comfyart/bot/chats", json={"provider": "deepseek-harness", "project": "first"})
            assert created.status == 200
            event = await ws.receive_json(timeout=2)
            assert event["type"] == "comfyart-bot" and event["data"]["chat"]["project"] == "first"


async def test_two_editors_cannot_overwrite_each_other(bot_client):
    url = "/comfyart/projects/shared"
    created = await bot_client.put(url, json={"snapshot": {"title": "initial"}})
    initial = created.headers["ETag"]
    assert (await bot_client.get(url)).headers["ETag"] == initial
    saved = await bot_client.put(url, json={"snapshot": {"title": "newer"}}, headers={"If-Match": initial})
    assert saved.status == 200 and saved.headers["ETag"] != initial
    assert (await bot_client.put(url, json={"snapshot": {}}, headers={"If-Match": initial})).status == 412
    assert (await bot_client.put(url, json={"snapshot": {}})).status == 412
    assert (await (await bot_client.get(url)).json()) == {"title": "newer"}


async def test_photo_library_lists_uploaded_images_by_name():
    async with TestClient(TestServer(create_app())) as client:
        for name in ("试刊 A.jpg", "试刊 B.png", "试刊说明.txt"):
            data = FormData(quote_fields=False)
            data.add_field("image", name.encode(), filename=name, content_type="application/octet-stream")
            assert (await client.post("/api/upload/image", data=data)).status == 200
        query = {"tags_any": "input", "name_contains": "试刊", "limit": 1}
        first = await (await client.get("/api/assets", params=query)).json()
        second = await (await client.get("/api/assets", params={**query, "after": first["next_cursor"]})).json()
        items = first["assets"] + second["assets"]
        assert {item["name"] for item in items} == {"试刊 A.jpg", "试刊 B.png"}
        assert second["next_cursor"] is None
        for item in items:
            response = await client.get(item["preview_url"])
            assert await response.read() == item["name"].encode()
