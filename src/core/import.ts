import type { CommandError } from "./types";

export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;

export const ALLOWED_IMPORT_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/aac",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export function kindFromMime(mime: string): "video" | "audio" | "image" | "graphic" {
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "image/svg+xml") return "graphic";
  if (mime.startsWith("image/")) return "image";
  return "video";
}

export function validateImportUri(uri: string): CommandError | null {
  if (
    uri.startsWith("https://") ||
    uri.startsWith("/demo/") ||
    uri.startsWith("blob:") ||
    uri.startsWith("idb:")
  ) {
    return null;
  }
  return { code: "VALIDATION_ERROR", message: "Import URI must be https, a demo path, or a local blob" };
}

export function validateImport(payload: {
  kind?: "video" | "audio" | "image" | "graphic";
  label: string;
  uri: string;
  mime: string;
  bytes?: number;
  durationMs: number;
}): CommandError | null {
  if (!payload.label.trim()) {
    return { code: "VALIDATION_ERROR", message: "Imported media needs a label" };
  }
  if (!ALLOWED_IMPORT_MIMES.has(payload.mime)) {
    return { code: "VALIDATION_ERROR", message: `Unsupported media type ${payload.mime}` };
  }
  if (payload.kind && payload.kind !== kindFromMime(payload.mime)) {
    return { code: "VALIDATION_ERROR", message: `Media kind ${payload.kind} does not match ${payload.mime}` };
  }
  if (payload.bytes != null && payload.bytes > MAX_IMPORT_BYTES) {
    return { code: "VALIDATION_ERROR", message: "Imports are limited to 500 MB" };
  }
  if (payload.durationMs <= 0) {
    return { code: "VALIDATION_ERROR", message: "Imported media needs a positive duration" };
  }
  return validateImportUri(payload.uri);
}

export function ensureStandardTracks<T extends { tracks: { trackId: string; order: number }[] }>(branch: T): T {
  if (branch.tracks.some((track) => track.trackId === "a2")) return branch;
  const ccIndex = branch.tracks.findIndex((track) => track.trackId === "cc");
  const a2 = {
    trackId: "a2",
    kind: "audio" as const,
    order: 3,
    locked: false,
    muted: false,
    hidden: false,
    items: [],
  };
  if (ccIndex >= 0) {
    branch.tracks[ccIndex].order = 4;
    branch.tracks.splice(ccIndex, 0, a2);
  } else {
    branch.tracks.push(a2);
  }
  return branch;
}
