"use client";

import { formatTimecode } from "@/core";
import { placementConflicts } from "@/core/linked";
import type { Asset } from "@/core/types";
import { activeBranch, useEditorStore } from "@/store/editorStore";
import { useEffect, useRef, useState } from "react";

export function SourceViewer({ asset, active }: { asset: Asset; active: boolean }) {
  const editor = useEditorStore((state) => state.editor);
  const timelinePlayhead = useEditorStore((state) => state.playheadMs);
  const dispatch = useEditorStore((state) => state.dispatch);
  const relinkAsset = useEditorStore((state) => state.relinkAsset);
  const branch = activeBranch(editor);
  const still = asset.kind === "image" || asset.kind === "graphic";
  const sourceDuration = Math.floor(asset.durationMs ?? 0);
  const [inMs, setInMs] = useState(0);
  const [outMs, setOutMs] = useState(still ? 5000 : sourceDuration);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trackId, setTrackId] = useState<"v1" | "v2" | "a1" | "a2">(asset.kind === "audio" ? "a2" : "v1");
  const [position, setPosition] = useState<"end" | "playhead">(asset.kind === "audio" ? "playhead" : "end");
  const [replaceConsent, setReplaceConsent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedProxy, setFailedProxy] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);
  const durationMs = still ? outMs : outMs - inMs;
  const startMs = Math.round(position === "end" ? branch.durationMs : timelinePlayhead);
  const endMs = startMs + durationMs;
  const audioOnly = trackId === "a1" || trackId === "a2";
  const withAudio = trackId === "v1" && asset.kind === "video" && asset.hasAudio !== false;
  const trackIds = withAudio ? ["v1", "a1"] : [trackId];
  const validRange = Number.isInteger(inMs) && Number.isInteger(outMs) && inMs >= 0 && durationMs > 0 && (still || outMs <= sourceDuration);
  const conflicts = validRange ? placementConflicts(branch, trackIds, { startMs, endMs }) : [];
  const consentKey = `${branch.branchId}:${branch.branchVersion}:${inMs}:${outMs}:${trackId}:${startMs}:${conflicts.map((item) => item.itemId).join(",")}`;
  const replaceExisting = replaceConsent === consentKey;
  const offline = asset.availability === "offline";
  const proxy = !failedProxy && asset.proxyStatus === "ready" ? asset.proxyUri : undefined;
  const uri = proxy ?? asset.uri;

  useEffect(() => {
    if (!active) media.current?.pause();
    const element = media.current;
    return () => { element?.pause(); };
  }, [active, uri]);

  useEffect(() => {
    if (!active || still || offline) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || target.isContentEditable
        || target.closest("input, textarea, select, button, summary, video, audio, [role='dialog'], dialog")
        || document.querySelector("[aria-modal='true'], dialog[open]")) return;
      const element = media.current;
      if (!element) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (element.paused) void element.play().catch(() => setError("Playback could not start. Try the media controls."));
        else element.pause();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        element.pause();
        element.currentTime = Math.max(0, Math.min(sourceDuration, element.currentTime * 1000 + (event.key === "ArrowLeft" ? -1 : 1) * 1000 / editor.project.frameRate)) / 1000;
        setPlayheadMs(Math.round(element.currentTime * 1000));
      }
      if (event.key.toLowerCase() === "i") setInMs(Math.round(element.currentTime * 1000));
      if (event.key.toLowerCase() === "o") setOutMs(Math.round(element.currentTime * 1000));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, editor.project.frameRate, offline, sourceDuration, still]);

  const onMediaError = () => {
    if (proxy) setFailedProxy(true);
    else setError("This source could not be previewed. Relink the file if its local media is missing.");
  };
  const mediaProps = {
    src: uri,
    controls: true,
    preload: "metadata",
    onError: onMediaError,
    onPlay: () => {
      if (!active) { media.current?.pause(); return; }
      if (media.current && validRange && (media.current.currentTime * 1000 < inMs || media.current.currentTime * 1000 >= outMs)) media.current.currentTime = inMs / 1000;
      setPlaying(true);
    },
    onPause: () => setPlaying(false),
    onTimeUpdate: () => {
      const element = media.current;
      if (!element) return;
      if (!element.paused && validRange && element.currentTime * 1000 >= outMs) { element.pause(); element.currentTime = outMs / 1000; }
      setPlayheadMs(Math.round(element.currentTime * 1000));
    },
  };

  return <section className="source-viewer" aria-label="Source monitor" tabIndex={0}>
    <div className="viewer-toolbar"><strong title={asset.label}>{asset.label}</strong><span>{still ? "Still image" : formatTimecode(sourceDuration)}{proxy ? " · 480p preview" : ""}</span></div>
    <div className="source-stage">
      {offline ? <div className="source-unavailable"><strong>Media offline</strong><p>Relink this source before previewing or placing it.</p><label className="secondary-button">Relink file<input className="sr-only" type="file" accept={asset.mime} onChange={(event) => { const file = event.target.files?.[0]; if (file) void relinkAsset(asset.assetId, file); event.target.value = ""; }} /></label></div>
        : still ? (
          // Browser-local images intentionally bypass the server image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.uri} alt={asset.label} onError={onMediaError} />
        ) : asset.kind === "video" ? <video {...mediaProps} ref={(element) => { media.current = element; }} playsInline />
          : <div className="source-audio"><strong>{asset.label}</strong><audio {...mediaProps} ref={(element) => { media.current = element; }} /></div>}
    </div>
    {!still && !offline ? <div className="source-scrub"><code>{formatTimecode(playheadMs)}</code><input type="range" aria-label="Source playhead" min={0} max={sourceDuration} step={1} value={Math.min(playheadMs, sourceDuration)} onChange={(event) => { const value = Number(event.target.value); if (media.current) { media.current.pause(); media.current.currentTime = value / 1000; } setPlayheadMs(value); }} /><span>{playing ? "Playing selection" : "I / O mark range"}</span></div> : null}
    <form className="source-placement" onChange={() => setError(null)} onSubmit={(event) => {
      event.preventDefault();
      if (!validRange || offline || branch.status !== "working" || (conflicts.length > 0 && !replaceExisting)) return;
      const previousIds = new Set(branch.tracks.flatMap((track) => track.items.map((item) => item.itemId)));
      const actor = { type: "human", surface: "ui" } as const;
      const common = { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, assetId: asset.assetId, sourceInMs: still ? 0 : inMs, replaceExisting };
      const result = audioOnly
        ? dispatch({ type: "PlaceAudio", actor, payload: { ...common, trackId: trackId as "a1" | "a2", range: { startMs, endMs }, gain: 1 } })
        : dispatch({ type: "PlaceClip", actor, payload: { ...common, trackId: trackId as "v1" | "v2", startMs, durationMs, fit: trackId === "v2" ? "contain" : "cover" } });
      if (!result.ok) {
        setError(result.error.code === "LOCKED_RANGE"
          ? "This placement affects protected material. Unprotect the range in Review or choose another position."
          : result.error.code === "INVARIANT_VIOLATION"
            ? `Placement could not be applied: ${result.error.message}. Check the destination and source range.`
            : result.error.message);
        return;
      }
      const placed = result.state.branches[branch.branchId].tracks.find((track) => track.trackId === trackId)?.items.find((item) => !previousIds.has(item.itemId));
      const store = useEditorStore.getState();
      store.setPlayhead(startMs);
      store.setSelectedItemId(placed?.itemId ?? null);
      store.setSelectedRange({ startMs, endMs });
      media.current?.pause();
      setReplaceConsent(null);
      setError(null);
    }}>
      <div className="source-fields">
        {!still ? <label>In (ms)<input aria-label="Source in (ms)" type="number" min={0} max={sourceDuration} step={1} value={Number.isFinite(inMs) ? inMs : ""} onChange={(event) => setInMs(event.currentTarget.valueAsNumber)} /><button type="button" className="mini-button" onClick={() => setInMs(playheadMs)}>Mark in</button></label> : null}
        <label>{still ? "Hold (ms)" : "Out (ms)"}<input aria-label={still ? "Still hold (ms)" : "Source out (ms)"} type="number" min={1} max={still ? undefined : sourceDuration} step={1} value={Number.isFinite(outMs) ? outMs : ""} onChange={(event) => setOutMs(event.currentTarget.valueAsNumber)} />{!still ? <button type="button" className="mini-button" onClick={() => setOutMs(playheadMs)}>Mark out</button> : null}</label>
        <label>Destination<select aria-label="Source destination" value={trackId} onChange={(event) => setTrackId(event.target.value as typeof trackId)}>
          {asset.kind !== "audio" ? <><option value="v1">V1 · Picture{asset.kind === "video" && asset.hasAudio !== false ? " + dialogue" : ""}</option><option value="v2">V2 · Overlay</option></> : null}
          {(asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio !== false)) ? <><option value="a1">A1 · Audio only</option><option value="a2">A2 · Audio only</option></> : null}
        </select></label>
        <label>Position<select aria-label="Source position" value={position} onChange={(event) => setPosition(event.target.value as typeof position)}><option value="end">Timeline end</option><option value="playhead">At playhead</option></select></label>
      </div>
      <div className="source-destination-summary" aria-live="polite">{validRange ? <><strong>{formatTimecode(durationMs)} selected</strong><span>{trackIds.map((id) => id.toUpperCase()).join(" + ")} · {formatTimecode(startMs)}–{formatTimecode(endMs)}</span>{withAudio ? <small>Creates linked picture and dialogue.</small> : null}</> : <span role="alert">Choose an ordered range within the source duration.</span>}</div>
      {conflicts.length ? <div className="source-conflicts"><label><input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceConsent(event.target.checked ? consentKey : null)} />Replace entire overlapping clips</label><p>This removes these clips completely, including linked partners:</p><ul>{conflicts.map((item) => <li key={item.itemId}>{item.trackId.toUpperCase()} · {item.label} · {formatTimecode(item.startMs)}–{formatTimecode(item.endMs)}</li>)}</ul></div> : null}
      {branch.status !== "working" ? <p className="inline-error">This version is read-only. Create a working version before placing media.</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={!validRange || offline || branch.status !== "working" || (conflicts.length > 0 && !replaceExisting)}>Place selection</button>
    </form>
  </section>;
}
