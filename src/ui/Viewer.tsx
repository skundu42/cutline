"use client";

import { formatTimecode, getActiveClipTransition, getTransitionFrame } from "@/core";
import type { ClipInstance } from "@/core/types";
import { activeBranch, useEditorStore } from "@/store/editorStore";
import { useEffect, useRef, type CSSProperties } from "react";
import { SourceViewer } from "./SourceViewer";

function clipAt<T extends { startMs: number; endMs: number }>(items: T[], time: number) {
  return items.find((item) => time >= item.startMs && time < item.endMs) ?? null;
}

function envelope(clip: ClipInstance, time: number): number {
  const fade = clip.fadeMs ?? 0;
  let env = 1;
  const inFade = clip.transitionIn === "fade_in" || clip.transitionIn === "crossfade" || clip.transitionIn === "dissolve";
  const outFade = clip.transitionOut === "fade_out" || clip.transitionOut === "crossfade" || clip.transitionOut === "dissolve";
  if (inFade && fade > 0 && time - clip.startMs < fade) env *= (time - clip.startMs) / fade;
  if (outFade && fade > 0 && clip.endMs - time < fade) env *= (clip.endMs - time) / fade;
  return Math.max(0, Math.min(1, env));
}

function clipVolume(clip: ClipInstance | null, time: number, muted: boolean): number {
  if (!clip || muted) return 0;
  return (clip.gain ?? 1) * envelope(clip, time);
}

function transitionLayerStyle(frame: { opacity: number; translateXPercent: number; scale: number }, objectPosition?: string): CSSProperties {
  return {
    objectPosition,
    opacity: frame.opacity,
    transform: `translateX(${frame.translateXPercent}%) scale(${frame.scale})`,
    transformOrigin: "center",
    willChange: "transform, opacity",
  };
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
  ) : (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m8 5 11 7-11 7V5Z"/></svg>
  );
}

