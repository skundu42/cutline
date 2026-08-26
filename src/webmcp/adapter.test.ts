import { describe, expect, it } from "vitest";
import { jsonSchema, InspectProjectInput, ApplyEditBatchInput, ControlPlaybackInput, TimeRangeSchema } from "./schemas";
import { HUMAN_ONLY_ABSENT, P0_TOOL_NAMES } from "./catalog";

describe("webmcp contract", () => {
  it("exposes json schemas for inspect and edit batch", () => {
    const inspect = jsonSchema(InspectProjectInput);
    const batch = jsonSchema(ApplyEditBatchInput);
    expect(inspect).toMatchObject({ type: "object" });
    expect(batch).toMatchObject({ type: "object" });
  });

  it("does not include human-only operations in the tool catalog", () => {
    expect(P0_TOOL_NAMES).toContain("apply_edit_batch");
    expect(P0_TOOL_NAMES).toContain("import_media");
    expect(P0_TOOL_NAMES).toContain("place_audio");
    expect(P0_TOOL_NAMES).toEqual(expect.arrayContaining([
      "control_playback",
      "select_branch",
      "add_comment",
      "propose_comment_resolution",
      "undo_edit",
      "redo_edit",
    ]));
    expect(P0_TOOL_NAMES).not.toContain("export");
    expect(HUMAN_ONLY_ABSENT).toEqual(
      expect.arrayContaining(["lock_range", "accept_branch", "export", "publish"]),
    );
  });

  it("rejects inverted ranges and invalid playback actions", () => {
    expect(TimeRangeSchema.safeParse({ startMs: 2000, endMs: 1000 }).success).toBe(false);
    expect(ControlPlaybackInput.safeParse({ projectId: "p", branchId: "b", action: "scrub" }).success).toBe(false);
  });
});
