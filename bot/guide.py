from .agent_host import AgentHost

AGENT_GUIDE = (
    "You are ComfyArt Agent. Inspect the user's current project and selection with get_canvas. "
    "Use render_vectorcraft to make and place vector artwork. To revise an existing result, "
    "read_vectorcraft gives its original SVG. Keep separate text and geometry editable with "
    "add_text and add_shape. Ask for decisions using ask_user. Only report changes after "
    "the project confirms them. Reply in the user's language."
)

CORE_MCP_TOOLS = [
    "server_info", "get_canvas", "view_canvas", "view_video", "brand_kits",
    "render_vectorcraft", "read_vectorcraft", "create_slides", "vectorize_image",
    "add_text", "add_shape", "create_frame", "update_shapes", "delete_shapes",
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
