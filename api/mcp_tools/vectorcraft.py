import asyncio
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image, ImageOps

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


async def run_vectorcraft(work: Path, colors: int | None):
    executable = shutil.which(os.environ.get("VECTORCRAFT_CLI") or "vectorcraft-cli")
    if not executable:
        raise ValueError("Set VECTORCRAFT_CLI to a headless VectorCraft executable")
    proc = await asyncio.create_subprocess_exec(
        "node", str(RENDER), executable, str(work), *([str(colors)] if colors else []),
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


def prepare_photo(source: Path, dest: Path):
    with Image.open(source) as original:
        if original.format not in {"JPEG", "PNG", "WEBP"} or getattr(original, "is_animated", False):
            raise ValueError("Select a still JPEG, PNG or WebP photo")
        original.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        upright = ImageOps.exif_transpose(original).convert("RGBA")
        background = Image.new("RGB", upright.size, "white")
        background.paste(upright, mask=upright.getchannel("A"))
        background.save(dest)


def finalize_palette(work: Path, limit: int):
    palette = json.loads((work / "palette.json").read_text())
    if not isinstance(palette, list) or not 1 <= len(palette) <= limit or not all(
        isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color) for color in palette
    ):
        raise ValueError("VectorCraft did not return the requested limited palette")
    swatches = b"".join(bytes.fromhex(color[1:]) for color in palette)
    table = Image.new("P", (1, 1))
    table.putpalette(swatches + swatches[:3] * (256 - len(palette)))
    # Keep antialiased edge pixels inside the exact palette of the native traced paths.
    with Image.open(work / "preview.png") as image:
        indexed = image.convert("RGB").quantize(palette=table, dither=Image.Dither.NONE)
    indexed.save(work / "preview.png", optimize=True)


async def build_artwork(folder, digest, *, svg=None, photo=None, colors=None):
    parent = DATA / "output" / folder
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / digest
    if not target.exists():
        with tempfile.TemporaryDirectory(dir=parent) as tmp:
            work = Path(tmp) / "document"
            work.mkdir()
            if photo is not None:
                await asyncio.to_thread(prepare_photo, photo, work / "photo.png")
            else:
                (work / "source.svg").write_text(svg, encoding="utf-8")
            await run_vectorcraft(work, colors)
            if colors is not None:
                await asyncio.to_thread(finalize_palette, work, colors)
                (work / "photo.png").unlink()
            with Image.open(work / "preview.png") as image:
                image.verify()
            if not (work / "design.vectorcraft").stat().st_size:
                raise ValueError("VectorCraft did not save the document")
            if not target.exists():
                work.rename(target)
    with Image.open(target / "preview.png") as image:
        width, height = image.size
        used = len(image.convert("RGB").getcolors(256)) if colors is not None else None
    return {"artwork": digest, "subfolder": (folder / digest).as_posix(), "width": width,
            "height": height, **({"used_colors": used} if used is not None else {})}


async def render_art(args):
    folder = project_folder()
    source = args.get("svg")
    validate_svg(source)
    name = str(args.get("name") or "VectorCraft")[:100]
    approval = await maybe_ask_run_approval(name)
    if approval is not None:
        return approval
    digest = hashlib.sha256(source.encode()).hexdigest()
    payload = await build_artwork(folder, digest, svg=source)
    result = await submit_command("place_vectorcraft", {**payload, "name": name}, PROJECT.get(), chat=BOT_CHAT_ID.get())
    return {**result, "artwork": digest}


async def color_blocks(args):
    folder = project_folder()
    shape, colors = args.get("shape_id"), args.get("colors")
    if not isinstance(shape, str) or not shape.startswith("shape:") or type(colors) is not int or not 2 <= colors <= 256:
        raise ValueError("Provide a photo shape_id and an integer color count from 2 through 256")
    project, chat = PROJECT.get(), BOT_CHAT_ID.get()
    original = await submit_command("vectorcraft_photo_source", {"id": shape}, project, chat=chat)
    url = original["src"]
    if not url.startswith("/api/view?"):
        raise ValueError("Please import the photo into this project before processing")
    approval = await maybe_ask_run_approval(f"{original['name']} · {colors} 色")
    if approval is not None:
        return approval
    photo = Path(view_path(url))
    def recipe_hash():
        digest = hashlib.sha256(f"VectorCraft photo trace v1/{colors}/".encode())
        with photo.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    digest = await asyncio.to_thread(recipe_hash)
    payload = await build_artwork(folder, digest, photo=photo, colors=colors)
    name = f"{original['name']} · {payload['used_colors']} 色"
    result = await submit_command("place_vectorcraft", {**payload, "name": name, "beside": shape, "source_url": url}, project, chat=chat)
    return {**result, "source_id": shape, "artwork": digest, "used_colors": payload["used_colors"]}


TOOLS = {
    "vectorcraft_color_blocks": {
        "description": "Turn a selected canvas photo into flat color blocks using real VectorCraft image tracing. Use this for requests like 只保留4种颜色. Pass the original photo shape_id from the message or get_canvas and the requested number of colors. Places the processed image directly beside the unchanged original and returns its id and actual palette size.",
        "inputSchema": {"type": "object", "properties": {"shape_id": {"type": "string"},
                        "colors": {"type": "integer", "minimum": 2, "maximum": 256}},
                        "required": ["shape_id", "colors"], "additionalProperties": False},
        "handler": color_blocks,
    },
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
