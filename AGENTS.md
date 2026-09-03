<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Cutline repository guide

This file is the operational source of truth for coding agents working in this repository. It describes the application as it exists now, not only the original challenge plan.

## Product and current stage

Cutline is an in-browser, local-first nonlinear video editor designed for a human and a WebMCP agent to operate the same versioned timeline. It was built for the 2026 OpenAI WebMCP Challenge.

As of 2026-08-31, the repository is a functional, tested challenge prototype rather than an early scaffold:

- The default route opens a content-agnostic empty project.
- Users can import local video, audio, still images, SVG graphics, and SRT/VTT transcripts without an upload service.
- The editor has a working viewer, multi-track timeline, direct clip manipulation, inspector, comments, locks, branch review, undo/redo, responsive layouts, and local export.
- A WebMCP bridge dynamically exposes 36 semantic tools over the same store and reducer used by the UI, including a non-committing edit planner.
- A local project library, portable `.cutline` bundles, project snapshots, and media survive reloads through IndexedDB plus OPFS where available.
- 480p and 720p WebM rendering, and capability-gated MP4 rendering, run entirely in the browser and include picture, overlays, captions, transitions, gain, mutes, and mixed audio.
- The checked baseline passes 73 Vitest unit/integration tests, ESLint, the Next.js production build, and 16 Chromium Playwright scenarios.

Treat this as a polished browser prototype with a credible end-to-end workflow. It is not a production NLE, a cloud collaboration product, or a lossless finishing pipeline.

## Source-of-truth order

When documents disagree, use this order:

1. Executable code and tests under `src/` and `e2e/`.
2. This `AGENTS.md` current-stage guide.
3. `README.md`, which describes the current user-facing contract.
4. `docs/PRD.md`, which is a historical challenge brief and contains superseded scope and authorization assumptions.

Important divergence from the PRD: the application now starts empty, supports user-owned local media, has two audio tracks, gives UI and WebMCP actors equal command authority, and permits agent-side accept/export/publish/delete operations. The old PRD's human-only finalization policy is no longer the implementation contract.

## Runtime and stack

- Next.js 16.3.3 App Router and Turbopack
- React 19.2.8
- TypeScript 5 in strict, no-emit mode; `@/*` maps to `src/*`
- Zustand 5 for the shared client store
- Immer 11 for deterministic immutable reducer updates
- Zod 4 for WebMCP input validation and JSON Schema generation
- Dexie 4 over IndexedDB for snapshots and the media fallback
- Mediabunny 1.55 for media inspection, audio decoding, and final WebM muxing
- Comlink 4 for the media inspection worker boundary
- Canvas, Web Audio, MediaRecorder, and browser media elements for preview/render
- Vitest 4 for unit/integration tests and Playwright 1.62 for Chromium E2E
- Tailwind 4 is installed through PostCSS, while most application styling lives in `src/app/globals.css`

There are no API routes, server-side media jobs, server-side databases, accounts, environment variables, secrets, or external publishing integrations. The `/` route is statically generated; all editor behavior begins after client hydration.

## Application shape

The principal data flow is:

```text
direct-manipulation UI ----+
                           +--> Zustand store --> applyCommand reducer --> next EditorState + Receipt
WebMCP tool handlers ------+                         |
                                                     +--> invariant validation
                                                     +--> branch history/audit events
                                                     +--> semantic SHA-256 digests

EditorState --> Dexie snapshot --> IndexedDB
Imported Blob --> OPFS when available, otherwise IndexedDB
Active Branch + resolved local media --> viewer and browser-local WebM renderer
```

The UI and WebMCP layer must not implement competing edit logic. Both surfaces should construct a typed `Command` and send it through `useEditorStore().dispatch`, which calls `applyCommand`.

## Domain model and invariants

The canonical types are in `src/core/types.ts`.

### Project and tracks

Each `EditorState` contains one project, assets, a source transcript, branches, per-branch undo/redo stacks, audit events, and export metadata. A new project has one working `branch_main`, a 30 fps timebase, 16:9 crop, and these fixed tracks:

