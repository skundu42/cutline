import { create } from "zustand";
import { sha256 } from "js-sha256";
import { applyCommand, createEmptyState, digestBranch, digestProject, kindFromMime, parseTranscriptText, validateImport } from "@/core";
import type { Actor, Command, EditorState, Receipt, Result, TimeRange } from "@/core/types";
import { createSeedState } from "@/demo/manifest";
import { renderBranchLocally, type RenderFormat, type RenderPreset } from "@/media/export";
import { inspectMediaFile } from "@/media/localMedia";
import {
  cleanupOrphanedMedia,
  createProjectBundle,
  deleteMediaBlob,
  deleteProject,
  getLocalStorageBackend,
  getMediaBlob,
  importProjectBundle,
  listProjects,
  loadEditor,
  persistEditor,
  putMediaBlob,
  registerLiveAssetUrl,
  type ProjectSummary,
} from "@/persistence/db";
import { track } from "@/telemetry";
import { createPreviewProxy } from "@/media/proxy";

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
  format: RenderFormat | null;
  mode: "accelerated" | "realtime" | null;
}

interface EditorStore {
  monitorMode: "source" | "timeline";
  sourceAssetId: string | null;
  selectSource: (assetId: string) => void;
  setMonitorMode: (mode: "source" | "timeline") => void;
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
  selectedItemIds: string[];
  receipts: Receipt[];
  toolLifecycle: ToolLifecycle[];
  compare: CompareState;
  exportOpen: boolean;
  renderState: RenderState;
  debug: boolean;
  lastError: string | null;
  registeredTools: string[];
  projects: ProjectSummary[];
  hydrate: () => Promise<void>;
  dispatch: (command: Command) => Result;
  importFile: (file: File) => Promise<Result>;
  importFiles: (files: File[]) => Promise<Result[]>;
  importTranscriptFile: (file: File) => Promise<Result>;
  cancelImports: () => void;
  loadSampleProject: () => Promise<void>;
  refreshStorageHealth: () => Promise<void>;
  setAgentMutationPolicy: (policy: "direct" | "plan_only") => void;
  newProject: () => Promise<void>;
  deleteCurrentProject: () => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  importProjectFile: (file: File) => Promise<void>;
  exportProjectFile: () => Promise<{ blob: Blob; filename: string }>;
  relinkAsset: (assetId: string, file: File) => Promise<boolean>;
  generateProxy: (assetId: string) => Promise<boolean>;
  renameProject: (title: string) => void;
  renderExport: (preset?: RenderPreset, actor?: Actor, branchId?: string, format?: RenderFormat) => Promise<RenderState>;
  cancelRender: () => void;
  setPlayhead: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setPlaybackEndMs: (endMs: number | null) => void;
  setSelectedRange: (range: TimeRange | null) => void;
  setSelectedItemId: (itemId: string | null) => void;
  setSelectedItemIds: (itemIds: string[]) => void;
  setExportOpen: (open: boolean) => void;
  setDebug: (debug: boolean) => void;
  setCompare: (compare: Partial<CompareState>, actor?: Actor) => void;
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
  format: null,
  mode: null,
});

let renderController: AbortController | null = null;
let saveSequence = 0;
let saveChain: Promise<void> = Promise.resolve();
const proxyControllers = new Map<string, AbortController>();

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
  const sequence = ++saveSequence;
  onStatus("saving");
  saveChain = saveChain.catch(() => undefined).then(() => persistEditor(state));
  void saveChain
    .then(() => { if (sequence === saveSequence) onStatus("saved"); })
    .catch((error: unknown) => { if (sequence === saveSequence) onStatus("failed", error instanceof Error ? error.message : "Local save failed"); });
}

async function flushPersistence() {
  await saveChain.catch(() => undefined);
}

