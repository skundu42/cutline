import type { TranscriptSegment, TranscriptWord } from "./types";
import { parseText, type CaptionsFileFormat } from "media-captions";

function wordsFor(text: string, startMs: number, endMs: number): TranscriptWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const duration = Math.max(tokens.length, endMs - startMs);
  return tokens.map((token, index) => ({
    startMs: Math.round(startMs + (duration * index) / tokens.length),
    endMs: Math.round(startMs + (duration * (index + 1)) / tokens.length),
    text: token,
  }));
}

function cleanCueText(text: string) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function parseTranscriptText(input: string, format?: CaptionsFileFormat): Promise<TranscriptSegment[]> {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("The transcript file is empty.");
  const detectedFormat = format ?? (normalized.startsWith("WEBVTT") ? "vtt" : "srt");
  const parsed = await parseText(normalized, { type: detectedFormat, errors: true });
  const segments = parsed.cues.flatMap((cue, index): TranscriptSegment[] => {
    const startMs = Math.round(cue.startTime * 1000);
    const endMs = Math.round(cue.endTime * 1000);
    const text = cleanCueText(cue.text);
    if (!text || endMs <= startMs) return [];
    return [{
      segmentId: `transcript_${String(index + 1).padStart(4, "0")}`,
      startMs,
      endMs,
      speaker: "Speaker",
      text,
      confidence: 1,
      words: wordsFor(text, startMs, endMs),
    }];
  });

  if (!segments.length) {
    throw new Error("No timed captions were found. Choose an SRT or WebVTT file with cue timestamps.");
  }
  return segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}