| Track | Kind | Current role |
|---|---|---|
| `v1` | video | Primary picture; placing a video with audio also creates a linked `a1` item |
| `v2` | video overlay | B-roll, images, and graphics; overlaps are permitted |
| `a1` | audio | Primary/dialogue audio |
| `a2` | audio | Music, SFX, extracted audio, and secondary beds |
| `cc` | caption | Caption cues are stored on the branch, while this track provides the timeline lane |

Times are milliseconds. Tool-facing ranges are integer, ordered, half-open ranges. UI dragging snaps to the project frame duration. Non-overlay tracks reject overlapping clips. Clip project duration must match its source duration, source bounds must stay within timed assets, transition durations must be between 0 and 5000 ms, and branch duration is recomputed from the latest material end.

### Commands and transactions

`src/core/reducer.ts` is the only semantic write engine. It supports project/media/transcript import, branch creation and selection, batched edits, caption styling, B-roll and clip/audio placement, crop, comments, locks, acceptance, export records, local publication records, transitions, gain, track mute, undo, and redo.

Keep these guarantees and current boundaries intact:

- Direct branch mutation commands carry `expectedBranchVersion`; stale writes return `CONFLICT` without partial mutation. `Undo`/`Redo` are exceptions in the core command type, although their WebMCP wrappers perform an explicit version check. Branch selection is view state and is not version-bound.
- Accepted or discarded branches are immutable. Create a new working branch before further edits.
- Branch count is capped at 8.
- An edit batch is capped at 40 operations and commits atomically through Immer.
- Batch operations default to required. Lock-aware optional operations (`required: false`) can be skipped with a warning; a required lock conflict rejects the batch.
- Lock enforcement currently covers ripple delete, replace, still extension, trim, required delete, move, clip/audio placement, B-roll placement, and adjacent-clip transitions. Ripple checks the downstream range it would shift.
- Timeline material edits consistently enforce range locks, including split, optional delete, clip-edge and adjacent transitions, gain, mute, and link/unlink. Lock-aware optional operations are skipped with an explicit receipt warning.
- Split, trim, move, and delete resolve linked targets in the reducer using `src/core/linked.ts`, from either side of explicit groups or legacy aligned V1/A1 pairs. UI and adapter callers must not expand partners themselves. Move/trim preserve offsets; split creates independent left/right link groups. Equivalent paired input operations coalesce, while contradictory partner edits require unlinking. Optional lock conflicts skip the whole linked edit; required failures reject the batch. Gain, fades, and mute retain their existing scope.
- Whole-clip placement replacement removes all overlapping clips plus linked partners. Protection is checked over the complete removed ranges, not just the insertion interval. Receipts include those removal ranges.
- Invariants are checked before a batch commits. Failures leave the original state unchanged.
- Every successful semantic write returns a `Receipt` with an operation ID, summary, branch/version where applicable, digest, changed ranges, warnings, and often a verification range.
- The reducer keeps at most 50 undo entries per branch. A new write clears redo history.
- Undo/redo restore whole branch snapshots for an edit group. Acceptance, export-record, and publish-record operations are deliberately excluded from branch undo history.
- Importing a replacement transcript clears generated captions on every branch and increments affected branch versions.
- Project and branch digests use canonical JSON plus SHA-256. Use the digest helpers; do not invent alternate serialization.

`EditOp` currently includes `ripple_delete`, `replace_range`, `extend_still`, `split`, `trim`, `delete`, `move`, `place_clip`, `place_audio`, `set_transition`, `add_transition`, `set_gain`, `mute_track`, and `set_link`.

### Branch and actor behavior

Branches are reversible working copies with a recorded base branch and base digest. Creating a branch clones its source, resets the clone to version 0, gives it fresh history, and makes it active. Accepting a branch marks it accepted and records it as `selectedFinalBranchId`; any previously accepted branch returns to working status.

