"""Project-aware memory management for the editor and the chat MCP tool."""
from aiohttp import web

from .. import runtime
from . import chat_store, memory_store
from ._common import error, json_body, request_user, routes
from .settings import get_setting

@routes.get("/comfyart/projects/{pid}/memory")
async def get_memory(request):
    return web.json_response(memory_store.listing(request_user(request), request.match_info["pid"], management=True))


@routes.post("/comfyart/projects/{pid}/memory")
async def change_memory(request):
    user, project = request_user(request), request.match_info["pid"]
    args = await json_body(request)
    try:
        source = str(args.get("source") or "editor")
        message = args.get("source_message_id")
        if message and not get_setting("memory-enabled"):
            raise ValueError("Memory is off")
        # Automatic extraction must be attributable to the original user message.
        if message:
            if args.get("action") != "add":
                raise ValueError("Automatic extraction can only add project notes")

        result = memory_store.mutate(user, project, args, source=source, message_id=message, management=not message, automatic=bool(message))
        runtime.send_event("comfyart-memory", {})
        return web.json_response(result)
    except ValueError as exc:
        return error(str(exc), 400)


async def memory_tool(args):
    from .mcp_tools._context import BOT_CHAT_ID
    from .bot_turns import ACTIVE_TURNS
    from .mcp_tools.bot_tools import ask_user
    chat = chat_store.get_chat(BOT_CHAT_ID.get()) if BOT_CHAT_ID.get() else None
    if not chat:
        raise ValueError("Open a project chat to access its memories")
    action = args.get("action")
    if action != "forget" and not get_setting("memory-enabled"):
        raise ValueError("Memory is off")
    if action == "list":
        return memory_store.listing(chat["user"], chat["project"])
    if action not in ("add", "correct", "forget"):
        raise ValueError("Unknown memory action")
    state = ACTIVE_TURNS.get(chat["id"])
    msg = chat_store.get_message(chat["id"], state.message_id) if state else None
    parent = chat_store.get_message(chat["id"], msg["parent_id"]) if msg and msg["parent_id"] else None
    if not parent or parent["role"] != "user":
        raise ValueError("A user turn is required to change memory")
    if action == "add" and args.get("scope") == "global":
        if not memory_store.explicit_global_request(parent["blocks"], args):
            answer = await ask_user({"prompt": f"把这条偏好用于哪些项目？\n{args.get('text', '')}",
                                     "options": [{"id": "project", "label": "仅当前项目"}, {"id": "global", "label": "所有项目"}]})
            if answer.get("status") != "answered":
                return {"status": answer.get("status")}
            args = {**args, "scope": answer["selected"][0]}
    result = memory_store.mutate(chat["user"], chat["project"], args, source="chat", message_id=parent["id"])
    runtime.send_event("comfyart-memory", {})
    return result


TOOL = {
    "description": "Memories for this chat's project and explicitly shared user preferences. List before correcting or forgetting by ID. "
                   "Save project decisions with default scope project. Only use global for an explicitly lasting cross-project preference; "
                   "quote the user's scope instruction in global_request. The project record owns the artwork title.",
    "inputSchema": {"type": "object", "properties": {
        "action": {"enum": ["list", "add", "correct", "forget"]}, "id": {"type": "string"}, "text": {"type": "string"},
        "scope": {"enum": ["project", "global"]}, "global_request": {"type": "string"},
        "category": {"enum": ["about", "taste", "work", "assets"]}}, "required": ["action"], "additionalProperties": False},
    "handler": memory_tool,
}
