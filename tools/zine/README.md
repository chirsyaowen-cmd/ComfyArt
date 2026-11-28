# Reference-driven zine layout

These local CLI tools turn reference spreads into reusable layouts and place the user's photos and text on a new editable ComfyArt canvas.

## Default in ComfyArt

Ask the project chat to make a complete zine from the reference spreads and uploaded photos. The agent uses `make_reference_zine` with one project reference per spread in reading order (back/front cover first). It reads saved frame sizes and identifies the paper stock color visually. Each native DeepSeek child receives its own reference and writes reusable layout, editable treatments and text slots. After every layout passes validation the same parent session receives the photo sheets and binds the whole book. The chat returns a new editable project. The source book stays available. The project data directory holds per-job specs, bindings, and traces under `zine-runs/`.

## Setup

Use the Python environment for the running ComfyArt server. From the repository root, run `python -m pip install -r tools/zine/requirements.txt`. Use the same `COMFYART_DATA`, `DSH_HOME`, and optional `COMFYART_TLDRAW` settings as the server. Model calls use the installed DeepSeek Harness, the `comfyart-acp` profile, and the configured official Flash API route. Set `COMFYART_DSH` if the executable is outside PATH. Graded photos use the server's PhotoCraft executable via `PHOTOCRAFT_CLI` or PATH.

## Generate and import

Create and save a zine with the desired page count and frame sizes. Keep the project open when using the ComfyArt image search tool. In the commands below, set `ZINE_RUN` to a local output directory, `FRAME_PROJECT` to the existing zine ID, and `NEW_PROJECT` to a new project ID.

```sh
python tools/zine/prepare_photos.py --output "$ZINE_RUN" photo1.heic photo2.jpg
python tools/zine/semantic_search.py --url http://127.0.0.1:8190 --project "$FRAME_PROJECT" \
  --photos "$ZINE_RUN/照片清单.json" --output "$ZINE_RUN" --trace "$ZINE_RUN/trace.jsonl"
python tools/zine/design.py "$ZINE_RUN/素材清单.json" --frame-project "$FRAME_PROJECT" \
  --records "$ZINE_RUN/设计记录" --output "$ZINE_RUN/zine_spec.json" \
  --photos "$ZINE_RUN/照片清单.json" --title '作品名' --use-all-photos --bindings-output "$ZINE_RUN/图文绑定.json"
python tools/zine/project.py "$ZINE_RUN" --url http://127.0.0.1:8190 \
  --references "$ZINE_RUN/来源.json" --database "$COMFYART_DATA/data.db" --id "$NEW_PROJECT" --title '作品名' \
  --photos "$ZINE_RUN/照片清单.json" --bindings "$ZINE_RUN/图文绑定.json" --trace "$ZINE_RUN/trace.jsonl"
```

The search stage proposes interior spreads from the uploaded photo thumbnails. For an eight-page zine it selects three interior references. Supply a cover image in the cover entry of `素材清单.json`, or pass an existing cover layout to `design.py --reuse-cover existing-spec.json`. Local reference manifests can also be used directly. A group has an `id`, `reference` file path and optional `referenceBox` in source pixels. The adjacent `装订顺序.json` specifies `cover`, ordered `spreads` and optional `relatedSpreads` groups.

The design agent chooses the slot roles, composition, component instances, and treatments from the reference. During the initial reference reading the agent supplies the paper stock color as a HEX value, or null if the paper is hidden. A supplied color is carried directly into the spread specification. The observations are saved in records/reference-structure.json.

Each generation reads the saved project frames in book order. New specs store actual page IDs and dimensions. Each spread is laid out in native page units, with the spine at the left page's width. The importer retains the legacy virtual coordinate mapping for v2 files without frame metadata. Use `--preserve-content` when reflowing a zine that already has slot bindings. Successful designs are cached by input digest so a failed generation can be resumed.

Running `python tools/zine/project.py "$ZINE_RUN"` creates an offline HTML layout reader with replaceable slots and layered SVG export. The native import instead creates editable photo, vector, text and group records. Split instances can be edited independently on the canvas. Mirrored text boxes retain readable native glyphs. Source photos, references, bindings, traces and finished projects belong in the local output directory.

### Transparent decoration layers

Spread designers can use `search_png` with the server’s existing `BRAVE_SEARCH_API_KEY` to look for Vecteezy, Pngtree or PNGimg decorations. They see a numbered contact sheet and may choose none. A selected `png` layer stores an immutable project asset key, box, rotation and opacity. Sources, original bytes and alpha are retained in the adjacent `zine-png/` folder; keep it with a saved spec. The native canvas and offline reader draw the PNG independently of the user's photos.

Public indexed PNGs are design previews. A draft that uses one carries the title suffix 素材预览稿 and per-layer source metadata. Search does not acquire publication rights. To use your downloaded original at generation time, upload the transparent PNG and pass its project photo key and provider resource page in `pngOriginals`. Source-page links remain with the image layers for any required credit.

PNGimg lists CC BY-NC 4.0 for its collection (https://pngimg.com/license/). Keep the source and check applicable credits and uses before publishing.
