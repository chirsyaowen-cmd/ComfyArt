from . import vectorcraft

from .. import chat_store
from . import bot_tools, canvas, image_search, media
from ._context import BOT_CHAT_ID, PROJECT


async def _server_info(_args: dict) -> dict:
    chat = chat_store.get_chat(BOT_CHAT_ID.get()) if BOT_CHAT_ID.get() else None
    return {
        "app": "ComfyArt",
        "project": PROJECT.get() or None,
        "chat": {"id": chat["id"], "provider": chat["provider"], "run_mode": chat["run_mode"]} if chat else None,
        "runtime": "standalone-dsh",
    }


TOOLS: dict[str, dict] = {
    "server_info": {
        "description": "ComfyArt status: the open project, this chat and its runtime.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "handler": _server_info,
    },
}
CANVAS_TOOLS = ("get_canvas", "view_canvas", "brand_kits", "add_text", "add_shape", "create_frame",
                "update_shapes", "delete_shapes", "focus", "memory", "skill", "create_slides", "vectorize_image")
TOOLS.update({name: canvas.TOOLS[name] for name in CANVAS_TOOLS})
TOOLS.update(vectorcraft.TOOLS)
TOOLS.update(media.TOOLS)
TOOLS.update(image_search.TOOLS)
TOOLS.update(bot_tools.TOOLS)
