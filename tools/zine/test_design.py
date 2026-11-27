import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from design import prepare_layout
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
            ):
                task = await prepare_layout([(group, target)], conf)
                actual = await generate(None, task.blocks, task.save, None, None)
                self.assertEqual(actual["spreads"][0]["paper"], "#ECEBE9")
                self.assertEqual(
                    actual["spreads"][0]["layers"][0]["points"], [[320, 0], [320, 510]]
                )


class StepElementsTests(unittest.TestCase):
    def test_resolve_component_and_slot_only_if_unambiguous(self):
        from layout_schema import resolve_step_elements

        step = {"elements": ["group", "photo", "unknown"]}
        use = {"id": "cover-use", "kind": "use", "component": "group"}
        design = {"components": [{"id": "group", "layers": [{"id": "image", "kind": "photo", "slot": "photo"}]}],
                  "spreads": [{"layers": [use], "steps": [step]}]}
        resolve_step_elements(design)
        self.assertEqual(step["elements"], ["cover-use", "image", "unknown"])
        design["spreads"][0]["layers"].append({**use, "id": "other"})
        step["elements"] = ["group"]
        resolve_step_elements(design)
        self.assertEqual(step["elements"], ["group"])


class PhotoAllocationTests(unittest.IsolatedAsyncioTestCase):
    async def test_editor_allocates_uploads_before_the_layouts(self):
        import json
        from design import plan_photo_slots

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            photos = root / "photos.json"
            photos.write_text(json.dumps([{"id": "P01"}, {"id": "P02"}, {"id": "P03"}]))
            args = SimpleNamespace(photos=photos, brief="", records=root, release=root)
            work = [[({}, {"id": k})] for k in ("cover", "inside")]
            async def choose(_, blocks, valid, trace, stage):
                with self.assertRaises(ValueError):
                    valid({"cover": 1, "inside": 1})
                valid({"cover": 1, "inside": 2})
                return {"cover": 1, "inside": 2}
            with patch("harness_json.request", choose):
                plan = await plan_photo_slots(args, work)
            self.assertEqual(plan, json.loads((root / "photo-plan.json").read_text()))
            self.assertEqual(plan["inside"], 2)


if __name__ == "__main__":
    unittest.main()
