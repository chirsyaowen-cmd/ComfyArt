"""Short isolated vision requests through the same installed Harness as layout extraction."""

import json
import os
import shutil
import tempfile
from pathlib import Path

from local_runtime import audit, configure


async def request(release, blocks, validate, trace, stage):
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
        overlay.write_text(
            json.dumps(
                overlay_entries("comfyart", ("deepseek-official", "deepseek-flash"))
            )
        )
        chunks = []

        async def receive(_, params):
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
            for i in range(3):
                chunks.clear()
                audit(trace, stage + ".request", session=sid, attempt=i + 1)
                await t.request(
                    "session/prompt", {"sessionId": sid, "prompt": blocks}, timeout=420
                )
                try:
                    data = json.loads(
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
        except Exception as exc:
            audit(trace, stage + ".failed", error=str(exc)[:350])
            raise
        finally:
            await t.close(1)
            if t.proc.returncode is None:
                t.proc.kill()
                await t.proc.wait()
            await t.dispose()
