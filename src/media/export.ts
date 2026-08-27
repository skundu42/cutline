import type { Asset, Branch, CaptionCue, ClipInstance, EditorState } from "@/core/types";

export interface LocalRenderResult {
  blob: Blob;
  mimeType: string;
  extension: "webm";
  width: number;
  height: number;
}

export type RenderPreset = "720p" | "480p";

interface RenderOptions {
  editor: EditorState;
  branch: Branch;
  preset?: RenderPreset;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

type VisualSource = HTMLVideoElement | HTMLImageElement;

interface PreparedVisual {
  clip: ClipInstance;
  source: VisualSource;
  video: boolean;
}

interface PreparedAudio {
  clip: ClipInstance;
  element: HTMLAudioElement;
  gain: GainNode;
  muted: boolean;
}

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function getRenderSize(aspectRatio: Branch["crop"]["aspectRatio"], preset: RenderPreset = "720p") {
  const shortEdge = preset === "480p" ? 480 : 720;
  const longEdge = Math.round((shortEdge * 16 / 9) / 2) * 2;
  if (aspectRatio === "9:16") return { width: shortEdge, height: longEdge };
  if (aspectRatio === "1:1") return { width: shortEdge, height: shortEdge };
  return { width: longEdge, height: shortEdge };
}

export function selectRenderMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

function abortError() {
  return new DOMException("Local render cancelled", "AbortError");
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function assetFor(editor: EditorState, assetId: string) {
  const asset = editor.assets.find((candidate) => candidate.assetId === assetId);
  if (!asset) throw new Error(`Missing media for clip ${assetId}`);
  if (asset.uri.startsWith("idb:") || asset.uri.startsWith("local:")) throw new Error(`${asset.label} is not available in local storage`);
  return asset;
}

function waitForMedia(element: HTMLMediaElement, signal?: AbortSignal): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("Timed out preparing local media")), 15_000);
    const onReady = () => finish();
    const onError = () => finish(new Error("A clip could not be decoded by this browser"));
    const onAbort = () => finish(abortError());
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      element.removeEventListener("loadeddata", onReady);
      element.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    element.addEventListener("loadeddata", onReady, { once: true });
    element.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function seekMedia(element: HTMLMediaElement, time: number, signal?: AbortSignal): Promise<void> {
  if (Math.abs(element.currentTime - time) < 0.01) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("Timed out seeking local media")), 10_000);
    const onSeeked = () => finish();
    const onError = () => finish(new Error("A clip could not be decoded at its edit point"));
    const onAbort = () => finish(abortError());
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      element.removeEventListener("seeked", onSeeked);
      element.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    element.addEventListener("seeked", onSeeked, { once: true });
    element.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    element.currentTime = time;
  });
}

function waitForImage(image: HTMLImageElement, signal?: AbortSignal): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("Timed out preparing a local image")), 15_000);
    const onReady = () => finish();
    const onError = () => finish(new Error("An image could not be decoded by this browser"));
    const onAbort = () => finish(abortError());
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      image.removeEventListener("load", onReady);
      image.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    image.addEventListener("load", onReady, { once: true });
    image.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function transitionEnvelope(clip: ClipInstance, timeMs: number) {
  const fadeMs = clip.fadeMs ?? 0;
  if (fadeMs <= 0) return 1;
  let opacity = 1;
  if (["fade_in", "crossfade", "dissolve"].includes(clip.transitionIn ?? "")) {
    opacity *= Math.min(1, Math.max(0, (timeMs - clip.startMs) / fadeMs));
  }
  if (["fade_out", "crossfade", "dissolve"].includes(clip.transitionOut ?? "")) {
    opacity *= Math.min(1, Math.max(0, (clip.endMs - timeMs) / fadeMs));
  }
  return opacity;
}

function isActive(clip: ClipInstance, timeMs: number) {
  return timeMs >= clip.startMs && timeMs < clip.endMs;
}

function sourceSize(source: VisualSource) {
  return source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.naturalWidth, height: source.naturalHeight };
}

