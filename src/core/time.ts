import type { TimeRange } from "./types";

export function isValidRange(range: TimeRange): boolean {
  return (
    Number.isInteger(range.startMs) &&
    Number.isInteger(range.endMs) &&
    range.startMs >= 0 &&
    range.endMs > range.startMs
  );
}

export function rangeDuration(range: TimeRange): number {
  return range.endMs - range.startMs;
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

export function rangesIntersect(a: TimeRange, b: TimeRange): boolean {
  return rangesOverlap(a, b);
}

export function clampRange(range: TimeRange, durationMs: number): TimeRange {
  const startMs = Math.max(0, Math.min(range.startMs, durationMs));
  const endMs = Math.max(startMs, Math.min(range.endMs, durationMs));
  return { startMs, endMs };
}

export function formatTimecode(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function parseTimecode(value: string): number | null {
  const match = /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const millis = match[3] ? Number(match[3].padEnd(3, "0")) : 0;
  return minutes * 60000 + seconds * 1000 + millis;
}