Read newly created branch IDs from the reducer receipt's `branchId`, never by searching for a name (duplicate names are permitted). Manual **New version** and **Continue editing from final** use `CreateBranch`, defaulting to the next unused `Version N` and preserving accepted originals/final selection. The shared store `setCompare` path is used by UI and WebMCP: it selects the shown A/B branch through `SelectActiveBranch`, keeping all edit surfaces aligned. Exiting comparison leaves that branch active.

Actor metadata is audit attribution, not an authorization boundary. Both `{type: "human", surface: "ui"}` and `{type: "agent", surface: "webmcp"}` commands pass through the same reducer rules. Do not reintroduce old PRD-only human/agent permission differences without an explicit product decision and coordinated tests/docs changes.

## Implemented user experience

`src/ui/Workspace.tsx` composes the application shell:

- Editable project name, branch tabs, aspect/version/duration readout, connection state, undo/redo, render button, and project menu.
- Media bin with multi-file import, content hashes, import/proxy progress and cancellation, poster thumbnails, metadata, offline relinking, optional 480p proxies, and actions to add picture, overlay, audio-only, or A2 audio.
- Project controls for 16:9, 9:16, and 1:1 crops and three caption presets.
- Collapsible transcript with SRT/VTT attachment and time-range selection.
- Review panel with comments, receipt/history details, agent lifecycle status, debug diagnostics, branch comparison, and final-branch acceptance.
- Resizable, persisted desktop media/review/timeline panes and focused mobile modes for preview, timeline, media, and review.
- A local project switcher plus `.cutline` project bundle import/export.
- Manual version naming (eight-version cap), comparison selectors with A/B preview/accept/exit, and a protected-range list with jump and per-lock Unprotect actions. Accepted versions must be cloned before editing or changing locks.

`src/ui/SourceViewer.tsx` provides transient source selection, an independent source playhead, native video/audio/image preview, numeric in/out, mark controls, and editable still holds. Media thumbnails open Source without a semantic write. Source uses available proxy URLs, pauses when hidden/unmounted, and directs offline assets to relink. Destination/position controls default visual media to V1/end and audio to A2/playhead; timed media starts with its full duration (no hidden audio/overlay caps), stills with a five-second hold. Occupied destinations require explicit whole-clip replacement consent and list linked partners. Success places through `PlaceClip`/`PlaceAudio`, selects the material, and returns to Timeline; failure retains the source selection. Project changes clear source state. Timeline seeking, comparison, and WebMCP playback select Timeline mode, pausing Source.

`src/ui/Viewer.tsx` previews V1/V2, stills, captions, A1/A2 audio, crop, clip-edge fades, and adjacent-clip crossfade/dissolve/slide/dip transitions. It supports bounded playback ranges used by WebMCP verification and synchronized left/right branch comparison.

`src/ui/Timeline.tsx` supports seeking, zoom, multi-select, magnetic/frame snapping, clip/range selection, waveform previews, transition edges, move and trim handles, explicit A/V link/unlink, split, delete, ripple delete, preview selection, range protection, comment markers, caption cues, audio mute, and visible lock bands. Linked V1/A1 operations stay synchronized until explicitly unlinked.

`src/ui/ExportModal.tsx` is an accessible modal with focus trapping, Escape close, preset selection, live progress, cancellation, digest display, and local download.

Keyboard behavior includes Space for play/pause, remappable split/protect/marker keys (defaults `S`/`L`/`M`), frame stepping, delete, and platform undo/redo. Timeline mutation shortcuts are ignored in Source and while form/dialog controls have focus. Source supports its own Space/frame stepping and I/O marks. Shortcut labels follow remapping. Do not claim a complete professional-editor shortcut set.

## WebMCP surface

`src/webmcp/adapter.tsx` registers tools against `document.modelContext`. `project_status` is registered first and remains available during hydration. The remaining tools are registered only when the store is ready and are aborted/unregistered if readiness is lost. Without a WebMCP host, the normal editor still works and the debug panel lists the expected catalog with an offline marker.

