"use client";

import { formatTimecode } from "@/core";
import { readMappedTranscript } from "@/core/reducer";
import type { CaptionPreset, Transition } from "@/core/types";
import { WINNING_PROMPT } from "@/demo/manifest";
import { activeBranch, useEditorStore } from "@/store/editorStore";
import Image from "next/image";
import { useEffect, useMemo, useRef } from "react";
import { ExportModal } from "./ExportModal";
import { Timeline } from "./Timeline";
import { Viewer } from "./Viewer";

type IconName =
  | "agent" | "arrowDown" | "audio" | "caption" | "clip" | "export"
  | "plus" | "redo" | "reset" | "spark" | "undo" | "upload";

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  agent: <><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M18.4 5.6l-2.1 2.1"/><rect x="6" y="7" width="12" height="12" rx="4"/><path d="M9.5 12h.01M14.5 12h.01M9.5 16h5"/></>,
  arrowDown: <path d="m7 10 5 5 5-5" />,
  audio: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
  caption: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h4M7 14h3M14 10h3M13 14h4"/></>,
  clip: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/></>,
  export: <><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6h14v-6"/></>,
  plus: <path d="M12 5v14M5 12h14" />,
  redo: <><path d="m16 7 4 4-4 4"/><path d="M20 11h-8a6 6 0 0 0-6 6"/></>,
  reset: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8"/><path d="M4 3v5h5"/></>,
  spark: <><path d="m12 3 1.2 4.3L17 9l-3.8 1.7L12 15l-1.2-4.3L7 9l3.8-1.7L12 3Z"/><path d="m18 15 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7L18 15Z"/></>,
  undo: <><path d="m8 7-4 4 4 4"/><path d="M4 11h8a6 6 0 0 1 6 6"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v5h16v-5"/></>,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  );
}

