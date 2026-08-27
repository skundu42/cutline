"use client";

import { compareBranches, formatTimecode } from "@/core";
import { readMappedTranscript } from "@/core/reducer";
import type { CaptionPreset, Transition } from "@/core/types";
import { WINNING_PROMPT } from "@/demo/manifest";
import { activeBranch, useEditorStore } from "@/store/editorStore";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExportModal } from "./ExportModal";
import { Timeline } from "./Timeline";
import { Viewer } from "./Viewer";

type IconName =
  | "agent" | "arrowDown" | "audio" | "caption" | "clip" | "export"
  | "copy" | "plus" | "redo" | "reset" | "spark" | "undo" | "upload";

type ActivityTab = "comments" | "history" | "agent";
type MobileView = "preview" | "timeline" | "media" | "review";

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  agent: <><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M18.4 5.6l-2.1 2.1"/><rect x="6" y="7" width="12" height="12" rx="4"/><path d="M9.5 12h.01M14.5 12h.01M9.5 16h5"/></>,
  arrowDown: <path d="m7 10 5 5 5-5" />,
  audio: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
  caption: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h4M7 14h3M14 10h3M13 14h4"/></>,
  clip: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
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

function ProjectNameInput() {
  const title = useEditorStore((state) => state.editor.project.title);
  const renameProject = useEditorStore((state) => state.renameProject);
  return <input key={title} className="project-name-input" aria-label="Project name" defaultValue={title} onBlur={(event) => { const next = event.currentTarget.value.trim(); if (next) renameProject(next); else event.currentTarget.value = title; }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = title; event.currentTarget.blur(); } }} />;
}