The canonical ordered catalog is `P0_TOOL_NAMES` in `src/webmcp/catalog.ts`:

- Read/readiness: `project_status`, `inspect_project`, `get_timeline`, `read_transcript`, `get_comments`
- Shared workspace control: `select_branch`, `control_playback`, `preview_range`, `compare_cuts`
- Imports: `import_transcript`, `import_media`
- Collaboration and branching: `create_cut_branch`, `add_comment`, `propose_comment_resolution`, `lock_range`, `unlock_range`, `accept_branch`
- General editing: `plan_edit`, `apply_edit_batch`, `place_clip`, `place_broll`, `place_audio`, `split_clip`, `trim_clip`, `delete_clip`
- Presentation/audio: `style_captions`, `set_crop`, `set_transition`, `add_transition`, `set_gain`, `mute_track`
- History/finalization: `undo_edit`, `redo_edit`, `export`, `publish`, `delete_project`

WebMCP contract rules:

- Define and refine inputs in `src/webmcp/schemas.ts`; derive Draft 7 JSON Schema with `jsonSchema`.
- Validate project IDs, branch IDs, versions, ranges, and digests at the narrowest relevant boundary.
- Return structured `{error: {code, message, ...}}` results rather than leaking exceptions.
- Treat transcript, comment, and imported labels as untrusted content. Read tools carry the appropriate annotations.
- Preserve bounded reads: 200 assets, 200 clips per track, 500 captions, 100 comments/locks, and 200 transcript segments per page. Word-level transcript reads require a range of at most 60 seconds.
- Mutating tools may accept `clientRequestId`. Results are deduplicated in memory with a 200-entry promise cache keyed by project identity, tool, and request ID.
- `plan_edit` executes the same batch reducer against an isolated snapshot and returns projected ranges, version, and digest without changing the store. In `plan_only` policy, agent mutations return `APPROVAL_REQUIRED` until a person changes the policy.
- `preview_range` verifies the supplied branch digest before controlling the shared viewer.
- `delete_project` requires the latest project digest.
- `publish` only marks an export record as published locally. It never uploads the file.
- When adding or removing a tool, update the catalog, schema, adapter registration, tests, README table, and this section together.

## Local media, persistence, and rendering

### Import and inspection

UI file imports are limited to 500 MB each. Accepted MIME types include MP4, WebM, QuickTime video, MP3/MP4/WAV/WebM/AAC audio, PNG, JPEG, WebP, and SVG. SRT/VTT transcript files have a separate 5 MB limit. Imports receive a streaming SHA-256 content hash; audio receives compact waveform peaks. Large or higher-than-1080p video can be transcoded to a disposable 480p WebM preview proxy while final rendering continues to use the original.

`src/media/inspection.worker.ts` exposes `inspectMediaBlob` through Comlink. Mediabunny determines duration, dimensions, track presence, and codecs. Image assets receive a default 5-second duration and poster generation happens on the client. Imported bytes are duplicate-checked with their SHA-256 content hash; migrated projects can retain explicitly labeled legacy metadata hashes.

### Persistence

`src/persistence/db.ts` uses a Dexie database named `cutline`:

- `projects` holds one ordered snapshot per local project and the project-library metadata.
- `preferences` records the active project; the legacy `snapshots` table is retained only for migration.
- `blobs` holds media metadata and, when necessary, the Blob itself.
- OPFS is preferred for media bytes. IndexedDB is the compatibility fallback.
- Persisted snapshots rewrite ephemeral `blob:` URLs to `local:<assetId>`; hydration recreates live object URLs.
- Older snapshots are migrated to schema 3 with standard tracks, a direct agent policy, and explicit legacy-checksum metadata.
- Creating a project preserves the existing library. Deleting a project revokes its live URLs and removes only its snapshot and media.
- `.cutline` bundles carry a validated manifest and concatenated original media payloads, remap imported project/asset identities, and omit disposable proxy files.
- Hydration has an 8-second timeout. On failure, the UI opens a temporary empty workspace and surfaces a storage error.