function SectionLabel({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return <div className="section-label"><span>{children}</span>{meta ? <span className="section-meta">{meta}</span> : null}</div>;
}

export function Workspace() {
  const hydrate = useEditorStore((s) => s.hydrate);
  const editor = useEditorStore((s) => s.editor);
  const ready = useEditorStore((s) => s.ready);
  const receipts = useEditorStore((s) => s.receipts);
  const toolLifecycle = useEditorStore((s) => s.toolLifecycle);
  const lastError = useEditorStore((s) => s.lastError);
  const debug = useEditorStore((s) => s.debug);
  const registeredTools = useEditorStore((s) => s.registeredTools);
  const compare = useEditorStore((s) => s.compare);
  const dispatch = useEditorStore((s) => s.dispatch);
  const resetDemo = useEditorStore((s) => s.resetDemo);
  const replayGoldenRun = useEditorStore((s) => s.replayGoldenRun);
  const replayRevision = useEditorStore((s) => s.replayRevision);
  const setExportOpen = useEditorStore((s) => s.setExportOpen);
  const setSelectedRange = useEditorStore((s) => s.setSelectedRange);
  const setSelectedItemId = useEditorStore((s) => s.setSelectedItemId);
  const selectedRange = useEditorStore((s) => s.selectedRange);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const playing = useEditorStore((s) => s.playing);

  useEffect(() => { void hydrate(); }, [hydrate]);

  const branch = activeBranch(editor);
  const branchHistory = editor.history[branch.branchId] ?? { undo: [], redo: [] };
  const canUndo = branchHistory.undo.length > 0;
  const canRedo = branchHistory.redo.length > 0;
  const transcript = useMemo(() => readMappedTranscript(editor, branch.branchId), [editor, branch.branchId]);
  const webMcpConnected = registeredTools.length > 0 && !registeredTools.some((name) => name.startsWith("("));
  const agentToolCount = registeredTools.filter((name) => !name.startsWith("(")).length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === "Space") {
        event.preventDefault();
        useEditorStore.getState().setPlaybackEndMs(null);
        setPlaying(!useEditorStore.getState().playing);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPlayhead(useEditorStore.getState().playheadMs + 1000 / editor.project.frameRate);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPlayhead(useEditorStore.getState().playheadMs - 1000 / editor.project.frameRate);
      }
      if (event.key.toLowerCase() === "l" && selectedRange) {
        const current = activeBranch(useEditorStore.getState().editor);
        dispatch({
          type: "SetLock", actor: { type: "human", surface: "ui" },
          payload: { action: "lock", branchId: current.branchId, expectedBranchVersion: current.branchVersion, range: selectedRange, label: "Keep pause" },
        });
      }
      if (event.key.toLowerCase() === "s") {
        const state = useEditorStore.getState();
        const current = activeBranch(state.editor);
        const selected = state.selectedItemId
          ? current.tracks.flatMap((track) => track.items).find((item) => item.itemId === state.selectedItemId)
          : current.tracks.flatMap((track) => track.items).find((item) => state.playheadMs > item.startMs && state.playheadMs < item.endMs);
        if (!selected || state.playheadMs <= selected.startMs || state.playheadMs >= selected.endMs) return;
        dispatch({
          type: "ApplyEditBatch", actor: { type: "human", surface: "ui" },
          payload: { branchId: current.branchId, expectedBranchVersion: current.branchVersion, operations: [{ op: "split", itemId: selected.itemId, atMs: state.playheadMs }] },
        });
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const currentState = useEditorStore.getState().editor;
        const current = activeBranch(currentState);
        const history = currentState.history[current.branchId];
        if (event.shiftKey ? history?.redo.length : history?.undo.length) {
          dispatch({ type: event.shiftKey ? "Redo" : "Undo", actor: { type: "human", surface: "ui" }, payload: { branchId: current.branchId } });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, editor.project.frameRate, selectedRange, setPlayhead, setPlaying]);

  if (!ready) {
    return <div className="loading-screen"><div className="loading-mark"><span /></div><p>Preparing the cut room</p><span>Loading KV Cache Explainer…</span></div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div><p className="brand-name">Cutline</p><p className="project-name">{editor.project.title}</p></div>
        </div>
        <nav className="branch-tabs" aria-label="Cut branches">
          {Object.values(editor.branches).map((item) => (
            <button
              key={item.branchId}
              data-testid={`branch-${item.name}`}
              aria-current={item.branchId === branch.branchId ? "page" : undefined}
              onClick={() => {
                setSelectedRange(null);
                setSelectedItemId(null);
                dispatch({ type: "SelectActiveBranch", actor: { type: "human", surface: "ui" }, payload: { branchId: item.branchId } });
              }}
              className={`branch-tab ${item.branchId === branch.branchId ? "is-active" : ""}`}
            >
              <span>{item.name}</span>
              {editor.project.selectedFinalBranchId === item.branchId ? <><span className="sr-only"> · final</span><span className="final-dot" title="Accepted final" /></> : null}
            </button>
          ))}
        </nav>
        <div className="project-readout" aria-label="Current branch details"><span>{branch.crop.aspectRatio}</span><span>v{branch.branchVersion}</span><span>{formatTimecode(branch.durationMs)}</span></div>
        <div className="topbar-actions">
          <div className={`connection-pill ${webMcpConnected ? "is-connected" : ""}`} title={webMcpConnected ? `${agentToolCount} WebMCP tools registered` : `${agentToolCount} WebMCP tool contracts ready; this browser has no WebMCP host`}>
            <span className="connection-dot" /><span className="connection-label">WebMCP</span><strong>{agentToolCount}</strong>
          </div>
          <button className="icon-button" title={canUndo ? "Undo (⌘Z)" : "Nothing to undo"} aria-label="Undo" disabled={!canUndo} onClick={() => dispatch({ type: "Undo", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId } })}><Icon name="undo" /></button>
          <button className="icon-button" title={canRedo ? "Redo (⇧⌘Z)" : "Nothing to redo"} aria-label="Redo" disabled={!canRedo} onClick={() => dispatch({ type: "Redo", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId } })}><Icon name="redo" /></button>
          <button data-testid="export-button" className="primary-button export-button" onClick={() => setExportOpen(true)}><Icon name="export" /><span>Export</span></button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="asset-panel panel-scroll">
          <SectionLabel meta={`${editor.assets.length} items`}>Media</SectionLabel>
          <label className="upload-zone">
            <Icon name="upload" size={18} /><span><strong>Import media</strong><small>Video, audio, images</small></span>
            <input
              data-testid="upload-media" type="file"
              accept="video/mp4,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/webm,image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void useEditorStore.getState().importFile(file); event.target.value = ""; }}
            />
          </label>
          <ul className="asset-list">
            {editor.assets.map((asset) => (
              <li key={asset.assetId} className="asset-card">
                <div className="asset-thumb">
                  {asset.posterUri ? <Image src={asset.posterUri} alt="" fill sizes="72px" loading="eager" unoptimized={asset.posterUri.endsWith(".svg")} /> : <Icon name={asset.kind === "audio" ? "audio" : "clip"} size={20} />}
                  <span>{asset.kind}</span>
                </div>
                <div className="asset-copy">
                  <p title={asset.label}>{asset.label}</p><span>{asset.durationMs ? formatTimecode(asset.durationMs) : "Still"}</span>
                  <div className="asset-actions">
                    {asset.kind !== "audio" ? (
                      <button className="mini-button" onClick={() => dispatch({
                        type: "PlaceClip", actor: { type: "human", surface: "ui" },
                        payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, assetId: asset.assetId, trackId: "v2", startMs: useEditorStore.getState().playheadMs, durationMs: Math.min(asset.durationMs ?? 3000, 5000), fit: "cover", replaceExisting: true },
                      })}><Icon name="plus" size={12} /> Add clip</button>
                    ) : null}
                    {asset.kind === "audio" || asset.kind === "video" ? (
                      <button className="mini-button" onClick={() => {
                        const startMs = useEditorStore.getState().playheadMs;
                        const durationMs = Math.min(asset.durationMs ?? 2000, 8000);
                        dispatch({ type: "PlaceAudio", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, assetId: asset.assetId, trackId: "a2", range: { startMs, endMs: startMs + durationMs }, gain: 0.8, transitionIn: "fade_in", transitionOut: "fade_out", fadeMs: 200, replaceExisting: true } });
                      }}><Icon name="plus" size={12} /> Add sound</button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <ProjectControls />
          <ClipInspector />
        </aside>

        <main className="program-panel">
          <Viewer />
          <section className="transcript-panel">
            <SectionLabel meta="Click text to select a range">Transcript</SectionLabel>
            <div className="transcript-copy">
              {transcript.map((segment) => {
                const silence = segment.markers?.includes("silence");
                const falseStart = segment.markers?.includes("false_start");
                return (
                  <button
                    key={segment.segmentId}
                    className={`transcript-segment ${silence ? "is-silence" : ""} ${falseStart ? "is-false-start" : ""}`}
                    aria-pressed={selectedRange?.startMs === segment.startMs && selectedRange.endMs === segment.endMs}
                    title={`${formatTimecode(segment.startMs)}–${formatTimecode(segment.endMs)}`}
                    onClick={() => { setPlayhead(segment.startMs); setSelectedRange({ startMs: segment.startMs, endMs: segment.endMs }); }}
                  >{silence ? <><span className="silence-wave">•••</span> silence</> : segment.text}</button>
                );
              })}
            </div>
          </section>
        </main>

        <aside className="activity-panel panel-scroll">
          <section className="prompt-card">
            <div className="prompt-heading"><Icon name="spark" /><span>Demo direction</span><span className="prompt-badge">Golden</span></div>
            <p>{WINNING_PROMPT}</p>
            <div className="prompt-actions">
              <button data-testid="replay-golden" className="primary-button wide" onClick={() => replayGoldenRun()}><Icon name="agent" /> Build first cut</button>
              <button data-testid="replay-revision" className="secondary-button wide" onClick={() => replayRevision()}><Icon name="redo" /> Run lock-aware revision</button>
              <button data-testid="reset-demo" className="text-button" onClick={() => void resetDemo()}><Icon name="reset" size={14} /> Reset demo</button>
            </div>
          </section>

          <section className="activity-section">
            <SectionLabel meta={selectedRange ? `${formatTimecode(selectedRange.startMs)}–${formatTimecode(selectedRange.endMs)}` : "At playhead"}>Comments</SectionLabel>
            <CommentForm />
            {branch.comments.length ? (
              <ul className="comment-list">
                {branch.comments.map((comment) => (
                  <li key={comment.commentId}><button onClick={() => { setPlayhead(comment.range.startMs); setSelectedRange(comment.range); }}><span>{comment.text}</span><small>{formatTimecode(comment.range.startMs)}–{formatTimecode(comment.range.endMs)}</small></button></li>
                ))}
              </ul>
            ) : <p className="empty-copy">Select a moment and leave a precise note.</p>}
          </section>

          <section className="activity-section agent-log">
            <SectionLabel meta={`${receipts.length} changes`}>Agent activity</SectionLabel>
            {lastError ? <div className="error-banner" role="alert">{lastError}</div> : null}
            {toolLifecycle.some((tool) => tool.phase === "running") ? <div className="tool-running"><span className="pulse-dot" /> Agent tool running</div> : null}
            {receipts.length === 0 ? (
              <div className="agent-empty"><Icon name="agent" size={22} /><p>No edits yet</p><span>Run the demo direction or connect an agent through WebMCP.</span></div>
            ) : (
              <ul className="receipt-list">
                {receipts.map((receipt, index) => (
                  <li key={receipt.operationId}>
                    <details open={index === 0}>
                      <summary><span className="receipt-icon"><Icon name="agent" size={14} /></span><span><strong>{receipt.summary}</strong><small>{receipt.branchVersion != null ? `Version ${receipt.branchVersion}` : "Project update"}</small></span><Icon name="arrowDown" size={14} /></summary>
                      <div className="receipt-detail"><code>{receipt.stateDigest.slice(0, 26)}…</code>{receipt.durationDeltaMs != null ? <span>Duration {receipt.durationDeltaMs > 0 ? "+" : ""}{(receipt.durationDeltaMs / 1000).toFixed(1)}s</span> : null}{receipt.warnings.map((warning) => <p key={`${warning.code}-${warning.message}`}><strong>{warning.code}</strong> {warning.message}</p>)}</div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {compare.enabled ? <CompareCard /> : null}
        </aside>

        <div className="timeline-shell"><Timeline /></div>
      </div>

      {debug ? <div data-testid="debug-panel" className="debug-panel"><p>ready={String(ready)} project={editor.project.projectId} playing={String(playing)}</p><p data-testid="tool-catalog">tools: {registeredTools.join(", ")}</p></div> : null}
      <ExportModal />
    </div>
  );
}

function CompareCard() {
  const editor = useEditorStore((s) => s.editor);
  const compare = useEditorStore((s) => s.compare);
  const setCompare = useEditorStore((s) => s.setCompare);
  const dispatch = useEditorStore((s) => s.dispatch);
  const left = compare.leftId ? editor.branches[compare.leftId] : null;
  const right = compare.rightId ? editor.branches[compare.rightId] : null;
  const shown = (compare.show === "right" ? right : left) ?? activeBranch(editor);
  const accepted = editor.project.selectedFinalBranchId === shown.branchId;

  return (
    <section className="compare-card">
      <SectionLabel meta="Previewing one at a time">Compare cuts</SectionLabel>
      <div className="compare-toggle" aria-label="Cut preview">
        <button className={compare.show === "left" ? "is-active" : ""} aria-pressed={compare.show === "left"} disabled={!left} onClick={() => setCompare({ show: "left" })}>{left?.name ?? "Cut A"}</button>
        <button className={compare.show === "right" ? "is-active" : ""} aria-pressed={compare.show === "right"} disabled={!right} onClick={() => setCompare({ show: "right" })}>{right?.name ?? "Cut B"}</button>
      </div>
      <button
        data-testid="accept-branch"
        className="primary-button wide"
        disabled={accepted}
        onClick={() => dispatch({ type: "AcceptBranch", actor: { type: "human", surface: "ui" }, payload: { branchId: shown.branchId, expectedBranchVersion: shown.branchVersion } })}
      >{accepted ? `${shown.name} accepted` : `Accept ${shown.name}`}</button>
      <p>The cut shown in the Program monitor will be accepted.</p>
    </section>
  );
}

function ProjectControls() {
  const editor = useEditorStore((s) => s.editor);
  const dispatch = useEditorStore((s) => s.dispatch);
  const branch = activeBranch(editor);
  const setCrop = (aspectRatio: "16:9" | "9:16" | "1:1") => dispatch({
    type: "SetCrop", actor: { type: "human", surface: "ui" },
    payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, target: { kind: "project" }, aspectRatio, anchor: aspectRatio === "9:16" ? "face" : "center" },
  });
  const styleCaptions = (preset: CaptionPreset) => dispatch({
    type: "StyleCaptions", actor: { type: "human", surface: "ui" },
    payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, source: "transcript", preset, emphasis: preset === "bold_center" ? "active_word" : "none", maxLines: 2, maxCharsPerLine: preset === "technical_card" ? 34 : 42 },
  });
  return (
    <section className="project-controls">
      <SectionLabel>Format</SectionLabel>
      <div className="segmented-control" aria-label="Aspect ratio">{(["16:9", "9:16", "1:1"] as const).map((ratio) => <button key={ratio} className={branch.crop.aspectRatio === ratio ? "is-active" : ""} onClick={() => setCrop(ratio)}>{ratio}</button>)}</div>
      <label className="compact-field"><span><Icon name="caption" size={14} /> Caption style</span><select value={branch.captionStyle.preset} onChange={(event) => styleCaptions(event.target.value as CaptionPreset)}><option value="bold_center">Bold center</option><option value="clean_lower">Clean lower</option><option value="technical_card">Technical card</option></select></label>
    </section>
  );
}

function ClipInspector() {
  const editor = useEditorStore((s) => s.editor);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const dispatch = useEditorStore((s) => s.dispatch);
  const branch = activeBranch(editor);
  const clip = branch.tracks.flatMap((track) => track.items).find((item) => item.itemId === selectedItemId);
  const track = clip ? branch.tracks.find((entry) => entry.trackId === clip.trackId) : null;
  if (!clip || !track) return <div className="inspector-empty"><span>S</span><p>Select a timeline clip to adjust audio, fades, or delete it.</p></div>;
  const transition = (side: "in" | "out", value: Transition) => dispatch({
    type: "SetTransition", actor: { type: "human", surface: "ui" },
    payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, itemId: clip.itemId, ...(side === "in" ? { transitionIn: value } : { transitionOut: value }), fadeMs: clip.fadeMs ?? 250 },
  });
  return (
    <section className="clip-inspector">
      <SectionLabel meta={track.trackId.toUpperCase()}>Selected clip</SectionLabel><p className="inspector-title">{clip.label}</p>
      <label className="range-field"><span>Gain <strong>{((clip.gain ?? 1) * 100).toFixed(0)}%</strong></span><input type="range" min={0} max={2} step={0.05} value={clip.gain ?? 1} onChange={(event) => dispatch({ type: "SetGain", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, itemId: clip.itemId, gain: Number(event.target.value) } })} /></label>
      <div className="field-grid"><label>In<select value={clip.transitionIn ?? "cut"} onChange={(event) => transition("in", event.target.value as Transition)}>{transitionOptions()}</select></label><label>Out<select value={clip.transitionOut ?? "cut"} onChange={(event) => transition("out", event.target.value as Transition)}>{transitionOptions()}</select></label></div>
      <label className="compact-field"><span>Fade duration</span><input type="number" min={0} max={5000} step={50} value={clip.fadeMs ?? 0} onChange={(event) => dispatch({ type: "SetTransition", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, itemId: clip.itemId, fadeMs: Number(event.target.value) } })} /></label>
      <div className="inspector-actions"><button className="secondary-button" onClick={() => dispatch({ type: "MuteTrack", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, trackId: track.trackId, muted: !track.muted } })}>{track.muted ? "Unmute track" : "Mute track"}</button><button className="danger-button" onClick={() => dispatch({ type: "ApplyEditBatch", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, operations: [{ op: "delete", itemId: clip.itemId }] } })}>Delete</button></div>
    </section>
  );
}

