import type { CaptionCue, CaptionPreset, TranscriptSegment, TranscriptWord } from "./types";

export function flattenWords(segments: TranscriptSegment[]): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const segment of segments) {
    if (segment.markers?.includes("silence")) continue;
    if (segment.words?.length) {
      words.push(...segment.words);
    } else {
      const parts = segment.text.split(/\s+/).filter(Boolean);
      const span = Math.max(1, segment.endMs - segment.startMs);
      const each = Math.floor(span / Math.max(1, parts.length));
      parts.forEach((text, i) => {
        const startMs = segment.startMs + i * each;
        const endMs = i === parts.length - 1 ? segment.endMs : startMs + each;
        words.push({ startMs, endMs, text });
      });
    }
  }
  return words.sort((a, b) => a.startMs - b.startMs);
}

function wrapLine(words: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word.length <= maxChars ? word : word.slice(0, maxChars);
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function segmentCaptions(options: {
  words: TranscriptWord[];
  range?: { startMs: number; endMs: number };
  preset: CaptionPreset;
  maxLines: 1 | 2;
  maxCharsPerLine: number;
  id: () => string;
}): { cues: CaptionCue[]; overflowWarnings: string[] } {
  const maxChars = Math.min(42, Math.max(18, options.maxCharsPerLine));
  const words = options.words.filter((word) => {
    if (!options.range) return true;
    return word.startMs < options.range.endMs && options.range.startMs < word.endMs;
  });
  const overflowWarnings: string[] = [];
  const cues: CaptionCue[] = [];
  let buffer: TranscriptWord[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const textWords = buffer.map((w) => w.text);
    const lines = wrapLine(textWords, maxChars).slice(0, options.maxLines);
    const used = lines.join(" ").split(/\s+/).length;
    if (used < textWords.length) {
      overflowWarnings.push(`Dropped ${textWords.length - used} words from a cue`);
    }
    const startMs = buffer[0].startMs;
    let endMs = buffer[Math.min(used, buffer.length) - 1]?.endMs ?? buffer[buffer.length - 1].endMs;
    if (endMs - startMs < 500) {
      endMs = startMs + 500;
    }
    cues.push({
      cueId: options.id(),
      startMs,
      endMs,
      text: lines.join("\n"),
      words: buffer.slice(0, used),
      styleId: options.preset,
    });
    buffer = [];
  };

  const maxWords = options.maxLines * Math.max(1, Math.floor(maxChars / 5));
  for (const word of words) {
    const tentative = [...buffer, word];
    const lines = wrapLine(
      tentative.map((w) => w.text),
      maxChars,
    );
    const duration = (tentative.at(-1)?.endMs ?? 0) - (tentative[0]?.startMs ?? 0);
    if (
      buffer.length &&
      (lines.length > options.maxLines ||
        tentative.length > maxWords ||
        duration > 4000 ||
        word.startMs - (buffer.at(-1)?.endMs ?? word.startMs) > 700)
    ) {
      flush();
    }
    buffer.push(word);
  }
  flush();

  return { cues, overflowWarnings };
}