function friendlyError(error: string) {
  const [, code = "EDIT_ERROR", rawMessage = error] = error.match(/^([^:]+):\s*(.*)$/) ?? [];
  const copy: Record<string, { title: string; message: string }> = {
    INVARIANT_VIOLATION: { title: "That edit could not be applied", message: "The timeline was left unchanged. Adjust the clip range and try again." },
    LOCKED_RANGE: { title: "This range is protected", message: "Remove the protection or choose a range outside it." },
    CONFLICT: { title: "The cut changed before this edit finished", message: "Review the latest timeline and try the edit again." },
    LOCAL_SAVE: { title: "Cutline could not save locally", message: "Keep this tab open and check that browser storage is available." },
    LOCAL_STORAGE: { title: "The saved project could not be opened", message: "A temporary workspace is open and the saved project has not been overwritten." },
    TRANSCRIPT: { title: "The transcript could not be attached", message: rawMessage },
    VALIDATION_ERROR: { title: "Check this input", message: rawMessage },
  };
  return { ...(copy[code] ?? { title: "The action did not finish", message: rawMessage }), detail: error };
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
  const importFiles = useEditorStore((s) => s.importFiles);
  const importTranscriptFile = useEditorStore((s) => s.importTranscriptFile);
  const importJobs = useEditorStore((s) => s.importJobs);
  const cancelImports = useEditorStore((s) => s.cancelImports);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const storageHealth = useEditorStore((s) => s.storageHealth);
  const hydrationError = useEditorStore((s) => s.hydrationError);
  const newProject = useEditorStore((s) => s.newProject);
  const requestPersistentStorage = useEditorStore((s) => s.requestPersistentStorage);
  const clearError = useEditorStore((s) => s.clearError);
  const setExportOpen = useEditorStore((s) => s.setExportOpen);
  const setSelectedRange = useEditorStore((s) => s.setSelectedRange);
  const setSelectedItemId = useEditorStore((s) => s.setSelectedItemId);
  const selectedRange = useEditorStore((s) => s.selectedRange);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const playing = useEditorStore((s) => s.playing);
  const [transcriptCollapsed, setTranscriptCollapsed] = useState(true);
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [activityTab, setActivityTab] = useState<ActivityTab>("comments");
  const [mobileView, setMobileView] = useState<MobileView>("preview");

  useEffect(() => { void hydrate(); }, [hydrate]);

  const branch = activeBranch(editor);
  const branchHistory = editor.history[branch.branchId] ?? { undo: [], redo: [] };
  const canUndo = branchHistory.undo.length > 0;
  const canRedo = branchHistory.redo.length > 0;
  const transcript = useMemo(() => readMappedTranscript(editor, branch.branchId), [editor, branch.branchId]);
  const webMcpConnected = registeredTools.length > 0 && !registeredTools.some((name) => name.startsWith("("));
  const agentToolCount = registeredTools.filter((name) => !name.startsWith("(")).length;
  const visibleError = lastError ? friendlyError(lastError) : null;

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
    return <div className="loading-screen"><div className="loading-mark"><span /></div><p>Preparing the cut room</p><span>Opening your local project…</span></div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div className="brand-copy">
            <p className="brand-name">Cutline</p>
            <ProjectNameInput />
          </div>
        </div>
        <p className="brand-tagline">In-browser agent-native &amp; WebMCP-compatible video editing</p>
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
          <div className={`connection-pill ${webMcpConnected ? "is-connected" : ""}`} title={webMcpConnected ? `${agentToolCount} editing actions are available` : "Open Cutline in a WebMCP-capable browser to connect an agent"}>
            <span className="connection-dot" /><span className="connection-label">{webMcpConnected ? "Agent connected" : "Agent offline"}</span>
          </div>
          <button className="icon-button" title={canUndo ? "Undo (⌘Z)" : "Nothing to undo"} aria-label="Undo" disabled={!canUndo} onClick={() => dispatch({ type: "Undo", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId } })}><Icon name="undo" /></button>
          <button className="icon-button" title={canRedo ? "Redo (⇧⌘Z)" : "Nothing to redo"} aria-label="Redo" disabled={!canRedo} onClick={() => dispatch({ type: "Redo", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId } })}><Icon name="redo" /></button>
          <button data-testid="export-button" className="primary-button export-button" disabled={branch.durationMs === 0} title={branch.durationMs ? "Render the current cut locally" : "Add a clip before rendering"} onClick={() => setExportOpen(true)}><Icon name="export" /><span>Render</span></button>
          <details className="project-menu">
            <summary>Project</summary>
            <div className="project-menu-popover">
              <div><strong>{editor.project.title}</strong><span>{saveStatus === "saving" ? "Saving…" : saveStatus === "failed" ? "Save needs attention" : "Saved locally"}</span></div>
              {storageHealth.persisted === false ? <button type="button" onClick={() => void requestPersistentStorage()}>Keep files available</button> : <span className="project-menu-status">Files kept in this browser</span>}
              <button data-testid="new-project" className="is-danger" type="button" onClick={() => { if (window.confirm("Start a new local project? This removes the current project and its stored media from this browser.")) void newProject(); }}>New local project</button>
            </div>
          </details>
        </div>
      </header>

      <nav className="mobile-workspace-tabs" aria-label="Workspace view">
        {(["preview", "timeline", "media", "review"] as const).map((view) => <button key={view} type="button" className={mobileView === view ? "is-active" : ""} aria-pressed={mobileView === view} onClick={() => { setMobileView(view); if (view === "review") setActivityCollapsed(false); }}>{view}</button>)}
      </nav>

      <div className={`workspace-grid ${activityCollapsed ? "is-activity-collapsed" : ""} mobile-view-${mobileView}`}>
        <aside className="asset-panel">
          <div className="asset-scroll panel-scroll">
          <SectionLabel meta={`${editor.assets.length} items`}>Media</SectionLabel>
          <label className="upload-zone">
            <Icon name="upload" size={18} /><span><strong>Choose local files</strong><small>Video, audio, images · up to 500 MB each</small></span>
            <input
              data-testid="upload-media" type="file" multiple
              accept="video/mp4,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/webm,image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void importFiles(files); event.target.value = ""; }}
            />
          </label>
          {importJobs.length ? (
            <div className="import-queue" aria-live="polite">
              <div className="import-queue-heading"><span>Recent imports</span>{importJobs.some((job) => job.status === "reading" || job.status === "storing") ? <button type="button" onClick={cancelImports}>Cancel</button> : null}</div>
              {importJobs.slice(0, 3).map((job) => <div key={job.id} className={`import-job is-${job.status}`}><i /><span title={job.name}>{job.name}</span><small>{job.status === "reading" ? "Reading media" : job.status === "storing" ? "Saving locally" : job.message ?? job.status}</small></div>)}
            </div>
          ) : null}
          {lastError?.startsWith("VALIDATION_ERROR") ? <div className="inline-error" role="alert">{lastError.replace("VALIDATION_ERROR: ", "")}</div> : null}
          {editor.assets.length === 0 ? <div className="asset-empty"><span>Local media bin</span><p>Your files stay in this browser. Choose clips above, then add them to the sequence.</p></div> : null}
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
                      <button className="mini-button is-primary" onClick={() => dispatch({
                        type: "PlaceClip", actor: { type: "human", surface: "ui" },
                        payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, assetId: asset.assetId, trackId: "v1", startMs: branch.durationMs, durationMs: asset.durationMs ?? 3000, fit: "cover" },
                      })}><Icon name="plus" size={12} /> Add to timeline</button>
                    ) : null}
                    {asset.kind === "audio" ? <button className="mini-button is-primary" onClick={() => {
                        const startMs = useEditorStore.getState().playheadMs;
                        const durationMs = Math.min(asset.durationMs ?? 2000, 8000);
                        dispatch({ type: "PlaceAudio", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, assetId: asset.assetId, trackId: "a2", range: { startMs, endMs: startMs + durationMs }, gain: 0.8, transitionIn: "fade_in", transitionOut: "fade_out", fadeMs: 200, replaceExisting: true } });
                      }}><Icon name="plus" size={12} /> Add at playhead</button> : null}
                    {asset.kind !== "audio" ? <details className="asset-more"><summary aria-label={`More options for ${asset.label}`}>•••</summary><div>
                      <button type="button" onClick={() => dispatch({ type: "PlaceClip", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, assetId: asset.assetId, trackId: "v2", startMs: useEditorStore.getState().playheadMs, durationMs: Math.min(asset.durationMs ?? 3000, 5000), fit: "contain", replaceExisting: true } })}>Add as overlay</button>
                      {asset.kind === "video" ? <button type="button" onClick={() => { const startMs = useEditorStore.getState().playheadMs; const durationMs = Math.min(asset.durationMs ?? 2000, 8000); dispatch({ type: "PlaceAudio", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, assetId: asset.assetId, trackId: "a2", range: { startMs, endMs: startMs + durationMs }, gain: 0.8, transitionIn: "fade_in", transitionOut: "fade_out", fadeMs: 200, replaceExisting: true } }); }}>Use audio only</button> : null}
                    </div></details> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <ProjectControls />
          </div>
          <ClipInspector />
        </aside>

        <main className="program-panel">
          <Viewer />
          <section id="transcript-dock" className={`transcript-panel ${transcriptCollapsed ? "is-collapsed" : ""}`}>
            <div className="transcript-toolbar">
              <button className="transcript-toggle" type="button" aria-expanded={!transcriptCollapsed} aria-controls="transcript-content" onClick={() => setTranscriptCollapsed((value) => !value)}>
                <Icon name="arrowDown" size={15} /><span>Transcript</span><small>{transcript.length ? `${transcript.length} cues` : "Optional"}</small>
              </button>
              <label className="transcript-import-button"><Icon name="upload" size={13} /><span>{transcript.length ? "Replace" : "Attach SRT/VTT"}</span><input data-testid="upload-transcript" className="sr-only" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" onChange={(event) => { const file = event.target.files?.[0]; if (file) { void importTranscriptFile(file).then((result) => { if (result.ok) setTranscriptCollapsed(false); }); } event.target.value = ""; }} /></label>
            </div>
            <div id="transcript-content" hidden={transcriptCollapsed} className="transcript-content">
            {transcript.length ? <div className="transcript-copy">
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
            </div> : <div className="transcript-empty"><strong>Attach timed captions</strong><span>Import an SRT or WebVTT file to unlock transcript selection, semantic edits, and caption styles—without uploading media.</span></div>}
            {lastError?.startsWith("TRANSCRIPT") ? <div className="inline-error" role="alert">{lastError.replace("TRANSCRIPT: ", "")}</div> : null}
            </div>
          </section>
        </main>

        <aside className={`activity-panel ${activityCollapsed ? "is-collapsed" : ""}`}>
          <div className="activity-rail-header">
            <strong>Review</strong>
            <button type="button" aria-label={activityCollapsed ? "Expand review panel" : "Collapse review panel"} aria-expanded={!activityCollapsed} onClick={() => setActivityCollapsed((value) => !value)}><Icon name="arrowDown" size={15} /></button>
          </div>
          <div className="activity-panel-content panel-scroll" hidden={activityCollapsed}>
            <nav className="activity-tabs" aria-label="Review panel">
              {(["comments", "history", "agent"] as const).map((tab) => <button key={tab} type="button" className={activityTab === tab ? "is-active" : ""} aria-pressed={activityTab === tab} onClick={() => setActivityTab(tab)}>{tab === "agent" ? "Agent" : tab === "history" ? `History ${receipts.length || ""}` : `Comments ${branch.comments.length || ""}`}</button>)}
            </nav>

            {activityTab === "agent" ? <>
              <AgentGuideCard connected={webMcpConnected} />
              <section className="local-card">
                <div className="prompt-heading"><Icon name="spark" /><span>Local workspace</span><span className="local-badge"><i /> On device</span></div>
                <p>Original clips, project state, previews, and renders stay in this browser. Nothing is uploaded by Cutline.</p>
                <dl className="local-stats">
                  <div><dt>Media</dt><dd>{editor.assets.length}</dd></div>
                  <div><dt>Cut</dt><dd>{formatTimecode(branch.durationMs)}</dd></div>
                  <div><dt>{storageHealth.backend === "opfs" ? "OPFS" : "Storage"}</dt><dd>{storageHealth.usedBytes == null ? "Local" : formatStorage(storageHealth.usedBytes)}</dd></div>
                </dl>
                <div className={`save-health is-${saveStatus}`}><i /><span>{saveStatus === "saving" ? "Saving changes…" : saveStatus === "failed" ? "Local save needs attention" : storageHealth.persisted === false ? "Saved for this browser session" : "Saved in this browser"}</span></div>
                {storageHealth.persisted === false ? <button className="secondary-button wide" type="button" onClick={() => void requestPersistentStorage()}>Keep files available</button> : null}
                {hydrationError ? <p className="local-recovery" role="alert">The saved project could not be opened: {hydrationError}. This temporary workspace has not overwritten it.</p> : null}
              </section>
            </> : null}

            {activityTab === "comments" ? <section className="activity-section">
              <SectionLabel meta={selectedRange ? `${formatTimecode(selectedRange.startMs)}–${formatTimecode(selectedRange.endMs)}` : "At playhead"}>Comments</SectionLabel>
              <CommentForm />
              {branch.comments.length ? <ul className="comment-list">{branch.comments.map((comment) => <li key={comment.commentId} className={`comment-card is-${comment.status}`}>
                <button className="comment-jump" onClick={() => { setPlayhead(comment.range.startMs); setSelectedRange(comment.range); }}><span>{comment.text}</span><small>{formatTimecode(comment.range.startMs)}–{formatTimecode(comment.range.endMs)}</small></button>
                <div className="comment-meta"><span>{comment.authorType === "agent" ? "Codex" : "Creator"}</span><span>{comment.status}</span></div>
                {comment.resolutionProposal ? <div className="resolution-proposal"><strong>Proposed resolution</strong><p>{comment.resolutionProposal}</p></div> : null}
                {comment.status !== "resolved" ? <button className="comment-resolve" onClick={() => dispatch({ type: "ProposeCommentResolution", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, commentId: comment.commentId, proposal: comment.resolutionProposal ?? "Resolved by creator" } })}>{comment.resolutionProposal ? "Accept resolution" : "Mark resolved"}</button> : null}
              </li>)}</ul> : <div className="agent-empty"><Icon name="plus" size={22} /><p>No comments yet</p><span>Select a range or move the playhead, then leave a precise note.</span></div>}
            </section> : null}

            {activityTab === "history" ? <>
              <section className="activity-section agent-log">
                <SectionLabel meta={`${receipts.length} changes`}>Change history</SectionLabel>
                {toolLifecycle.some((tool) => tool.phase === "running") ? <div className="tool-running"><span className="pulse-dot" /> Agent edit in progress</div> : null}
                {receipts.length === 0 ? <div className="agent-empty"><Icon name="agent" size={22} /><p>No edits yet</p><span>Changes from you and the connected agent will appear here.</span></div> : <ul className="receipt-list">{receipts.map((receipt, index) => <li key={receipt.operationId}><details open={index === 0}>
                  <summary><span className="receipt-icon"><Icon name="agent" size={14} /></span><span><strong>{receipt.summary}</strong><small>{receipt.branchVersion != null ? `Version ${receipt.branchVersion}` : "Project update"}</small></span><Icon name="arrowDown" size={14} /></summary>
                  <div className="receipt-detail">
                    {receipt.durationDeltaMs != null ? <span>Duration {receipt.durationDeltaMs > 0 ? "+" : ""}{(receipt.durationDeltaMs / 1000).toFixed(1)}s</span> : null}
                    {receipt.changedRanges.slice(0, 3).map((range, rangeIndex) => <button key={`${range.startMs}-${range.endMs}-${rangeIndex}`} onClick={() => { setPlayhead(range.startMs); setSelectedRange({ startMs: range.startMs, endMs: range.endMs }); }}>{formatTimecode(range.startMs)}–{formatTimecode(range.endMs)}{range.changes?.length ? ` · ${range.changes.join(", ").replaceAll("_", " ")}` : ""}</button>)}
                    {receipt.warnings.map((warning) => <p key={`${warning.code}-${warning.message}`}>{warning.message}</p>)}
                    <details className="technical-details"><summary>Technical details</summary><code>{receipt.stateDigest.slice(0, 26)}…</code></details>
                    {index === 0 && canUndo && receipt.branchId === branch.branchId ? <button className="receipt-undo" onClick={() => dispatch({ type: "Undo", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId } })}><Icon name="undo" size={12} /> Undo this change</button> : null}
                  </div>
                </details></li>)}</ul>}
              </section>
              {compare.enabled ? <CompareCard /> : null}
            </> : null}
          </div>
        </aside>

        <div className="timeline-shell"><Timeline /></div>
      </div>

      {debug ? <div data-testid="debug-panel" className="debug-panel"><p>ready={String(ready)} project={editor.project.projectId} playing={String(playing)}</p><p data-testid="tool-catalog">tools: {registeredTools.join(", ")}</p></div> : null}
      {visibleError ? <div className="workspace-toast" role="alert"><div><strong>{visibleError.title}</strong><span>{visibleError.message}</span><details><summary>Technical details</summary><code>{visibleError.detail}</code></details></div><button type="button" aria-label="Dismiss error" onClick={clearError}>×</button></div> : null}
      <ExportModal />
    </div>
  );
}

