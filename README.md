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
- Inspectable WebMCP actions with bounded reads, dry-run edit plans, and idempotent writes
- Direct or review-first agent mutation policy, with the same reducer rules for people and agents
- A browser-local project library, portable `.cutline` bundles, content hashes, relinking, and recoverable offline media
- Resizable panes, multi-select edits, magnetic snapping, linked A/V, waveforms, markers, and remappable shortcuts
- Optional 480p preview proxies for large video; final renders always use the source media
- 480p and 720p WebM rendering, plus MP4 where the browser exposes the required codecs
- Source/Timeline monitors with marked-range placement and explicit whole-clip replacement
- Manual named versions, A/B comparison, final-cut continuation, and removable range protection

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
| `import_transcript` | Replace the project transcript with structured, word-timed segments |
| `select_branch`, `control_playback` | Control the shared visible workspace |
| `import_media` | Register browser-local or same-origin media without uploading it |
| `create_cut_branch` | Create a reversible working branch from an explicit version |
| `plan_edit`, `apply_edit_batch` | Dry-run or commit up to 40 atomic semantic timeline operations |
| `place_clip`, `place_broll`, `place_audio` | Build picture, overlay, and sound tracks |
| `split_clip`, `trim_clip`, `delete_clip` | Edit either side of linked picture/audio together; unlink first for independent edits |
| `set_crop`, `set_transition`, `add_transition`, `set_gain`, `mute_track` | Adjust presentation and sound; `add_transition` applies a crossfade, dissolve, slide, or dip between adjacent clips |
| `style_captions` | Generate styled cues from the attached transcript |
| `add_comment`, `propose_comment_resolution` | Add and resolve attributed timeline notes |
| `preview_range`, `compare_cuts` | Verify a digest-bound range and compare branch structure |
| `lock_range`, `unlock_range` | Create and remove versioned edit protections |
| `accept_branch` | Select a branch as the immutable final cut |
| `export`, `publish` | Render locally and mark the digest-bound artifact as published in Cutline |
| `delete_project` | Delete a digest-matched local project and open an empty workspace |
| `undo_edit`, `redo_edit` | Reverse or restore working-branch edits |

### Actor parity

UI users and agents use the same command bus and can import transcripts, manage locks, accept branches, render, publish local artifacts, resolve comments, and delete projects. Identity remains explicit in audit events and comments, but it does not change authorization.

The Agent panel can switch between **Review first**, which requires `plan_edit` and blocks agent writes, and **Direct edits**. Mutations still require the latest branch or project digest, support idempotent request IDs, respect protected ranges, and return a receipt containing the new version, state digest, changed ranges, duration delta, and warnings. Accepted branches remain immutable for every actor; further edits start from a new working branch. External upload and publishing destinations are not configured for either actor.

## Local media workflow

Cutline accepts MP4/WebM video, MP3/MP4/WAV/WebM audio, PNG/JPEG/WebP/SVG images, and SRT/VTT transcripts. Media imports are limited to 500 MB per file.

Select a media thumbnail to open **Source** without changing the timeline or undo history. Scrub the source, use **Mark in / Mark out** or numeric millisecond fields, then choose the destination and either the timeline end or playhead. Timed media initially selects its full duration; stills use an editable five-second hold. Visual media defaults to V1/end, audio to A2/playhead. Video can also be placed as audio-only on A1/A2. The preview uses an available proxy; placement still references the original media.

The placement summary shows the exact interval and whether linked dialogue will be created. Occupied destinations require **Replace entire overlapping clips**: the listed clips and their linked partners are removed completely, not trimmed or rippled. Protection is checked across their full removal ranges. Failed placement keeps the source range and timeline intact. **Place selection** returns to Timeline and selects the new material. Source and Timeline have separate playheads and never play together; timeline seeking, comparison, and agent playback switch back to Timeline. Source controls are transient and reset when the project changes.

### Linked edits and manual versions

Split, trim, move, and delete use the same reducer for keyboard, timeline, inspector, and WebMCP actions. Editing either side propagates to its linked partners, including older aligned V1/A1 pairs. Move/trim preserve relative offsets; splitting creates independently linked left/right pieces. Use **Unlink A/V** for independent edits. Gain, fades, and track mute retain their own scope.

A batch accepts at most 40 input operations and creates one undo entry/version increment. Equivalent operations explicitly targeting both partners coalesce; contradictory edits require unlinking. Required failures reject the entire batch. An optional lock conflict skips the entire linked edit with a warning. Timeline mutation shortcuts are ignored while Source or form/dialog controls have focus; remapped shortcuts are reflected in the controls.

Choose **New version** beside the branch tabs to name a working copy (default: the next unused `Version N`). **Continue editing from final** clones an accepted version without changing it or the selected final. There is an eight-version limit; branch renaming/deletion/archiving is not part of this workflow.

**Compare versions** opens two version selectors, structural differences, and A/B preview. Switching A/B keeps the viewer, timeline, inspector, and active branch aligned. Acceptance targets the displayed version; **Exit comparison** leaves it active. The Review panel's **Protected ranges** list lets you jump to a labeled time range or **Unprotect** only that lock. Accepted versions require a working copy before edits or protection changes.

Source media is content-hashed and written to the browser's Origin Private File System when available, with IndexedDB as the compatibility fallback. Dexie stores an ordered snapshot for each local project, comments, history, and media metadata. Missing bytes are surfaced as offline media that can be relinked. Portable `.cutline` bundles include the project state and original local media; disposable proxies are regenerated after import. Mediabunny inspects duration, dimensions, codecs, and audio tracks in a dedicated worker through Comlink. The application Content Security Policy restricts media and network access to same-origin and browser-local blob sources.

Rendering is entirely local and composites V1/V2, crop settings, fades, captions, track mute state, and gain from original media. Still/image-only timelines use a faster WebCodecs path when supported. Timelines containing video use a resilient real-time path that pauses rather than skipping frames while the tab is hidden. WebM is the portable default; MP4 appears only when the browser reports compatible video and AAC capabilities.

## Architecture

```text
User UI ----------+
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

If another development server already holds `.next/dev/lock`, do not stop it automatically. Run Playwright with a temporary configuration that imports `playwright.config.ts`, sets `webServer: undefined`, and points `use.baseURL` to the known existing server (with absolute `testDir`/`outputDir` paths if the temporary config lives outside the repository).

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

- Project data is scoped to the current browser origin and may be cleared by browser storage controls; export `.cutline` bundles for portable backups.
- Local render formats depend on codecs exposed by `MediaRecorder` and WebCodecs; Chromium currently provides the broadest support.
- Video timelines render in real time in the active tab. Hiding the tab pauses progress safely, but there is no background render worker or resumable render job.
- There is no cloud sync, real-time multi-user collaboration, remote publishing destination, or built-in speech-to-text.
- Cutline is an editing prototype, not a lossless professional finishing pipeline.

## License and attribution

Cutline is available under the [MIT License](LICENSE). Demo media under `public/demo/` is original generated test-fixture material; see [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md).
