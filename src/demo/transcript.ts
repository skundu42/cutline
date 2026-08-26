import type { TranscriptMarker, TranscriptSegment, TranscriptWord } from "../core/types";

function words(text: string, startMs: number, endMs: number): TranscriptWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const span = endMs - startMs;
  const each = Math.max(80, Math.floor(span / parts.length));
  return parts.map((token, i) => {
    const s = startMs + i * each;
    const e = i === parts.length - 1 ? endMs : Math.min(endMs, s + each);
    return { startMs: s, endMs: e, text: token };
  });
}

function segment(
  id: string,
  startMs: number,
  endMs: number,
  text: string,
  markers?: TranscriptMarker[],
): TranscriptSegment {
  return {
    segmentId: id,
    startMs,
    endMs,
    speaker: "host",
    text,
    confidence: markers?.includes("silence") ? 0.4 : 0.94,
    markers,
    words: markers?.includes("silence") ? [] : words(text, startMs, endMs),
  };
}

export const SILENCE_REGIONS = [
  { startMs: 5200, endMs: 8200 },
  { startMs: 12000, endMs: 16000 },
  { startMs: 21000, endMs: 25000 },
  { startMs: 46000, endMs: 51000 },
  { startMs: 55000, endMs: 60000 },
  { startMs: 63000, endMs: 68000 },
  { startMs: 70000, endMs: 74000 },
] as const;

export const FALSE_START = { startMs: 0, endMs: 2400 } as const;
export const WEAK_TAKE = { startMs: 27000, endMs: 44000 } as const;

export const DEMO_TRANSCRIPT: TranscriptSegment[] = [
  segment("seg_false", 0, 2400, "So um wait let me start over.", ["false_start"]),
  segment("seg_01", 2400, 5200, "When a transformer generates tokens it recomputes attention."),
  segment("seg_s1", 5200, 8200, "", ["silence"]),
  segment("seg_02", 8200, 12000, "That gets expensive as the sequence grows."),
  segment("seg_s2", 12000, 16000, "", ["silence"]),
  segment("seg_03", 16000, 21000, "A KV cache stores the keys and values from earlier tokens."),
  segment("seg_s3", 21000, 25000, "", ["silence"]),
  segment("seg_04", 25000, 27000, "So we do not recompute them."),
  segment(
    "seg_weak",
    27000,
    44000,
    "I mean basically what happens is you keep the previous keys and values around so later tokens can reuse them instead of doing all that work again which is kind of the whole point of the cache if that makes sense.",
    ["alternate_take"],
  ),
  segment("seg_05", 44000, 46000, "On GPUs this cache lives in memory."),
  segment("seg_s4", 46000, 51000, "", ["silence"]),
  segment("seg_06", 51000, 55000, "Reusing keys and values keeps inference fast."),
  segment("seg_s5", 55000, 60000, "", ["silence"]),
  segment("seg_07", 60000, 63000, "Think of a table that grows by one row per token."),
  segment("seg_s6", 63000, 68000, "", ["silence"]),
  segment("seg_08", 68000, 70000, "That is the KV cache."),
  segment("seg_s7", 70000, 74000, "", ["silence"]),
];
