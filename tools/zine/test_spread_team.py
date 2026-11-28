import json
import tempfile
import unittest
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch

from design import LayoutTask
from spread_team import run_team


class SpreadTeamTest(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, missing=False, contrast=1.13, recover=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trace = root / "trace.jsonl"
            saved = {}
            read_material = []
            tasks = []
            for key in ("spread-01", "spread-02"):

                def save(value, spread=key):
                    if "treatment" not in value:
                        raise ValueError("Missing treatment")
                    saved[spread] = value

                tasks.append(LayoutTask(key, [{"type": "text", "text": key}], save))

            @asynccontextmanager
            async def harness(_, *, team, on_event):
                self.assertTrue(team)

                class Parent:
                    async def request(parent, method, args, timeout):
                        self.assertEqual(args["sessionId"], "editor")
                        self.assertNotIn("photo catalog", str(args))
                        ids = args["prompt"][0]["text"].split("本批编号：")[-1].split(", ")
                        for task in tasks:
                            if task.key not in ids:
                                continue
                            child = str(uuid.uuid4())

                            async def event(kind, child=child, **fields):
                                await on_event(
                                    root, {"event": kind, "child": child, **fields}
                                )

                            await event("spawn")
                            self.assertEqual(
                                json.loads((root / (task.key + ".json")).read_text()),
                                task.blocks,
                            )
                            await event("reference", spread=task.key, images=1)
                            if not missing or task is tasks[0] or recover and len(ids) == 1:
                                token = str(uuid.uuid4())
                                await event(
                                    "submit", spread=task.key, token=token, json="{}"
                                )
                                self.assertIn(
                                    "error",
                                    json.loads(
                                        (root / (token + ".receipt")).read_text()
                                    ),
                                )
                                await event(
                                    "submit",
                                    spread=task.key,
                                    token=str(uuid.uuid4()),
                                    json=json.dumps(
                                        {
                                            "treatment": {"contrast": contrast},
                                            "spreads": [],
                                            "components": [],
                                        }
                                    ),
                                )
                            await event("end", reason="completed")

                yield Parent(), "editor", [], root

            async def bind(parent, session_id, chunks, blocks, validate, trace, stage):
                self.assertEqual(session_id, "editor")
                read_material.extend(blocks)

            async def seal(designs, bind_photos):
                self.assertEqual(designs, saved)
                self.assertEqual(set(designs), {t.key for t in tasks})
                await bind_photos(
                    None,
                    [{"type": "text", "text": "photo catalog"}],
                    None,
                    trace,
                    "binding",
                )
                return designs["spread-02"]["treatment"]

            with (
                patch("spread_team.session", harness),
                patch("spread_team.json_turn", bind),
            ):
                if missing and not recover:
                    with self.assertRaisesRegex(RuntimeError, "spread-02"):
                        await run_team(root, tasks, trace, seal, binding=True)
                    self.assertFalse(read_material)
                else:
                    result = await run_team(root, tasks, trace, seal, binding=True)
                    self.assertTrue(read_material)
                    self.assertEqual(result, {"contrast": contrast})

    async def test_sealed_child_choices_reach_master_unchanged(self):
        for value in (1.13, 0.9):
            await self.exercise(contrast=value)

    async def test_incomplete_layout_never_releases_photos(self):
        await self.exercise(missing=True)

    async def test_replacement_child_finishes_only_the_missing_spread(self):
        await self.exercise(missing=True, recover=True)
