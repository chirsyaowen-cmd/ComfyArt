import asyncio
import json

from conftest import write_settings
from ComfyArt.api import chat_store, memory_store, project_store


def project(pid, name):
    project_store.save_project("default", pid, "{}", name, [], None)


def add(pid, value, scope="project"):
    return memory_store.mutate("default", pid, {"action": "add", "text": value, "scope": scope}, source="editor")


async def test_request_and_mcp_read_only_the_chat_project(bot_client, fake_provider):
    project("a", "橙色日出")
    project("b", "未命名小志")
    a = add("a", "封面用橙色")
    b = add("b", "保留绿色")
    g = add("a", "用小白语言", "global")
    chat = chat_store.create_chat(user="default", project="b", provider=fake_provider.id)
    path = "/comfyart/bot/chats/" + chat["id"]
    response = await bot_client.post(path + "/send", json={"text": "看看封面", "memory": "橙色日出", "project": "a"})
    assert response.status == 200
    for _ in range(100):
        if fake_provider.last_turn:
            break
        await asyncio.sleep(.02)
    prompt = fake_provider.last_turn.user_text
    assert all(x in prompt for x in ("未命名小志", b["text"], g["text"]))
    assert "橙色日出" not in prompt and a["text"] not in prompt
    rpc = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
           "params": {"name": "memory", "arguments": {"action": "list", "project": "a"}}}
    result = await (await bot_client.post("/comfyart/mcp?project=a&bot_chat=" + chat["id"], json=rpc)).json()
    assert {m["id"] for m in json.loads(result["result"]["content"][0]["text"])["memories"]} == {b["id"], g["id"]}
    assert (await bot_client.post("/comfyart/projects/b/memory", json={"action": "forget", "id": a["id"]})).status == 400
    write_settings(**{"memory-enabled": False})
    result = await (await bot_client.post("/comfyart/mcp?bot_chat=" + chat["id"], json=rpc)).json()
    assert result["result"]["isError"]


def test_same_text_is_independent_on_duplicate_and_delete():
    project("a", "Original")
    first = add("a", "封面用绿色")
    shared = add("a", "用小白语言", "global")
    project_store.duplicate_project("default", "a", "b", "Copy")
    copy = next(m for m in memory_store.listing("default", "b")["memories"] if m["scope"] == "project")
    assert first["id"] != copy["id"]
    memory_store.mutate("default", "b", {"action": "correct", "id": copy["id"], "text": "封面用灰色"}, source="editor")
    assert memory_store.listing("default", "a")["memories"][0]["text"] == "封面用绿色"
    project_store.delete_project("default", "b")
    assert [m["id"] for m in memory_store.listing("default", "b")["memories"]] == [shared["id"]]


def test_legacy_origin_and_dsh_reset(fresh_user_dir):
    project("a", "橙色日出")
    project("b", "未命名小志")
    chat_a = chat_store.create_chat(user="default", project="a", provider="deepseek-harness")
    chat_b = chat_store.create_chat(user="default", project="b", provider="deepseek-harness")
    user_msg = chat_store.create_message(chat_id=chat_a["id"], role="user", blocks=[{"type": "text", "text": "记住纸张用米色"}])
    chat_store.create_message(chat_id=chat_a["id"], role="assistant", parent_id=user_msg["id"], blocks=[
        {"type": "tool_use", "name": "mcp__comfyart__memory", "id": "add", "input": {"action": "add", "text": "纸张用米色"}},
        {"type": "tool_result", "name": "mcp__comfyart__memory", "id": "add", "status": "success"}])
    msg = chat_store.create_message(chat_id=chat_b["id"], role="assistant", blocks=[{"type": "text", "text": "旧对话保留"}])
    chat_store.update_message(chat_b["id"], msg["id"], resume_token_after="old-token")
    chat_b = chat_store.update_chat(chat_b["id"], resume_token="old-token")
    path = fresh_user_dir / "userdata/comfyart"
    path.mkdir(parents=True, exist_ok=True)
    (path / "memory.json").write_text(json.dumps([{"text": "作品名称：「橙色日出」"}, {"text": "纸张用米色"}]))
    prompt, token = memory_store.turn_context(chat_b, "hello")
    assert "橙色日出" not in prompt and "纸张用米色" not in prompt and token is None
    managed = memory_store.listing("default", "b", management=True)
    assert managed["memories"] == [] and len(managed["legacy"]) == 1
    recovered, = memory_store.listing("default", "a")["memories"]
    assert recovered["source_message_id"] == user_msg["id"] and recovered["text"] == "纸张用米色"
    assert len(memory_store.listing("default", "b", management=True)["legacy"]) == 1
    history, = chat_store.list_messages(chat_b["id"])
    assert history["blocks"] == msg["blocks"] and history["resume_token_after"] is None
    chat_b = chat_store.update_chat(chat_b["id"], resume_token="clean-token")
    assert memory_store.turn_context(chat_b, "next")[1] == "clean-token"
    add("a", "A 项目的新决定")
    assert memory_store.turn_context(chat_b, "next")[1] == "clean-token"
    add("b", "B 项目的新决定")
    assert memory_store.turn_context(chat_b, "next")[1] is None


