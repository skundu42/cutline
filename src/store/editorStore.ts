import { create } from "zustand";
import { sha256 } from "js-sha256";
import { applyCommand, createEmptyState, digestBranch, digestProject, kindFromMime, parseTranscriptText, validateImport } from "@/core";
import type { Command, EditorState, Receipt, Result, TimeRange } from "@/core/types";
import { createSeedState } from "@/demo/manifest";
import { renderBranchLocally, type RenderPreset } from "@/media/export";
import { inspectMediaFile } from "@/media/localMedia";
import { clearEditor, getLocalStorageBackend, loadEditor, persistEditor, putMediaBlob, registerLiveAssetUrl } from "@/persistence/db";
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

export interface ImportJob {
  id: string;
  name: string;
  status: "reading" | "storing" | "ready" | "failed" | "cancelled";
  message?: string;
}

export interface StorageHealth {
  usedBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean | null;
  backend: "opfs" | "indexeddb" | null;
}

export interface RenderState {
  status: "idle" | "preparing" | "rendering" | "ready" | "failed" | "cancelled";
  progress: number;
  downloadUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
}

interface EditorStore {
  editor: EditorState;
  ready: boolean;
  readyAt: number | null;
  hydrationError: string | null;
  saveStatus: "saved" | "saving" | "failed";
  storageHealth: StorageHealth;
  importJobs: ImportJob[];
  importsCancelled: boolean;
  playheadMs: number;
  playing: boolean;
  playbackEndMs: number | null;
  selectedRange: TimeRange | null;
  selectedItemId: string | null;
  receipts: Receipt[];
  toolLifecycle: ToolLifecycle[];
  compare: CompareState;
  exportOpen: boolean;
  renderState: RenderState;
  debug: boolean;
  lastError: string | null;
  registeredTools: string[];
  hydrate: () => Promise<void>;
  dispatch: (command: Command) => Result;
  importFile: (file: File) => Promise<Result>;
  importFiles: (files: File[]) => Promise<Result[]>;
  importTranscriptFile: (file: File) => Promise<Result>;
  cancelImports: () => void;
  loadSampleProject: () => Promise<void>;
  refreshStorageHealth: () => Promise<void>;
  requestPersistentStorage: () => Promise<boolean>;
  newProject: () => Promise<void>;
  renameProject: (title: string) => void;
  renderExport: (preset?: RenderPreset) => Promise<void>;
  cancelRender: () => void;
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
  clearError: () => void;
}

const emptyRenderState = (): RenderState => ({
  status: "idle",
  progress: 0,
  downloadUrl: null,
  filename: null,
  mimeType: null,
  bytes: null,
  width: null,
  height: null,
  error: null,
});

let renderController: AbortController | null = null;

function bus() {
  return {
    now: () => Date.now(),
    id: () =>
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `id_${Math.random().toString(16).slice(2)}`,
  };
}

function persist(
  state: EditorState,
  onStatus: (status: "saved" | "saving" | "failed", error?: string) => void,
) {
  onStatus("saving");
  void persistEditor(state)
    .then(() => onStatus("saved"))
    .catch((error: unknown) => onStatus("failed", error instanceof Error ? error.message : "Local save failed"));
}

function revokeRenderUrl(renderState: RenderState) {
  if (renderState.downloadUrl) URL.revokeObjectURL(renderState.downloadUrl);
}

function resetInteractionState() {
  return {
    receipts: [] as Receipt[],
    toolLifecycle: [] as ToolLifecycle[],
    playheadMs: 0,
    playing: false,
    playbackEndMs: null,
    selectedRange: null,
    selectedItemId: null,
    compare: { enabled: false, leftId: null, rightId: null, show: "left" } as CompareState,
    lastError: null,
    exportOpen: false,
    renderState: emptyRenderState(),
    importJobs: [] as ImportJob[],
    importsCancelled: false,
  };
}

