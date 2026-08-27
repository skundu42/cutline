import { describe, expect, it } from "vitest";
import { parseTranscriptText } from "../transcriptImport";

describe("parseTranscriptText", () => {
  it("parses SRT cues and generates word timings", async () => {
    const segments = await parseTranscriptText(`1\n00:00:01,000 --> 00:00:03,000\nHello local editor\n\n2\n00:00:04,250 --> 00:00:05,500\nSecond cue`);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startMs: 1000, endMs: 3000, text: "Hello local editor" });
    expect(segments[0].words).toHaveLength(3);
  });

  it("parses WebVTT and strips cue markup", async () => {
    const segments = await parseTranscriptText(`WEBVTT\n\n00:01.000 --> 00:02.500 align:start\n<b>Cache</b> stays local`);
    expect(segments[0]).toMatchObject({ startMs: 1000, endMs: 2500, text: "Cache stays local" });
  });

  it("rejects untimed text", async () => {
    await expect(parseTranscriptText("This has no cue timings")).rejects.toThrow(/No timed captions/);
  });
});
