# Cutline

Agent-native browser video editor for the OpenAI WebMCP Challenge.

Edit at the speed of intent. Keep the human in control.

Codex inspects, edits, and verifies a live timeline through page-native WebMCP tools. Locks, final acceptance, and export stay human-only.

## Quick start

```bash
npm install
npm run demo:assets
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Add `?debug=1` to show the tool catalog and digests.

Reset anytime with **Reset demo project**.

## Golden demo

Bundled project: **KV Cache Explainer** (placeholder media with stable IDs `take_1`, `take_2`, `gpu_rack`, `cache_diagram`).

1. Play the messy 74s source.
2. Paste the winning prompt into ChatGPT/Codex in the in-app browser, or click **Replay golden run**.
3. Pin a comment, lock 18.0–19.2s (`L` or **Lock range**).
4. Ask Codex to revise, or click **Replay lock-aware revision**.
5. Compare A/B, accept, undo/redo, then **Export** (human-only).

Winning prompt:

> Turn this into a punchy 35-second vertical short for software engineers. Remove dead air and false starts, use the cleaner second take, cover the cache explanation with the GPU clip, hold the diagram long enough to understand it, and add bold captions. Create a new branch—do not touch locked ranges or export.

## WebMCP tools

Registered through the current `document.modelContext.registerTool()` API. Only `project_status` is registered during hydration; the operational catalog is added once the project is ready and removed if readiness is lost. Registrations include titles, JSON Schema inputs, cancellation-aware execution, safety annotations, idempotent write retries, bounded reads, and visible lifecycle status.

| Tool | Side effect |
|---|---|
| `project_status` | none |
| `inspect_project` | none |
| `get_timeline` | none |
| `read_transcript` | none |
| `get_comments` | none |
| `select_branch` | visible branch selection |
| `control_playback` | play, pause, or seek the shared viewer |
| `add_comment` | agent-attributed timeline comment |
| `propose_comment_resolution` | non-destructive resolution proposal |
| `create_cut_branch` | working branch |
| `apply_edit_batch` | atomic timeline mutation |
| `style_captions` | caption cues |
| `place_broll` | V2 overlay |
| `place_clip` | V1/V2 clip at a time |
| `place_audio` | A1 dialogue or A2 music/SFX |
| `set_transition` | cut / crossfade / fade in-out / dissolve |
| `split_clip` | razor at a time |
| `trim_clip` | in/out points |
| `set_gain` | clip volume 0–2 |
| `mute_track` | mute/unmute a track |
| `delete_clip` | remove without ripple |
| `import_media` | add https or demo media to the bin (≤500 MB) |
| `set_crop` | aspect / framing |
| `preview_range` | seek/play, no edit |
| `compare_cuts` | compare target, no edit |
| `undo_edit` | undo the latest branch edit group |
| `redo_edit` | redo the latest branch edit group |

Not registered (trust boundary): lock/unlock, accept, export, publish, delete.

Every branch write requires the latest `expectedBranchVersion`. Reusing a `clientRequestId` returns the original result instead of repeating a write. Once a human accepts a branch it becomes immutable; further work must start on a new working branch. `preview_range` verifies through the shared live viewer and does not claim to render a separate artifact.

## Architecture

Direct manipulation and WebMCP share one command bus (`src/core`). State is local-first in IndexedDB, including uploaded media blobs. Tracks: V1, V2, A1, A2, CC. Accepted branches are read-only. Export uses a cached 720p artifact after the Day 1 media gate; live MediaRecorder is not required for the demo.

## Tests

```bash
npm test
npx playwright install chromium
npm run e2e
```

## Deploy

```bash
npx vercel --yes
```

## License

MIT. Demo placeholders are original generated color bars, not third-party footage. Replace files in `public/demo/` using the same asset IDs to drop in real media.
