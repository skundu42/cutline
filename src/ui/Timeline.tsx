"use client";

import { formatTimecode } from "@/core";
import { activeBranch, useEditorStore } from "@/store/editorStore";

const TRACK_COLORS: Record<string, string> = { v1: "track-video", v2: "track-overlay", a1: "track-dialogue", a2: "track-audio", cc: "track-caption" };
const TRACK_NAMES: Record<string, string> = { v1: "Video", v2: "Overlay", a1: "Dialogue", a2: "Music", cc: "Captions" };
const TIMELINE_WIDTH = 1120;
const LABEL_WIDTH = 86;

function LockIcon() {
  return <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
}

function SoundIcon({ muted }: { muted: boolean }) {
  return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>{muted ? <path d="m16 9 5 5m0-5-5 5"/> : <path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/>}</svg>;
}

export function Timeline() {
  const editor = useEditorStore((s) => s.editor);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setSelectedRange = useEditorStore((s) => s.setSelectedRange);
  const setSelectedItemId = useEditorStore((s) => s.setSelectedItemId);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const selectedRange = useEditorStore((s) => s.selectedRange);
  const dispatch = useEditorStore((s) => s.dispatch);
  const branch = activeBranch(editor);
  const px = (ms: number) => (ms / Math.max(branch.durationMs, 1)) * TIMELINE_WIDTH;
  const seek = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const timelineX = Math.max(0, Math.min(TIMELINE_WIDTH, clientX - rect.left - LABEL_WIDTH));
    setPlayhead(Math.round((timelineX / TIMELINE_WIDTH) * branch.durationMs));
    setSelectedRange(null);
    setSelectedItemId(null);
  };

  return (
    <section className="timeline-panel" aria-label="Timeline editor">
      <div className="timeline-header">
        <div className="timeline-title"><strong>Timeline</strong><span>{branch.tracks.length} tracks</span></div>
        <div className="timeline-selection">{selectedRange ? <><span>Selection</span><code>{formatTimecode(selectedRange.startMs)} – {formatTimecode(selectedRange.endMs)}</code></> : <span>No range selected</span>}</div>
        <button
          data-testid="lock-range"
          className="timeline-action"
          disabled={!selectedRange}
          title={selectedRange ? "Protect the selected range (L)" : "Select a transcript segment or timeline clip first"}
          onClick={() => {
            if (!selectedRange) return;
            dispatch({ type: "SetLock", actor: { type: "human", surface: "ui" }, payload: { action: "lock", branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, range: selectedRange, label: "Keep pause" } });
          }}
        ><LockIcon /> Protect range <kbd>L</kbd></button>
        <code className="timeline-time">{formatTimecode(playheadMs)}</code>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-canvas" style={{ width: TIMELINE_WIDTH + LABEL_WIDTH }} onPointerDown={(event) => seek(event.clientX, event.currentTarget)}>
          <div className="ruler-label">TC</div>
          <div className="timeline-ruler" style={{ marginLeft: LABEL_WIDTH, width: TIMELINE_WIDTH }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <span key={i} style={{ left: `${(i / 8) * 100}%` }}><i />{formatTimecode((branch.durationMs / 8) * i)}</span>
            ))}
          </div>
          <div className="track-stack">
            {branch.tracks.map((track) => (
              <div key={track.trackId} className="timeline-track">
                <div className="track-label">
                  <strong>{track.trackId.toUpperCase()}</strong><span>{TRACK_NAMES[track.trackId] ?? track.kind}</span>
                  {track.kind === "audio" ? (
                    <button
                      aria-label={`${track.muted ? "Unmute" : "Mute"} ${TRACK_NAMES[track.trackId]}`}
                      title={track.muted ? "Unmute track" : "Mute track"}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => dispatch({ type: "MuteTrack", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, trackId: track.trackId, muted: !track.muted } })}
                    ><SoundIcon muted={track.muted} /></button>
                  ) : null}
                </div>
                <div className="track-lane" style={{ width: TIMELINE_WIDTH }}>
                  {track.items.map((item) => (
                    <button
                      key={item.itemId}
                      aria-label={`${item.label}, ${formatTimecode(item.startMs)} to ${formatTimecode(item.endMs)}`}
                      title={`${item.label} ${formatTimecode(item.startMs)}–${formatTimecode(item.endMs)}`}
                      className={`timeline-clip ${TRACK_COLORS[track.trackId] ?? "track-video"} ${selectedItemId === item.itemId ? "is-selected" : ""}`}
                      aria-pressed={selectedItemId === item.itemId}
                      style={{ left: px(item.startMs), width: Math.max(3, px(item.endMs) - px(item.startMs)) }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => { setSelectedRange({ startMs: item.startMs, endMs: item.endMs }); setSelectedItemId(item.itemId); setPlayhead(item.startMs); }}
                    ><span>{item.label}</span></button>
                  ))}
                  {track.trackId === "cc" ? branch.captions.map((cue) => (
                    <button
                      key={cue.cueId}
                      className="caption-cue"
                      aria-label={`Caption: ${cue.text}, ${formatTimecode(cue.startMs)} to ${formatTimecode(cue.endMs)}`}
                      title={cue.text}
                      style={{ left: px(cue.startMs), width: Math.max(3, px(cue.endMs) - px(cue.startMs)) }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => { setSelectedRange({ startMs: cue.startMs, endMs: cue.endMs }); setSelectedItemId(null); setPlayhead(cue.startMs); }}
                    />
                  )) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="timeline-overlay" style={{ left: LABEL_WIDTH, width: TIMELINE_WIDTH }}>
            {branch.locks.map((lock) => (
              <div key={lock.lockId} className="lock-band lock-hatch" style={{ left: px(lock.startMs), width: Math.max(4, px(lock.endMs) - px(lock.startMs)) }} title={`Protected: ${lock.label}`}><span><LockIcon /> {lock.label}</span></div>
            ))}
            {branch.comments.map((comment) => (
              <button
                key={comment.commentId}
                className="comment-marker"
                style={{ left: px(comment.range.startMs) }}
                title={comment.text}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => { setPlayhead(comment.range.startMs); setSelectedRange(comment.range); }}
              ><span /></button>
            ))}
            <div className="playhead" style={{ left: px(playheadMs) }}><span /></div>
          </div>
        </div>
      </div>
      <ol className="sr-only">{branch.tracks.flatMap((track) => track.items.map((item) => <li key={item.itemId}>{track.trackId} {item.label} {formatTimecode(item.startMs)} to {formatTimecode(item.endMs)} {branch.locks.some((lock) => lock.startMs < item.endMs && item.startMs < lock.endMs) ? "locked" : ""}</li>))}</ol>
    </section>
  );
}
