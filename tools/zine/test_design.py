import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from design import extract
from frame_geometry import spread_geometry
from PIL import Image


class GenerateSpreadTests(unittest.IsolatedAsyncioTestCase):
    async def test_measured_coordinates_and_agent_layers_reach_the_spec(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            source = folder / "reference.jpg"
            Image.new("RGB", (60, 40), "#eeeeee").save(source)
            group = {"id": "input", "reference": str(source)}
            left = {"id": "shape:a", "w": 320, "h": 510}
            right = {"id": "shape:b", "w": 410, "h": 520}
            target = {
                "id": "spread-01",
                "pageIds": [left["id"], right["id"]],
                "geometry": spread_geometry(left, right),
            }
            conf = SimpleNamespace(
                records=folder,
                gate=asyncio.Semaphore(1),
                release=folder,
                previous={},
                content={},
                prompt="test",
                schema_digest="test",
            )

            async def generate(_, blocks, validate, trace, stage):
                self.assertIn('"size": [730, 520]', blocks[-1]["text"])
                self.assertIn('"spine": 320', blocks[-1]["text"])
                output = {
                    "name": "Cover",
                    "slots": [],
                    "components": [],
                    "spreads": [
                        {
                            "id": "spread-01",
                            "pageIds": target["pageIds"],
                            "name": "Cover",
                            "paper": "#ffffff",
                            "steps": [
                                {
                                    "action": "Place rule",
                                    "check": "At fold",
                                    "elements": ["line"],
                                }
                            ],
                            "layers": [
                                {
                                    "id": "line",
                                    "name": "Rule",
                                    "kind": "path",
                                    "points": [[320, 0], [320, 510]],
                                    "stroke": "#112233",
                                    "sw": 1,
                                }
                            ],
                        }
                    ],
                }
                validate(output)
                return output

            with (
                patch(
                    "paper_sample.sample_paper",
                    return_value={"status": "measured", "paper": "#ECEBE9"},
                ),
                patch("design.request", generate),
            ):
                actual = await extract([(group, target)], conf)
                self.assertEqual(actual["spreads"][0]["paper"], "#ECEBE9")
                self.assertEqual(
                    actual["spreads"][0]["layers"][0]["points"], [[320, 0], [320, 510]]
                )