Storage usage and backend are visible in the Agent/debug surface.

### Render pipeline

`src/media/export.ts` renders the selected branch locally:

1. Resolve V1/V2 media elements and decode all unmuted audio-track material.
2. Composite video/stills, crop, overlays, transitions, and captions onto a canvas at 30 fps.
3. Encode image/still-only timelines faster than real time with WebCodecs when available; otherwise capture video timelines in real time with `MediaRecorder` without advancing across hidden-tab suspension.
4. Mix A1/A2 in a 48 kHz stereo `OfflineAudioContext`, respecting per-clip gain and fades.
5. Mux WebM/Opus or capability-gated MP4/AAC output with Mediabunny.
6. Verify the branch digest did not change during rendering, record export metadata, and expose a browser-local download URL.

Output sizes are 1280x720/720x1280/720x720 for 720p and 854x480/480x854/480x480 for 480p. Video timelines require active-tab time approximately equal to their duration; hiding the tab pauses progress without skipping frames. Rendering works most reliably in current Chromium browsers.

## Repository map

| Path | Responsibility |
|---|---|
| `src/app/` | Single Next.js route, metadata, fonts, CSP-backed global styling |
| `src/core/types.ts` | Domain types, commands, results, receipts, errors |
| `src/core/reducer.ts` | Deterministic command engine, locks, versions, history, audit |
| `src/core/invariants.ts` | Timeline validity and duration recomputation |
| `src/core/linked.ts` | Shared link resolution and whole-clip placement conflicts |
| `src/core/digest.ts` | Canonical branch/project SHA-256 digests |
| `src/core/transitions.ts` | Adjacent-clip transition boundaries and seek-safe frames |
| `src/core/captions.ts` | Transcript word flattening and caption segmentation |
| `src/core/compare.ts` | Structural branch delta calculation |
| `src/core/import.ts` | Import MIME/size/URI policy and track migration |
| `src/core/transcriptImport.ts` | SRT/VTT parsing and inferred word timings |
| `src/store/editorStore.ts` | Hydration, dispatch, persistence orchestration, UI state, imports, renders |
| `src/persistence/db.ts` | Dexie snapshot storage and OPFS/IndexedDB media storage |
| `src/media/` | Worker inspection, local capability checks, browser render/export |
| `src/webmcp/` | Tool catalog, Zod schemas, lifecycle registration, handlers |
| `src/ui/` | Workspace, viewer, timeline, inspector/review, export modal |
| `src/demo/` | Deterministic KV-cache fixtures and golden edit recipe |
| `public/demo/` | Bundled test media and rendered WebMCP explainer clips |
| `videos/webmcp-demo-clips/` | Separate Motion Canvas source project; excluded from root TypeScript |
| `e2e/` | Browser-level product flows |
| `docs/PRD.md` | Historical challenge specification, not current authority |

## Development workflow

Requirements: Node.js 20.9 or newer, npm, and Chromium for full render/E2E coverage.

```bash
npm ci
npm run dev
```

The app runs at `http://localhost:3000`. Add `?debug=1` to expose the tool catalog and project diagnostics. No environment setup is required.

Validation commands:

```bash
npm test
npm run lint
npm run build
npm run e2e
```

Install the Playwright browser once with `npx playwright install chromium`. The configured E2E server uses `127.0.0.1:3002`. Next.js permits only one `next dev` process per repository build directory, so `npm run e2e` can fail on `.next/dev/lock` when another development server for this checkout is already running, even on another port. Do not kill an unknown/user-owned process automatically; stop it deliberately or run Playwright against the known existing server with a temporary configuration.

Current checked baseline:

- Vitest: 9 files, 73 tests passed.
- Playwright: 16 Chromium tests passed.
- ESLint: clean.
- `next build`: successful; `/` and `/_not-found` are static routes.

