# Cutline

**In-browser, agent-native, WebMCP-compatible video editing.**

Cutline is a local-first nonlinear video editor where a person and a WebMCP agent work on the same timeline. Import media, edit manually or through semantic tools, inspect every agent change, compare branches, and render the selected cut without uploading source files.

Built for the 2026 OpenAI WebMCP Challenge.

## Why Cutline

Traditional browser automation treats creative software as a collection of buttons and coordinates. Cutline exposes editing intent directly: inspect a project, create a safe branch, place or trim clips, style captions, compare cuts, and return a structured receipt. The visible editor remains the source of truth, so human and agent actions share one deterministic command path.

Key capabilities:

- Browser-local video, audio, image, and SRT/VTT import
- V1/V2 video and A1/A2 audio tracks with direct timeline editing
- Split, trim, move, crop, transitions, gain, mute, captions, and comments
- Reversible working branches, version checks, state digests, undo, and redo
- Inspectable WebMCP actions with bounded reads and idempotent writes
- Human-only final selection and local rendering
- OPFS media persistence with an IndexedDB fallback
- 480p and 720p WebM rendering with Canvas, Web Audio, and MediaRecorder

## Quick start

Requirements:

- Node.js 20.9 or newer
- npm
- A Chromium-based browser for the most reliable local rendering

From the repository root:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No environment variables, accounts, or cloud services are required. Add `?debug=1` to display the registered WebMCP tools and project diagnostics.

To try the complete flow quickly, open the **Agent** panel and choose **Load the guided sample**.

## Use with a WebMCP agent

1. Open Cutline in a WebMCP-capable browser.
2. Wait for the header status to show **Agent connected**.
3. Import local media or load the guided sample project.
4. Ask the agent to inspect the project before editing.
5. Review its branch, receipts, changed ranges, and preview before choosing a final cut.

Example request:

> Inspect this project, create a new working branch, turn it into a punchy short, preserve protected ranges, and show me exactly what changed.

Only `project_status` is available while the local project hydrates. The remaining tools are registered when the project is ready and removed if readiness is lost.

### Semantic tool surface

| Tools | Purpose |
|---|---|
| `project_status`, `inspect_project` | Check readiness, capabilities, assets, branches, tracks, and locks |
| `get_timeline`, `read_transcript`, `get_comments` | Read bounded editing context |
| `select_branch`, `control_playback` | Control the shared visible workspace |
| `import_media` | Register browser-local or same-origin media without uploading it |
| `create_cut_branch` | Create a reversible working branch from an explicit version |
| `apply_edit_batch` | Apply up to 40 atomic semantic timeline operations |
| `place_clip`, `place_broll`, `place_audio` | Build picture, overlay, and sound tracks |
| `split_clip`, `trim_clip`, `delete_clip` | Refine timeline clips |
| `set_crop`, `set_transition`, `add_transition`, `set_gain`, `mute_track` | Adjust presentation and sound; `add_transition` applies a crossfade, dissolve, slide, or dip between adjacent clips |
| `style_captions` | Generate styled cues from the attached transcript |
| `add_comment`, `propose_comment_resolution` | Collaborate without impersonating or deleting human notes |
| `preview_range`, `compare_cuts` | Verify a digest-bound range and compare branch structure |
| `undo_edit`, `redo_edit` | Reverse or restore working-branch edits |

### Human-control boundaries

Agents can operate only on media already available to the browser. They cannot:

- accept a branch as the final cut;
- render, download, upload, or publish media;
- delete the local project;
- remove or impersonate human comments; or
- silently overwrite a stale or accepted branch.

Mutations require the latest branch version, support idempotent request IDs, respect protected ranges, and return a receipt containing the new version, state digest, changed ranges, duration delta, and warnings.

## Local media workflow

Cutline accepts MP4/WebM video, MP3/MP4/WAV/WebM audio, PNG/JPEG/WebP/SVG images, and SRT/VTT transcripts. Media imports are limited to 500 MB per file.

Source media is written to the browser's Origin Private File System when available, with IndexedDB as the compatibility fallback. Dexie stores project snapshots, comments, history, and media metadata. Mediabunny inspects duration, dimensions, codecs, and audio tracks in a dedicated worker through Comlink. The application Content Security Policy restricts media and network access to same-origin and browser-local blob sources.

Rendering is entirely local and composites V1/V2, crop settings, fades, captions, track mute state, and gain. It currently runs in real time, so a 30-second timeline takes approximately 30 seconds to render.

## Architecture

```text
Human UI ---------+
                  +--> shared editor store --> deterministic reducer --> receipts/digests
WebMCP tools -----+             |                        |
                                |                        +--> undo/redo + invariants
                                +--> Dexie metadata/history
                                +--> OPFS or IndexedDB media
                                +--> local preview/render pipeline
```

| Directory | Responsibility |
|---|---|
| `src/core` | Commands, types, timeline invariants, imports, versioning, and digests |
| `src/store` | Shared UI/WebMCP state and local workflow orchestration |
| `src/persistence` | IndexedDB project snapshots and persisted media fallback |
| `src/media` | Media inspection worker, local media access, and browser-native rendering |
| `src/webmcp` | Schemas and dynamically registered semantic editing tools |
| `src/ui` | Direct-manipulation editor, review surfaces, and render flow |
| `e2e` | Browser-level editing and WebMCP registration coverage |

## Development commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local Next.js development server |
| `npm test` | Run the Vitest unit and integration suite |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run lint` | Run ESLint |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run e2e` | Run Playwright end-to-end tests |
| `npm run demo:assets` | Regenerate the local demo fixtures |

Install the Playwright browser once before running E2E tests:

```bash
npx playwright install chromium
```

Run the full pre-push validation:

```bash
npm test
npm run lint
npm run build
npm run e2e
```

## Deployment

Cutline is a standard Next.js application and includes `vercel.json` for automatic framework detection. It has no server-side media pipeline and requires no secrets. After deployment, verify the site in the WebMCP browser used by your agent and confirm that the connection status changes from **Agent offline** to **Agent connected**.

## Privacy and current limitations

- Project data is scoped to the current browser origin and may be cleared by browser storage controls.
- Request persistent storage from the Project menu when the browser offers it.
- Local render output depends on the codecs exposed by `MediaRecorder`; Chromium currently provides the most consistent WebM support.
- Rendering happens in the active tab and should not be interrupted.
- Cutline is an editing prototype, not a lossless professional finishing pipeline.

## License and attribution

Cutline is available under the [MIT License](LICENSE). Demo media under `public/demo/` is original generated test-fixture material; see [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md).
