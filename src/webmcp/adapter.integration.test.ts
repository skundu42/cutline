/** @vitest-environment jsdom */

import type { ModelContext, WebMcpToolAnnotations } from "@mcp-b/webmcp-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/persistence/db", () => ({
  clearEditor: vi.fn(async () => undefined),
  cleanupOrphanedMedia: vi.fn(async () => undefined),
  createProjectBundle: vi.fn(async () => new Blob()),
  deleteMediaBlob: vi.fn(async () => undefined),
  deleteProject: vi.fn(async () => undefined),
  importProjectBundle: vi.fn(async () => { throw new Error("not mocked"); }),
  listProjects: vi.fn(async () => []),
  loadEditor: vi.fn(async () => null),
  persistEditor: vi.fn(async () => undefined),
  putMediaBlob: vi.fn(async () => undefined),
  registerLiveAssetUrl: vi.fn(),
  getLocalStorageBackend: vi.fn(() => "indexeddb"),
}));
vi.mock("@/telemetry", () => ({ track: vi.fn() }));
vi.mock("@/media/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/media/export")>();
  return {
    ...actual,
    renderBranchLocally: vi.fn(async () => ({
      blob: new Blob(["rendered"], { type: "video/webm" }),
      mimeType: "video/webm",
      extension: "webm",
      mode: "realtime",
      width: 1280,
      height: 720,
    })),
  };
});

import { createSeedState, SOURCE_BRANCH_ID } from "@/demo/manifest";
import { digestBranch } from "@/core";
import { useEditorStore } from "@/store/editorStore";
import { P0_TOOL_NAMES } from "./catalog";
import { registerAll } from "./adapter";

interface CapturedTool {
  name: string;
  annotations?: WebMcpToolAnnotations;
  execute: (input: unknown, extras?: { signal?: AbortSignal }) => Promise<unknown>;
}

const tools = new Map<string, CapturedTool>();

