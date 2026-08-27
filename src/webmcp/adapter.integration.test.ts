/** @vitest-environment jsdom */

import type { ModelContext, WebMcpToolAnnotations } from "@mcp-b/webmcp-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/persistence/db", () => ({
  clearEditor: vi.fn(async () => undefined),
  loadEditor: vi.fn(async () => null),
  persistEditor: vi.fn(async () => undefined),
  putMediaBlob: vi.fn(async () => undefined),
  registerLiveAssetUrl: vi.fn(),
  getLocalStorageBackend: vi.fn(() => "indexeddb"),
}));
vi.mock("@/telemetry", () => ({ track: vi.fn() }));

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
});
