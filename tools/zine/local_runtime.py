"""Locate the active ComfyArt checkout and share the server's local configuration."""

import importlib.util
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def configure(release=ROOT):
    root = Path(release).resolve()
    if "ComfyArt" not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            "ComfyArt", root / "__init__.py", submodule_search_locations=[str(root)]
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules["ComfyArt"] = module
        spec.loader.exec_module(module)
    if os.environ.get("COMFYART_TLDRAW"):
        from ComfyArt.startup import configure_tldraw

        configure_tldraw(Path(os.environ["COMFYART_TLDRAW"]).expanduser())
    data = Path(os.environ.get("COMFYART_DATA", "~/.local/share/comfyart")).expanduser()
    os.environ.setdefault("DSH_HOME", str(data / "dsh"))


def audit(path, event, **details):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(
            json.dumps(
                {
                    "time": datetime.now(timezone.utc).isoformat(
                        timespec="milliseconds"
                    ),
                    "event": event,
                    **details,
                },
                ensure_ascii=False,
            )
            + "\n"
        )


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, delete=False, encoding="utf-8"
    ) as tmp:
        json.dump(value, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
    Path(tmp.name).replace(path)