function installModelContext() {
  const modelContext = {
    registerTool: vi.fn(async (tool: CapturedTool, options?: { signal?: AbortSignal }) => {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
    }),
    getTools: vi.fn(async () => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    ontoolchange: null,
  } as unknown as ModelContext;
  Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
}

function resetStore(ready = true) {
  useEditorStore.setState({
    editor: createSeedState(100),
    ready,
    readyAt: ready ? 150 : null,
    receipts: [],
    toolLifecycle: [],
    lastError: null,
    registeredTools: [],
    compare: { enabled: false, leftId: null, rightId: null, show: "left" },
    monitorMode: "timeline",
    sourceAssetId: null,
    playing: false,
    playheadMs: 0,
  });
}

async function registerTools(scope: "all" | "status" | "operational" = "all") {
  const controller = new AbortController();
  await registerAll(controller, scope);
  return controller;
}

describe("WebMCP registered handlers", () => {
  beforeEach(() => {
    tools.clear();
    installModelContext();
    resetStore();
  });

  it("gives UI and agent edits the same linked behavior and keeps plans non-committing", async () => {
    await registerTools();
    const operations = [{ op: "split" as const, itemId: "c_a1_take1", atMs: 1000 }];
    const before = useEditorStore.getState().editor;
    const planned = await tools.get("plan_edit")!.execute({ projectId: before.project.projectId, branchId: SOURCE_BRANCH_ID, expectedBranchVersion: 0, operations });
    expect(planned).toMatchObject({ committed: false });
    expect(useEditorStore.getState().editor).toBe(before);
    const summarize = () => useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID].tracks.map((track) => ({
      trackId: track.trackId, items: track.items.map((item) => [item.startMs, item.endMs, item.sourceInMs, item.sourceOutMs]),
    }));
    const ui = useEditorStore.getState().dispatch({ type: "ApplyEditBatch", actor: { type: "human", surface: "ui" }, payload: { branchId: SOURCE_BRANCH_ID, expectedBranchVersion: 0, operations } });
    expect(ui.ok).toBe(true);
    const expected = summarize();
    resetStore();
    const result = await tools.get("split_clip")!.execute({ projectId: before.project.projectId, branchId: SOURCE_BRANCH_ID, expectedBranchVersion: 0, itemId: "c_a1_take1", atMs: 1000 });
    expect(result).toMatchObject({ branchVersion: 1 });
    expect(summarize()).toEqual(expected);
  });

  it("identifies new branches by ID even when names are duplicated", async () => {
    await registerTools();
    const state = useEditorStore.getState().editor;
    const created = await tools.get("create_cut_branch")!.execute({ projectId: state.project.projectId, baseBranchId: SOURCE_BRANCH_ID, expectedBaseVersion: 0, name: state.branches[SOURCE_BRANCH_ID].name }) as { branchId: string };
    expect(created.branchId).not.toBe(SOURCE_BRANCH_ID);
    expect(created.branchId).toBe(useEditorStore.getState().editor.project.activeBranchId);
  });

  it("keeps comparison, active timeline, and source playback mode aligned", async () => {
    await registerTools();
    const store = useEditorStore.getState();
    const originalDigest = digestBranch(store.editor.branches[SOURCE_BRANCH_ID]);
    store.selectSource(store.editor.assets[0].assetId);
    expect(useEditorStore.getState()).toMatchObject({ monitorMode: "source", playing: false });
    expect(digestBranch(useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID])).toBe(originalDigest);
    const created = await tools.get("create_cut_branch")!.execute({ projectId: store.editor.project.projectId, baseBranchId: SOURCE_BRANCH_ID, expectedBaseVersion: 0, name: "Comparison" }) as { branchId: string };
    useEditorStore.getState().selectSource(store.editor.assets[0].assetId);
    await tools.get("compare_cuts")!.execute({ projectId: store.editor.project.projectId, leftBranchId: SOURCE_BRANCH_ID, rightBranchId: created.branchId });
    expect(useEditorStore.getState()).toMatchObject({ monitorMode: "timeline", editor: { project: { activeBranchId: SOURCE_BRANCH_ID } } });
    useEditorStore.getState().setCompare({ show: "right" });
    expect(useEditorStore.getState().editor.project.activeBranchId).toBe(created.branchId);
    useEditorStore.getState().setCompare({ enabled: false });
    expect(useEditorStore.getState().editor.project.activeBranchId).toBe(created.branchId);
    useEditorStore.getState().selectSource(store.editor.assets[0].assetId);
    useEditorStore.getState().setPlaying(true);
    expect(useEditorStore.getState()).toMatchObject({ monitorMode: "timeline", playing: true });
  });

  it("registers readiness and operational tools in independently removable groups", async () => {
    const status = await registerTools("status");
    expect([...tools.keys()]).toEqual(["project_status"]);
    const operational = await registerTools("operational");
    expect(tools.size).toBe(P0_TOOL_NAMES.length);
    expect(tools.has("project_status")).toBe(true);
    operational.abort();
    expect([...tools.keys()]).toEqual(["project_status"]);
    status.abort();
    expect(tools.size).toBe(0);
  });

  it("returns structured readiness, project, validation, and cancellation errors", async () => {
    resetStore(false);
    await registerTools();
    await expect(tools.get("project_status")!.execute({ projectId: "proj_kv_demo_v1" })).resolves.toMatchObject({
      ready: false,
      readyAt: null,
    });
    const timeline = tools.get("get_timeline")!;
    await expect(timeline.execute({ projectId: "wrong", branchId: SOURCE_BRANCH_ID })).resolves.toMatchObject({
      error: { code: "PROJECT_NOT_READY" },
    });
    resetStore(true);
    await expect(tools.get("project_status")!.execute({ projectId: "proj_kv_demo_v1" })).resolves.toMatchObject({
      ready: true,
      readyAt: 150,
      processing: { localOnly: true, mediaEngine: "mediabunny" },
      storageBackend: "indexeddb",
    });
    await expect(timeline.execute({ projectId: "wrong", branchId: SOURCE_BRANCH_ID })).resolves.toMatchObject({
      error: { code: "PROJECT_NOT_FOUND" },
    });
    await expect(timeline.execute({ projectId: "proj_kv_demo_v1", branchId: SOURCE_BRANCH_ID, range: { startMs: 2, endMs: 1 } })).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(timeline.execute({ projectId: "proj_kv_demo_v1", branchId: SOURCE_BRANCH_ID }, { signal: cancellation.signal })).resolves.toMatchObject({
      error: { code: "CANCELLED" },
    });
  });

  it("executes agent comments with agent attribution", async () => {
    await registerTools();
    const result = await tools.get("add_comment")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 0,
      clientRequestId: "comment-1",
      range: { startMs: 1000, endMs: 2000 },
      text: "Try a shorter beat.",
    });
    expect(result).toMatchObject({ branchVersion: 1 });
    expect(useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID].comments[0]).toMatchObject({
      authorType: "agent",
      text: "Try a shorter beat.",
    });
  });

  it("lets an agent add one transition between adjacent clips", async () => {
    await registerTools();
    const split = useEditorStore.getState().dispatch({
      type: "ApplyEditBatch",
      actor: { type: "human", surface: "ui" },
      payload: {
        branchId: SOURCE_BRANCH_ID,
        expectedBranchVersion: 0,
        operations: [{ op: "split", itemId: "c_v1_take1", atMs: 5000 }],
      },
    });
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const clips = split.state.branches[SOURCE_BRANCH_ID].tracks.find((track) => track.trackId === "v1")!.items;
    const result = await tools.get("add_transition")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 1,
      clientRequestId: "transition-1",
      fromItemId: clips[0].itemId,
      toItemId: clips[1].itemId,
      transition: "crossfade",
      durationMs: 300,
    });
    expect(result).toMatchObject({ branchVersion: 2, transition: "crossfade", audioPolicy: "unchanged" });
    const timeline = await tools.get("get_timeline")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      include: ["clips"],
    }) as { tracks: Array<{ trackId: string; transitions: unknown[] }> };
    expect(timeline.tracks.find((track) => track.trackId === "v1")?.transitions).toEqual([
      expect.objectContaining({ transition: "crossfade", atMs: 5000, durationMs: 300 }),
    ]);
  });

  it("honors read filters and marks project content as untrusted", async () => {
    await registerTools();
    const inspect = await tools.get("inspect_project")!.execute({
      projectId: "proj_kv_demo_v1",
      include: ["tracks"],
    }) as Record<string, unknown>;
    expect(inspect).toHaveProperty("tracks");
    expect(inspect).not.toHaveProperty("assets");
    expect(inspect).not.toHaveProperty("locks");
    expect(inspect).toHaveProperty("capabilities.processing.localOnly", true);
    expect(tools.get("inspect_project")!.annotations).toMatchObject({ readOnlyHint: true, untrustedContentHint: true });

    const timeline = await tools.get("get_timeline")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      include: ["captions"],
    }) as { tracks: Array<{ items: unknown[] }> } & Record<string, unknown>;
    expect(timeline.tracks.every((track) => track.items.length === 0)).toBe(true);
    expect(timeline).toHaveProperty("captions");
    expect(timeline).not.toHaveProperty("comments");

    await expect(tools.get("read_transcript")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      includeWords: true,
    })).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("deduplicates retried writes by clientRequestId", async () => {
    await registerTools();
    const input = {
      projectId: "proj_kv_demo_v1",
      baseBranchId: SOURCE_BRANCH_ID,
      expectedBaseVersion: 0,
      clientRequestId: "branch-1",
      name: "Agent cut",
    };
    const first = await tools.get("create_cut_branch")!.execute(input);
    const retry = await tools.get("create_cut_branch")!.execute(input);
    expect(retry).toEqual(first);
    expect(Object.keys(useEditorStore.getState().editor.branches)).toHaveLength(2);
  });

  it("simulates edit plans without mutation and enforces review-first policy", async () => {
    await registerTools();
    const before = digestBranch(useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID]);
    const planned = await tools.get("plan_edit")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 0,
      rationale: "Preview a shorter ending",
      operations: [{ op: "ripple_delete", range: { startMs: 70_000, endMs: 74_000 } }],
    });
    expect(planned).toMatchObject({ committed: false, currentBranchVersion: 0, projectedBranchVersion: 1, projectedDurationMs: 70_000 });
    expect(digestBranch(useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID])).toBe(before);

    useEditorStore.getState().setAgentMutationPolicy("plan_only");
    const blocked = await tools.get("apply_edit_batch")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 0,
      operations: [{ op: "ripple_delete", range: { startMs: 70_000, endMs: 74_000 } }],
    });
    expect(blocked).toMatchObject({ error: { code: "APPROVAL_REQUIRED" } });
    expect(digestBranch(useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID])).toBe(before);
  });

  it("gives agents first-class control over transcripts, locks, comments, export, publish, and acceptance", async () => {
    await registerTools();
    const imported = await tools.get("import_transcript")!.execute({
      projectId: "proj_kv_demo_v1",
      clientRequestId: "transcript-agent-1",
      label: "agent transcript",
      segments: [{
        segmentId: "agent-segment",
        startMs: 0,
        endMs: 1000,
        speaker: "Agent",
        text: "First-class editing.",
        confidence: 1,
        words: [{ startMs: 0, endMs: 1000, text: "First-class editing." }],
      }],
    });
    expect(imported).toMatchObject({ segmentCount: 1 });

    const locked = await tools.get("lock_range")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 0,
      clientRequestId: "lock-agent-1",
      range: { startMs: 0, endMs: 1000 },
      label: "Agent lock",
    }) as { branchVersion: number; lock: { lockId: string; createdBy: string } };
    expect(locked).toMatchObject({ branchVersion: 1, lock: { createdBy: "agent" } });

    const unlocked = await tools.get("unlock_range")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 1,
      clientRequestId: "unlock-agent-1",
      lockId: locked.lock.lockId,
    });
    expect(unlocked).toMatchObject({ branchVersion: 2 });

    const commented = await tools.get("add_comment")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 2,
      clientRequestId: "comment-agent-resolve-1",
      range: { startMs: 1000, endMs: 2000 },
      text: "Resolved by the same first-class actor.",
    });
    expect(commented).toMatchObject({ branchVersion: 3 });
    const commentId = useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID].comments[0].commentId;
    const resolved = await tools.get("propose_comment_resolution")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 3,
      clientRequestId: "resolve-agent-1",
      commentId,
      proposal: "Done.",
    });
    expect(resolved).toMatchObject({ branchVersion: 4, summary: "Resolved comment." });
    expect(useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID].comments[0].status).toBe("resolved");

    const exported = await tools.get("export")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 4,
      clientRequestId: "export-agent-1",
      preset: "720p",
    }) as { exportId: string };
    expect(exported).toMatchObject({ mimeType: "video/webm", width: 1280, height: 720 });
    const published = await tools.get("publish")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 4,
      clientRequestId: "publish-agent-1",
      exportId: exported.exportId,
    });
    expect(published).toMatchObject({ summary: "Published local export.", export: { publishedBy: "agent" } });

    const accepted = await tools.get("accept_branch")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 4,
      clientRequestId: "accept-agent-1",
    });
    expect(accepted).toMatchObject({ selectedFinalBranchId: SOURCE_BRANCH_ID });
    expect(useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID].status).toBe("accepted");
  });

  it("lets an agent delete a digest-matched local project", async () => {
    await registerTools();
    const inspected = await tools.get("inspect_project")!.execute({ projectId: "proj_kv_demo_v1" }) as { project: { stateDigest: string } };
    const deleted = await tools.get("delete_project")!.execute({
      projectId: "proj_kv_demo_v1",
      expectedProjectDigest: inspected.project.stateDigest,
      clientRequestId: "delete-agent-1",
    });
    expect(deleted).toMatchObject({ deletedProjectId: "proj_kv_demo_v1", summary: "Deleted the local project and created an empty workspace." });
    expect(useEditorStore.getState().editor.project.projectId).not.toBe("proj_kv_demo_v1");
  });

  it("rejects WebMCP writes after human acceptance", async () => {
    await registerTools();
    const accepted = useEditorStore.getState().dispatch({
      type: "AcceptBranch",
      actor: { type: "human", surface: "ui" },
      payload: { branchId: SOURCE_BRANCH_ID, expectedBranchVersion: 0 },
    });
    expect(accepted.ok).toBe(true);
    const result = await tools.get("set_crop")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      expectedBranchVersion: 0,
      clientRequestId: "crop-1",
      target: { kind: "project" },
      aspectRatio: "9:16",
    });
    expect(result).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("reports viewer previews truthfully and applies comparison ranges", async () => {
    await registerTools();
    const branchInput = {
      projectId: "proj_kv_demo_v1",
      baseBranchId: SOURCE_BRANCH_ID,
      expectedBaseVersion: 0,
      clientRequestId: "branch-preview",
      name: "Preview cut",
    };
    const created = await tools.get("create_cut_branch")!.execute(branchInput) as { branchId: string };
    const source = useEditorStore.getState().editor.branches[SOURCE_BRANCH_ID];
    const preview = await tools.get("preview_range")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: SOURCE_BRANCH_ID,
      stateDigest: digestBranch(source),
      startMs: 0,
      endMs: 5000,
      quality: "proxy",
    }) as Record<string, unknown>;
    expect(preview).toMatchObject({ mode: "shared_viewer", verification: { action: "play_range" } });
    expect(preview).not.toHaveProperty("renderMs");
    const compared = await tools.get("compare_cuts")!.execute({
      projectId: "proj_kv_demo_v1",
      leftBranchId: SOURCE_BRANCH_ID,
      rightBranchId: created.branchId,
      range: { startMs: 1000, endMs: 2000 },
    });
    expect(compared).toMatchObject({ range: { startMs: 1000, endMs: 2000 } });
    expect(useEditorStore.getState().playheadMs).toBe(1000);
  });

  it("exits comparison mode when selecting or previewing a branch", async () => {
    await registerTools();
    const created = await tools.get("create_cut_branch")!.execute({
      projectId: "proj_kv_demo_v1",
      baseBranchId: SOURCE_BRANCH_ID,
      expectedBaseVersion: 0,
      clientRequestId: "branch-selection-regression",
      name: "Selection regression cut",
    }) as { branchId: string };

    await tools.get("compare_cuts")!.execute({
      projectId: "proj_kv_demo_v1",
      leftBranchId: SOURCE_BRANCH_ID,
      rightBranchId: created.branchId,
    });
    expect(useEditorStore.getState().compare.enabled).toBe(true);

    await tools.get("select_branch")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: created.branchId,
    });
    expect(useEditorStore.getState().editor.project.activeBranchId).toBe(created.branchId);
    expect(useEditorStore.getState().compare.enabled).toBe(false);

    await tools.get("compare_cuts")!.execute({
      projectId: "proj_kv_demo_v1",
      leftBranchId: SOURCE_BRANCH_ID,
      rightBranchId: created.branchId,
    });
    const previewed = await tools.get("preview_range")!.execute({
      projectId: "proj_kv_demo_v1",
      branchId: created.branchId,
      stateDigest: digestBranch(useEditorStore.getState().editor.branches[created.branchId]),
      startMs: 0,
      endMs: 1000,
    });
    expect(previewed).toMatchObject({ mode: "shared_viewer" });
    expect(useEditorStore.getState().editor.project.activeBranchId).toBe(created.branchId);
    expect(useEditorStore.getState().compare.enabled).toBe(false);
  });
});
