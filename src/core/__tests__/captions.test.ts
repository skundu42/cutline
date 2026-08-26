import { describe, expect, it } from "vitest";
import { segmentCaptions } from "../captions";
import { formatTimecode, rangesOverlap } from "../time";

describe("captions", () => {
  it("never exceeds two lines or 42 characters per line", () => {
    const words = Array.from({ length: 40 }, (_, i) => ({
      startMs: i * 200,
      endMs: i * 200 + 180,
      text: i % 3 === 0 ? "inference" : "cache",
    }));
    const { cues } = segmentCaptions({
      words,
      preset: "bold_center",
      maxLines: 2,
      maxCharsPerLine: 42,
      id: () => `cue_${Math.random().toString(16).slice(2)}`,
    });
    for (const cue of cues) {
      const lines = cue.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(42);
      }
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
    }
  });
});

describe("time helpers", () => {
  it("formats millisecond ranges as timecode", () => {
    expect(formatTimecode(18120)).toBe("00:18.120");
  });

  it("treats ranges as half-open overlaps", () => {
    expect(rangesOverlap({ startMs: 0, endMs: 10 }, { startMs: 10, endMs: 20 })).toBe(false);
    expect(rangesOverlap({ startMs: 0, endMs: 11 }, { startMs: 10, endMs: 20 })).toBe(true);
  });
});