async def test_memory_tool_binds_new_notes_to_the_current_user_turn(bot_client, fake_provider):
    chat = chat_store.create_chat(user="default", project="b", provider=fake_provider.id)
    fake_provider.gate = asyncio.Event()
    path = "/comfyart/bot/chats/" + chat["id"]
    response = await bot_client.post(path + "/send", json={"text": "这个封面用绿色；以后所有项目都用小白语言。"})
    message = (await response.json())["user_message"]["id"]

    async def tool(**args):
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": "memory", "arguments": args}}
        result = (await (await bot_client.post("/comfyart/mcp?bot_chat=" + chat["id"], json=body)).json())["result"]
        assert not result["isError"], result
        return json.loads(result["content"][0]["text"])
    try:
        private = await tool(action="add", text="封面用绿色", project="a")
        shared = await tool(action="add", scope="global", text="用小白语言", global_request="以后所有项目都用小白语言")
        assert private["scope"] == "project" and private["project"] == "b"
        assert private["source_message_id"] == shared["source_message_id"] == message
        assert shared["scope"] == "global" and shared["project"] is None
        assert {m["id"] for m in memory_store.listing("default", "a")["memories"]} == {shared["id"]}
        rejected = await bot_client.post("/comfyart/projects/a/memory",
                                         json={"action": "add", "text": "wrong project", "source_message_id": message})
        assert rejected.status == 400
    finally:
        fake_provider.gate.set()
        for _ in range(80):
            if fake_provider.last_turn:
                break
            await asyncio.sleep(.02)


def test_unassigned_legacy_is_reviewable_and_never_enters_a_prompt(fresh_user_dir):
    path = fresh_user_dir / "userdata/comfyart"
    path.mkdir(parents=True)
    (path / "memory.json").write_text(json.dumps([{"text": "使用短句"}]))
    old, = memory_store.listing("default", "b", management=True)["legacy"]
    assert old["can_assign"] and not memory_store.listing("default", "b")["memories"]
    promoted = memory_store.mutate("default", "b", {"action": "assign", "id": old["id"], "scope": "global"},
                                   management=True, source="editor")
    assert promoted["scope"] == "global"
    assert [m["id"] for m in memory_store.listing("default", "a")["memories"]] == [old["id"]]


def test_automatic_global_requires_matching_user_evidence():
    chat = chat_store.create_chat(user="default", project="b", provider="deepseek-harness")
    quote = "以后所有项目都用小白语言"
    user_msg = chat_store.create_message(chat_id=chat["id"], role="user", blocks=[{"type": "text", "text": "这本封面用绿色。" + quote}])
    def extract(note, evidence):
        return memory_store.mutate("default", "b", {"action": "add", "text": note, "scope": "global", "global_request": evidence},
                                   message_id=user_msg["id"], source="automatic", automatic=True)
    assert extract("封面用绿色", quote)["scope"] == "project"
    assert extract("用小白语言", quote)["scope"] == "global"
    assert [r["text"] for r in memory_store.listing("default", "a")["memories"]] == ["用小白语言"]


def test_previous_zine_sessions_start_clean_without_erasing_the_visible_chat():
    old = chat_store.create_chat(user="default", project="book", provider="deepseek-harness")
    other = chat_store.create_chat(user="default", project="canvas", provider="fake-test")
    message = chat_store.create_message(chat_id=old["id"], role="user", blocks=[
        {"type": "roadmap_turn", "token": "old-editor"}, {"type": "text", "text": "封面用绿色"}])
    chat_store.update_message(old["id"], message["id"], resume_token_after="old-session")
    old = chat_store.update_chat(old["id"], resume_token="old-session")
    other = chat_store.update_chat(other["id"], resume_token="other-session")
    assert memory_store.turn_context(other, "hello")[1] == "other-session"
    assert memory_store.turn_context(old, "继续")[1] is None
    saved, = chat_store.list_messages(old["id"])
    assert saved["blocks"] == message["blocks"] and saved["resume_token_after"] is None
    current = chat_store.update_chat(old["id"], resume_token="new-session")
    assert memory_store.turn_context(current, "继续")[1] == "new-session"