function posterFor(file: File): Promise<string | undefined> {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const canvas = document.createElement("canvas");
    let settled = false;
    const finish = (source?: CanvasImageSource, sourceWidth?: number, sourceHeight?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        if (!source || !sourceWidth || !sourceHeight) return resolve(undefined);
        const scale = Math.min(1, 320 / sourceWidth, 180 / sourceHeight);
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.76));
      } catch {
        resolve(undefined);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    const timeout = window.setTimeout(() => finish(), 4_000);
    if (file.type.startsWith("image/")) {
      const image = new Image();
      image.onload = () => finish(image, image.naturalWidth, image.naturalHeight);
      image.onerror = () => finish();
      image.src = url;
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.onloadeddata = () => finish(video, video.videoWidth, video.videoHeight);
    video.onerror = () => finish();
    video.src = url;
  });
}

function safeFilename(title: string) {
  const normalized = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "cutline-export";
}

function initialEditor(saved: EditorState | null, now: number) {
  return saved ?? createEmptyState(now);
}

const emptyStorageHealth = (): StorageHealth => ({ usedBytes: null, quotaBytes: null, persisted: null, backend: null });

export const useEditorStore = create<EditorStore>((set, get) => ({
  editor: createEmptyState(),
  ready: false,
  readyAt: null,
  hydrationError: null,
  saveStatus: "saved",
  storageHealth: emptyStorageHealth(),
  ...resetInteractionState(),
  debug: false,
  registeredTools: [],

  hydrate: async () => {
    const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const startedAt = Date.now();
    try {
      const saved = await Promise.race([
        loadEditor(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Local storage took too long to open")), 8_000)),
      ]);
      const readyAt = Date.now();
      const editor = initialEditor(saved, readyAt);
      set({ editor, ready: true, readyAt, hydrationError: null, debug: params.get("debug") === "1" });
      track({ event: "project_ready", loadMs: readyAt - startedAt, assetCount: editor.assets.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The local project could not be opened";
      const readyAt = Date.now();
      set({
        editor: createEmptyState(readyAt),
        ready: true,
        readyAt,
        hydrationError: message,
        lastError: `LOCAL_STORAGE: ${message}. A temporary empty workspace is open; reset local storage or reload to retry.`,
        debug: params.get("debug") === "1",
      });
    }
    await get().refreshStorageHealth();
  },

  dispatch: (command) => {
    const currentStore = get();
    const result = applyCommand(currentStore.editor, command, bus());
    if (result.ok) {
      const invalidatesRender = command.type !== "RecordExport";
      if (invalidatesRender && renderController) {
        renderController.abort();
        renderController = null;
      }
      if (invalidatesRender) revokeRenderUrl(currentStore.renderState);
      set((store) => ({
        editor: result.state,
        playheadMs: Math.min(store.playheadMs, activeBranch(result.state).durationMs),
        receipts: [result.receipt, ...store.receipts].slice(0, 40),
        lastError: null,
        ...(invalidatesRender ? { renderState: emptyRenderState() } : {}),
      }));
      persist(result.state, (saveStatus, error) => set({
        saveStatus,
        ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}),
      }));
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
          preset: "local-webm",
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
    const jobId = `${file.name}:${file.size}:${file.lastModified}`;
    const updateJob = (status: ImportJob["status"], message?: string) => set((store) => ({
      importJobs: [
        { id: jobId, name: file.name, status, message },
        ...store.importJobs.filter((job) => job.id !== jobId),
      ].slice(0, 8),
    }));
    updateJob("reading");
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
      updateJob("failed", invalid.message);
      return { ok: false, error: invalid };
    }
    try {
      if (get().importsCancelled) throw new DOMException("Import cancelled", "AbortError");
      const checksum = sha256(`${file.name}:${file.size}:${file.lastModified}`);
      if (get().editor.assets.some((asset) => asset.checksum === checksum)) {
        throw new Error(`${file.name} is already in this project`);
      }
      const probe = await inspectMediaFile(file);
      const posterUri = await posterFor(file);
      if (get().importsCancelled) throw new DOMException("Import cancelled", "AbortError");
      updateJob("storing");
      const assetId = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `asset_${Date.now()}`;
      await putMediaBlob(assetId, file);
      const uri = URL.createObjectURL(file);
      registerLiveAssetUrl(assetId, uri);
      const label = file.name.replace(/\.[^.]+$/, "") || file.name;
      const result = get().dispatch({
        type: "ImportAsset",
        actor: { type: "human", surface: "ui" },
        payload: {
          assetId,
          kind: kindFromMime(mime),
          label,
          uri,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          mime,
          bytes: file.size,
          checksum,
          posterUri,
          hasAudio: probe.hasAudio,
          videoCodec: probe.videoCodec,
          audioCodec: probe.audioCodec,
        },
      });
      if (result.ok && result.state.assets.length === 1 && result.state.project.title === "Untitled cut") {
        get().renameProject(label);
      }
      updateJob(result.ok ? "ready" : "failed", result.ok ? "Stored in this browser" : result.error.message);
      await get().refreshStorageHealth();
      return result;
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      const message = error instanceof Error ? error.message : "The media file could not be stored locally";
      const failure: Result = { ok: false, error: { code: "VALIDATION_ERROR", message } };
      updateJob(cancelled ? "cancelled" : "failed", message);
      if (!cancelled) set({ lastError: `VALIDATION_ERROR: ${message}` });
      return failure;
    }
  },

  importFiles: async (files) => {
    set({ importsCancelled: false });
    const results: Result[] = [];
    for (const file of files) {
      if (get().importsCancelled) break;
      results.push(await get().importFile(file));
    }
    return results;
  },

  importTranscriptFile: async (file) => {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Transcript files must be smaller than 5 MB.");
      if (!/\.(srt|vtt)$/i.test(file.name)) throw new Error("Choose an SRT or WebVTT transcript file.");
      const format = file.name.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
      const segments = await parseTranscriptText(await file.text(), format);
      return get().dispatch({
        type: "ImportTranscript",
        actor: { type: "human", surface: "ui" },
        payload: { label: file.name, segments },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The transcript could not be read";
      const failure: Result = { ok: false, error: { code: "VALIDATION_ERROR", message } };
      set({ lastError: `TRANSCRIPT: ${message}` });
      return failure;
    }
  },

  cancelImports: () => set((store) => ({
    importsCancelled: true,
    importJobs: store.importJobs.map((job) => job.status === "reading" || job.status === "storing" ? { ...job, status: "cancelled", message: "Cancelled" } : job),
  })),

  loadSampleProject: async () => {
    renderController?.abort();
    renderController = null;
    revokeRenderUrl(get().renderState);
    await clearEditor();
    const editor = createSeedState(Date.now());
    set({ editor, ready: true, readyAt: Date.now(), hydrationError: null, ...resetInteractionState() });
    persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
    await get().refreshStorageHealth();
  },

  refreshStorageHealth: async () => {
    if (typeof navigator === "undefined" || !navigator.storage) {
      set({ storageHealth: emptyStorageHealth() });
      return;
    }
    try {
      const [estimate, persisted] = await Promise.all([
        navigator.storage.estimate(),
        navigator.storage.persisted?.() ?? Promise.resolve(null),
      ]);
      set({ storageHealth: {
        usedBytes: estimate.usage ?? null,
        quotaBytes: estimate.quota ?? null,
        persisted,
        backend: getLocalStorageBackend(),
      } });
    } catch {
      set({ storageHealth: emptyStorageHealth() });
    }
  },

  requestPersistentStorage: async () => {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    try {
      const persisted = await navigator.storage.persist();
      await get().refreshStorageHealth();
      return persisted;
    } catch {
      return false;
    }
  },

  newProject: async () => {
    renderController?.abort();
    renderController = null;
    revokeRenderUrl(get().renderState);
    await clearEditor();
    const editor = createEmptyState(Date.now());
    set({ editor, ready: true, readyAt: Date.now(), hydrationError: null, ...resetInteractionState() });
    persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
    await get().refreshStorageHealth();
  },

  renameProject: (title) => {
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) return;
    const editor = structuredClone(get().editor);
    editor.project.title = nextTitle;
    set({ editor });
    persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
  },

  renderExport: async (preset = "720p") => {
    const snapshot = get();
    const branch = activeBranch(snapshot.editor);
    if (!branch.durationMs) {
      set({ renderState: { ...emptyRenderState(), status: "failed", error: "Add a clip to the timeline before rendering." } });
      return;
    }
    renderController?.abort();
    revokeRenderUrl(snapshot.renderState);
    const controller = new AbortController();
    renderController = controller;
    const expectedDigest = digestBranch(branch);
    set({ playing: false, renderState: { ...emptyRenderState(), status: "preparing" } });
    try {
      const rendered = await renderBranchLocally({
        editor: snapshot.editor,
        branch,
        preset,
        signal: controller.signal,
        onProgress: (progress) => {
          if (renderController !== controller) return;
          set((store) => ({ renderState: { ...store.renderState, status: "rendering", progress } }));
        },
      });
      if (renderController !== controller || controller.signal.aborted) return;
      const current = get();
      const currentBranch = current.editor.branches[branch.branchId];
      if (!currentBranch || digestBranch(currentBranch) !== expectedDigest) {
        throw new Error("The timeline changed during rendering. Render the current cut again.");
      }
      const downloadUrl = URL.createObjectURL(rendered.blob);
      const filename = `${safeFilename(current.editor.project.title)}-${safeFilename(branch.name)}.webm`;
      const recorded = current.dispatch({
        type: "RecordExport",
        actor: { type: "human", surface: "ui" },
        payload: {
          branchId: branch.branchId,
          expectedBranchVersion: branch.branchVersion,
          uri: `local-render:${expectedDigest}`,
          width: rendered.width,
          height: rendered.height,
          bytes: rendered.blob.size,
        },
      });
      if (!recorded.ok) throw new Error(recorded.error.message);
      set({
        renderState: {
          status: "ready",
          progress: 1,
          downloadUrl,
          filename,
          mimeType: rendered.mimeType,
          bytes: rendered.blob.size,
          width: rendered.width,
          height: rendered.height,
          error: null,
        },
      });
    } catch (error) {
      if (renderController !== controller) return;
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      set({
        renderState: {
          ...emptyRenderState(),
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? null : error instanceof Error ? error.message : "Local rendering failed",
        },
      });
    } finally {
      if (renderController === controller) renderController = null;
    }
  },

  cancelRender: () => {
    renderController?.abort();
    renderController = null;
    set({ renderState: { ...emptyRenderState(), status: "cancelled" } });
  },

  setPlayhead: (ms) => set((store) => ({ playheadMs: Math.min(activeBranch(store.editor).durationMs, Math.max(0, ms)) })),
  setPlaying: (playing) => set({ playing }),
  setPlaybackEndMs: (playbackEndMs) => set({ playbackEndMs }),
  setSelectedRange: (selectedRange) => set({ selectedRange }),
  setSelectedItemId: (selectedItemId) => set({ selectedItemId }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setDebug: (debug) => set({ debug }),
  setCompare: (compare) => set((store) => ({ compare: { ...store.compare, ...compare } })),
  setRegisteredTools: (registeredTools) => set({ registeredTools }),
  recordTool: (entry) =>
    set((store) => ({ toolLifecycle: [entry, ...store.toolLifecycle.filter((item) => item.id !== entry.id)].slice(0, 20) })),
  clearError: () => set({ lastError: null }),
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