export function Viewer() {
  const mode = useEditorStore((state) => state.monitorMode);
  const sourceId = useEditorStore((state) => state.sourceAssetId);
  const editor = useEditorStore((state) => state.editor);
  const setMode = useEditorStore((state) => state.setMonitorMode);
  const asset = editor.assets.find((item) => item.assetId === sourceId);
  return <div className="monitor-shell">
    <div className="monitor-tabs" role="tablist" aria-label="Monitor" onKeyDown={(event) => {
      if (!asset || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "source" : event.key === "End" ? "timeline" : mode === "source" ? "timeline" : "source";
      setMode(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-monitor='${next}']`)?.focus();
    }}>
      <button type="button" role="tab" id="source-tab" data-monitor="source" aria-controls="source-panel" aria-selected={mode === "source"} tabIndex={mode === "source" ? 0 : -1} disabled={!asset} onClick={() => setMode("source")}>Source</button>
      <button type="button" role="tab" id="timeline-tab" data-monitor="timeline" aria-controls="timeline-panel" aria-selected={mode === "timeline"} tabIndex={mode === "timeline" ? 0 : -1} onClick={() => setMode("timeline")}>Timeline</button>
    </div>
    <div id="source-panel" role="tabpanel" aria-labelledby="source-tab" className="monitor-panel" hidden={mode !== "source"}>
      {asset ? <SourceViewer key={`${editor.project.projectId}:${asset.assetId}`} asset={asset} active={mode === "source"} /> : null}
    </div>
    <div id="timeline-panel" role="tabpanel" aria-labelledby="timeline-tab" className="monitor-panel" hidden={mode !== "timeline"}>
      {mode === "timeline" ? <TimelineViewer /> : null}
    </div>
  </div>;
}

function TimelineViewer() {
  const editor = useEditorStore((s) => s.editor);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const playing = useEditorStore((s) => s.playing);
  const playbackEndMs = useEditorStore((s) => s.playbackEndMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlaybackEndMs = useEditorStore((s) => s.setPlaybackEndMs);
  const importFiles = useEditorStore((s) => s.importFiles);
  const loadSampleProject = useEditorStore((s) => s.loadSampleProject);
  const dispatch = useEditorStore((s) => s.dispatch);
  const compare = useEditorStore((s) => s.compare);
  const comparedBranchId = compare.show === "right" ? compare.rightId : compare.leftId;
  const branch = compare.enabled && comparedBranchId ? editor.branches[comparedBranchId] ?? activeBranch(editor) : activeBranch(editor);
  const v1 = useRef<HTMLVideoElement>(null);
  const v1Incoming = useRef<HTMLVideoElement>(null);
  const v2 = useRef<HTMLVideoElement>(null);
  const v2Incoming = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const audio2 = useRef<HTMLAudioElement>(null);

  const v1Track = branch.tracks.find((t) => t.trackId === "v1")!;
  const v2Track = branch.tracks.find((t) => t.trackId === "v2")!;
  const a1Track = branch.tracks.find((t) => t.trackId === "a1")!;
  const a2Track = branch.tracks.find((t) => t.trackId === "a2");
  const v1Clip = clipAt(v1Track.items, playheadMs);
  const v2Clip = clipAt(v2Track.items, playheadMs);
  const v1Transition = getActiveClipTransition(v1Track, playheadMs);
  const v2Transition = getActiveClipTransition(v2Track, playheadMs);
  const a1Clip = clipAt(a1Track.items, playheadMs);
  const a2Clip = a2Track ? clipAt(a2Track.items, playheadMs) : null;
  const cue = branch.captions.find((item) => playheadMs >= item.startMs && playheadMs < item.endMs);
  const asset = (id: string) => editor.assets.find((item) => item.assetId === id);
  const previewUri = (media: ReturnType<typeof asset>) => media?.proxyStatus === "ready" && media.proxyUri ? media.proxyUri : media?.uri;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (!useEditorStore.getState().playing) return;
      const next = useEditorStore.getState().playheadMs + (now - last);
      last = now;
      const endMs = playbackEndMs ?? branch.durationMs;
      if (next >= endMs) {
        setPlayhead(endMs);
        setPlaying(false);
        setPlaybackEndMs(null);
        return;
      }
      setPlayhead(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, playbackEndMs, branch.durationMs, setPlaybackEndMs, setPlayhead, setPlaying]);

  useEffect(() => {
    const sync = (el: HTMLVideoElement | HTMLAudioElement | null, clip: ClipInstance | null, volume: number, freezeAtStart = false) => {
      if (!el || !clip) { el?.pause(); return; }
      el.volume = Math.max(0, Math.min(1, volume));
      const mediaTime = (clip.sourceInMs + (freezeAtStart ? 0 : playheadMs - clip.startMs)) / 1000;
      if (Math.abs(el.currentTime - mediaTime) > 0.12) el.currentTime = Math.max(0, mediaTime);
      if (playing && !freezeAtStart) void el.play().catch(() => undefined); else el.pause();
    };
    sync(v1.current, v1Clip, 0);
    sync(v1Incoming.current, v1Transition?.incoming ?? null, 0, true);
    sync(v2.current, v2Clip, 0);
    sync(v2Incoming.current, v2Transition?.incoming ?? null, 0, true);
    sync(audio.current, a1Clip, clipVolume(a1Clip, playheadMs, a1Track.muted));
    sync(audio2.current, a2Clip, clipVolume(a2Clip, playheadMs, a2Track?.muted ?? false));
  }, [playheadMs, playing, v1Clip, v2Clip, v1Transition?.incoming, v2Transition?.incoming, a1Clip, a2Clip, a1Track.muted, a2Track?.muted]);

  useEffect(() => {
    const elements = [v1.current, v1Incoming.current, v2.current, v2Incoming.current, audio.current, audio2.current];
    return () => { for (const element of elements) element?.pause(); };
  }, []);

  const aspect = branch.crop.aspectRatio === "9:16" ? "aspect-[9/16]" : branch.crop.aspectRatio === "1:1" ? "aspect-square" : "aspect-video";
  const objectPos = `${branch.crop.normalizedCenter.x * 100}% ${branch.crop.normalizedCenter.y * 100}%`;
  const v1Asset = v1Clip ? asset(v1Clip.assetId) : null;
  const v1IsStill = v1Asset?.kind === "graphic" || v1Asset?.kind === "image";
  const v2Asset = v2Clip ? asset(v2Clip.assetId) : null;
  const isGraphic = v2Asset?.kind === "graphic" || v2Asset?.kind === "image";
  const v1TransitionFrame = v1Transition ? getTransitionFrame(v1Transition.transition, v1Transition.progress) : null;
  const v2TransitionFrame = v2Transition ? getTransitionFrame(v2Transition.transition, v2Transition.progress) : null;
  const v1IncomingAsset = v1Transition ? asset(v1Transition.incoming.assetId) : null;
  const v1IncomingIsStill = v1IncomingAsset?.kind === "graphic" || v1IncomingAsset?.kind === "image";
  const v2IncomingAsset = v2Transition ? asset(v2Transition.incoming.assetId) : null;
  const v2IncomingIsStill = v2IncomingAsset?.kind === "graphic" || v2IncomingAsset?.kind === "image";
  const v1Style = v1TransitionFrame
    ? transitionLayerStyle(v1TransitionFrame.outgoing, objectPos)
    : { objectPosition: objectPos, opacity: v1Clip ? envelope(v1Clip, playheadMs) : 0 };
  const v2Style = v2TransitionFrame
    ? transitionLayerStyle({ ...v2TransitionFrame.outgoing, opacity: v2TransitionFrame.outgoing.opacity * 0.9 })
    : { opacity: v2Clip ? 0.9 * envelope(v2Clip, playheadMs) : 0 };
  const firstVisualAsset = editor.assets.find((item) => item.kind !== "audio");
  const addFirstVisual = () => {
    if (!firstVisualAsset) return;
    dispatch({
      type: "PlaceClip",
      actor: { type: "human", surface: "ui" },
      payload: {
        branchId: branch.branchId,
        expectedBranchVersion: branch.branchVersion,
        assetId: firstVisualAsset.assetId,
        trackId: "v1",
        startMs: branch.durationMs,
        durationMs: firstVisualAsset.durationMs ?? 3000,
        fit: "cover",
      },
    });
  };

  return (
    <section className="viewer-shell" aria-label="Program monitor">
      <div className="viewer-toolbar">
        <div><span className="live-dot" /> Program</div>
        <span>{branch.name}</span>
        <span>{branch.crop.aspectRatio} · {branch.crop.anchor.replace("_", " ")}</span>
      </div>
      <div className="viewer-stage">
        <div className={`program-frame ${aspect}`}>
          {v1Clip && v1Asset && !v1IsStill ? (
            <video ref={v1} src={previewUri(v1Asset)} className="program-media" style={v1Style} muted playsInline />
          ) : null}
          {v1Clip && v1Asset && v1IsStill ? (
            // Local blob URLs bypass the Next image optimizer by design.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v1Asset.uri} alt={v1Asset.label} className={`program-media ${v1Clip.fit === "contain" ? "contain" : ""}`} style={v1Style} />
          ) : null}
          {v1Transition && v1IncomingAsset && !v1IncomingIsStill ? <video ref={v1Incoming} src={previewUri(v1IncomingAsset)} className="program-media transition-incoming" style={transitionLayerStyle(v1TransitionFrame!.incoming, objectPos)} muted playsInline /> : null}
          {v1Transition && v1IncomingAsset && v1IncomingIsStill ? (
            // Local blob URLs bypass the Next image optimizer by design.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v1IncomingAsset.uri} alt={v1IncomingAsset.label} className={`program-media transition-incoming ${v1Transition.incoming.fit === "contain" ? "contain" : ""}`} style={transitionLayerStyle(v1TransitionFrame!.incoming, objectPos)} />
          ) : null}
          {!v1Clip ? (
            <div className={`no-clip ${editor.assets.length ? "" : "is-onboarding"}`}>
              <span>{editor.assets.length ? "No picture at playhead" : "Make your first cut"}</span>
              <small>{editor.assets.length ? "Move to an occupied range or add media to the timeline." : "Import a clip to begin. Your media stays in this browser."}</small>
              {editor.assets.length === 0 ? (
                <div className="viewer-empty-actions">
                  <label className="viewer-import-button">Import media<input data-testid="viewer-upload-media" className="sr-only" type="file" multiple accept="video/mp4,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/webm,image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void importFiles(files); event.target.value = ""; }} /></label>
                  <button type="button" onClick={() => void loadSampleProject()}>Try the sample</button>
                </div>
              ) : firstVisualAsset && branch.durationMs === 0 ? <button className="viewer-next-step" type="button" onClick={addFirstVisual}>Add {firstVisualAsset.label} to timeline</button> : null}
            </div>
          ) : null}
          {v2Clip && v2Asset && !isGraphic ? <video ref={v2} src={previewUri(v2Asset)} className="program-media overlay-media" style={v2Style} muted playsInline /> : null}
          {v2Clip && v2Asset && isGraphic ? (
            // Dynamic editor assets may be blob URLs, which cannot use next/image's optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v2Asset.uri} alt={v2Asset.label} className="program-media overlay-media contain" style={v2Style} />
          ) : null}
          {v2Transition && v2IncomingAsset && !v2IncomingIsStill ? <video ref={v2Incoming} src={previewUri(v2IncomingAsset)} className="program-media overlay-media transition-incoming" style={transitionLayerStyle({ ...v2TransitionFrame!.incoming, opacity: v2TransitionFrame!.incoming.opacity * 0.9 })} muted playsInline /> : null}
          {v2Transition && v2IncomingAsset && v2IncomingIsStill ? (
            // Dynamic editor assets may be blob URLs, which cannot use next/image's optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v2IncomingAsset.uri} alt={v2IncomingAsset.label} className="program-media overlay-media transition-incoming contain" style={transitionLayerStyle({ ...v2TransitionFrame!.incoming, opacity: v2TransitionFrame!.incoming.opacity * 0.9 })} />
          ) : null}
          {cue ? <div className={`preview-caption caption-${branch.captionStyle.preset}`}><p>{cue.text}</p></div> : null}
          <div className="safe-frame" aria-hidden="true"><i /><i /><i /><i /></div>
          <audio ref={audio} src={a1Clip ? asset(a1Clip.assetId)?.uri : undefined} />
          <audio ref={audio2} src={a2Clip ? asset(a2Clip.assetId)?.uri : undefined} />
        </div>
      </div>
      <div className="transport-bar">
        <button className="transport-play" onClick={() => { setPlaybackEndMs(null); setPlaying(!playing); }} aria-label={playing ? "Pause" : "Play"}><PlayIcon playing={playing} /></button>
        <span className="transport-time current">{formatTimecode(playheadMs)}</span>
        <input aria-label="Playhead" type="range" min={0} max={Math.max(branch.durationMs, 1)} step={1000 / editor.project.frameRate} value={Math.min(playheadMs, branch.durationMs)} onChange={(event) => setPlayhead(Number(event.target.value))} />
        <span className="transport-time">{formatTimecode(branch.durationMs)}</span>
        <kbd>Space</kbd>
      </div>
    </section>
  );
}
