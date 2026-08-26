import { create } from "zustand";
import { applyCommand, digestBranch, digestProject, kindFromMime, validateImport } from "@/core";
import type { Command, EditorState, Receipt, Result, TimeRange } from "@/core/types";
import { createSeedState, SOURCE_BRANCH_ID, WINNING_PROMPT } from "@/demo/manifest";
import { GOLDEN_BRANCH_A_NAME, GOLDEN_BRANCH_B_NAME, GOLDEN_CUT_OPS, GOLDEN_POLISH_OPS_AFTER_CUTS } from "@/demo/goldenRecipe";
import { clearEditor, loadEditor, persistEditor, putMediaBlob } from "@/persistence/db";
import { track } from "@/telemetry";

export interface ToolLifecycle {
  id: string;
  toolName: string;
  phase: "queued" | "running" | "succeeded" | "failed";
  summary?: string;
  at: number;
}

interface CompareState {
  enabled: boolean;
  leftId: string | null;
  rightId: string | null;
  show: "left" | "right";
}

interface EditorStore {
  editor: EditorState;
  ready: boolean;
  readyAt: number | null;
  playheadMs: number;
  playing: boolean;
  playbackEndMs: number | null;
  selectedRange: TimeRange | null;
  selectedItemId: string | null;
  receipts: Receipt[];
  toolLifecycle: ToolLifecycle[];
  compare: CompareState;
  exportOpen: boolean;
  debug: boolean;
  lastError: string | null;
  registeredTools: string[];
  hydrate: () => Promise<void>;
  dispatch: (command: Command) => Result;
  importFile: (file: File) => Promise<Result>;
  resetDemo: () => Promise<void>;
  setPlayhead: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setPlaybackEndMs: (endMs: number | null) => void;
  setSelectedRange: (range: TimeRange | null) => void;
  setSelectedItemId: (itemId: string | null) => void;
  setExportOpen: (open: boolean) => void;
  setDebug: (debug: boolean) => void;
  setCompare: (compare: Partial<CompareState>) => void;
  setRegisteredTools: (names: string[]) => void;
  recordTool: (entry: ToolLifecycle) => void;
  replayGoldenRun: () => Result;
  replayRevision: () => Result;
}

function bus() {
  return {
    now: () => Date.now(),
    id: () =>
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `id_${Math.random().toString(16).slice(2)}`,
  };
}

function persist(state: EditorState) {
  void persistEditor(state);
}