async function contentChecksum(file: File, isCancelled: () => boolean) {
  const hasher = sha256.create();
  const reader = file.stream().getReader();
  try {
    while (true) {
      if (isCancelled()) throw new DOMException("Import cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
    return hasher.hex();
  } finally {
    reader.releaseLock();
  }
}

async function waveformFor(file: File) {
  if (!file.type.startsWith("audio/") || file.size > 50 * 1024 * 1024 || typeof AudioContext === "undefined") return undefined;
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const count = 72;
    const peaks = Array.from({ length: count }, () => 0);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      const block = Math.max(1, Math.floor(data.length / count));
      for (let index = 0; index < count; index += 1) {
        let peak = 0;
        const end = Math.min(data.length, (index + 1) * block);
        for (let sample = index * block; sample < end; sample += Math.max(1, Math.floor(block / 64))) peak = Math.max(peak, Math.abs(data[sample]));
        peaks[index] = Math.max(peaks[index], peak);
      }
    }
    const max = Math.max(...peaks, 0.001);
    return peaks.map((peak) => Math.round(peak / max * 100) / 100);
  } catch {
    return undefined;
  } finally {
    await context.close().catch(() => undefined);
  }
}

function revokeRenderUrl(renderState: RenderState) {
  if (renderState.downloadUrl) URL.revokeObjectURL(renderState.downloadUrl);
}

