"""Short isolated vision requests through the same installed Harness as layout extraction."""

import json
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from local_runtime import audit, configure


@asynccontextmanager
async def session(release, *, team=False, on_event=None, paper_stage=None, reports=None):
    configure(release)
    from ComfyArt.bot._acp import AcpTransport
    from ComfyArt.bot.deepseek_harness_runtime import (
        ensure_profile,
        overlay_entries,
        profile_dir,
        resolve_command,
    )

    exe = os.environ.get("COMFYART_DSH")
    if exe:
        argv = [shutil.which("node") or "node", exe] if exe.endswith(".js") else [exe]
    else:
        argv, error = resolve_command()
        if not argv:
            raise RuntimeError(error)
    error = await ensure_profile(argv, "comfyart-acp")
    if error:
        raise RuntimeError(error)
    with tempfile.TemporaryDirectory(prefix="zine-vision-") as tmp:
        folder = Path(tmp)
        shutil.copytree(profile_dir("comfyart-acp"), folder / "profiles/comfyart-acp")
        overlay = folder / "turn.yml"
        entries = overlay_entries("comfyart", ("deepseek-official", "deepseek-flash"))
        if team:
            enabled = {"subagent", "subagent-spawn-in-process", "tool-subagent"}
            entries = [e for e in entries if e.get("id") not in enabled]
            entries.extend(
                [
                    {
                        "id": "tool-subagent",
                        "config": {
                            "provider": "spawn",
                            "toolName": "subagent",
                            "maxDepth": 1,
                            "agentOptions": {
                                "provider": "deepseek-official",
                                "model": "deepseek-flash",
                                "reasoningEffort": "low",
                            },
                        },
                    },
                    {
                        "insert": [
                            {
                                "id": "comfyart-spreads",
                                "name": Path(__file__)
                                .with_name("spread_io.mjs")
                                .as_uri(),
                            }
                        ]
                    },
                ]
            )
        if paper_stage:
            entries.append({"insert": [{"id": "comfyart-paper", "name": Path(__file__).with_name("paper_report.mjs").as_uri()}]})
        overlay.write_text(json.dumps(entries))
        chunks = []

        async def receive(method, params):
            if method == "_comfyart/paper" and reports is not None:
                reports.append(params)
                return
            if method == "_comfyart/spread" and on_event:
                await on_event(folder, params)
                return
            u = params.get("update", {})
            if (
                u.get("sessionUpdate") == "agent_message_chunk"
                and u.get("content", {}).get("type") == "text"
            ):
                chunks.append(u["content"]["text"])

        async def deny(*_):
            return {"outcome": {"outcome": "cancelled"}}

        env = {
            k: os.environ[k]
            for k in ("HOME", "PATH", "DEEPSEEK_API_KEY")
            if k in os.environ
        }
        env["DSH_HOME"] = tmp
        if paper_stage:
            env["COMFYART_PAPER_STAGE"] = paper_stage
        t = AcpTransport(
            [*argv, "--profile", "comfyart-acp", "--patch", str(overlay)],
            cwd=tmp,
            env=env,
            on_notification=receive,
            on_request=deny,
        )
        await t.start()
        try:
            init = await t.request(
                "initialize",
                {
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "terminal": False,
                        "fs": {"readTextFile": False, "writeTextFile": False},
                    },
                },
            )
            if not init["agentCapabilities"]["promptCapabilities"]["image"]:
                raise RuntimeError("DSH vision unavailable")
            sid = (await t.request("session/new", {"cwd": tmp, "mcpServers": []}))[
                "sessionId"
            ]
            for k, v in [
                ("model", '["deepseek-official","deepseek-flash"]'),
                ("reasoning_effort", "low"),
            ]:
                options = await t.request(
                    "session/set_config_option",
                    {"sessionId": sid, "configId": k, "value": v},
                )
                if (
                    next(
                        o["currentValue"]
                        for o in options["configOptions"]
                        if o["id"] == k
                    )
                    != v
                ):
                    raise ValueError("Unexpected DSH configuration")
            yield t, sid, chunks, folder
        finally:
            await t.close(1)
            if t.proc.returncode is None:
                t.proc.kill()
                await t.proc.wait()
            await t.dispose()


async def json_turn(t, sid, chunks, blocks, validate, trace, stage, reports=None):
    for i in range(3):
        chunks.clear()
        if reports is not None:
            reports.clear()
            blocks = [*blocks, {"type": "text", "text": "请调用 submit_paper_report 提交观察结果，参数按工具定义填写。提交后直接结束。"}]
        audit(trace, stage + ".request", session=sid, attempt=i + 1)
        await t.request(
            "session/prompt", {"sessionId": sid, "prompt": blocks}, timeout=420
        )
        try:
            if reports is not None and not reports:
                raise ValueError("Submit the observation using submit_paper_report")
            data = reports[-1] if reports is not None else json.loads(
                "".join(chunks)
                .strip()
                .removeprefix("```json")
                .removeprefix("```")
                .removesuffix("```")
                .strip()
            )
            validate(data)
            audit(trace, stage + ".validated", session=sid, attempt=i + 1)
            return data
        except (ValueError, TypeError, KeyError, IndexError) as exc:
            audit(trace, stage + ".retry", error=str(exc)[:220])
            if i == 2:
                raise
            blocks = [
                {
                    "type": "text",
                    "text": f"校验未通过：{exc}。请对照原图，重新给出完整 JSON。",
                }
            ]


async def request(release, blocks, validate, trace, stage):
    try:
        suffix = stage.rsplit(".paper.", 1)
        paper_stage = suffix[1] if len(suffix) == 2 and suffix[1] in ("locate", "review") else None
        reports = [] if paper_stage else None
        async with session(release, paper_stage=paper_stage, reports=reports) as (t, sid, chunks, _):
            return await json_turn(t, sid, chunks, blocks, validate, trace, stage, reports)
    except Exception as exc:
        audit(trace, stage + ".failed", error=str(exc)[:350])
        raise
