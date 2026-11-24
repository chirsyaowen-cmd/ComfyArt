import asyncio
import io
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageChops

from ComfyArt.api.photo_adjust import OPERATIONS, cli, commands, render


class PhotoAdjustTests(unittest.TestCase):
    def test_reject_invalid_stops(self):
        for stops in ([], [{"position": 0, "color": "#224422"}] * 2,
                      [{"position": 0, "color": "oops"}, {"position": 1, "color": "#ffffff"}]):
            with self.assertRaises(ValueError):
                commands([{"kind": "gradientMap", "stops": stops}])

    @unittest.skipUnless(cli(), "PhotoCraft CLI is required for the render test")
    def test_real_gradient_and_alpha(self):
        photo = Image.new("RGBA", (4, 1))
        photo.putdata([(0, 0, 0, 255), (130, 170, 90, 255), (255, 255, 255, 255), (0, 0, 0, 0)])
        buf = io.BytesIO()
        photo.save(buf, format="PNG")
        recipe = [{"kind": "saturation", "value": -100}, {"kind": "gradientMap", "stops": [
            {"position": 0, "color": "#102820"}, {"position": 1, "color": "#c8d8ca"}]}]
        with tempfile.TemporaryDirectory() as tmp:
            result = asyncio.run(render(buf.getvalue(), recipe, Path(tmp)))
        image = Image.open(io.BytesIO(result)).convert("RGBA")
        pixels = [image.getpixel((x, 0)) for x in range(4)]
        self.assertEqual(pixels[0], (16, 40, 32, 255))
        self.assertEqual(pixels[2], (200, 216, 202, 255))
        self.assertTrue(all(a < b < c for a, b, c in zip(pixels[0][:3], pixels[1][:3], pixels[2][:3])))
        self.assertEqual(pixels[3][3], 0)

    @unittest.skipUnless(cli(), "PhotoCraft CLI is required for the catalog test")
    def test_catalog_entries_change_pixels_at_their_suggested_values(self):
        photo = Image.new("RGB", (48, 48))
        photo.putdata([((x * 13 + y * 3) % 256, (x * 7 + y * 9) % 256, (x * 17 + y) % 256)
                       for y in range(48) for x in range(48)])
        source = io.BytesIO()
        photo.save(source, format="PNG")
        for kind, op in OPERATIONS.items():
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                recipe = [{"kind": kind, "value": op["initial"]}]
                result = asyncio.run(render(source.getvalue(), recipe, Path(tmp)))
                image = Image.open(io.BytesIO(result)).convert("RGB")
                self.assertEqual(photo.size, image.size)
                self.assertIsNotNone(ImageChops.difference(photo, image).getbbox())
