import { ALL_FORMATS, BlobSource, Input } from "mediabunny";

export interface MediaInspection {
  durationMs: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
}

async function inspectImage(blob: Blob): Promise<MediaInspection> {
  if (typeof createImageBitmap !== "function") {
    return { durationMs: 5000, hasVideo: false, hasAudio: false };
  }
  const bitmap = await createImageBitmap(blob);
  try {
    return {
      durationMs: 5000,
      width: bitmap.width,
      height: bitmap.height,
      hasVideo: false,
      hasAudio: false,
    };
  } finally {
    bitmap.close();
  }
}

export async function inspectMediaBlob(blob: Blob, mime = blob.type): Promise<MediaInspection> {
  if (mime.startsWith("image/")) return inspectImage(blob);

  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    if (!await input.canRead()) throw new Error("This media container is not supported by the local media engine");
    const [videoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    if (!videoTrack && !audioTrack) throw new Error("No playable audio or video track was found");

    const durationSeconds = await input.computeDuration(
      [videoTrack, audioTrack].filter((track) => track !== null),
      { skipLiveWait: true },
    );
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("The media duration could not be determined");
    }

    const [width, height, videoCodec, audioCodec] = await Promise.all([
      videoTrack?.getDisplayWidth(),
      videoTrack?.getDisplayHeight(),
      videoTrack?.getCodec(),
      audioTrack?.getCodec(),
    ]);

    return {
      durationMs: Math.max(1, Math.round(durationSeconds * 1000)),
      width,
      height,
      hasVideo: Boolean(videoTrack),
      hasAudio: Boolean(audioTrack),
      videoCodec: videoCodec ?? undefined,
      audioCodec: audioCodec ?? undefined,
    };
  } finally {
    input.dispose();
  }
}

