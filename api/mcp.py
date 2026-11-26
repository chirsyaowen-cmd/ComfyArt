import re
from pathlib import Path

from aiohttp import web

from ..bot.mcp_server import McpServer, rpc_error
from . import chat_store
from ._common import routes
from .mcp_commands import ROADMAP_TURN
from .mcp_tools import TOOLS, bot_tools, photo_adjust, vectorcraft
from .mcp_tools._context import BOT_CHAT_ID, PROJECT
from .settings import mcp_enabled

VERSION = re.search(r'^version = "([^"]+)"', (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text(encoding="utf-8"), re.MULTILINE).group(1)

INSTRUCTIONS = (
    "For a whole reference-based Zine use make_reference_zine and wait for its canvas URL. "
    "Work in the current ComfyArt project. Use get_canvas for its selection and shape IDs. "
    "Use render_vectorcraft to create and place vector artwork. Use ask_user for choices. "
    "Only report changes after receiving a successful tool result."
)


def _tool_visible(name: str) -> bool:
    return (name not in bot_tools.TOOLS and name not in vectorcraft.TOOLS and name not in photo_adjust.TOOLS) or bool(BOT_CHAT_ID.get())


SERVER = McpServer(name="comfyart-mcp", title="ComfyArt", version=VERSION, instructions=INSTRUCTIONS,
                   tools=TOOLS, tool_visible=_tool_visible)


@routes.post("/comfyart/mcp")
async def mcp_post(request: web.Request) -> web.Response:
    if not mcp_enabled():
        return web.json_response(rpc_error(None, -32000, "ComfyArt MCP is off: turn it on in Agent settings"), status=403)
    chat_id = str(request.query.get("bot_chat") or "")
    chat = chat_store.get_chat(chat_id) if chat_id else None
    if chat_id and not chat:
        raise web.HTTPNotFound()
    turn_token = ROADMAP_TURN.set(request.query.get("roadmap_turn", ""))
    chat_token = BOT_CHAT_ID.set(chat_id if chat else "")
    project_token = PROJECT.set(chat["project"] if chat else str(request.query.get("project") or ""))
    try:
        return await SERVER.respond(request)
    finally:
        ROADMAP_TURN.reset(turn_token)
        BOT_CHAT_ID.reset(chat_token)
        PROJECT.reset(project_token)


@routes.get("/comfyart/mcp")
async def mcp_get(_request: web.Request) -> web.Response:
    return web.json_response({"error": "SSE streams are not supported; POST JSON-RPC messages instead"}, status=405)


@routes.delete("/comfyart/mcp")
async def mcp_delete(_request: web.Request) -> web.Response:
    return web.Response(status=200)