function formatStorage(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function AgentGuideCard({ connected }: { connected: boolean }) {
  const editor = useEditorStore((s) => s.editor);
  const loadSampleProject = useEditorStore((s) => s.loadSampleProject);
  const [copied, setCopied] = useState(false);
  const hasWork = editor.assets.length > 0 || activeBranch(editor).durationMs > 0;
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(WINNING_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="prompt-card intent-strip">
      <div className="prompt-heading"><Icon name="spark" /><span>Ask the agent</span><span className={`agent-ready-label ${connected ? "is-connected" : ""}`}>{connected ? "Connected" : "Offline"}</span></div>
      <p>Copy a timeline-aware request into Codex. It can create a safe branch, make bounded edits, and show exactly what changed.</p>
      <blockquote>“Turn this into a punchy short. Create a new branch, preserve protected ranges, and show me what changed.”</blockquote>
      <div className="prompt-actions">
        <button className="primary-button" type="button" onClick={() => void copyPrompt()}><Icon name="copy" size={14} /> {copied ? "Prompt copied" : "Copy prompt for Codex"}</button>
        <button className="text-button" type="button" onClick={() => { if (!hasWork || window.confirm("Replace this local workspace with the sample KV Cache project?")) void loadSampleProject(); }}>Load the guided sample</button>
      </div>
      {!connected ? <small>Open Cutline in a WebMCP-capable browser to connect an editing agent.</small> : null}
    </section>
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
  const delta = left && right ? compareBranches(left, right) : null;
  const itemDeltaCount = delta ? delta.addedItemIds.length + delta.removedItemIds.length + delta.changedItemIds.length : 0;

  return (
    <section className="compare-card">
      <SectionLabel meta="Previewing one at a time">Compare cuts</SectionLabel>
      <div className="compare-toggle" aria-label="Cut preview">
        <button className={compare.show === "left" ? "is-active" : ""} aria-pressed={compare.show === "left"} disabled={!left} onClick={() => setCompare({ show: "left" })}>{left?.name ?? "Cut A"}</button>
        <button className={compare.show === "right" ? "is-active" : ""} aria-pressed={compare.show === "right"} disabled={!right} onClick={() => setCompare({ show: "right" })}>{right?.name ?? "Cut B"}</button>
      </div>
      {delta ? <div className="compare-delta"><div><span>Duration</span><strong>{delta.durationDeltaMs > 0 ? "+" : ""}{(delta.durationDeltaMs / 1000).toFixed(1)}s</strong></div><div><span>Clip changes</span><strong>{itemDeltaCount}</strong></div><div><span>Visual setup</span><strong>{delta.cropChanged || delta.captionStyleChanged ? "Changed" : "Same"}</strong></div></div> : null}
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
      <div className="segmented-control" aria-label="Aspect ratio">{(["16:9", "9:16", "1:1"] as const).map((ratio) => <button key={ratio} aria-pressed={branch.crop.aspectRatio === ratio} className={branch.crop.aspectRatio === ratio ? "is-active" : ""} onClick={() => setCrop(ratio)}>{ratio}</button>)}</div>
      <label className="compact-field"><span><Icon name="caption" size={14} /> Caption style</span><select disabled={!editor.transcript.length} title={editor.transcript.length ? "Style transcript captions" : "Add a transcript before styling captions"} value={branch.captionStyle.preset} onChange={(event) => styleCaptions(event.target.value as CaptionPreset)}><option value="bold_center">Bold center</option><option value="clean_lower">Clean lower</option><option value="technical_card">Technical card</option></select></label>
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
  const linked = clip.trackId === "v1" ? branch.tracks.find((entry) => entry.trackId === "a1")?.items.find((item) => item.assetId === clip.assetId && item.startMs === clip.startMs && item.endMs === clip.endMs && item.sourceInMs === clip.sourceInMs) : null;
  const editItems = (operation: (itemId: string) => { op: "move"; itemId: string; startMs: number } | { op: "trim"; itemId: string; startMs?: number; endMs?: number } | { op: "delete"; itemId: string }) => dispatch({
    type: "ApplyEditBatch",
    actor: { type: "human", surface: "ui" },
    payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, operations: [operation(clip.itemId), ...(linked ? [operation(linked.itemId)] : [])] },
  });
  const transition = (side: "in" | "out", value: Transition) => dispatch({
    type: "SetTransition", actor: { type: "human", surface: "ui" },
    payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, itemId: clip.itemId, ...(side === "in" ? { transitionIn: value } : { transitionOut: value }), fadeMs: clip.fadeMs ?? 250 },
  });
  return (
    <section className="clip-inspector">
      <SectionLabel meta={track.trackId.toUpperCase()}>Selected clip</SectionLabel><p className="inspector-title">{clip.label}</p>
      <div className="time-field-grid">
        <label>Start (ms)<input key={`${clip.itemId}-start-${clip.startMs}`} type="number" min={0} step={Math.round(1000 / editor.project.frameRate)} defaultValue={Math.round(clip.startMs)} onBlur={(event) => { const startMs = Number(event.currentTarget.value); if (Number.isFinite(startMs) && startMs >= 0 && startMs !== clip.startMs) editItems((itemId) => ({ op: "move", itemId, startMs })); }} /></label>
        <label>End (ms)<input key={`${clip.itemId}-end-${clip.endMs}`} type="number" min={clip.startMs + 1} step={Math.round(1000 / editor.project.frameRate)} defaultValue={Math.round(clip.endMs)} onBlur={(event) => { const endMs = Number(event.currentTarget.value); if (Number.isFinite(endMs) && endMs > clip.startMs && endMs !== clip.endMs) editItems((itemId) => ({ op: "trim", itemId, endMs })); }} /></label>
      </div>
      <label className="range-field"><span>Gain <strong>{((clip.gain ?? 1) * 100).toFixed(0)}%</strong></span><input type="range" min={0} max={2} step={0.05} value={clip.gain ?? 1} onChange={(event) => dispatch({ type: "SetGain", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, itemId: clip.itemId, gain: Number(event.target.value) } })} /></label>
      <div className="field-grid"><label>In<select value={clip.transitionIn ?? "cut"} onChange={(event) => transition("in", event.target.value as Transition)}>{transitionOptions()}</select></label><label>Out<select value={clip.transitionOut ?? "cut"} onChange={(event) => transition("out", event.target.value as Transition)}>{transitionOptions()}</select></label></div>
      <label className="compact-field"><span>Fade duration</span><input type="number" min={0} max={5000} step={50} value={clip.fadeMs ?? 0} onChange={(event) => dispatch({ type: "SetTransition", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, itemId: clip.itemId, fadeMs: Number(event.target.value) } })} /></label>
      <div className="inspector-actions"><button className="secondary-button" onClick={() => dispatch({ type: "MuteTrack", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, trackId: track.trackId, muted: !track.muted } })}>{track.muted ? "Unmute track" : "Mute track"}</button><button className="danger-button" onClick={() => editItems((itemId) => ({ op: "delete", itemId }))}>Delete{linked ? " linked" : ""}</button></div>
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
    }}><input ref={inputRef} data-testid="comment-input" disabled={!branch.durationMs} placeholder={branch.durationMs ? "Leave a time-coded note…" : "Add a clip before commenting"} aria-label="Comment" /><button data-testid="pin-comment" className="icon-button" type="submit" disabled={!branch.durationMs} aria-label="Pin comment" title="Pin comment"><Icon name="plus" /></button></form>
  );
}