function resetInteractionState() {
  return {
    monitorMode: "timeline" as const,
    sourceAssetId: null,
    receipts: [] as Receipt[],
    toolLifecycle: [] as ToolLifecycle[],
    playheadMs: 0,
    playing: false,
    playbackEndMs: null,
    selectedRange: null,
    selectedItemId: null,
    selectedItemIds: [] as string[],
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

const emptyStorageHealth = (): StorageHealth => ({ usedBytes: null, quotaBytes: null, backend: null });

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
  projects: [],

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
      set({ editor, ready: true, readyAt, hydrationError: null, debug: params.get("debug") === "1", projects: await listProjects() });
      await cleanupOrphanedMedia();
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
        ...(command.type === "SelectActiveBranch" || command.type === "CreateBranch"
          ? { compare: { ...store.compare, enabled: false }, monitorMode: "timeline" as const,
            selectedRange: null, selectedItemId: null, selectedItemIds: [], playing: false, playbackEndMs: null }
          : {}),
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
      if (command.type === "AcceptBranch") track({ event: "decision", actorType: command.actor.type, action: "accept" });
      if (command.type === "Undo") track({ event: "decision", actorType: command.actor.type, action: "undo" });
      if (command.type === "Redo") track({ event: "decision", actorType: command.actor.type, action: "redo" });
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
      const checksum = await contentChecksum(file, () => get().importsCancelled);
      if (get().editor.assets.some((asset) => asset.checksum === checksum)) {
        throw new Error(`${file.name} is already in this project`);
      }
      const [probe, posterUri, waveformPeaks] = await Promise.all([inspectMediaFile(file), posterFor(file), waveformFor(file)]);
      if (get().importsCancelled) throw new DOMException("Import cancelled", "AbortError");
      updateJob("storing");
      const assetId = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `asset_${Date.now()}`;
      await putMediaBlob(assetId, file, get().editor.project.projectId);
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
          checksumAlgorithm: "sha256-content",
          posterUri,
          hasAudio: probe.hasAudio,
          videoCodec: probe.videoCodec,
          audioCodec: probe.audioCodec,
          waveformPeaks,
          proxyStatus: kindFromMime(mime) === "video" && (file.size > 100 * 1024 * 1024 || (probe.width ?? 0) > 1920 || (probe.height ?? 0) > 1080) ? "recommended" : undefined,
        },
      });
      if (result.ok && result.state.assets.length === 1 && result.state.project.title === "Untitled cut") {
        get().renameProject(label);
      }
      if (!result.ok) {
        URL.revokeObjectURL(uri);
        await deleteMediaBlob(assetId);
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

  cancelImports: () => {
    for (const controller of proxyControllers.values()) controller.abort();
    proxyControllers.clear();
    set((store) => ({
      importsCancelled: true,
      importJobs: store.importJobs.map((job) => job.status === "reading" || job.status === "storing" ? { ...job, status: "cancelled", message: "Cancelled" } : job),
    }));
  },

  loadSampleProject: async () => {
    for (const controller of proxyControllers.values()) controller.abort();
    proxyControllers.clear();
    renderController?.abort();
    renderController = null;
    revokeRenderUrl(get().renderState);
    await flushPersistence();
    const editor = createSeedState(Date.now());
    set({ editor, ready: true, readyAt: Date.now(), hydrationError: null, ...resetInteractionState() });
    persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
    await flushPersistence();
    set({ projects: await listProjects() });
    await get().refreshStorageHealth();
  },

  refreshStorageHealth: async () => {
    if (typeof navigator === "undefined" || !navigator.storage) {
      set({ storageHealth: emptyStorageHealth() });
      return;
    }
    try {
      const estimate = await navigator.storage.estimate();
      set({ storageHealth: {
        usedBytes: estimate.usage ?? null,
        quotaBytes: estimate.quota ?? null,
        backend: getLocalStorageBackend(),
      } });
    } catch {
      set({ storageHealth: emptyStorageHealth() });
    }
  },

  setAgentMutationPolicy: (policy) => {
    get().dispatch({ type: "SetAgentPolicy", actor: { type: "human", surface: "ui" }, payload: { policy } });
  },

  newProject: async () => {
    for (const controller of proxyControllers.values()) controller.abort();
    proxyControllers.clear();
    renderController?.abort();
    renderController = null;
    revokeRenderUrl(get().renderState);
    await flushPersistence();
    const editor = createEmptyState(Date.now());
    set({ editor, ready: true, readyAt: Date.now(), hydrationError: null, ...resetInteractionState() });
    persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
    await flushPersistence();
    set({ projects: await listProjects() });
    await get().refreshStorageHealth();
  },

  deleteCurrentProject: async () => {
    for (const controller of proxyControllers.values()) controller.abort();
    proxyControllers.clear();
    renderController?.abort();
    renderController = null;
    revokeRenderUrl(get().renderState);
    await flushPersistence();
    await deleteProject(get().editor.project.projectId);
    const remaining = await listProjects();
    const saved = remaining[0] ? await loadEditor(remaining[0].projectId) : null;
    const editor = saved ?? createEmptyState(Date.now());
    set({ editor, ready: true, readyAt: Date.now(), hydrationError: null, ...resetInteractionState() });
    if (!saved) {
      persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
      await flushPersistence();
    }
    set({ projects: await listProjects() });
    await get().refreshStorageHealth();
  },

  switchProject: async (projectId) => {
    if (projectId === get().editor.project.projectId) return;
    for (const controller of proxyControllers.values()) controller.abort();
    proxyControllers.clear();
    renderController?.abort();
    renderController = null;
    revokeRenderUrl(get().renderState);
    await flushPersistence();
    const editor = await loadEditor(projectId);
    if (!editor) {
      set({ lastError: "LOCAL_STORAGE: The selected project could not be opened." });
      return;
    }
    set({ editor, ready: true, readyAt: Date.now(), hydrationError: null, projects: await listProjects(), ...resetInteractionState() });
  },

  importProjectFile: async (file) => {
    try {
      for (const controller of proxyControllers.values()) controller.abort();
      proxyControllers.clear();
      renderController?.abort();
      renderController = null;
      revokeRenderUrl(get().renderState);
      await flushPersistence();
      const editor = await importProjectBundle(file);
      set({ editor, ready: true, readyAt: Date.now(), hydrationError: null, projects: await listProjects(), ...resetInteractionState() });
      await get().refreshStorageHealth();
    } catch (error) {
      set({ lastError: `PROJECT_IMPORT: ${error instanceof Error ? error.message : "The project could not be imported"}` });
    }
  },

  exportProjectFile: async () => {
    await flushPersistence();
    return {
      blob: await createProjectBundle(get().editor),
      filename: `${safeFilename(get().editor.project.title)}.cutline`,
    };
  },

  relinkAsset: async (assetId, file) => {
    const state = get().editor;
    const asset = state.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset) return false;
    try {
      const checksum = await contentChecksum(file, () => false);
      if (asset.checksumAlgorithm === "sha256-content" && asset.checksum && checksum !== asset.checksum) {
        throw new Error("This file does not match the original media. Choose the original file used by this project.");
      }
      await putMediaBlob(assetId, file, state.project.projectId);
      const uri = URL.createObjectURL(file);
      registerLiveAssetUrl(assetId, uri);
      const editor = structuredClone(state);
      const repaired = editor.assets.find((candidate) => candidate.assetId === assetId)!;
      repaired.uri = uri;
      repaired.mime = file.type || repaired.mime;
      repaired.bytes = file.size;
      repaired.checksum = checksum;
      repaired.checksumAlgorithm = "sha256-content";
      repaired.availability = "ready";
      if (repaired.proxyAssetId) await deleteMediaBlob(repaired.proxyAssetId);
      repaired.proxyAssetId = undefined;
      repaired.proxyUri = undefined;
      repaired.proxyBytes = undefined;
      repaired.proxyStatus = repaired.kind === "video" ? "recommended" : undefined;
      set({ editor, lastError: null });
      persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
      return true;
    } catch (error) {
      set({ lastError: `MEDIA_RELINK: ${error instanceof Error ? error.message : "The media could not be relinked"}` });
      return false;
    }
  },

  generateProxy: async (assetId) => {
    const state = get().editor;
    const asset = state.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset || asset.kind !== "video") return false;
    const source = await getMediaBlob(assetId);
    if (!source) {
      set({ lastError: "PROXY: Relink the original media before generating a proxy." });
      return false;
    }
    proxyControllers.get(assetId)?.abort();
    const controller = new AbortController();
    proxyControllers.set(assetId, controller);
    const jobId = `proxy:${assetId}`;
    const update = (status: ImportJob["status"], message: string) => set((store) => ({ importJobs: [{ id: jobId, name: `${asset.label} proxy`, status, message }, ...store.importJobs.filter((job) => job.id !== jobId)].slice(0, 8) }));
    update("reading", "Generating 480p preview proxy");
    try {
      const blob = await createPreviewProxy(source, controller.signal, (progress) => update("reading", `Generating proxy · ${Math.round(progress * 100)}%`));
      const proxyAssetId = asset.proxyAssetId ?? `${assetId}__proxy`;
      await putMediaBlob(proxyAssetId, blob, state.project.projectId);
      const proxyUri = URL.createObjectURL(blob);
      registerLiveAssetUrl(proxyAssetId, proxyUri);
      const editor = structuredClone(get().editor);
      const updated = editor.assets.find((candidate) => candidate.assetId === assetId);
      if (!updated) throw new Error("The source asset was removed while its proxy was being generated.");
      updated.proxyAssetId = proxyAssetId;
      updated.proxyUri = proxyUri;
      updated.proxyBytes = blob.size;
      updated.proxyStatus = "ready";
      set({ editor, lastError: null });
      persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
      update("ready", "480p preview proxy ready");
      return true;
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      update(cancelled ? "cancelled" : "failed", cancelled ? "Proxy cancelled" : error instanceof Error ? error.message : "Proxy generation failed");
      if (!cancelled) set({ lastError: `PROXY: ${error instanceof Error ? error.message : "Proxy generation failed"}` });
      return false;
    } finally {
      if (proxyControllers.get(assetId) === controller) proxyControllers.delete(assetId);
    }
  },

  renameProject: (title) => {
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) return;
    const editor = structuredClone(get().editor);
    editor.project.title = nextTitle;
    set({ editor });
    persist(editor, (saveStatus, error) => set({ saveStatus, ...(error ? { lastError: `LOCAL_SAVE: ${error}` } : {}) }));
    void flushPersistence().then(async () => set({ projects: await listProjects() }));
  },

  renderExport: async (preset = "720p", actor = { type: "human", surface: "ui" }, branchId, format = "webm") => {
    const snapshot = get();
    const branch = branchId ? snapshot.editor.branches[branchId] : activeBranch(snapshot.editor);
    if (!branch) {
      const failed = { ...emptyRenderState(), status: "failed" as const, error: "Unknown branch." };
      set({ renderState: failed });
      return failed;
    }
    if (!branch.durationMs) {
      const failed = { ...emptyRenderState(), status: "failed" as const, error: "Add a clip to the timeline before rendering." };
      set({ renderState: failed });
      return failed;
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
        format,
        signal: controller.signal,
        onProgress: (progress) => {
          if (renderController !== controller) return;
          set((store) => ({ renderState: { ...store.renderState, status: "rendering", progress } }));
        },
      });
      if (renderController !== controller || controller.signal.aborted) return get().renderState;
      const current = get();
      const currentBranch = current.editor.branches[branch.branchId];
      if (!currentBranch || digestBranch(currentBranch) !== expectedDigest) {
        throw new Error("The timeline changed during rendering. Render the current cut again.");
      }
      const downloadUrl = URL.createObjectURL(rendered.blob);
      const filename = `${safeFilename(current.editor.project.title)}-${safeFilename(branch.name)}.${rendered.extension}`;
      const recorded = current.dispatch({
        type: "RecordExport",
        actor,
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
          format: rendered.extension,
          mode: rendered.mode,
        },
      });
      return get().renderState;
    } catch (error) {
      if (renderController !== controller) return get().renderState;
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      set({
        renderState: {
          ...emptyRenderState(),
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? null : error instanceof Error ? error.message : "Local rendering failed",
        },
      });
      return get().renderState;
    } finally {
      if (renderController === controller) renderController = null;
    }
  },

  cancelRender: () => {
    renderController?.abort();
    renderController = null;
    set({ renderState: { ...emptyRenderState(), status: "cancelled" } });
  },

  selectSource: (assetId) => {
    if (!get().editor.assets.some((asset) => asset.assetId === assetId)) return;
    set({ sourceAssetId: assetId, monitorMode: "source", playing: false, playbackEndMs: null });
  },
  setMonitorMode: (monitorMode) => set({ monitorMode, playing: false, playbackEndMs: null }),
  setPlayhead: (ms) => set((store) => ({ monitorMode: "timeline", playheadMs: Math.min(activeBranch(store.editor).durationMs, Math.max(0, ms)) })),
  setPlaying: (playing) => set({ playing, monitorMode: "timeline" }),
  setPlaybackEndMs: (playbackEndMs) => set({ playbackEndMs }),
  setSelectedRange: (selectedRange) => set({ selectedRange }),
  setSelectedItemId: (selectedItemId) => set((store) => ({ selectedItemId, selectedItemIds: selectedItemId == null ? [] : store.selectedItemIds.includes(selectedItemId) ? store.selectedItemIds : [selectedItemId] })),
  setSelectedItemIds: (selectedItemIds) => set({ selectedItemIds, selectedItemId: selectedItemIds[0] ?? null }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setDebug: (debug) => set({ debug }),
  setCompare: (compare, actor = { type: "human", surface: "ui" }) => {
    const current = get();
    const next = { ...current.compare, ...compare };
    const shownId = next.show === "right" ? next.rightId : next.leftId;
    if (next.enabled) {
      if (!next.leftId || !next.rightId || !current.editor.branches[next.leftId] || !current.editor.branches[next.rightId] || next.leftId === next.rightId) return;
      if (shownId !== current.editor.project.activeBranchId) {
        const result = current.dispatch({ type: "SelectActiveBranch", actor, payload: { branchId: shownId! } });
        if (!result.ok) return;
      }
    }
    set({ compare: next, monitorMode: "timeline", playing: false, playbackEndMs: null, selectedRange: null, selectedItemId: null, selectedItemIds: [] });
  },
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