function probeMedia(file: File): Promise<{ durationMs: number; width?: number; height?: number }> {
  if (file.type.startsWith("image/")) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        resolve({ durationMs: 5000, width: image.naturalWidth, height: image.naturalHeight });
        URL.revokeObjectURL(url);
      };
      image.onerror = () => {
        resolve({ durationMs: 5000 });
        URL.revokeObjectURL(url);
      };
      image.src = url;
    });
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      resolve({
        durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 1000,
        width: "videoWidth" in el ? el.videoWidth : undefined,
        height: "videoHeight" in el ? el.videoHeight : undefined,
      });
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      resolve({ durationMs: 1000 });
      URL.revokeObjectURL(url);
    };
    el.src = url;
  });
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  editor: createSeedState(),
  ready: false,
  readyAt: null,
  playheadMs: 0,
  playing: false,
  playbackEndMs: null,
  selectedRange: null,
  selectedItemId: null,
  receipts: [],
  toolLifecycle: [],
  compare: { enabled: false, leftId: null, rightId: null, show: "left" },
  exportOpen: false,
  debug: false,
  lastError: null,
  registeredTools: [],

  hydrate: async () => {
    const saved = await loadEditor();
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const readyAt = Date.now();
    set({
      editor: saved ?? createSeedState(),
      ready: true,
      readyAt,
      debug: params.get("debug") === "1",
    });
  },

  dispatch: (command) => {
    const result = applyCommand(get().editor, command, bus());
    if (result.ok) {
      set((store) => ({
        editor: result.state,
        playheadMs: Math.min(store.playheadMs, activeBranch(result.state).durationMs),
        receipts: [result.receipt, ...store.receipts].slice(0, 40),
        lastError: null,
      }));
      persist(result.state);
      track({
        event: "command_committed",
        actorType: command.actor.type,
        commandType: command.type,
        branchVersion: result.receipt.branchVersion,
        durationDeltaMs: result.receipt.durationDeltaMs,
      });
      if (command.type === "AcceptBranch") track({ event: "human_decision", action: "accept" });
      if (command.type === "Undo") track({ event: "human_decision", action: "undo" });
      if (command.type === "Redo") track({ event: "human_decision", action: "redo" });
      if (command.type === "RecordExport") {
        track({
          event: "export_completed",
          preset: "720p",
          durationMs: result.receipt.durationMs ?? 0,
          digestPrefix: result.receipt.stateDigest.slice(0, 18),
        });
      }
    } else {
      set({ lastError: `${result.error.code}: ${result.error.message}` });
    }
    return result;
  },

  importFile: async (file) => {
    const mime = file.type || "application/octet-stream";
    const invalid = validateImport({
      label: file.name,
      uri: "blob:local",
      mime,
      bytes: file.size,
      durationMs: 1,
    });
    if (invalid) {
      set({ lastError: `${invalid.code}: ${invalid.message}` });
      return { ok: false, error: invalid };
    }
    const probe = await probeMedia(file);
    const assetId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `asset_${Date.now()}`;
    await putMediaBlob(assetId, file);
    const uri = URL.createObjectURL(file);
    return get().dispatch({
      type: "ImportAsset",
      actor: { type: "human", surface: "ui" },
      payload: {
        assetId,
        kind: kindFromMime(mime),
        label: file.name.replace(/\.[^.]+$/, "") || file.name,
        uri,
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        mime,
        bytes: file.size,
        checksum: `import-${assetId}`,
      },
    });
  },

  resetDemo: async () => {
    await clearEditor();
    const editor = createSeedState(Date.now());
    set({
      editor,
      ready: true,
      readyAt: Date.now(),
      receipts: [],
      toolLifecycle: [],
      playheadMs: 0,
      playing: false,
      playbackEndMs: null,
      selectedRange: null,
      selectedItemId: null,
      compare: { enabled: false, leftId: null, rightId: null, show: "left" },
      lastError: null,
      exportOpen: false,
    });
    persist(editor);
  },

  setPlayhead: (ms) => set((store) => ({ playheadMs: Math.min(activeBranch(store.editor).durationMs, Math.max(0, ms)) })),
  setPlaying: (playing) => set({ playing }),
  setPlaybackEndMs: (playbackEndMs) => set({ playbackEndMs }),
  setSelectedRange: (range) => set({ selectedRange: range }),
  setSelectedItemId: (itemId) => set({ selectedItemId: itemId }),
  setExportOpen: (open) => set({ exportOpen: open }),
  setDebug: (debug) => set({ debug }),
  setCompare: (compare) => set((store) => ({ compare: { ...store.compare, ...compare } })),
  setRegisteredTools: (names) => set({ registeredTools: names }),
  recordTool: (entry) =>
    set((store) => ({ toolLifecycle: [entry, ...store.toolLifecycle.filter((item) => item.id !== entry.id)].slice(0, 20) })),

  replayGoldenRun: () => {
    const { dispatch, editor } = get();
    const created = dispatch({
      type: "CreateBranch",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        baseBranchId: editor.project.activeBranchId,
        expectedBaseVersion: editor.branches[editor.project.activeBranchId].branchVersion,
        name: GOLDEN_BRANCH_A_NAME,
        purpose: WINNING_PROMPT.slice(0, 240),
      },
    });
    if (!created.ok) return created;
    const branch = Object.values(created.state.branches).find((item) => item.name === GOLDEN_BRANCH_A_NAME)!;
    const cut = dispatch({
      type: "ApplyEditBatch",
      actor: { type: "agent", surface: "webmcp" },
      payload: { branchId: branch.branchId, expectedBranchVersion: 0, operations: GOLDEN_CUT_OPS },
    });
    if (!cut.ok) return cut;
    const polished = dispatch({
      type: "SetCrop",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        branchId: branch.branchId,
        expectedBranchVersion: cut.state.branches[branch.branchId].branchVersion,
        target: { kind: "project" },
        aspectRatio: "9:16",
        anchor: "face",
      },
    });
    if (!polished.ok) return polished;
    const broll = dispatch({
      type: "PlaceBroll",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        branchId: branch.branchId,
        expectedBranchVersion: polished.state.branches[branch.branchId].branchVersion,
        assetId: "gpu_rack",
        trackId: "v2",
        range: GOLDEN_POLISH_OPS_AFTER_CUTS.broll,
        fit: "cover",
        anchor: "safe_region",
        transitionIn: "cut",
        transitionOut: "cut",
      },
    });
    if (!broll.ok) return broll;
    const diagram = dispatch({
      type: "PlaceBroll",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        branchId: branch.branchId,
        expectedBranchVersion: broll.state.branches[branch.branchId].branchVersion,
        assetId: "cache_diagram",
        trackId: "v2",
        range: GOLDEN_POLISH_OPS_AFTER_CUTS.diagram,
        fit: "contain",
        anchor: "center",
        transitionIn: "cut",
        transitionOut: "cut",
      },
    });
    if (!diagram.ok) return diagram;
    return dispatch({
      type: "StyleCaptions",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        branchId: branch.branchId,
        expectedBranchVersion: diagram.state.branches[branch.branchId].branchVersion,
        source: "transcript",
        preset: "bold_center",
        emphasis: "none",
        maxLines: 2,
        maxCharsPerLine: 42,
      },
    });
  },

  replayRevision: () => {
    const { dispatch, editor } = get();
    const active = editor.branches[editor.project.activeBranchId];
    const created = dispatch({
      type: "CreateBranch",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        baseBranchId: active.branchId,
        expectedBaseVersion: active.branchVersion,
        name: GOLDEN_BRANCH_B_NAME,
        purpose: "Opening more technical; honor locks",
      },
    });
    if (!created.ok) return created;
    const branch = Object.values(created.state.branches).find((item) => item.name === GOLDEN_BRANCH_B_NAME)!;
    const result = dispatch({
      type: "ApplyEditBatch",
      actor: { type: "agent", surface: "webmcp" },
      payload: {
        branchId: branch.branchId,
        expectedBranchVersion: 0,
        operations: [
          {
            op: "replace_range",
            trackId: "v1",
            range: { startMs: 0, endMs: 6400 },
            assetId: "take_2",
            source: { inMs: 0, endMs: 6400 },
            transition: "cut",
            required: false,
          },
          {
            op: "ripple_delete",
            range: { startMs: 18000, endMs: 19200 },
            required: false,
          },
        ],
      },
    });
    set({
      compare: {
        enabled: true,
        leftId: active.branchId,
        rightId: branch.branchId,
        show: "right",
      },
    });
    return result;
  },
}));

export function activeBranch(state: EditorState) {
  return state.branches[state.project.activeBranchId];
}

export function projectDigest(state: EditorState) {
  return digestProject(state);
}

export function branchDigest(state: EditorState, branchId = state.project.activeBranchId) {
  return digestBranch(state.branches[branchId]);
}

export { SOURCE_BRANCH_ID };
