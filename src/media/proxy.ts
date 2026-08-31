import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  Quality,
  WebMOutputFormat,
} from "mediabunny";

export async function createPreviewProxy(blob: Blob, signal?: AbortSignal, onProgress?: (progress: number) => void) {
  if (typeof VideoEncoder === "undefined") throw new Error("Video proxy encoding is unavailable in this browser.");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const conversion = await Conversion.init({
    input,
    output,
    tracks: "primary",
    video: {
      width: 854,
      height: 480,
      fit: "contain",
      frameRate: 30,
      codec: "vp9",
      quality: new Quality({ bitrate: 1_500_000 }),
      keyFrameInterval: 1,
      forceTranscode: true,
    },
    audio: {
      codec: "opus",
      quality: new Quality({ bitrate: 96_000 }),
      forceTranscode: true,
    },
    showWarnings: false,
  });
  if (!conversion.isValid) {
    input.dispose();
    throw new Error("This browser cannot decode and encode the selected proxy media.");
  }
  conversion.onProgress = (progress) => onProgress?.(progress);
  const abort = () => { void conversion.cancel(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("Proxy generation cancelled", "AbortError");
    await conversion.execute();
    if (!target.buffer) throw new Error("The preview proxy could not be finalized.");
    return new Blob([target.buffer], { type: "video/webm" });
  } finally {
    signal?.removeEventListener("abort", abort);
    input.dispose();
  }
}
