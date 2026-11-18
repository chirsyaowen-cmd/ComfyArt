import asyncio
import os
from pathlib import Path

from aiohttp import web

DATA = Path(os.environ.get("COMFYART_DATA", "~/.local/share/comfyart")).expanduser().resolve()
routes = web.RouteTableDef()
sockets: dict[str, web.WebSocketResponse] = {}
port = 8190
_pending: set[asyncio.Task] = set()


def confined(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not relative or path == root or not path.is_relative_to(root.resolve()):
        raise ValueError("invalid file path")
    return path


def send_event(event: str, data: dict, sid: str | None = None) -> None:
    targets = [sockets[sid]] if sid in sockets else [] if sid else list(sockets.values())
    for socket in targets:
        if not socket.closed:
            task = asyncio.create_task(socket.send_json({"type": event, "data": data}))
            _pending.add(task)
            task.add_done_callback(_pending.discard)
