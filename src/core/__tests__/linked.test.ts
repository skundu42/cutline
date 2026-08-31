import { describe, expect, it } from "vitest";
import { applyCommand, createBusContext } from "../reducer";
import { digestBranch } from "../digest";
import { linkedItems } from "../linked";
import type { EditorState, EditOp } from "../types";
import { createSeedState, SOURCE_BRANCH_ID } from "../../demo/manifest";

function fixture(explicit = true) {
  const state = createSeedState();
  const branch = state.branches[SOURCE_BRANCH_ID];
  branch.locks = [];
  if (explicit) for (const track of branch.tracks) for (const item of track.items) item.linkGroupId = "av";
  return state;
}
const branchOf = (state: EditorState) => state.branches[SOURCE_BRANCH_ID];
const clips = (state: EditorState, track: string) => branchOf(state).tracks.find((entry) => entry.trackId === track)!.items;
function edit(state: EditorState, operations: EditOp[], context = createBusContext(900)) {
  return applyCommand(state, { type: "ApplyEditBatch", actor: { type: "human", surface: "ui" }, payload: {
    branchId: SOURCE_BRANCH_ID, expectedBranchVersion: branchOf(state).branchVersion, operations,
  } }, context);
}

describe("shared linked edits", () => {
  it.each(["v1", "a1"])("splits either side (%s) into independent linked pieces", (track) => {
    const context = createBusContext(900);
    const split = edit(fixture(), [{ op: "split", itemId: `c_${track}_take1`, atMs: 1000 }], context);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(clips(split.state, "v1")).toHaveLength(2);
    expect(clips(split.state, "a1")).toHaveLength(2);
    expect(clips(split.state, "v1")[0].linkGroupId).toBe(clips(split.state, "a1")[0].linkGroupId);
    expect(clips(split.state, "v1")[1].linkGroupId).toBe(clips(split.state, "a1")[1].linkGroupId);
    expect(clips(split.state, "v1")[0].linkGroupId).not.toBe(clips(split.state, "v1")[1].linkGroupId);
    const next = edit(split.state, [{ op: "split", itemId: clips(split.state, "a1")[1].itemId, atMs: 2000 }], context);
    expect(next.ok).toBe(true);
    if (next.ok) expect(clips(next.state, "v1").map((item) => item.startMs)).toEqual([0, 1000, 2000]);
  });

  it.each(["v1", "a1"])("moves, trims, and deletes both partners from %s", (track) => {
    const context = createBusContext(900);
    let state = fixture();
    for (const operation of [
      { op: "move", itemId: `c_${track}_take1`, startMs: 1000 },
      { op: "trim", itemId: `c_${track}_take1`, startMs: 2000, endMs: 70000 },
      { op: "delete", itemId: `c_${track}_take1` },
    ] satisfies EditOp[]) {
      const result = edit(state, [operation], context);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
      expect(clips(state, "v1").map((item) => [item.startMs, item.endMs, item.sourceInMs, item.sourceOutMs]))
        .toEqual(clips(state, "a1").map((item) => [item.startMs, item.endMs, item.sourceInMs, item.sourceOutMs]));
    }
    expect(clips(state, "v1")).toHaveLength(0);
  });

  it("preserves offsets for explicitly linked material", () => {
    const state = fixture();
    clips(state, "a1")[0].startMs += 1000;
    clips(state, "a1")[0].endMs += 1000;
    branchOf(state).durationMs += 1000;
    const result = edit(state, [{ op: "trim", itemId: "c_v1_take1", startMs: 1000, endMs: 70000 }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(clips(result.state, "a1")[0]).toMatchObject({ startMs: 2000, endMs: 71000, sourceInMs: 1000 });
  });

  it("supports legacy pairs and honors explicit unlinking", () => {
    const state = fixture(false);
    expect(linkedItems(branchOf(state), "c_a1_take1")).toHaveLength(2);
    const unlinked = edit(state, [{ op: "set_link", itemIds: ["c_v1_take1", "c_a1_take1"], linked: false }, { op: "delete", itemId: "c_a1_take1" }]);
    expect(unlinked.ok).toBe(true);
    if (unlinked.ok) expect(clips(unlinked.state, "v1")).toHaveLength(1);
  });

  it.each(["split", "trim", "move", "delete"] as const)("coalesces explicit paired %s operations", (op) => {
    const operations = ["c_v1_take1", "c_a1_take1"].map((itemId): EditOp => {
      if (op === "split") return { op, itemId, atMs: 1000 };
      if (op === "trim") return { op, itemId, startMs: 1000, endMs: 70000 };
      if (op === "move") return { op, itemId, startMs: 1000 };
      return { op, itemId };
    });
    const result = edit(fixture(), operations);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(branchOf(result.state).branchVersion).toBe(1);
    expect(result.state.history[SOURCE_BRANCH_ID].undo).toHaveLength(1);
    expect(clips(result.state, "v1")).toHaveLength(op === "split" ? 2 : op === "delete" ? 0 : 1);
  });

  it("rejects contradictory partner edits atomically", () => {
    const state = fixture();
    const before = digestBranch(branchOf(state));
    expect(edit(state, [
      { op: "move", itemId: "c_v1_take1", startMs: 1000 },
      { op: "move", itemId: "c_a1_take1", startMs: 2000 },
    ])).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(digestBranch(branchOf(state))).toBe(before);
  });

  it("does not silently coalesce paired edits after an intervening edit changes their effect", () => {
    expect(edit(fixture(), [
      { op: "trim", itemId: "c_v1_take1", startMs: 1000, endMs: 70000 },
      { op: "move", itemId: "c_v1_take1", startMs: 2000 },
      { op: "trim", itemId: "c_a1_take1", startMs: 1000, endMs: 70000 },
    ])).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("includes vacated material in move and trim receipts", () => {
    const moved = edit(fixture(), [{ op: "move", itemId: "c_a1_take1", startMs: 1000 }]);
    const trimmed = edit(fixture(), [{ op: "trim", itemId: "c_a1_take1", endMs: 70000 }]);
    if (!moved.ok || !trimmed.ok) throw new Error("Expected edits to succeed");
    expect(moved.receipt.changedRanges).toEqual(Array(2).fill({ startMs: 0, endMs: 75000, changes: ["move"] }));
    expect(trimmed.receipt.changedRanges).toEqual(Array(2).fill({ startMs: 0, endMs: 74000, changes: ["trim"] }));
  });

  it("rejects a partner's source overflow or overlap without changing either clip", () => {
    const state = fixture();
    const before = digestBranch(branchOf(state));
    clips(state, "a1").push({ ...clips(state, "a1")[0], itemId: "other", linkGroupId: null, startMs: 75000, endMs: 76000, sourceInMs: 0, sourceOutMs: 1000 });
    branchOf(state).durationMs = 76000;
    expect(edit(state, [{ op: "move", itemId: "c_v1_take1", startMs: 2000 }])).toMatchObject({ ok: false, error: { code: "INVARIANT_VIOLATION" } });
    clips(state, "a1").pop();
    branchOf(state).durationMs = 74000;
    expect(digestBranch(branchOf(state))).toBe(before);
    Object.assign(clips(state, "v1")[0], { endMs: 70000, sourceOutMs: 70000 });
    Object.assign(clips(state, "a1")[0], { assetId: "take_2", endMs: 11000, sourceOutMs: 11000 });
    branchOf(state).durationMs = 70000;
    const bounded = digestBranch(branchOf(state));
    expect(edit(state, [{ op: "trim", itemId: "c_v1_take1", endMs: 71000 }])).toMatchObject({ ok: false, error: { code: "INVARIANT_VIOLATION" } });
    expect(digestBranch(branchOf(state))).toBe(bounded);
  });

  it("skips or rejects the whole group when only the partner intersects a lock", () => {
    const state = fixture();
    clips(state, "a1")[0].startMs += 1000;
    clips(state, "a1")[0].endMs += 1000;
    branchOf(state).durationMs += 1000;
    branchOf(state).locks = [{ lockId: "lock", startMs: 74500, endMs: 75000, label: "Audio tail", createdAt: 0, createdBy: "human" }];
    const operation = { op: "move" as const, itemId: "c_v1_take1", startMs: 100 };
    expect(edit(state, [operation])).toMatchObject({ ok: false, error: { code: "LOCKED_RANGE" } });
    const skipped = edit(state, [{ ...operation, required: false }]);
    expect(skipped.ok).toBe(true);
    if (skipped.ok) {
      expect(clips(skipped.state, "v1")[0].startMs).toBe(0);
      expect(clips(skipped.state, "a1")[0].startMs).toBe(1000);
      expect(skipped.receipt.skippedOperations).toHaveLength(1);
    }
  });

  it("rejects out-of-bounds edits and restores linked pieces through undo/redo", () => {
    const state = fixture();
    expect(edit(state, [{ op: "trim", itemId: "c_a1_take1", endMs: 80000 }])).toMatchObject({ ok: false });
    const split = edit(state, [{ op: "split", itemId: "c_a1_take1", atMs: 1000 }]);
    if (!split.ok) throw new Error(split.error.message);
    const undo = applyCommand(split.state, { type: "Undo", actor: { type: "human", surface: "ui" }, payload: { branchId: SOURCE_BRANCH_ID } }, createBusContext(2000));
    if (!undo.ok) throw new Error(undo.error.message);
    expect(digestBranch(branchOf(undo.state))).toBe(digestBranch(branchOf(state)));
    const redo = applyCommand(undo.state, { type: "Redo", actor: { type: "human", surface: "ui" }, payload: { branchId: SOURCE_BRANCH_ID } }, createBusContext(3000));
    if (!redo.ok) throw new Error(redo.error.message);
    expect(digestBranch(branchOf(redo.state))).toBe(digestBranch(branchOf(split.state)));
  });

  it("does not let an optional partner bypass a required protected edit", () => {
    const state = fixture();
    branchOf(state).locks = [{ lockId: "lock", startMs: 0, endMs: 1000, label: "Head", createdAt: 0, createdBy: "human" }];
    const operations: EditOp[] = [
      { op: "delete", itemId: "c_a1_take1", required: false },
      { op: "delete", itemId: "c_v1_take1", required: false },
    ];
    const optional = edit(state, operations);
    if (!optional.ok) throw new Error(optional.error.message);
    expect(optional.receipt.skippedOperations).toHaveLength(2);
    expect(clips(optional.state, "v1")).toHaveLength(1);
    expect(clips(optional.state, "a1")).toHaveLength(1);
    expect(edit(state, [operations[0], { ...operations[1], required: true }])).toMatchObject({ ok: false, error: { code: "LOCKED_RANGE" } });
  });

  it("checks the full replaced clip and removes its linked partner", () => {
    const state = fixture();
    const command = { type: "PlaceClip" as const, actor: { type: "human" as const, surface: "ui" as const }, payload: {
      branchId: SOURCE_BRANCH_ID, expectedBranchVersion: 0, assetId: "take_2", trackId: "v1" as const,
      startMs: 1000, durationMs: 1000, replaceExisting: true,
    } };
    branchOf(state).locks = [{ lockId: "lock", startMs: 5000, endMs: 6000, label: "Outside insertion", createdAt: 0, createdBy: "human" }];
    expect(applyCommand(state, command, createBusContext(900))).toMatchObject({ ok: false, error: { code: "LOCKED_RANGE" } });
    branchOf(state).locks = [];
    const replaced = applyCommand(state, command, createBusContext(900));
    if (!replaced.ok) throw new Error(replaced.error.message);
    expect(clips(replaced.state, "v1").map((item) => item.assetId)).toEqual(["take_2"]);
    expect(clips(replaced.state, "a1").map((item) => item.assetId)).toEqual(["take_2"]);
  });
});
