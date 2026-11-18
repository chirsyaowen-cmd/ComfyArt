import os
import shutil
from dataclasses import replace
from pathlib import Path

from .deepseek_harness import DeepSeekHarnessProvider


class StandaloneDSH(DeepSeekHarnessProvider):
    def _command(self):
        executable = os.environ.get("COMFYART_DSH")
        if executable:
            path = Path(executable).expanduser().resolve()
            if path.suffix == ".js" and path.is_file() and shutil.which("node"):
                return [shutil.which("node"), str(path)], ""
            if path.is_file() and os.access(path, os.X_OK):
                return [str(path)], ""
            return None, "COMFYART_DSH does not point to an executable or DSH CLI bin.js."
        return super()._command()

    def _prompt_blocks(self, turn, image_supported):
        if not image_supported and not turn.mcp_endpoint and turn.attachments:
            layout = turn.attachments[0].get("layout_context")
            if layout:
                turn = replace(turn, attachments=[], user_text=turn.user_text +
                    "\nThe screenshot is unavailable. Review only the supplied geometry and editable text. "
                    "Do not infer pixels or image quality.\n" + layout)
        if not image_supported and turn.mcp_endpoint and turn.attachments and all(a.get("artwork") for a in turn.attachments):
            ids = ", ".join(a["artwork"] for a in turn.attachments)
            text = (f"The selected VectorCraft artwork IDs are {ids}. This session accepts text. "
                    "Use read_vectorcraft to inspect their original SVG and get_canvas for their current placement.\n"
                    + turn.user_text)
            turn = replace(turn, user_text=text, attachments=[])
        return super()._prompt_blocks(turn, image_supported)

    def _target_model(self, saved):
        selected = saved or os.environ.get("COMFYART_DSH_MODEL", "")
        if not selected and os.environ.get("DEEPSEEK_API_KEY"):
            selected = next((row["value"] for row in self._catalog if row["group"] == "deepseek-official"), "")
        return super()._target_model(selected)
