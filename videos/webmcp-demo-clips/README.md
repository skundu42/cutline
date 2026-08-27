# WebMCP demo clips

Six silent, 10-second Motion Canvas scenes for demonstrating Cutline's WebMCP workflow.

## Clips

1. **WebMCP overview** — exposes the editor as a semantic, agent-native workspace.
2. **Inspect first** — reads project structure and constraints before editing.
3. **Reversible branch** — creates an auditable branch before mutations.
4. **Semantic edit** — applies a structured batch edit to meaningful timeline objects.
5. **Protected ranges** — preserves human-locked sections while agents work.
6. **Visible proof** — compares, previews, receipts, and exports the verified result.

Rendered files live in [`public/demo/webmcp-clips`](../../public/demo/webmcp-clips). Each file is H.264 MP4, 1280×720, 30 fps, 300 frames, and exactly 10 seconds.

## Edit and preview

```sh
npm install
npm run serve
```

Open `http://127.0.0.1:9000`, then use Motion Canvas's **Video (FFmpeg)** exporter at 1280×720 and 30 fps. The project renders as a 60-second master; split it at frames 0, 300, 600, 900, 1200, 1500, and 1800 to regenerate the six deliverables.

Run `npm run typecheck` after editing a scene.
