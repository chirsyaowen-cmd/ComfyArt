import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from canvas_records import shape
from native_assets import CanvasAssets
from native_canvas import Spread
from PIL import Image
from png_assets import (
    media_url,
    prepare_originals,
    read_png,
    resource_identity,
    store_png,
    transparent_image,
)


def encoded(alpha):
    im = Image.new("RGBA", (10, 20), (40, 130, 90, alpha))
    if alpha == 127:
        im.putpixel((0, 0), (0, 0, 0, 0))
    f = io.BytesIO()
    im.save(f, "PNG")
    return f.getvalue()


class PngLayers(unittest.IsolatedAsyncioTestCase):
    def test_only_provider_art_and_real_transparency(self):
        self.assertEqual(
            resource_identity("https://de.pngtree.com/freepng/abc_123.html"),
            "Pngtree:123",
        )
        self.assertEqual(resource_identity("https://pngimg.com/image/45"), "PNGimg:45")
        self.assertIsNone(media_url("PNGimg", "https://image.shutterstock.com/a.png"))
        self.assertIsNone(
            media_url("Pngtree", "https://png.pngtree.com/png-vector/../../secret.png")
        )
        for alpha in [0, 255]:
            with self.assertRaises(ValueError):
                transparent_image(encoded(alpha))

    async def test_search_uses_same_provider_brave_preview_when_cdn_fails(self):
        from unittest.mock import patch
        import os
        from local_runtime import configure
        from png_assets import search_png

        configure()
        cdn = "https://png.pngtree.com/png-vector/2025/ourmid/a.png"
        thumb = "https://imgs.search.brave.com/example"
        row = {
            "sourcePageUrl": "https://pngtree.com/freepng/a_12.html",
            "imageUrl": cdn,
            "thumbnailUrl": thumb,
            "title": "shell",
        }
        with (
            tempfile.TemporaryDirectory() as tmp,
            patch.dict(os.environ, BRAVE_SEARCH_API_KEY="test"),
            patch(
                "ComfyArt.api.mcp_tools.image_search.image_results",
                new_callable=AsyncMock,
            ) as search,
            patch("png_assets.preview_png", new_callable=AsyncMock) as fetch,
        ):
            search.return_value = [
                row,
                {**row, "imageUrl": "https://example.org/ad.png"},
            ]
            fetch.side_effect = [None, encoded(127)]
            rows, blocks = await search_png(
                Path(tmp), "shell", allow_previews=True, provider="Pngtree"
            )
            self.assertEqual([c.args[1] for c in fetch.await_args_list], [cdn, thumb])
            self.assertEqual(len(blocks), 1)
            self.assertEqual(
                [(r["provider"], r["origin"], r["imageUrl"]) for r in rows],
                [("Pngtree", "search-preview", thumb)],
            )

    async def test_preview_and_uploaded_original_are_independent_native_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            src = "https://pngimg.com/image/451"
            data = encoded(127)
            png = folder / "upload.png"
            png.write_bytes(data)
            prepare_originals(
                folder, [{"sourcePageUrl": src, "file": str(png), "name": "original"}]
            )
            import json

            original = json.loads((folder / "originals.json").read_text())["PNGimg:451"]
            preview = store_png(
                folder,
                data,
                "shell",
                src,
                "https://pngimg.com/uploads/shell/a.png",
                "search-preview",
            )["id"]
            for key in [preview, original]:
                self.assertEqual(read_png(folder, key)[1], data)
                store = {}
                ids = ["shape:a", "shape:b"]
                for n, f in enumerate(ids):
                    store[f] = shape(
                        f,
                        "frame",
                        "page:book",
                        n + 1,
                        n * 400,
                        0,
                        {"w": 400, "h": 600, "name": "page", "color": "black"},
                        {},
                    )
                layer = {
                    "kind": "png",
                    "id": "deco",
                    "name": "Shell",
                    "asset": key,
                    "box": [20, 40, 100, 100],
                    "rotation": 12,
                }
                spread = {
                    "id": "spread-01",
                    "pageIds": ids,
                    "name": "Spread",
                    "paper": "#ffffff",
                    "layers": [layer],
                    "steps": [
                        {"action": "Place", "elements": ["deco"], "check": "Visible"}
                    ],
                }
                assets = CanvasAssets(None, store, [], folder / "trace")
                assets.png_dir = folder
                assets.upload = AsyncMock(return_value="/api/view?filename=shell.png")
                steps, _ = await Spread(
                    store, assets, spread, {"components": []}, {}, ids
                ).install()
                image = store[steps[0]["elementIds"][0]]
                self.assertEqual(image["type"], "image")
                self.assertEqual((image["props"]["w"], image["props"]["h"]), (50, 100))
                self.assertEqual(image["props"]["url"], src)
                self.assertEqual(image["meta"]["decoration"]["provider"], "PNGimg")
                self.assertEqual("预览" in image["meta"]["name"], key == preview)
                self.assertFalse(assets.imports)
                self.assertEqual(assets.upload.await_args.args[0], data)
