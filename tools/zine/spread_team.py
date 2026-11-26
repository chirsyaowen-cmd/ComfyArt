"""Coordinate native Harness children, then bind the sealed book in their parent."""

import asyncio
import json
import uuid

from harness_json import json_turn, session
from local_runtime import audit, write_json


async def run_team(release, tasks, trace, finish, *, binding):
    pending = {task.key: task for task in tasks}
    accepted = {}
    owners = {}
    ended = set()
    spawned = set()
    if not tasks and not binding:
        return await finish({}, None)

    async def event(folder, msg):
        kind, actor = msg["event"], msg["child"]
        key = msg.get("spread")
        if kind == "spawn":
            spawned.add(actor)
        elif kind == "end":
            ended.add(actor)
        elif kind == "reference":
            owners[actor] = key
        elif kind == "submit":
            token = str(uuid.UUID(msg["token"]))
            receipt = {}
            try:
                if (
                    actor not in spawned
                    or owners.get(actor) != key
                    or key not in pending
                ):
                    raise ValueError("Unknown spread assignment")
                if key not in accepted:
                    design = json.loads(msg["json"])
                    pending[key].save(design)
                    accepted[key] = design
            except (KeyError, ValueError, TypeError, IndexError) as exc:
                receipt["error"] = str(exc)[:1500]
            write_json(folder / (token + ".receipt"), receipt)
            audit(
                trace,
                "child.retry" if receipt else "child.accepted",
                child=actor,
                spread=key,
                **receipt,
            )
            return
        audit(trace, "child." + kind, **{k: v for k, v in msg.items() if k != "event"})

    async with session(release, team=True, on_event=event) as (
        transport,
        sid,
        chunks,
        folder,
    ):
        audit(trace, "parent.ready", session=sid)
        # Limit simultaneous in-flight models without hardcoding the page count.
        for offset in range(0, len(tasks), 4):
            batch = tasks[offset : offset + 4]
            for task in batch:
                write_json(folder / (task.key + ".json"), task.blocks)
            ids = [task.key for task in batch]
            before = spawned.copy()
            await transport.request(
                "session/prompt",
                {
                    "sessionId": sid,
                    "prompt": [
                        {
                            "type": "text",
                            "text": "你是制作主编。请立即用原生 subagent 工具并行派生，每个编号一个全新子会话，description 使用编号。"
                            "只告诉孩子自己的编号，调用 read_reference 读取本组参考及规格契约，按原图拆版，"
                            "注明哪些区域保留色彩、哪些要处理，并将参数写入照片层。调用 submit_spec 提交，校验失败自行修正。"
                            "此时不接触用户素材、不配图文。你只派发，不替孩子设计，也不审稿。本批编号："
                            + ", ".join(ids),
                        }
                    ],
                },
                timeout=900,
            )

            async def wait_children():
                while spawned - before - ended:
                    if transport.returncode is not None:
                        raise RuntimeError("DeepSeek Harness stopped during layout")
                    await asyncio.sleep(0.2)

            await asyncio.wait_for(wait_children(), timeout=900)
            missing = [key for key in ids if key not in accepted]
            if missing or len(spawned - before) != len(batch):
                raise RuntimeError(
                    f"Native layout team did not complete the batch; unsubmitted spreads: {missing}"
                )
            for task in batch:
                (folder / (task.key + ".json")).unlink()

        async def bind(_, blocks, validate, trace, stage):
            audit(
                trace,
                "parent.read_photos",
                session=sid,
                sheets=sum(b["type"] == "image" for b in blocks),
            )
            return await json_turn(
                transport, sid, chunks, blocks, validate, trace, stage
            )

        return await finish(accepted, bind)
