import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from paper_sample import sample_paper
from PIL import Image


class PaperSamplingTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_reviewed_paper_pixels_reach_spec_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "reference.png"
            image = Image.new("RGB", (140, 110), "#51322c")
            image.paste("#c1d4c7", (20, 15, 120, 95))
            image.paste("#131415", (60, 45, 80, 65))
            image.save(path)
            group = {"reference": str(path), "referenceBox": [20, 15, 120, 95]}
            conf = SimpleNamespace(records=root, release=root)
            target = {"id": "spread-02"}
            replies = iter(
                [
                    {
                        "visible": True,
                        "points": [
                            {"xy": [0.2, 0.3], "where": "left"},
                            {"xy": [0.5, 0.5], "where": "center"},
                            {"xy": [0.8, 0.6], "where": "right"},
                        ],
                        "reason": "margin points",
                    },
                    {
                        "accepted": [1, 3],
                        "consistent": True,
                        "reason": "Point 2 is printed",
                    },
                ]
            )

            async def fake_request(_, blocks, validate, trace, stage):
                result = next(replies)
                validate(result)
                return result

            with patch("paper_sample.request", fake_request):
                result = await sample_paper(group, target, conf)
                self.assertEqual(result["paper"], "#C1D4C7")
                self.assertEqual(len(result["samples"]), 2)
                self.assertEqual(result["attempts"][0]["review"]["accepted"], [1, 3])
                self.assertTrue((root / "spread-02.paper.jpg").is_file())
                cached = await sample_paper(group, target, conf)
                self.assertEqual(cached["paper"], result["paper"])

    async def test_no_visible_paper_is_recorded_without_color(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "reference.png"
            Image.new("RGB", (50, 50), "black").save(path)

            async def absent(_, blocks, validate, trace, stage):
                response = {"visible": False, "points": [], "reason": "full bleed"}
                validate(response)
                return response

            with patch("paper_sample.request", absent):
                result = await sample_paper(
                    {"reference": str(path)},
                    {"id": "spread-02"},
                    SimpleNamespace(records=root, release=root),
                )
            self.assertEqual(result["status"], "unobservable")
            self.assertIsNone(result["paper"])


if __name__ == "__main__":
    unittest.main()
