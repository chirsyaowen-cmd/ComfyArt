from __future__ import annotations

import asyncio
import json

from conftest import SENT, write_settings
from ComfyArt import runtime

from ComfyArt.api import chat_store, mcp_commands
from ComfyArt.api.mcp_tools import bot_tools, photo_adjust, vectorcraft
from ComfyArt.api.bot_turns import ACTIVE_TURNS
from ComfyArt.bot.turns import TurnState
from ComfyArt.bot.guide import CORE_MCP_TOOLS
from ComfyArt.bot.providers import TurnHandle


async def _open(client, project="p", tab="tab-1"):
    runtime.sockets[tab] = object()
    await client.post("/comfyart/mcp_page", json={"client_id": tab, "project": project})


def _rpc(method, params=None, rid=1):
    return {"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}}


async def _answer_commands(client, reply):
    for _ in range(200):
        commands = [d for e, d in SENT if e == "comfyart-mcp-command"]
        if commands:
            SENT.clear()
            for c in commands:
                await client.post("/comfyart/mcp_command_result", json={"command_id": c["id"], **reply(c)})
            return commands
        await asyncio.sleep(0.01)
    raise AssertionError("no command was sent")


async def test_mcp_is_off_by_default(bot_client):
    write_settings(**{"enable-mcp": False})
    resp = await bot_client.post("/comfyart/mcp", json=_rpc("tools/list"))
    assert resp.status == 403


async def test_tools_list_matches_the_core_list(bot_client):
    tools = (await (await bot_client.post("/comfyart/mcp", json=_rpc("tools/list"))).json())["result"]["tools"]
    names = {t["name"] for t in tools}
    assert names == set(CORE_MCP_TOOLS) - set(bot_tools.TOOLS) - set(vectorcraft.TOOLS) - set(photo_adjust.TOOLS)

    chat = chat_store.create_chat(user="default", project="p", provider="codex")
    with_chat = await (await bot_client.post(f"/comfyart/mcp?bot_chat={chat['id']}", json=_rpc("tools/list"))).json()
    assert set(bot_tools.TOOLS) <= {t["name"] for t in with_chat["result"]["tools"]}


async def test_project_chat_discovers_photo_operations(bot_client):
    chat = chat_store.create_chat(user="default", project="photo-test", provider="deepseek-harness")
    path = "/comfyart/mcp?bot_chat=" + chat["id"]
    listing = await (await bot_client.post(path, json=_rpc("tools/list"))).json()
    assert {"adjust_photo", "list_photo_adjustments"} <= {t["name"] for t in listing["result"]["tools"]}
    result = await (await bot_client.post(path, json=_rpc("tools/call", {"name": "list_photo_adjustments"}))).json()
    operations = json.loads(result["result"]["content"][0]["text"])["operations"]
    assert operations["gradientMap"]["command"] == "layer.newAdjustmentLayer.gradientMap"
    assert operations["halftone"]["min"] == 4


async def test_canvas_tool_is_relayed_to_the_project_page(bot_client):
    await _open(bot_client, "other", "tab-0")
    await _open(bot_client, "proj-7")
    chat = chat_store.create_chat(user="default", project="proj-7", provider="codex")
    call = asyncio.create_task(bot_client.post(f"/comfyart/mcp?bot_chat={chat['id']}&roadmap_turn=first",
                                               json=_rpc("tools/call", {"name": "get_canvas", "arguments": {}})))
    commands = await _answer_commands(bot_client, lambda c: {"ok": True, "result": {"shapes": [], "page": "page:1"}})
    data = await (await call).json()
    assert commands[0]["roadmap_turn"] == "first"
    assert commands[0]["action"] == "get_canvas" and commands[0]["project"] == "proj-7" and commands[0]["_sid"] == "tab-1"
    assert data["result"]["isError"] is False
    assert '"page": "page:1"' in data["result"]["content"][0]["text"]


async def test_view_canvas_png_becomes_an_image_block(bot_client):
    await _open(bot_client)
    call = asyncio.create_task(bot_client.post("/comfyart/mcp", json=_rpc("tools/call", {"name": "view_canvas", "arguments": {}})))
    await _answer_commands(bot_client, lambda c: {"ok": True, "result": {"width": 4, "png": "QUJD"}})
    content = (await (await call).json())["result"]["content"]
    assert content[1] == {"type": "image", "data": "QUJD", "mimeType": "image/png"}
    assert "png" not in content[0]["text"]


async def test_zine_title_then_reviewed_decoration_preview(bot_client):
    await _open(bot_client)
    chat = chat_store.create_chat(user="default", project="p", provider="deepseek-harness")
    msg = chat_store.create_message(chat_id=chat["id"], role="assistant", blocks=[], status="streaming")
    ACTIVE_TURNS[chat["id"]] = TurnState(TurnHandle(), chat["id"], msg["id"])
    offer = {"frame": "shape:cover", "version": "current", "preview": "data:image/jpeg;base64,QUJD",
             "reason": "Echo the stem", "marks": [{"kind": "rect", "x": 31, "y": 215, "w": 43, "h": 2,
                                                     "rotation": 28, "fill": "#80623A"}]}
    async def invoke(name, args, result):
        call = asyncio.create_task(bot_client.post(f"/comfyart/mcp?bot_chat={chat['id']}", json=_rpc(
            "tools/call", {"name": name, "arguments": args})))
        await _answer_commands(bot_client, lambda _: {"ok": True, "result": result})
        response = (await (await asyncio.wait_for(call, timeout=2)).json())["result"]
        assert not response["isError"]
        return response["content"]

    try:
        await invoke("add_text", {"text": "海风来信", "frame": offer["frame"]}, {"id": "shape:title"})
        image = await invoke("preview_embellishments", {k: offer[k] for k in ("frame", "reason", "marks")},
                             {"preview_id": "draft", "jpeg": "QUJD"})
        assert image[1] == {"type": "image", "data": "QUJD", "mimeType": "image/jpeg"}
        assert chat_store.get_message(chat["id"], msg["id"])["blocks"] == []
        content = await invoke("suggest_embellishments", {"preview_id": "draft"}, {"embellishments": [offer]})
        assert json.loads(content[0]["text"]) == {"embellishment_cards": 1}
        block = {"type": "embellishment", "offer": {**offer, "project": "p"}}
        assert chat_store.get_message(chat["id"], msg["id"])["blocks"] == [block]
        assert [data["blocks"] for event, data in SENT if event == "comfyart-bot" and data["event"] == "turn_embellishments"] == [[block]]
    finally:
        ACTIVE_TURNS.pop(chat["id"], None)


async def test_comfyui_models_are_not_available(bot_client):
    response = await bot_client.post("/comfyart/mcp", json=_rpc("tools/list"))
    names = {row["name"] for row in (await response.json())["result"]["tools"]}
    assert "list_models" not in names and "generate_image" not in names


async def test_page_errors_come_back_as_tool_errors(bot_client):
    await _open(bot_client)
    call = asyncio.create_task(bot_client.post("/comfyart/mcp", json=_rpc("tools/call", {"name": "focus", "arguments": {"ids": ["x"]}})))
    await _answer_commands(bot_client, lambda c: {"ok": False, "error": "no shape x"})
    result = (await (await call).json())["result"]
    assert result["isError"] is True and "no shape x" in result["content"][0]["text"]


async def test_no_open_page_fails_at_once():
    try:
        await mcp_commands.submit_command("get_canvas", {}, "p", timeout=5)
    except ValueError as e:
        assert "not open in any browser tab" in str(e)
    else:
        raise AssertionError("expected an error")


async def test_without_a_project_several_open_projects_are_ambiguous(bot_client):
    await _open(bot_client, "a", "tab-a")
    await _open(bot_client, "b", "tab-b")
    try:
        await mcp_commands.submit_command("get_canvas", {}, "", timeout=5)
    except ValueError as e:
        assert "several ComfyArt projects" in str(e)
    else:
        raise AssertionError("expected an error")


async def test_slow_page_times_out_without_claiming_it_is_closed(bot_client):
    await _open(bot_client)
    try:
        await mcp_commands.submit_command("get_canvas", {}, "p", timeout=0.05)
    except ValueError as e:
        assert "may still complete" in str(e)
    else:
        raise AssertionError("expected a timeout")


async def test_generation_asks_first_when_the_chat_runs_in_ask_mode(bot_client):
    chat = chat_store.create_chat(user="default", project="p", provider="codex", run_mode="ask")
    msg = chat_store.create_message(chat_id=chat["id"], role="assistant", blocks=[], status="streaming")
    ACTIVE_TURNS[chat["id"]] = TurnState(TurnHandle(), chat["id"], msg["id"])
    call = asyncio.create_task(bot_client.post(f"/comfyart/mcp?bot_chat={chat['id']}", json=_rpc(
        "tools/call", {"name": "render_vectorcraft", "arguments": {"name": "a cat", "svg": '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'}})))
    for _ in range(200):
        asks = [d for e, d in SENT if e == "comfyart-bot" and d["event"] == "turn_ask"]
        if asks:
            break
        await asyncio.sleep(0.01)
    assert asks[0]["kind"] == "run_approval" and "a cat" in asks[0]["prompt"]
    await bot_client.post(f"/comfyart/bot/chats/{chat['id']}/asks/{asks[0]['ask_id']}/answer", json={"selected": ["cancel"]})
    result = (await (await call).json())["result"]
    assert '"declined"' in result["content"][0]["text"]
    assert not [d for e, d in SENT if e == "comfyart-mcp-command"]
    ACTIVE_TURNS.clear()
