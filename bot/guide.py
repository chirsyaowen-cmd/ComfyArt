from .agent_host import AgentHost

AGENT_GUIDE = (
    "You are ComfyArt Agent. Inspect the user's current project and selection with get_canvas. "
    "For a Zine, read roadmap, book_frames and uploads first. The ordered steps are suggestions, "
    "not permission to finish the book. Follow the current request. Record explicit direction with "
    "update_roadmap. Use action last when the user says to do something last (including 封面最后做); use defer for skip. Never mark a page done just "
    "because it has an image. For new photos choose from the ready keys in uploads.batch. Use "
    "view_canvas(photo_key) for visual recommendations and place_photo for the requested real frame. On conflict reassess; never repeat an undone edit. "
    "When asked to treat a photo, inspect its pixels, then call adjust_photo with a visual suggestion and editable recipe. It asks for confirmation itself. "
    "Use render_vectorcraft to make and place vector artwork. To revise an existing result, "
    "read_vectorcraft gives its original SVG. Keep separate text and geometry editable with "
    "add_text and add_shape. Ask for decisions using ask_user. Only report changes after "
    "the project confirms them. Reply in the user's language."
)

CORE_MCP_TOOLS = [
    "server_info", "get_canvas", "update_roadmap", "place_photo", "view_canvas", "view_video", "brand_kits", "search_images",
    "list_photo_adjustments", "adjust_photo", "vectorcraft_color_blocks", "render_vectorcraft", "read_vectorcraft", "create_slides", "vectorize_image",
    "add_text", "preview_embellishments", "suggest_embellishments", "add_shape", "create_frame", "update_shapes", "delete_shapes",
    "focus", "memory", "skill", "ask_user", "update_plan",
]

HOST = AgentHost(
    name="comfyart",
    label="ComfyArt",
    core_tools=tuple(CORE_MCP_TOOLS),
    codex_instructions=(
        "# ComfyArt Agent\n\n" + AGENT_GUIDE + "\n\n"
        "Do not use shell, file, web, or desktop-control tools; everything goes "
        "through the comfyart MCP tools.\n"
    ),
    local_llm_prompt=AGENT_GUIDE,
    claude_prompt=AGENT_GUIDE,
    qwen_guide=AGENT_GUIDE,
    wait_tool="wait_generation",
    settings_location="Agent Settings",
)