function drawMedia(
  context: CanvasRenderingContext2D,
  source: VisualSource,
  output: { width: number; height: number },
  fit: "cover" | "contain",
  center: { x: number; y: number },
  scale = 1,
) {
  const size = sourceSize(source);
  if (!size.width || !size.height) return;
  if (fit === "contain") {
    const ratio = Math.min(output.width / size.width, output.height / size.height) * scale;
    const width = size.width * ratio;
    const height = size.height * ratio;
    context.drawImage(source, (output.width - width) / 2, (output.height - height) / 2, width, height);
    return;
  }

  const baseScale = Math.max(output.width / size.width, output.height / size.height) * scale;
  const sourceWidth = Math.min(size.width, output.width / baseScale);
  const sourceHeight = Math.min(size.height, output.height / baseScale);
  const sourceX = Math.max(0, Math.min(size.width - sourceWidth, center.x * size.width - sourceWidth / 2));
  const sourceY = Math.max(0, Math.min(size.height - sourceHeight, center.y * size.height - sourceHeight / 2));
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
}

function wrapCaption(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function drawCaption(
  context: CanvasRenderingContext2D,
  cue: CaptionCue,
  branch: Branch,
  output: { width: number; height: number },
) {
  const technical = branch.captionStyle.preset === "technical_card";
  const clean = branch.captionStyle.preset === "clean_lower";
  const fontSize = Math.round(output.width * (technical ? 0.032 : clean ? 0.036 : 0.048));
  context.save();
  context.font = `${technical ? 600 : 750} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lines = wrapCaption(context, cue.text, output.width * 0.76);
  const lineHeight = fontSize * 1.22;
  const blockHeight = lines.length * lineHeight + fontSize * 0.8;
  const centerY = output.height * (technical ? 0.84 : 0.86);
  const maxLineWidth = Math.max(...lines.map((line) => context.measureText(line).width), 0);
  context.fillStyle = clean ? "rgba(250,251,249,.92)" : "rgba(9,16,14,.84)";
  context.fillRect(
    (output.width - maxLineWidth) / 2 - fontSize * 0.45,
    centerY - blockHeight / 2,
    maxLineWidth + fontSize * 0.9,
    blockHeight,
  );
  if (technical) {
    context.fillStyle = "#bff56c";
    context.fillRect((output.width - maxLineWidth) / 2 - fontSize * 0.45, centerY - blockHeight / 2, 6, blockHeight);
  }
  context.fillStyle = clean ? "#171b19" : "#ffffff";
  lines.forEach((line, index) => {
    context.fillText(line, output.width / 2, centerY + (index - (lines.length - 1) / 2) * lineHeight);
  });
  context.restore();
}

async function prepareVisual(asset: Asset, clip: ClipInstance, container: HTMLElement, signal?: AbortSignal): Promise<PreparedVisual> {
  if (asset.kind === "video") {
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.src = asset.uri;
    container.appendChild(video);
    await waitForMedia(video, signal);
    await seekMedia(video, Math.min(clip.sourceInMs / 1000, Math.max(0, video.duration - 0.01)), signal);
    return { clip, source: video, video: true };
  }
  const image = new Image();
  image.decoding = "async";
  image.src = asset.uri;
  await waitForImage(image, signal);
  return { clip, source: image, video: false };
}

async function prepareAudio(
  asset: Asset,
  clip: ClipInstance,
  context: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  muted: boolean,
  container: HTMLElement,
  signal?: AbortSignal,
): Promise<PreparedAudio> {
  const element = document.createElement("audio");
  element.preload = "auto";
  element.src = asset.uri;
  container.appendChild(element);
  await waitForMedia(element, signal);
  await seekMedia(element, Math.min(clip.sourceInMs / 1000, Math.max(0, element.duration - 0.01)), signal);
  const source = context.createMediaElementSource(element);
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(gain).connect(destination);
  return { clip, element, gain, muted };
}

function syncVideo(entry: PreparedVisual, timeMs: number) {
  if (!entry.video) return;
  const video = entry.source as HTMLVideoElement;
  if (!isActive(entry.clip, timeMs)) {
    video.pause();
    return;
  }
  const expected = (entry.clip.sourceInMs + timeMs - entry.clip.startMs) / 1000;
  if (Math.abs(video.currentTime - expected) > 0.18) video.currentTime = expected;
  if (video.paused) void video.play().catch(() => undefined);
}

function syncAudio(entry: PreparedAudio, timeMs: number) {
  if (!isActive(entry.clip, timeMs)) {
    entry.gain.gain.value = 0;
    entry.element.pause();
    return;
  }
  const expected = (entry.clip.sourceInMs + timeMs - entry.clip.startMs) / 1000;
  if (Math.abs(entry.element.currentTime - expected) > 0.18) entry.element.currentTime = expected;
  entry.gain.gain.value = entry.muted ? 0 : Math.max(0, Math.min(2, (entry.clip.gain ?? 1) * transitionEnvelope(entry.clip, timeMs)));
  if (entry.element.paused) void entry.element.play().catch(() => undefined);
}

export async function renderBranchLocally({ editor, branch, preset = "720p", signal, onProgress }: RenderOptions): Promise<LocalRenderResult> {
  assertNotAborted(signal);
  if (branch.durationMs <= 0) throw new Error("Add at least one clip to the timeline before rendering");
  const mimeType = selectRenderMimeType();
  if (!mimeType) throw new Error("This browser cannot create a local WebM video");

  const output = getRenderSize(branch.crop.aspectRatio, preset);
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas rendering is unavailable");

  const mediaContainer = document.createElement("div");
  mediaContainer.setAttribute("aria-hidden", "true");
  Object.assign(mediaContainer.style, {
    position: "fixed",
    left: "-10px",
    top: "-10px",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(mediaContainer);

  const audioContext = new AudioContext();
  await audioContext.resume();
  const audioDestination = audioContext.createMediaStreamDestination();
  const visuals: PreparedVisual[] = [];
  const audioEntries: PreparedAudio[] = [];
  let renderStream: MediaStream | null = null;

  try {
    const visualTracks = branch.tracks.filter((track) => track.trackId === "v1" || track.trackId === "v2");
    for (const track of visualTracks) {
      for (const clip of track.items) {
        assertNotAborted(signal);
        visuals.push(await prepareVisual(assetFor(editor, clip.assetId), clip, mediaContainer, signal));
      }
    }
    const audioTracks = branch.tracks.filter((track) => track.kind === "audio");
    for (const track of audioTracks) {
      for (const clip of track.items) {
        assertNotAborted(signal);
        audioEntries.push(await prepareAudio(assetFor(editor, clip.assetId), clip, audioContext, audioDestination, track.muted, mediaContainer, signal));
      }
    }

    const canvasStream = canvas.captureStream(editor.project.frameRate);
    renderStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(renderStream, {
      mimeType,
      videoBitsPerSecond: preset === "480p" ? 2_500_000 : 5_000_000,
      audioBitsPerSecond: 192_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("The browser stopped the local render"));
    });

    const drawFrame = (timeMs: number) => {
      context.fillStyle = "#080d0b";
      context.fillRect(0, 0, output.width, output.height);
      for (const entry of visuals) {
        syncVideo(entry, timeMs);
        if (!isActive(entry.clip, timeMs)) continue;
        const isPrimary = entry.clip.trackId === "v1";
        const transform = entry.clip.transform;
        context.save();
        context.globalAlpha = transitionEnvelope(entry.clip, timeMs);
        drawMedia(
          context,
          entry.source,
          output,
          entry.clip.fit ?? "cover",
          isPrimary
            ? branch.crop.normalizedCenter
            : { x: transform?.x ?? 0.5, y: transform?.y ?? 0.5 },
          isPrimary ? branch.crop.scale : transform?.scale ?? 1,
        );
        context.restore();
      }
      for (const entry of audioEntries) syncAudio(entry, timeMs);
      const cue = branch.captions.find((candidate) => timeMs >= candidate.startMs && timeMs < candidate.endMs);
      if (cue) drawCaption(context, cue, branch, output);
    };

    drawFrame(0);
    recorder.start(1000);
    const startedAt = performance.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const tick = (now: number) => {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          const elapsedMs = Math.min(branch.durationMs, now - startedAt);
          drawFrame(elapsedMs);
          onProgress?.(elapsedMs / branch.durationMs);
          if (elapsedMs >= branch.durationMs) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    } catch (error) {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped.catch(() => undefined);
      throw error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    recorder.stop();
    await stopped;
    onProgress?.(1);
    return {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      extension: "webm",
      ...output,
    };
  } finally {
    for (const entry of visuals) {
      if (entry.video) (entry.source as HTMLVideoElement).pause();
    }
    for (const entry of audioEntries) entry.element.pause();
    renderStream?.getTracks().forEach((track) => track.stop());
    mediaContainer.remove();
    await audioContext.close().catch(() => undefined);
  }
}
