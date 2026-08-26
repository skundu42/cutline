import { describe, expect, it } from "vitest";
import { applyCommand, createBusContext, collectInvariantViolations } from "../index";
import { createSeedState, SOURCE_BRANCH_ID } from "../../demo/manifest";

function ctx() {
  return createBusContext(400);
}

describe("import, audio, and transitions", () => {
  it("imports a new audio asset into the project bin", () => {
    const result = applyCommand(
      createSeedState(),
      {
        type: "ImportAsset",
        actor: { type: "human", surface: "ui" },
        payload: {
          kind: "audio",
          label: "Bed music",
          uri: "/demo/brand_sting.mp4",
          durationMs: 2000,
          mime: "audio/mp4",
          checksum: "import-music",
        },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.assets.some((asset) => asset.label === "Bed music" && asset.kind === "audio")).toBe(true);
  });

  it("rejects oversized or unsupported imports", () => {
    const huge = applyCommand(
      createSeedState(),
      {
        type: "ImportAsset",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          kind: "video",
          label: "huge",
          uri: "/demo/take_1.mp4",
          durationMs: 1000,
          mime: "video/mp4",
          bytes: 600 * 1024 * 1024,
          checksum: "too-big",
        },
      },
      ctx(),
    );
    expect(huge.ok).toBe(false);
    if (huge.ok) return;
    expect(huge.error.code).toBe("VALIDATION_ERROR");

    const exe = applyCommand(
      createSeedState(),
      {
        type: "ImportAsset",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          kind: "video",
          label: "nope",
          uri: "blob:fake",
          durationMs: 1000,
          mime: "application/x-msdownload",
          checksum: "exe",
        },
      },
      ctx(),
    );
    expect(exe.ok).toBe(false);
  });

  it("places audio on A2 without changing V1", () => {
    const result = applyCommand(
      createSeedState(),
      {
        type: "PlaceAudio",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 0,
          assetId: "brand_sting",
          trackId: "a2",
          range: { startMs: 1000, endMs: 3000 },
          gain: 0.4,
          transitionIn: "fade_in",
          transitionOut: "fade_out",
          fadeMs: 200,
        },
      },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const branch = result.state.branches[SOURCE_BRANCH_ID];
    const a2 = branch.tracks.find((track) => track.trackId === "a2");
    expect(a2?.items).toHaveLength(1);
    expect(a2?.items[0].gain).toBe(0.4);
    expect(a2?.items[0].transitionIn).toBe("fade_in");
    expect(branch.tracks.find((track) => track.trackId === "v1")?.items[0].assetId).toBe("take_1");
    expect(collectInvariantViolations(branch, result.state.assets)).toEqual([]);
  });

  it("places a clip at the playhead and sets a crossfade", () => {
    const placed = applyCommand(
      createSeedState(),
      {
        type: "PlaceClip",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 0,
          assetId: "gpu_rack",
          trackId: "v2",
          startMs: 5000,
          sourceInMs: 0,
          durationMs: 2000,
          fit: "cover",
          transitionIn: "cut",
          transitionOut: "cut",
        },
      },
      ctx(),
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const itemId = placed.state.branches[SOURCE_BRANCH_ID].tracks
      .find((track) => track.trackId === "v2")!
      .items[0].itemId;
    const faded = applyCommand(
      placed.state,
      {
        type: "SetTransition",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 1,
          itemId,
          transitionIn: "crossfade",
          transitionOut: "crossfade",
          fadeMs: 400,
        },
      },
      ctx(),
    );
    expect(faded.ok).toBe(true);
    if (!faded.ok) return;
    const clip = faded.state.branches[SOURCE_BRANCH_ID].tracks.find((t) => t.trackId === "v2")!.items[0];
    expect(clip.transitionIn).toBe("crossfade");
    expect(clip.fadeMs).toBe(400);
  });

  it("sets gain and mutes a track", () => {
    const gained = applyCommand(
      createSeedState(),
      {
        type: "SetGain",
        actor: { type: "human", surface: "ui" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 0,
          itemId: "c_a1_take1",
          gain: 0.7,
        },
      },
      ctx(),
    );
    expect(gained.ok).toBe(true);
    if (!gained.ok) return;
    expect(gained.state.branches[SOURCE_BRANCH_ID].tracks.find((t) => t.trackId === "a1")!.items[0].gain).toBe(0.7);
    const muted = applyCommand(
      gained.state,
      {
        type: "MuteTrack",
        actor: { type: "agent", surface: "webmcp" },
        payload: {
          branchId: SOURCE_BRANCH_ID,
          expectedBranchVersion: 1,
          trackId: "a1",
          muted: true,
        },
      },
      ctx(),
    );
    expect(muted.ok).toBe(true);
    if (!muted.ok) return;
    expect(muted.state.branches[SOURCE_BRANCH_ID].tracks.find((t) => t.trackId === "a1")!.muted).toBe(true);
  });
});
