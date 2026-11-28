import json
import unittest
from pathlib import Path

from PIL import Image
from evals.paper_color import score_page


class PaperColorEvaluation(unittest.TestCase):
    def test_reference_and_rendering_have_independent_limits(self):
        fixture = json.loads((Path(__file__).parent / "evals/fm01-summer.json").read_text())
        for case in fixture["paperPages"].values():
            rgb = case["expected"]
            page = Image.new("RGB", (480, 680), tuple(rgb))
            self.assertTrue(score_page(page, rgb, case, fixture)["pass"])
            self.assertFalse(score_page(page, [255, 255, 255], case, fixture)["pass"])
            page.paste("white", (0, 0, 480, 680))
            self.assertFalse(score_page(page, [255, 255, 255], case, fixture)["pass"])
