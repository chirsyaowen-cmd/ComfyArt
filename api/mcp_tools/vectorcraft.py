import asyncio
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image

from ...runtime import DATA
from ..project_store import get_snapshot
from .._common import view_path
from ..mcp_commands import submit_command
from ._context import BOT_CHAT_ID, PROJECT
from .bot_tools import maybe_ask_run_approval

RENDER = Path(__file__).resolve().parents[2] / "vectorcraft" / "render.mjs"
TAGS = set("svg g path rect circle ellipse polygon polyline line text tspan title desc defs linearGradient radialGradient stop clipPath".split())
ATTRS = set("xmlns width height viewBox x y x1 x2 y1 y2 dx dy cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray fill-opacity stroke-opacity fill-rule opacity transform id offset stop-color stop-opacity gradientUnits gradientTransform font-size font-family font-weight text-anchor dominant-baseline clip-path".split())


def validate_svg(source):
    if not isinstance(source, str) or len(source.encode()) > 128_000 or "<!" in source:
        raise ValueError("Supply a static SVG under 128 KB without declarations")
    try:
        root = ElementTree.fromstring(source)
    except ElementTree.ParseError as e:
        raise ValueError("Invalid SVG: " + str(e)) from e
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError("Include the SVG namespace")
    for key in ("width", "height"):
        if not re.fullmatch(r"[0-9]{1,4}", root.get(key, "")) or not 1 <= int(root.get(key)) <= 2048:
            raise ValueError("Use integer SVG width and height from 1 to 2048")
    for node in root.iter():
        if node.tag.removeprefix("{http://www.w3.org/2000/svg}") not in TAGS:
            raise ValueError(f"Unsupported SVG element {node.tag}")
        for key, value in node.attrib.items():
            if key not in ATTRS or ("url" in value.lower() and not re.fullmatch(r"url\(#[\w.-]+\)", value)):
                raise ValueError(f"Unsupported SVG attribute or reference: {key}")


def project_folder():
    project = PROJECT.get()
    if not project or not BOT_CHAT_ID.get():
        raise ValueError("Open a project chat first")
    return Path("vectorcraft") / hashlib.sha256(project.encode()).hexdigest()


async def source_art(args):
    folder = project_folder()
    digest = args.get("artwork", "")
    if not isinstance(digest, str) or not re.fullmatch("[a-f0-9]{64}", digest):
        raise ValueError("Supply the artwork id from get_canvas")
    path = DATA / "output" / folder / digest / "source.svg"
    if not path.is_file():
        # Duplicated projects share the immutable assets referenced by their copied shapes.
        snapshot = json.loads(get_snapshot("default", PROJECT.get()) or "{}")
        records = snapshot.get("document", {}).get("store", {})
        for shape in records.values():
            if shape.get("type") != "image" or shape.get("meta", {}).get("vectorcraft") != digest:
                continue
            asset = records.get(shape.get("props", {}).get("assetId"), {})
            preview = Path(view_path(asset.get("props", {}).get("src") or ""))
            if preview.name == "preview.png" and preview.parent.name == digest and preview.is_relative_to(DATA / "output" / "vectorcraft"):
                path = preview.with_name("source.svg")
                break
        if not path.is_file():
            raise ValueError("Artwork not found in this project")
    return {"svg": path.read_text(encoding="utf-8")}


async def render_art(args):
    folder = project_folder()
    source = args.get("svg")
    validate_svg(source)
    name = str(args.get("name") or "VectorCraft")[:100]
    approval = await maybe_ask_run_approval(name)
    if approval is not None:
        return approval
    executable = shutil.which(os.environ.get("VECTORCRAFT_CLI") or "vectorcraft-cli")
    if not executable:
        raise ValueError("Set VECTORCRAFT_CLI to a headless VectorCraft executable")
    digest = hashlib.sha256(source.encode()).hexdigest()
    parent = DATA / "output" / folder
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / digest
    if not target.exists():
        with tempfile.TemporaryDirectory(dir=parent) as tmp:
            work = Path(tmp) / "document"
            work.mkdir()
            (work / "source.svg").write_text(source, encoding="utf-8")
            proc = await asyncio.create_subprocess_exec(
                "node", str(RENDER), executable, str(work),
                stderr=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL,
                env={key: os.environ[key] for key in ("PATH", "SYSTEMROOT") if key in os.environ})
            try:
                _, stderr = await asyncio.wait_for(proc.communicate(), 70)
            finally:
                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()
            if proc.returncode:
                raise ValueError("VectorCraft MCP failed: " + stderr.decode(errors="replace")[-1000:])
            with Image.open(work / "preview.png") as image:
                image.verify()
            if not (work / "design.vectorcraft").stat().st_size:
                raise ValueError("VectorCraft did not save the document")
            if not target.exists():
                work.rename(target)
    with Image.open(target / "preview.png") as image:
        width, height = image.size
    payload = {"name": name, "artwork": digest, "subfolder": (folder / digest).as_posix(),
               "width": width, "height": height}
    result = await submit_command("place_vectorcraft", payload, PROJECT.get(), chat=BOT_CHAT_ID.get())
    return {**result, "artwork": digest}


TOOLS = {
    "render_vectorcraft": {
        "description": "Create vector artwork with VectorCraft MCP and place it in this chat's project. Supply a complete static SVG with xmlns, integer width and height (1-2048), basic geometry, paths, text or gradients. Use presentation attributes, no CSS, scripts or external resources. The user can move/resize the placed image. To revise, read_vectorcraft and render a new version.",
        "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}, "svg": {"type": "string"}},
                        "required": ["svg"], "additionalProperties": False},
        "handler": render_art,
    },
    "read_vectorcraft": {
        "description": "Read the original editable SVG of artwork in the current project. Get the artwork id from get_canvas.",
        "inputSchema": {"type": "object", "properties": {"artwork": {"type": "string"}},
                        "required": ["artwork"], "additionalProperties": False},
        "handler": source_art,
    },
}