function transitionOptions() {
  return <><option value="cut">Cut</option><option value="crossfade">Crossfade</option><option value="fade_in">Fade in</option><option value="fade_out">Fade out</option><option value="dissolve">Dissolve</option></>;
}

function CommentForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const branch = activeBranch(useEditorStore((s) => s.editor));
  const selectedRange = useEditorStore((s) => s.selectedRange);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setSelectedRange = useEditorStore((s) => s.setSelectedRange);
  const dispatch = useEditorStore((s) => s.dispatch);
  return (
    <form className="comment-form" onSubmit={(event) => {
      event.preventDefault();
      const text = inputRef.current?.value.trim();
      if (!text) return;
      const endMs = Math.min(branch.durationMs, playheadMs + 1200);
      const range = selectedRange ?? { startMs: Math.max(0, Math.min(playheadMs, endMs - 1)), endMs };
      const result = dispatch({ type: "AddComment", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, range, text } });
      if (result.ok) {
        setSelectedRange(range);
        if (inputRef.current) inputRef.current.value = "";
      }
    }}><input ref={inputRef} data-testid="comment-input" placeholder="Leave a time-coded note…" aria-label="Comment" /><button data-testid="pin-comment" className="icon-button" type="submit" aria-label="Pin comment" title="Pin comment"><Icon name="plus" /></button></form>
  );
}
