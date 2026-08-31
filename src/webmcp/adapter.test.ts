import { describe, expect, it } from "vitest";
import { AddTransitionInput, jsonSchema, InspectProjectInput, ApplyEditBatchInput, ControlPlaybackInput, LockRangeInput, TimeRangeSchema } from "./schemas";
import { P0_TOOL_NAMES } from "./catalog";

describe("webmcp contract", () => {
  it("exposes json schemas for inspect and edit batch", () => {
    const inspect = jsonSchema(InspectProjectInput);
    const batch = jsonSchema(ApplyEditBatchInput);
    expect(inspect).toMatchObject({ type: "object" });
    expect(batch).toMatchObject({ type: "object" });
  });

  it("exposes first-class agent operations in the tool catalog", () => {
    expect(P0_TOOL_NAMES).toContain("apply_edit_batch");
    expect(P0_TOOL_NAMES).toContain("plan_edit");
    expect(P0_TOOL_NAMES).toContain("import_media");
    expect(P0_TOOL_NAMES).toContain("place_audio");
    expect(P0_TOOL_NAMES).toContain("add_transition");
    expect(P0_TOOL_NAMES).toEqual(expect.arrayContaining([
      "control_playback",
      "select_branch",
      "add_comment",
      "propose_comment_resolution",
      "undo_edit",
      "redo_edit",
    ]));
    expect(P0_TOOL_NAMES).toEqual(expect.arrayContaining([
      "import_transcript",
      "lock_range",
      "unlock_range",
      "accept_branch",
      "export",
      "publish",
      "delete_project",
    ]));
    expect(LockRangeInput.safeParse({
      projectId: "p",
      branchId: "b",
      expectedBranchVersion: 1,
      range: { startMs: 0, endMs: 1000 },
      label: "Agent-owned lock",
    }).success).toBe(true);
  });

  it("accepts simple between-clip transitions and validates their duration", () => {
    expect(AddTransitionInput.safeParse({
      projectId: "p",
      branchId: "b",
      expectedBranchVersion: 1,
      fromItemId: "out",
      toItemId: "in",
      transition: "slide_left",
    }).success).toBe(true);
    expect(AddTransitionInput.safeParse({
      projectId: "p",
      branchId: "b",
      expectedBranchVersion: 1,
      fromItemId: "out",
      toItemId: "in",
      transition: "crossfade",
      durationMs: 25,
    }).success).toBe(false);
  });

  it("rejects inverted ranges and invalid playback actions", () => {
    expect(TimeRangeSchema.safeParse({ startMs: 2000, endMs: 1000 }).success).toBe(false);
    expect(ControlPlaybackInput.safeParse({ projectId: "p", branchId: "b", action: "scrub" }).success).toBe(false);
  });
});
