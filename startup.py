"""Configure the optional local tldraw toolchain before importing the web app."""
import json
import os
from pathlib import Path
import runpy
import shlex
import sys


def configure_tldraw(root: Path):
    config = json.loads((root / ".local/product.json").read_text(encoding="utf-8"))
    node = Path(config["nodeExecutable"])
    os.environ["PATH"] = str(node.parent) + os.pathsep + os.environ.get("PATH", "")
    os.environ.setdefault("COMFYART_DSH", str(Path(config["engineRoot"]) / "apps/cli/lib/bin.js"))
    artwork = config.get("artwork", {})
    if artwork.get("enabled") and artwork.get("executable"):
        os.environ.setdefault("VECTORCRAFT_CLI", artwork["executable"])
    env_file = root / "local-agent/.env.local"
    if env_file.is_file() and not os.environ.get("DEEPSEEK_API_KEY"):
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, _, raw = line.strip().removeprefix("export ").partition("=")
            if key.strip() == "DEEPSEEK_API_KEY":
                values = shlex.split(raw, comments=True)
                if len(values) == 1:
                    os.environ["DEEPSEEK_API_KEY"] = values[0]
                break


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    if os.environ.get("COMFYART_TLDRAW"):
        configure_tldraw(Path(os.environ["COMFYART_TLDRAW"]).expanduser().resolve())
    data = Path(os.environ.get("COMFYART_DATA", "~/.local/share/comfyart")).expanduser().resolve()
    os.environ.setdefault("DSH_HOME", str(data / "dsh"))
    sys.path.insert(0, str(root.parent))
    runpy.run_module(f"{root.name}.__main__", run_name="__main__")
