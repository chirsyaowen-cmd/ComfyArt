import json
import os
import shutil
from pathlib import Path
from xml.etree import ElementTree

import pytest
from PIL import Image

from ComfyArt.api.mcp_tools.vectorcraft import build_artwork, finalize_palette


def test_antialiased_preview_uses_only_native_swatches(tmp_path):
    palette = ["#072a28", "#27887b", "#ad441b", "#f4c979"]
    (tmp_path / "palette.json").write_text(json.dumps(palette))
    image = Image.new("RGB", (5, 1))
    colors = [tuple(bytes.fromhex(color[1:])) for color in palette]
    image.putdata(colors + [(40, 60, 50)])
    image.save(tmp_path / "preview.png")
    finalize_palette(tmp_path, 4)
    with Image.open(tmp_path / "preview.png") as result:
        assert {rgb for _, rgb in result.convert("RGB").getcolors()} == set(colors)


async def test_headless_mcp_photo_trace(fresh_user_dir):
    if not shutil.which(os.environ.get("VECTORCRAFT_CLI") or "vectorcraft-cli"):
        pytest.skip("Set VECTORCRAFT_CLI to run the real headless integration")
    photo = fresh_user_dir / "input.jpg"
    image = Image.new("RGB", (128, 96))
    image.putdata([(x * 2, y * 2, (x + y) % 256) for y in range(96) for x in range(128)])
    image.save(photo)
    original = photo.read_bytes()
    folder = Path("vectorcraft/test-project")
    result = await build_artwork(folder, "test-trace", photo=photo, colors=4)
    out = fresh_user_dir / "output" / result["subfolder"]
    assert result["used_colors"] == 4
    assert (out / "design.vectorcraft").stat().st_size > 0
    svg = ElementTree.parse(out / "source.svg")
    fills = {p.get("fill") for p in svg.iter("{http://www.w3.org/2000/svg}path")}
    with Image.open(out / "preview.png") as preview:
        assert preview.size == image.size
        assert {"#%02x%02x%02x" % rgb for _, rgb in preview.convert("RGB").getcolors()} == fills
    assert photo.read_bytes() == original
