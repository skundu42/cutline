"use client";

import { formatTimecode } from "@/core";
import type { ClipInstance } from "@/core/types";
import { activeBranch, useEditorStore } from "@/store/editorStore";
import { useEffect, useRef } from "react";

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

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
  ) : (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m8 5 11 7-11 7V5Z"/></svg>
  );
}

export function Viewer() {
  const editor = useEditorStore((s) => s.editor);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const playing = useEditorStore((s) => s.playing);
  const playbackEndMs = useEditorStore((s) => s.playbackEndMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlaybackEndMs = useEditorStore((s) => s.setPlaybackEndMs);
  const compare = useEditorStore((s) => s.compare);
  const comparedBranchId = compare.show === "right" ? compare.rightId : compare.leftId;
  const branch = compare.enabled && comparedBranchId ? editor.branches[comparedBranchId] ?? activeBranch(editor) : activeBranch(editor);
  const v1 = useRef<HTMLVideoElement>(null);
  const v2 = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const audio2 = useRef<HTMLAudioElement>(null);

  const v1Track = branch.tracks.find((t) => t.trackId === "v1")!;
  const v2Track = branch.tracks.find((t) => t.trackId === "v2")!;
  const a1Track = branch.tracks.find((t) => t.trackId === "a1")!;
  const a2Track = branch.tracks.find((t) => t.trackId === "a2");
  const v1Clip = clipAt(v1Track.items, playheadMs);
  const v2Clip = clipAt(v2Track.items, playheadMs);
  const a1Clip = clipAt(a1Track.items, playheadMs);
  const a2Clip = a2Track ? clipAt(a2Track.items, playheadMs) : null;
  const cue = branch.captions.find((item) => playheadMs >= item.startMs && playheadMs < item.endMs);
  const asset = (id: string) => editor.assets.find((item) => item.assetId === id);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
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
    const sync = (el: HTMLVideoElement | HTMLAudioElement | null, clip: ClipInstance | null, volume: number) => {
      if (!el || !clip) { el?.pause(); return; }
      el.volume = Math.max(0, Math.min(1, volume));
      const mediaTime = (playheadMs - clip.startMs + clip.sourceInMs) / 1000;
      if (Math.abs(el.currentTime - mediaTime) > 0.12) el.currentTime = Math.max(0, mediaTime);
      if (playing) void el.play().catch(() => undefined); else el.pause();
    };
    sync(v1.current, v1Clip, 0);
    sync(v2.current, v2Clip, 0);
    sync(audio.current, a1Clip, clipVolume(a1Clip, playheadMs, a1Track.muted));
    sync(audio2.current, a2Clip, clipVolume(a2Clip, playheadMs, a2Track?.muted ?? false));
  }, [playheadMs, playing, v1Clip, v2Clip, a1Clip, a2Clip, a1Track.muted, a2Track?.muted]);

  const aspect = branch.crop.aspectRatio === "9:16" ? "aspect-[9/16]" : branch.crop.aspectRatio === "1:1" ? "aspect-square" : "aspect-video";
  const objectPos = `${branch.crop.normalizedCenter.x * 100}% ${branch.crop.normalizedCenter.y * 100}%`;
  const v2Asset = v2Clip ? asset(v2Clip.assetId) : null;
  const isGraphic = v2Asset?.kind === "graphic" || v2Asset?.kind === "image";
  const overlayOpacity = v2Clip ? 0.9 * envelope(v2Clip, playheadMs) : 0;

  return (
    <section className="viewer-shell" aria-label="Program monitor">
      <div className="viewer-toolbar">
        <div><span className="live-dot" /> Program</div>
        <span>{branch.name}</span>
        <span>{branch.crop.aspectRatio} · {branch.crop.anchor.replace("_", " ")}</span>
      </div>
      <div className="viewer-stage">
        <div className={`program-frame ${aspect}`}>
          {v1Clip ? (
            <video ref={v1} src={asset(v1Clip.assetId)?.uri} className="program-media" style={{ objectPosition: objectPos, opacity: envelope(v1Clip, playheadMs) }} muted playsInline />
          ) : <div className="no-clip"><span>No media at playhead</span><small>Add a clip or move to an occupied range.</small></div>}
          {v2Clip && v2Asset && !isGraphic ? <video ref={v2} src={v2Asset.uri} className="program-media overlay-media" style={{ opacity: overlayOpacity }} muted playsInline /> : null}
          {v2Clip && v2Asset && isGraphic ? (
            // Dynamic editor assets may be blob URLs, which cannot use next/image's optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v2Asset.uri} alt={v2Asset.label} className="program-media overlay-media contain" style={{ opacity: overlayOpacity }} />
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
