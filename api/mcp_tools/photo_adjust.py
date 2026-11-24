from ..mcp_commands import submit_command
from ..photo_adjust import OPERATIONS, RECIPE_SCHEMA, cli, commands
from ._context import BOT_CHAT_ID, PROJECT
from .bot_tools import ask_user


async def adjust_photo(args):
    project, chat = PROJECT.get(), BOT_CHAT_ID.get()
    if not project or not chat:
        raise ValueError("Open a project chat first")
    recipe, question = args.get("recipe"), args.get("suggestion")
    commands(recipe)
    if not cli():
        raise ValueError("PhotoCraft CLI is not configured on the server")
    if not isinstance(question, str) or not question.strip():
        raise ValueError("Describe how the photo will look")
    photo = {"id": args.get("shape_id"), "frame_version": args.get("frame_version")}
    snapshot = await submit_command("photo_adjust_target", photo, project, chat=chat)
    answer = await ask_user({"prompt": question, "options": [
        {"id": "try", "label": "试一试"}, {"id": "keep", "label": "保留原图"}]}, kind="photo_adjust")
    if answer["status"] != "answered":
        return {"status": answer["status"]}
    keep = answer["selected"] == ["keep"]
    if not keep and answer["selected"] != ["try"]:
        raise ValueError("Unknown photo decision")
    return await submit_command("apply_photo_recipe", {**photo, **snapshot, "recipe": recipe, "keep": keep},
                                project, timeout=110, chat=chat)


TOOLS = {"adjust_photo": {"description": "Propose an editable photo treatment after inspecting its actual pixels. This tool shows Try it / Keep original and applies only after consent. Supply the photo shape_id, its book frame_version from get_canvas, one short question describing the visible result, without technical terms, hex codes or parameter values, and an ordered recipe. Choose colors based on the photo and user's intent. Gradient stops start at 0 and end at 1.",
    "inputSchema": {"type": "object", "properties": {"shape_id": {"type": "string"}, "frame_version": {"type": "string"},
        "suggestion": {"type": "string"}, "recipe": RECIPE_SCHEMA},
        "required": ["shape_id", "frame_version", "suggestion", "recipe"], "additionalProperties": False}, "handler": adjust_photo}}


async def list_adjustments(_args):
    return {"engine": "PhotoCraft", "available": bool(cli()), "operations": {
        **{k: {"command": v["command"], "parameter": v["parameter"], "min": v["min"], "max": v["max"]} for k, v in OPERATIONS.items()},
        "gradientMap": {"command": "layer.newAdjustmentLayer.gradientMap", "stops": "2–64 ordered colors from position 0 to 1"}}}


TOOLS["list_photo_adjustments"] = {"description": "List supported photo operations and their parameter ranges before planning a Zine photo treatment.",
    "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}, "handler": list_adjustments}
