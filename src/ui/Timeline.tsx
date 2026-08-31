"use client";

import { formatTimecode } from "@/core";
import type { ClipInstance, EditOp } from "@/core/types";
import { activeBranch, useEditorStore } from "@/store/editorStore";
import { useEffect, useRef, useState } from "react";

const TRACK_COLORS: Record<string, string> = { v1: "track-video", v2: "track-overlay", a1: "track-dialogue", a2: "track-audio", cc: "track-caption" };
const TRACK_NAMES: Record<string, string> = { v1: "Video", v2: "Overlay", a1: "Dialogue", a2: "Music", cc: "Captions" };
const BASE_TIMELINE_WIDTH = 1120;
const LABEL_WIDTH = 96;

type DragMode = "move" | "trim-start" | "trim-end";
interface DragState {
  mode: DragMode;
  item: ClipInstance;
  originClientX: number;
  previewStartMs: number;
  previewEndMs: number;
}

function LockIcon() {
  return <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
}

function SoundIcon({ muted }: { muted: boolean }) {
  return <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>{muted ? <path d="m16 9 5 5m0-5-5 5"/> : <path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/>}</svg>;
}

export function Timeline({ splitShortcut = "s", protectShortcut = "l" }: { splitShortcut?: string; protectShortcut?: string }) {
  const editor = useEditorStore((s) => s.editor);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setSelectedRange = useEditorStore((s) => s.setSelectedRange);
  const setSelectedItemId = useEditorStore((s) => s.setSelectedItemId);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const selectedItemIds = useEditorStore((s) => s.selectedItemIds);
  const setSelectedItemIds = useEditorStore((s) => s.setSelectedItemIds);
  const selectedRange = useEditorStore((s) => s.selectedRange);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlaybackEndMs = useEditorStore((s) => s.setPlaybackEndMs);
  const dispatch = useEditorStore((s) => s.dispatch);
  const branch = activeBranch(editor);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineWidth = Math.round(BASE_TIMELINE_WIDTH * zoom);
  const frameMs = 1000 / editor.project.frameRate;
  const px = (ms: number) => (ms / Math.max(branch.durationMs, 1)) * timelineWidth;
  const selectedItem = selectedItemId ? branch.tracks.flatMap((track) => track.items).find((item) => item.itemId === selectedItemId) ?? null : null;
  const writable = branch.status === "working";
  const canSplit = Boolean(writable && selectedItem && playheadMs > selectedItem.startMs && playheadMs < selectedItem.endMs);

  const seek = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const timelineX = Math.max(0, Math.min(timelineWidth, clientX - rect.left - LABEL_WIDTH));
    setPlayhead(Math.round((timelineX / timelineWidth) * branch.durationMs));
    setSelectedRange(null);
    setSelectedItemId(null);
  };

  const beginDrag = (event: React.PointerEvent, item: ClipInstance, mode: DragMode) => {
    if (branch.status !== "working") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && mode === "move") {
      const next = selectedItemIds.includes(item.itemId)
        ? selectedItemIds.filter((itemId) => itemId !== item.itemId)
        : [...selectedItemIds, item.itemId];
      setSelectedItemIds(next);
      setSelectedRange(next.length ? { startMs: Math.min(...branch.tracks.flatMap((track) => track.items).filter((candidate) => next.includes(candidate.itemId)).map((candidate) => candidate.startMs)), endMs: Math.max(...branch.tracks.flatMap((track) => track.items).filter((candidate) => next.includes(candidate.itemId)).map((candidate) => candidate.endMs)) } : null);
      return;
    }
    if (!selectedItemIds.includes(item.itemId)) setSelectedItemIds([item.itemId]);
    setSelectedRange({ startMs: item.startMs, endMs: item.endMs });
    setSelectedItemId(item.itemId);
    setPlayhead(item.startMs);
    setDrag({ mode, item, originClientX: event.clientX, previewStartMs: item.startMs, previewEndMs: item.endMs });
  };

  useEffect(() => {
    if (!drag) return;
    const snap = (ms: number) => Math.round(Math.round(ms / frameMs) * frameMs);
    const edgeToleranceMs = Math.max(frameMs, branch.durationMs * 8 / timelineWidth);
    const edges = branch.tracks.flatMap((track) => track.items)
      .filter((item) => item.itemId !== drag.item.itemId && !selectedItemIds.includes(item.itemId))
      .flatMap((item) => [item.startMs, item.endMs]);
    const magneticStart = (startMs: number, duration: number) => {
      let best = startMs;
      let distance = edgeToleranceMs + 1;
      for (const edge of edges) {
        for (const candidate of [edge, edge - duration]) {
          const nextDistance = Math.abs(candidate - startMs);
          if (nextDistance < distance) { best = candidate; distance = nextDistance; }
        }
      }
      return distance <= edgeToleranceMs ? snap(best) : startMs;
    };
    const onMove = (event: PointerEvent) => {
      const deltaMs = snap(((event.clientX - drag.originClientX) / timelineWidth) * branch.durationMs);
      const duration = drag.item.endMs - drag.item.startMs;
      if (drag.mode === "move") {
        const startMs = Math.max(0, magneticStart(snap(drag.item.startMs + deltaMs), duration));
        setDrag((current) => current ? { ...current, previewStartMs: startMs, previewEndMs: startMs + duration } : null);
      } else if (drag.mode === "trim-start") {
        const startMs = Math.max(0, Math.min(drag.item.endMs - frameMs, snap(drag.item.startMs + deltaMs)));
        setDrag((current) => current ? { ...current, previewStartMs: startMs } : null);
      } else {
        const endMs = Math.max(drag.item.startMs + frameMs, snap(drag.item.endMs + deltaMs));
        setDrag((current) => current ? { ...current, previewEndMs: endMs } : null);
      }
    };
    const onUp = () => {
      const current = drag;
      const operations: EditOp[] = [];
      if (current.mode === "move" && current.previewStartMs !== current.item.startMs) {
        const deltaMs = current.previewStartMs - current.item.startMs;
        const selected = branch.tracks.flatMap((track) => track.items).filter((item) => selectedItemIds.includes(item.itemId));
        const moving = selected.length > 1 && selectedItemIds.includes(current.item.itemId) ? selected : [current.item];
        for (const item of moving) {
          operations.push({ op: "move", itemId: item.itemId, startMs: item.startMs + deltaMs });
        }
      }
      if (current.mode !== "move" && (current.previewStartMs !== current.item.startMs || current.previewEndMs !== current.item.endMs)) {
        operations.push({ op: "trim", itemId: current.item.itemId, startMs: current.previewStartMs, endMs: current.previewEndMs });
      }
      if (operations.length) {
        const result = dispatch({ type: "ApplyEditBatch", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, operations } });
        if (result.ok) setSelectedRange({ startMs: current.previewStartMs, endMs: current.previewEndMs });
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [branch, dispatch, drag, frameMs, selectedItemIds, setSelectedRange, timelineWidth]);

  const fitTimeline = () => {
    setZoom(1);
    scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  };

  const splitSelected = () => {
    if (!selectedItem || !canSplit) return;
    const operations: EditOp[] = [{ op: "split", itemId: selectedItem.itemId, atMs: Math.round(playheadMs) }];
    dispatch({ type: "ApplyEditBatch", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, operations } });
  };

  const deleteSelected = () => {
    if (!selectedItem) return;
    const selected = branch.tracks.flatMap((track) => track.items).filter((item) => selectedItemIds.includes(item.itemId));
    const targets = selected.length ? selected : [selectedItem];
    const ids = new Set(targets.map((item) => item.itemId));
    const operations: EditOp[] = [...ids].map((itemId) => ({ op: "delete", itemId }));
    dispatch({ type: "ApplyEditBatch", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, operations } });
    setSelectedItemId(null);
    setSelectedItemIds([]);
    setSelectedRange(null);
  };

  const rippleSelected = () => {
    if (!selectedItem) return;
    dispatch({ type: "ApplyEditBatch", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, operations: [{ op: "ripple_delete", range: { startMs: selectedItem.startMs, endMs: selectedItem.endMs }, required: true }] } });
    setSelectedItemId(null);
    setSelectedRange(null);
  };

  const previewSelection = () => {
    if (!selectedRange) return;
    setPlayhead(selectedRange.startMs);
    setPlaybackEndMs(selectedRange.endMs);
    setPlaying(true);
  };

  return (
    <section className="timeline-panel" aria-label="Timeline editor">
      <div className="timeline-header">
        <div className="timeline-title"><strong>Timeline</strong><span>{branch.tracks.length} tracks</span></div>
        <div className="timeline-selection">{selectedRange ? <><span>Selection</span><code>{formatTimecode(selectedRange.startMs)} – {formatTimecode(selectedRange.endMs)}</code></> : <span>No range selected</span>}</div>
        <div className="timeline-edit-actions" aria-label="Selected clip actions">
          <button type="button" disabled={!selectedRange} onClick={previewSelection}>Preview</button>
          <button data-testid="split-selected" type="button" disabled={!canSplit} title={selectedItem ? `Move the playhead inside the clip to split it (${splitShortcut.toUpperCase()})` : "Select a clip first"} onClick={splitSelected}>Split</button>
          <button type="button" disabled={!writable || !selectedItem} title="Delete the clip and close the gap" onClick={rippleSelected}>Ripple</button>
          <button type="button" disabled={!writable || !selectedItem} onClick={deleteSelected}>Delete</button>
        </div>
        <div className="timeline-zoom" aria-label="Timeline zoom">
          <button aria-label="Zoom out" disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}>−</button>
          <button onClick={fitTimeline}>Fit</button>
          <button aria-label="Zoom in" disabled={zoom >= 6} onClick={() => setZoom((value) => Math.min(6, value + 0.25))}>+</button>
          <output>{Math.round(zoom * 100)}%</output>
        </div>
        <button data-testid="lock-range" className="timeline-action" disabled={!writable || !selectedRange} title={selectedRange ? `Protect the selected range (${protectShortcut.toUpperCase()})` : "Select a transcript segment or timeline clip first"} onClick={() => { if (selectedRange) dispatch({ type: "SetLock", actor: { type: "human", surface: "ui" }, payload: { action: "lock", branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, range: selectedRange, label: "Protected range" } }); }}><LockIcon /> Protect <kbd>{protectShortcut.toUpperCase()}</kbd></button>
        <code className="timeline-time">{formatTimecode(playheadMs)}</code>
      </div>
      <div ref={scrollRef} className="timeline-scroll">
        <div className="timeline-canvas" style={{ width: timelineWidth + LABEL_WIDTH }} onPointerDown={(event) => seek(event.clientX, event.currentTarget)}>
          <div className="ruler-label">TC</div>
          <div className="timeline-ruler" style={{ marginLeft: LABEL_WIDTH, width: timelineWidth }}>
            {Array.from({ length: Math.max(9, Math.round(9 * zoom)) }).map((_, i, marks) => <span key={i} style={{ left: `${(i / (marks.length - 1)) * 100}%` }}><i />{formatTimecode((branch.durationMs / (marks.length - 1)) * i)}</span>)}
          </div>
          <div className="track-stack">
            {branch.tracks.map((track) => (
              <div key={track.trackId} className="timeline-track" style={{ gridTemplateColumns: `${LABEL_WIDTH}px ${timelineWidth}px` }}>
                <div className="track-label">
                  <strong>{track.trackId.toUpperCase()}</strong><span>{TRACK_NAMES[track.trackId] ?? track.kind}</span>
                  {track.kind === "audio" ? <button disabled={!writable} aria-label={`${track.muted ? "Unmute" : "Mute"} ${TRACK_NAMES[track.trackId]}`} title={track.muted ? "Unmute track" : "Mute track"} onPointerDown={(event) => event.stopPropagation()} onClick={() => dispatch({ type: "MuteTrack", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, trackId: track.trackId, muted: !track.muted } })}><SoundIcon muted={track.muted} /></button> : null}
                </div>
                <div className="track-lane" style={{ width: timelineWidth }}>
                  {track.items.map((item) => {
                    const dragged = drag?.item.itemId === item.itemId ? drag : null;
                    const shownStart = dragged?.previewStartMs ?? item.startMs;
                    const shownEnd = dragged?.previewEndMs ?? item.endMs;
                    const waveform = editor.assets.find((asset) => asset.assetId === item.assetId)?.waveformPeaks;
                    return <div key={item.itemId} role="button" tabIndex={0} aria-label={`${item.label}, ${formatTimecode(item.startMs)} to ${formatTimecode(item.endMs)}`} title={`${item.label} ${formatTimecode(item.startMs)}–${formatTimecode(item.endMs)} · drag to move · Shift-click to multi-select`} className={`timeline-clip ${TRACK_COLORS[track.trackId] ?? "track-video"} ${selectedItemIds.includes(item.itemId) ? "is-selected" : ""} ${dragged ? "is-dragging" : ""}`} aria-pressed={selectedItemIds.includes(item.itemId)} style={{ left: px(shownStart), width: Math.max(4, px(shownEnd) - px(shownStart)) }} onPointerDown={(event) => beginDrag(event, item, "move")} onClick={(event) => { if (event.shiftKey) return; setSelectedRange({ startMs: item.startMs, endMs: item.endMs }); setSelectedItemIds([item.itemId]); setPlayhead(item.startMs); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedRange({ startMs: item.startMs, endMs: item.endMs }); setSelectedItemIds([item.itemId]); setPlayhead(item.startMs); } }}><button className="trim-handle is-start" aria-label={`Trim start of ${item.label}`} onPointerDown={(event) => beginDrag(event, item, "trim-start")} />{waveform?.length ? <span className="clip-waveform" aria-hidden="true">{waveform.map((peak, index) => <i key={index} style={{ height: `${Math.max(12, peak * 100)}%` }} />)}</span> : null}<span className="clip-label">{item.label}</span>{item.transitionIn && item.transitionIn !== "cut" ? <i className="transition-edge is-in" title={`${item.transitionIn} in`} /> : null}{item.transitionOut && item.transitionOut !== "cut" ? <i className="transition-edge is-out" title={`${item.transitionOut} out`} /> : null}<button className="trim-handle is-end" aria-label={`Trim end of ${item.label}`} onPointerDown={(event) => beginDrag(event, item, "trim-end")} /></div>;
                  })}
                  {track.trackId === "cc" ? branch.captions.map((cue) => <button key={cue.cueId} className="caption-cue" aria-label={`Caption: ${cue.text}, ${formatTimecode(cue.startMs)} to ${formatTimecode(cue.endMs)}`} title={cue.text} style={{ left: px(cue.startMs), width: Math.max(3, px(cue.endMs) - px(cue.startMs)) }} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedRange({ startMs: cue.startMs, endMs: cue.endMs }); setSelectedItemId(null); setPlayhead(cue.startMs); }} />) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="timeline-overlay" style={{ left: LABEL_WIDTH, width: timelineWidth }}>
            {branch.locks.map((lock) => <div key={lock.lockId} className="lock-band lock-hatch" style={{ left: px(lock.startMs), width: Math.max(4, px(lock.endMs) - px(lock.startMs)) }} title={`Protected: ${lock.label}`}><span><LockIcon /> {lock.label}</span></div>)}
            {branch.comments.map((comment) => <button key={comment.commentId} className="comment-marker" style={{ left: px(comment.range.startMs) }} title={comment.text} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setPlayhead(comment.range.startMs); setSelectedRange(comment.range); }}><span /></button>)}
            <div className="playhead" style={{ left: px(playheadMs) }}><span /></div>
          </div>
        </div>
      </div>
      <div className="timeline-help">Space play · ← → frame step · {splitShortcut.toUpperCase()} split · Shift-click multi-select · magnetic edge snap · drag edges to trim</div>
      <ol className="sr-only">{branch.tracks.flatMap((track) => track.items.map((item) => <li key={item.itemId}>{track.trackId} {item.label} {formatTimecode(item.startMs)} to {formatTimecode(item.endMs)} {branch.locks.some((lock) => lock.startMs < item.endMs && item.startMs < lock.endMs) ? "locked" : ""}</li>))}</ol>
    </section>
  );
}
