import unittest

from canvas_records import shape
from frame_geometry import book_frames, spread_geometry
from native_canvas import Spread


class FrameGeometryTests(unittest.IsolatedAsyncioTestCase):
    def test_read_order_and_live_dimensions(self):
        keys = ["shape:front", "shape:back"]
        store = {"document:document": {"meta": {"zinePages": keys}}}
        for i, k in enumerate(reversed(keys)):
            store[k] = shape(
                k, "frame", "page:book", i + 1, 100 + i, 0, {"w": 325 + i, "h": 510 + i}
            )
        frames = book_frames({"document": {"store": store}})
        target = spread_geometry(frames[1], frames[0])
        self.assertEqual(target["size"], [651, 511])
        self.assertEqual(target["spine"], 325)
        self.assertEqual([p["id"] for p in target["pages"]], list(reversed(keys)))
        store[keys[0]]["props"]["w"] = 411
        new = book_frames({"document": {"store": store}})
        self.assertEqual(spread_geometry(new[1], new[0])["size"], [736, 511])

    async def test_full_bleed_photo_crops_at_real_spine_without_outer_padding(self):
        class Assets:
            async def source(self, key):
                return {"size": (750, 600), "library": {"key": "photo"}}

            async def treated(self, key, treatment):
                return "asset:photo", {}

        ids = ["shape:left", "shape:right"]
        store = {
            k: shape(k, "frame", "page:book", i + 1, 0, 0, {"w": width, "h": 600})
            for i, (k, width) in enumerate(zip(ids, [320, 430]))
        }
        spread = {
            "id": "s",
            "name": "spread",
            "pageIds": ids,
            "layers": [
                {
                    "id": "photo",
                    "kind": "photo",
                    "name": "Full",
                    "slot": "p",
                    "box": [0, 0, 750, 600],
                    "fit": "cover",
                }
            ],
        }
        adapter = Spread(
            store,
            Assets(),
            spread,
            {"components": []},
            {"p": "test"},
            ["shape:front", *ids, "shape:back"],
        )
        await adapter.install()
        for i, width in enumerate([320, 430]):
            group = store[ids[i] + ":paper"]
            im = store[f"shape:s:{i}:photo"]
            self.assertEqual((group["x"], group["y"], im["x"], im["y"]), (0, 0, 0, 0))
            self.assertEqual((im["props"]["w"], im["props"]["h"]), (width, 600))
        self.assertAlmostEqual(
            store["shape:s:1:photo"]["props"]["crop"]["topLeft"]["x"], 320 / 750
        )


if __name__ == "__main__":
    unittest.main()