Tests cover reducer atomicity and locks, bidirectional linked edits and deduplication, replacement protection, local projects, imports, captions, transcripts, transitions, render sizing, tool parity, dry-run non-mutation, reliable branch IDs, and idempotency. Browser coverage includes manual versions/acceptance/continuation, unprotect/undo, source placement and replacement, full-duration audio-only placement, adjustable SVG holds, shortcut parity/remapping/focus guards, and narrow layouts. Rendering E2E uses the two-second `public/demo/brand_sting.mp4` fixture and verifies a non-empty downloaded WebM.

## Change discipline

- Read the relevant local Next.js guide under `node_modules/next/dist/docs/` before changing framework APIs or conventions. This repository uses Next.js 16 behavior that may differ from prior knowledge.
- Preserve the shared command path. UI-only state belongs in Zustand, but durable semantic edits belong in `Command`/`applyCommand`.
- Keep reducer operations deterministic by injecting IDs and time through `BusContext`.
- Maintain atomic failure behavior: validate first or mutate only inside the Immer transaction.
- Preserve optimistic version checks, digest checks, protected-range enforcement, receipts, audit attribution, and accepted-branch immutability.
- Keep imported media browser-local. Do not introduce network uploads, remote URLs, or permissive CSP changes casually.
- Avoid persisting object URLs; store stable local asset references and reconstruct URLs during hydration.
- Clean up object URLs, media elements, workers, streams, and abort controllers.
- Use existing transition and caption helpers in both viewer and exporter so preview and output remain visually aligned.
- Add focused reducer tests for semantic behavior, adapter integration tests for tool changes, and Playwright coverage for visible user flows.
- Minimize unrelated edits. `docs/PRD.md` should remain historical unless the task explicitly requests a product-spec revision.

## Security and privacy posture

- Source media and render output stay on the device under normal operation.
- The WebMCP media URI schema permits only same-origin paths and browser-local `blob:`/`idb:` references.
- CSP is defined in `next.config.ts`: default same-origin; images may additionally use blob/data; media, connections, and workers may use blob; objects and base URIs are disabled.
- Tool inputs are schema-validated. Branch mutations are version-bound; project deletion is digest-bound; project-level imports use project identity plus optional idempotency IDs rather than a branch version.
- Transcript/comment text is explicitly untrusted content for agent reads.
- No credentials or external destinations are configured.

The development CSP currently permits inline styles/scripts and `unsafe-eval`, so do not describe it as a fully hardened production policy. Any CSP tightening must be tested against Next.js development, workers, local blobs, fonts, and media rendering.

## Known limitations and likely next stage

- Video rendering is real-time, active-tab, and browser-codec-dependent. MP4 is capability-gated; there is no background render worker, resumable render, or server fallback.
- This is a single-user, single-browser-origin application. Portable project interchange exists through `.cutline` bundles, but there is no account sync, real-time collaboration, or cloud backup.
- “Publish” is local metadata only; no YouTube, Drive, social, or storage destination exists.
- There is no speech-to-text generation. Transcripts must be bundled, imported as SRT/VTT, or supplied as structured WebMCP input.
- The editor does not offer multicam, keyframe curves, color grading, masks, effects/plugins, waveform editing, advanced audio buses, or lossless source passthrough. Proxy generation is a fixed 480p preview optimization, not a configurable proxy workflow.
- Browser preview is pragmatic media-element synchronization, not a sample-accurate playback engine.
- Project schema version 3 normalizes earlier projects with standard tracks, the direct agent policy, and legacy checksum metadata. This is still a narrow migration path rather than a general migration framework.
- Telemetry is a rolling 200-event array in `sessionStorage`; there is no external observability service.
- Accessibility foundations exist (labels, keyboard access, focus trapping, semantic controls, responsive modes), but a complete WCAG audit has not been documented.

The highest-value productionization work would be broader codec/browser verification, background/resumable video export, branch renaming/archiving, cloud backup/collaboration, and formal accessibility/performance audits. Manual creation/comparison/continuation is implemented. Treat future directions as ideas, not pre-authorized scope.
