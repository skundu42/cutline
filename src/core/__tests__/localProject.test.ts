import { describe, expect, it } from "vitest";
import { createProjectBundle, importProjectBundle } from "@/persistence/db";
import { applyCommand, createBusContext, readMappedTranscript } from "../reducer";
import { validateImportUri } from "../import";
import { createEmptyState, MAIN_BRANCH_ID } from "../project";
import { createSeedState } from "@/demo/manifest";

describe("local content-agnostic projects", () => {
  it("starts with an empty standard timeline", () => {
    const state = createEmptyState(42);
    const branch = state.branches[MAIN_BRANCH_ID];
    expect(state.project).toMatchObject({ projectId: "project_local_16", title: "Untitled cut" });
    expect(state.assets).toEqual([]);
    expect(branch.durationMs).toBe(0);
    expect(branch.tracks.map((track) => track.trackId)).toEqual(["v1", "v2", "a1", "a2", "cc"]);
  });

  it("places uploaded video with linked picture and audio", () => {
    const context = createBusContext();
    const imported = applyCommand(createEmptyState(), {
      type: "ImportAsset",
      actor: { type: "human", surface: "ui" },
      payload: {
        assetId: "local-video",
        kind: "video",
        label: "Local clip",
        uri: "blob:local-video",
        durationMs: 5000,
        width: 1920,
        height: 1080,
        mime: "video/mp4",
        bytes: 1024,
        checksum: "local",
      },
    }, context);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const placed = applyCommand(imported.state, {
      type: "PlaceClip",
      actor: { type: "human", surface: "ui" },
      payload: {
        branchId: MAIN_BRANCH_ID,
        expectedBranchVersion: 0,
        assetId: "local-video",
        trackId: "v1",
        startMs: 0,
      },
    }, context);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const branch = placed.state.branches[MAIN_BRANCH_ID];
    expect(branch.durationMs).toBe(5000);
    expect(branch.tracks.find((track) => track.trackId === "v1")?.items).toHaveLength(1);
    expect(branch.tracks.find((track) => track.trackId === "a1")?.items).toHaveLength(1);
    expect(placed.receipt.summary).toContain("linked audio");

    const videoItem = branch.tracks.find((track) => track.trackId === "v1")!.items[0];
    const audioItem = branch.tracks.find((track) => track.trackId === "a1")!.items[0];
    expect(videoItem.linkGroupId).toBeTruthy();
    expect(audioItem.linkGroupId).toBe(videoItem.linkGroupId);
    const unlinked = applyCommand(placed.state, {
      type: "ApplyEditBatch",
      actor: { type: "human", surface: "ui" },
      payload: {
        branchId: MAIN_BRANCH_ID,
        expectedBranchVersion: 1,
        operations: [{ op: "set_link", itemIds: [videoItem.itemId, audioItem.itemId], linked: false }],
      },
    }, context);
    expect(unlinked.ok).toBe(true);
    if (!unlinked.ok) return;
    expect(unlinked.state.branches[MAIN_BRANCH_ID].tracks.flatMap((track) => track.items).filter((item) => [videoItem.itemId, audioItem.itemId].includes(item.itemId)).every((item) => item.linkGroupId === null)).toBe(true);

    const exported = applyCommand(unlinked.state, {
      type: "RecordExport",
      actor: { type: "human", surface: "ui" },
      payload: {
        branchId: MAIN_BRANCH_ID,
        expectedBranchVersion: 2,
        uri: "local-render:digest",
        width: 1280,
        height: 720,
        bytes: 2048,
      },
    }, context);
    expect(exported.ok).toBe(true);
    if (exported.ok) expect(exported.state.exports[0].uri).toBe("local-render:digest");
  });

  it("rejects remote media references", () => {
    expect(validateImportUri("https://example.com/clip.mp4")).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(validateImportUri("blob:local")).toBeNull();
    expect(validateImportUri("/fixtures/local.mp4")).toBeNull();
  });

  it("does not invent linked audio for a silent video", () => {
    const context = createBusContext();
    const imported = applyCommand(createEmptyState(), {
      type: "ImportAsset",
      actor: { type: "human", surface: "ui" },
      payload: {
        assetId: "silent-video",
        kind: "video",
        label: "Silent clip",
        uri: "blob:silent-video",
        durationMs: 2000,
        width: 1920,
        height: 1080,
        mime: "video/mp4",
        checksum: "silent",
        hasAudio: false,
      },
    }, context);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const placed = applyCommand(imported.state, {
      type: "PlaceClip",
      actor: { type: "human", surface: "ui" },
      payload: {
        branchId: MAIN_BRANCH_ID,
        expectedBranchVersion: 0,
        assetId: "silent-video",
        trackId: "v1",
        startMs: 0,
      },
    }, context);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.state.branches[MAIN_BRANCH_ID].tracks.find((track) => track.trackId === "a1")?.items).toHaveLength(0);
    expect(placed.receipt.summary).not.toContain("linked audio");
  });

  it("maps imported transcripts onto arbitrary local video assets", () => {
    const state = createEmptyState();
    const transcript = applyCommand(state, {
      type: "ImportTranscript",
      actor: { type: "human", surface: "ui" },
      payload: {
        label: "local.srt",
        segments: [{
          segmentId: "cue-1",
          startMs: 0,
          endMs: 1000,
          speaker: "Speaker",
          text: "Local cue",
          confidence: 1,
          words: [{ startMs: 0, endMs: 1000, text: "Local cue" }],
        }],
      },
    }, createBusContext());
    expect(transcript.ok).toBe(true);
    if (!transcript.ok) return;
    expect(readMappedTranscript(transcript.state, MAIN_BRANCH_ID)).toHaveLength(1);
  });

  it("round-trips a portable project bundle and remaps project and asset identities", async () => {
    const original = createSeedState(100);
    const originalAssetId = original.assets[0].assetId;
    const bundle = await createProjectBundle(original);
    const imported = await importProjectBundle(bundle, 200);
    expect(imported.project.projectId).not.toBe(original.project.projectId);
    expect(imported.project.title).toBe(`${original.project.title} (imported)`);
    expect(imported.assets[0].assetId).not.toBe(originalAssetId);
    const importedAssetIds = new Set(imported.assets.map((asset) => asset.assetId));
    expect(Object.values(imported.branches).flatMap((branch) => branch.tracks).flatMap((track) => track.items).every((item) => importedAssetIds.has(item.assetId))).toBe(true);
  });
});
