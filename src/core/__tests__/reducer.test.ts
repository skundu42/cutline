import { describe, expect, it } from "vitest";
import { applyCommand, createBusContext, digestBranch, collectInvariantViolations } from "../index";
import { createSeedState, SOURCE_BRANCH_ID } from "../../demo/manifest";
import { GOLDEN_CUT_OPS, GOLDEN_BRANCH_A_NAME } from "../../demo/goldenRecipe";

function ctx() {
  return createBusContext(100);
}

describe("time and seed invariants", () => {
  it("seed state has matching duration and no overlaps", () => {
    const state = createSeedState();
    const branch = state.branches[SOURCE_BRANCH_ID];
    expect(collectInvariantViolations(branch, state.assets)).toEqual([]);
    expect(branch.durationMs).toBe(74000);
  });

  it("accepts sub-millisecond floating point drift in matching clip durations", () => {
    const state = createSeedState();
    const branch = state.branches[SOURCE_BRANCH_ID];
    const item = branch.tracks.find((track) => track.trackId === "v1")!.items[0];
    const endMs = (44 * 1000) / state.project.frameRate;
    const result = applyCommand(
      state,
      {
        type: "ApplyEditBatch",
        actor: { type: "human", surface: "ui" },
        payload: {
          branchId: branch.branchId,
          expectedBranchVersion: branch.branchVersion,
          operations: [{ op: "trim", itemId: item.itemId, endMs }],
        },
      },
      ctx(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(collectInvariantViolations(result.state.branches[SOURCE_BRANCH_ID], result.state.assets)).toEqual([]);
  });
});

describe("command bus", () => {
  it("creates a working branch without changing the source digest", () => {
    let state = createSeedState();
    const sourceDigest = digestBranch(state.branches[SOURCE_BRANCH_ID]);
    const result = applyCommand(
      state,
      {
        type: "CreateBranch",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          baseBranchId: SOURCE_BRANCH_ID,
          expectedBaseVersion: 0,
          name: GOLDEN_BRANCH_A_NAME,
        },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    const created = Object.values(state.branches).find((b) => b.name === GOLDEN_BRANCH_A_NAME);
    expect(created?.branchVersion).toBe(0);
    expect(created?.baseDigest).toBe(sourceDigest);
    expect(digestBranch(state.branches[SOURCE_BRANCH_ID])).toBe(sourceDigest);
  });

  it("rejects stale expectedBranchVersion with CONFLICT", () => {
    let state = createSeedState();
    const created = applyCommand(
      state,
      {
        type: "CreateBranch",
        actor: { type: "agent", surface: "webmcp" },
        payload: { baseBranchId: SOURCE_BRANCH_ID, expectedBaseVersion: 0, name: "A" },
      },
      ctx(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    state = created.state;
    const branchId = Object.values(state.branches).find((b) => b.name === "A")!.branchId;
    const first = applyCommand(
      state,
      {
        type: "ApplyEditBatch",
        actor: { type: "human", surface: "ui" },
        payload: {
          branchId,
          expectedBranchVersion: 0,
          operations: [{ op: "ripple_delete", range: { startMs: 70000, endMs: 74000 }, required: true }],
        },
      },
      ctx(),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stale = applyCommand(
      first.state,
      {
        type: "ApplyEditBatch",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId,
          expectedBranchVersion: 0,
          operations: [{ op: "ripple_delete", range: { startMs: 0, endMs: 1000 }, required: true }],
        },
      },
      ctx(),
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("CONFLICT");
  });

  it("undo restores the exact digest", () => {
    let state = createSeedState();
    const created = applyCommand(
      state,
      {
        type: "CreateBranch",
        actor: { type: "human", surface: "ui" },
        payload: { baseBranchId: SOURCE_BRANCH_ID, expectedBaseVersion: 0, name: "Scratch" },
      },
      ctx(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    state = created.state;
    const branch = Object.values(state.branches).find((b) => b.name === "Scratch")!;
    const before = digestBranch(branch);
    const edited = applyCommand(
      state,
      {
        type: "ApplyEditBatch",
        actor: { type: "human", surface: "ui" },
        payload: {
          branchId: branch.branchId,
          expectedBranchVersion: 0,
          operations: [{ op: "ripple_delete", range: { startMs: 70000, endMs: 74000 }, required: true }],
        },
      },
      ctx(),
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const undone = applyCommand(
      edited.state,
      { type: "Undo", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId } },
      ctx(),
    );
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(digestBranch(undone.state.branches[branch.branchId])).toBe(before);
  });

  it("keeps agent comments explicitly attributed", () => {
    const result = applyCommand(
      createSeedState(),
      {
        type: "AddComment",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 0,
          range: { startMs: 1000, endMs: 2000 },
          text: "Consider a tighter opening.",
        },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.branches[SOURCE_BRANCH_ID].comments[0]).toMatchObject({
      authorType: "agent",
      text: "Consider a tighter opening.",
    });
  });

  it("prevents agents from mutating an accepted branch", () => {
    const accepted = applyCommand(
      createSeedState(),
      {
        type: "AcceptBranch",
        actor: { type: "human", surface: "ui" },
        payload: { branchId: SOURCE_BRANCH_ID, expectedBranchVersion: 0 },
      },
      ctx(),
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const edit = applyCommand(
      accepted.state,
      {
        type: "SetCrop",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 0,
          target: { kind: "project" },
          aspectRatio: "9:16",
        },
      },
      ctx(),
    );
    expect(edit).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
  });
});

describe("locks", () => {
  it("rejects a required ripple that would shift a locked range", () => {
    const state = createSeedState();
    const locked = applyCommand(
      state,
      {
        type: "SetLock",
        actor: { type: "human", surface: "ui" },
        payload: {
          action: "lock",
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 0,
          range: { startMs: 18000, endMs: 19200 },
          label: "Keep pause",
        },
      },
      ctx(),
    );
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const result = applyCommand(
      locked.state,
      {
        type: "ApplyEditBatch",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 1,
          operations: [{ op: "ripple_delete", range: { startMs: 3000, endMs: 4000 }, required: true }],
        },
      },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("LOCKED_RANGE");
  });

  it("skips optional operations that hit a lock and still commits required ones", () => {
    const state = createSeedState();
    const locked = applyCommand(
      state,
      {
        type: "SetLock",
        actor: { type: "human", surface: "ui" },
        payload: {
          action: "lock",
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 0,
          range: { startMs: 18000, endMs: 19200 },
          label: "Keep pause",
        },
      },
      ctx(),
    );
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const result = applyCommand(
      locked.state,
      {
        type: "ApplyEditBatch",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 1,
          operations: [
            { op: "ripple_delete", range: { startMs: 70000, endMs: 74000 }, required: true },
            { op: "ripple_delete", range: { startMs: 3000, endMs: 4000 }, required: false },
          ],
        },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.skippedOperations).toEqual([{ op: "ripple_delete", reason: "LOCKED_RANGE" }]);
    expect(result.state.branches[SOURCE_BRANCH_ID].durationMs).toBe(70000);
    expect(result.state.branches[SOURCE_BRANCH_ID].locks[0].startMs).toBe(18000);
  });

  it("lets agents create and remove locks", () => {
    const result = applyCommand(
      createSeedState(),
      {
        type: "SetLock",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          action: "lock",
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 0,
          range: { startMs: 0, endMs: 1000 },
          label: "Agent lock",
        },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lock = result.state.branches[SOURCE_BRANCH_ID].locks[0];
    expect(lock).toMatchObject({ label: "Agent lock", createdBy: "agent" });

    const unlocked = applyCommand(result.state, {
      type: "SetLock",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        action: "unlock",
        branchId: SOURCE_BRANCH_ID,
        expectedBranchVersion: 1,
        lockId: lock.lockId,
      },
    }, ctx());
    expect(unlocked.ok).toBe(true);
    if (unlocked.ok) expect(unlocked.state.branches[SOURCE_BRANCH_ID].locks).toHaveLength(0);
  });
});

describe("golden cut", () => {
  it("lands near 35 seconds with take two on V1", () => {
    let state = createSeedState();
    const created = applyCommand(
      state,
      {
        type: "CreateBranch",
        actor: { type: "agent", surface: "webmcp" },
        payload: { baseBranchId: SOURCE_BRANCH_ID, expectedBaseVersion: 0, name: GOLDEN_BRANCH_A_NAME },
      },
      ctx(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    state = created.state;
    const branchId = Object.values(state.branches).find((b) => b.name === GOLDEN_BRANCH_A_NAME)!.branchId;
    const cut = applyCommand(
      state,
      {
        type: "ApplyEditBatch",
        actor: { type: "agent", surface: "webmcp" },
        payload: { branchId, expectedBranchVersion: 0, operations: GOLDEN_CUT_OPS },
      },
      ctx(),
    );
    expect(cut.ok).toBe(true);
    if (!cut.ok) {
      throw new Error(cut.error.message);
    }
    const branch = cut.state.branches[branchId];
    expect(collectInvariantViolations(branch, cut.state.assets)).toEqual([]);
    expect(branch.durationMs).toBeGreaterThanOrEqual(32000);
    expect(branch.durationMs).toBeLessThanOrEqual(38000);
    const v1 = branch.tracks.find((t) => t.trackId === "v1")!;
    expect(v1.items.some((item) => item.assetId === "take_2")).toBe(true);
  });

  it("places b-roll, 9:16 crop, and captions on the cut", () => {
    const state = createSeedState();
    const created = applyCommand(
      state,
      {
        type: "CreateBranch",
        actor: { type: "agent", surface: "webmcp" },
        payload: { baseBranchId: SOURCE_BRANCH_ID, expectedBaseVersion: 0, name: GOLDEN_BRANCH_A_NAME },
      },
      ctx(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const branchId = Object.values(created.state.branches).find((b) => b.name === GOLDEN_BRANCH_A_NAME)!.branchId;
    const cut = applyCommand(
      created.state,
      {
        type: "ApplyEditBatch",
        actor: { type: "agent", surface: "webmcp" },
        payload: { branchId, expectedBranchVersion: 0, operations: GOLDEN_CUT_OPS },
      },
      ctx(),
    );
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    const cropped = applyCommand(
      cut.state,
      {
        type: "SetCrop",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId,
          expectedBranchVersion: cut.state.branches[branchId].branchVersion,
          target: { kind: "project" },
          aspectRatio: "9:16",
          anchor: "face",
        },
      },
      ctx(),
    );
    expect(cropped.ok).toBe(true);
    if (!cropped.ok) return;
    const broll = applyCommand(
      cropped.state,
      {
        type: "PlaceBroll",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId,
          expectedBranchVersion: cropped.state.branches[branchId].branchVersion,
          assetId: "gpu_rack",
          trackId: "v2",
          range: { startMs: 12000, endMs: 17000 },
          fit: "cover",
          anchor: "safe_region",
          transitionIn: "cut",
          transitionOut: "cut",
        },
      },
      ctx(),
    );
    expect(broll.ok).toBe(true);
    if (!broll.ok) return;
    const diagramPlace = applyCommand(
      broll.state,
      {
        type: "PlaceBroll",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId,
          expectedBranchVersion: broll.state.branches[branchId].branchVersion,
          assetId: "cache_diagram",
          trackId: "v2",
          range: { startMs: 22000, endMs: 27000 },
          fit: "contain",
          anchor: "center",
          transitionIn: "cut",
          transitionOut: "cut",
        },
      },
      ctx(),
    );
    expect(diagramPlace.ok).toBe(true);
    if (!diagramPlace.ok) return;
    const captions = applyCommand(
      diagramPlace.state,
      {
        type: "StyleCaptions",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId,
          expectedBranchVersion: diagramPlace.state.branches[branchId].branchVersion,
          source: "transcript",
          preset: "bold_center",
          emphasis: "none",
          maxLines: 2,
          maxCharsPerLine: 42,
        },
      },
      ctx(),
    );
    expect(captions.ok).toBe(true);
    if (!captions.ok) return;
    const branch = captions.state.branches[branchId];
    expect(branch.crop.aspectRatio).toBe("9:16");
    expect(branch.tracks.find((t) => t.trackId === "v2")?.items.some((item) => item.assetId === "gpu_rack")).toBe(true);
    const diagram = branch.tracks.find((t) => t.trackId === "v2")?.items.find((item) => item.assetId === "cache_diagram");
    expect(diagram?.endMs).toBe(27000);
    expect(diagram?.startMs).toBe(22000);
    expect(branch.captions.length).toBeGreaterThan(0);
  });
});
