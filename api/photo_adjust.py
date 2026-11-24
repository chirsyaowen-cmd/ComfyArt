"""Render the same editable photo recipe for the Agent and the image panel."""
import asyncio
import json
import os
import re
import shutil
import tempfile
from pathlib import Path

from aiohttp import web
from PIL import Image

from ._common import error, routes

SLOTS = asyncio.Semaphore(2)
OPERATIONS = json.loads(Path(__file__).with_name("photo_operations.json").read_text())
MAX_STEPS = len(OPERATIONS) + 1
COLOR = {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}
RECIPE_SCHEMA = {"type": "array", "minItems": 1, "maxItems": MAX_STEPS, "items": {"oneOf": [
    {"type": "object", "properties": {"kind": {"enum": [kind]}, "value": {"type": "integer", "minimum": op["min"], "maximum": op["max"]}},
     "required": ["kind", "value"], "additionalProperties": False}
    for kind, op in OPERATIONS.items()
] + [{"type": "object", "properties": {"kind": {"enum": ["gradientMap"]},
       "stops": {"type": "array", "minItems": 2, "maxItems": 64, "items": {
           "type": "object", "properties": {"position": {"type": "number", "minimum": 0, "maximum": 1}, "color": COLOR},
           "required": ["position", "color"], "additionalProperties": False}}},
      "required": ["kind", "stops"], "additionalProperties": False}]}}


def commands(recipe):
    if not isinstance(recipe, list) or not 1 <= len(recipe) <= MAX_STEPS:
        raise ValueError("Expected a nonempty list of photo adjustments")
    result, seen = [], set()
    # Raster filters work on the active pixel layer. Keep their preceding steps on
    # that temporary image; the project always retains the full editable recipe.
    raster = any(isinstance(s, dict) and isinstance(s.get("kind"), str) and
                 s["kind"] in OPERATIONS and not OPERATIONS[s["kind"]]["command"].startswith("layer.")
                 for s in recipe)
    for item in recipe:
        kind = item.get("kind") if isinstance(item, dict) else None
        if not isinstance(kind, str) or kind in seen:
            raise ValueError("Expected distinct photo adjustments")
        seen.add(kind)
        if kind == "gradientMap":
            stops = item.get("stops")
            if not isinstance(stops, list) or not 2 <= len(stops) <= 64:
                raise ValueError("A gradient needs 2–64 color stops")
            pairs = []
            for stop in stops:
                pos = stop.get("position") if isinstance(stop, dict) else None
                if (type(pos) not in (float, int) or not 0 <= pos <= 1 or (pairs and pos <= pairs[-1][0])
                        or not isinstance(stop.get("color"), str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", stop["color"])):
                    raise ValueError("Expected increasing gradient positions and hex colors")
                pairs.append([pos, stop["color"]])
            if pairs[0][0] != 0 or pairs[-1][0] != 1:
                raise ValueError("Place the first and last gradient stops at 0 and 1")
            command, params = "layer.newAdjustmentLayer.gradientMap", {"stops": pairs}
        elif kind in OPERATIONS:
            op = OPERATIONS[kind]
            val = item.get("value")
            if type(val) is not int or not op["min"] <= val <= op["max"]:
                raise ValueError(f"Invalid value for {kind}")
            command = op["command"]
            params = {**op.get("fixed", {}), op["parameter"]: val}
        else:
            raise ValueError("Unknown photo adjustment")
        if raster:
            command = command.replace("layer.newAdjustmentLayer.", "image.adjustments.")
        result.append((command, params))
    return result


def cli():
    return shutil.which(os.environ.get("PHOTOCRAFT_CLI") or "photocraft-cli")


async def render(source, recipe, root):
    operations = commands(recipe)
    executable = cli()
    if not executable:
        raise ValueError("未找到 PhotoCraft。请在服务端设置 PHOTOCRAFT_CLI。")
    input_path = root / "source.png"
    input_path.write_bytes(source)
    with Image.open(input_path) as image:
        if image.format != "PNG" or image.width * image.height > 48_000_000:
            raise ValueError("Expected a PNG of at most 48 megapixels")
        image.verify()
    proc = await asyncio.create_subprocess_exec(executable, "mcp", "--no-gpu",
        "--automation-read-root", str(root), "--automation-write-root", str(root),
        cwd=root, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, limit=2**20,
        env={k: os.environ[k] for k in ("PATH", "SYSTEMROOT", "HOME", "TMPDIR") if k in os.environ})
    seq = 0

    async def rpc(method, params):
        nonlocal seq
        seq += 1
        proc.stdin.write((json.dumps({"jsonrpc": "2.0", "id": seq, "method": method, "params": params}) + "\n").encode())
        await proc.stdin.drain()
        while line := await proc.stdout.readline():
            msg = json.loads(line)
            if msg.get("id") == seq:
                if "error" in msg:
                    raise ValueError(str(msg["error"].get("message"))[:500])
                return msg["result"]
        raise ValueError("PhotoCraft stopped before returning an image")

    async def tool(name, args):
        result = await rpc("tools/call", {"name": name, "arguments": args})
        if result.get("isError"):
            raise ValueError("PhotoCraft: " + str(result.get("content"))[:500])

    try:
        await rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "ComfyArt", "version": "1"}})
        proc.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        await tool("doc_open", {"path": "source.png"})
        for name, params in operations:
            await tool("command_run", {"id": name, "params": params})
        await tool("doc_export", {"path": "result.png"})
        return (root / "result.png").read_bytes()
    finally:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()


@routes.post("/comfyart/photo_adjust")
async def render_photo(request):
    try:
        recipe = json.loads(request.headers.get("X-Photo-Recipe", "null"))
        commands(recipe)
        source = await request.read()
        async with SLOTS:
            with tempfile.TemporaryDirectory() as tmp:
                result = await asyncio.wait_for(render(source, recipe, Path(tmp)), 75)
        return web.Response(body=result, content_type="image/png")
    except asyncio.TimeoutError:
        return error("PhotoCraft 处理超时，照片已保留。", 504)
    except (ValueError, OSError, Image.DecompressionBombError) as exc:
        return error(str(exc), 400)
