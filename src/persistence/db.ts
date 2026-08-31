import Dexie, { type EntityTable } from "dexie";
import { ensureStandardTracks } from "@/core/import";
import { SCHEMA_VERSION } from "@/core/project";
import type { EditorState } from "@/core/types";

interface StateRow {
  id: "current";
  state: EditorState;
  savedAt: number;
}

interface BlobRow {
  assetId: string;
  blob?: Blob;
  mime: string;
  storage?: "idb" | "opfs";
  projectId?: string;
}

interface ProjectRow {
  projectId: string;
  state: EditorState;
  title: string;
  createdAt: number;
  savedAt: number;
  lastOpenedAt: number;
}

interface PreferenceRow {
  key: string;
  value: string;
}

export interface ProjectSummary {
  projectId: string;
  title: string;
  createdAt: number;
  savedAt: number;
  lastOpenedAt: number;
  assetCount: number;
}

class CutlineDB extends Dexie {
  snapshots!: EntityTable<StateRow, "id">;
  blobs!: EntityTable<BlobRow, "assetId">;
  projects!: EntityTable<ProjectRow, "projectId">;
  preferences!: EntityTable<PreferenceRow, "key">;

  constructor() {
    super("cutline");
    this.version(1).stores({
      snapshots: "id",
    });
    this.version(2).stores({
      snapshots: "id",
      blobs: "assetId",
    });
    this.version(3).stores({
      snapshots: "id",
      blobs: "assetId, projectId",
      projects: "projectId, lastOpenedAt, savedAt",
      preferences: "key",
    });
  }
}

const db = typeof indexedDB === "undefined" ? null : new CutlineDB();
const liveUrls = new Map<string, string>();

function migrateState(state: EditorState): EditorState {
  const fromVersion = state.project.schemaVersion ?? 1;
  if (fromVersion > SCHEMA_VERSION) throw new Error(`This project uses schema ${fromVersion}; this version of Cutline supports up to ${SCHEMA_VERSION}.`);
  for (const branch of Object.values(state.branches)) {
    ensureStandardTracks(branch);
  }
  if (fromVersion < 3) {
    state.project.agentMutationPolicy = "direct";
    for (const asset of state.assets) {
      if (asset.imported && !asset.checksumAlgorithm) asset.checksumAlgorithm = "sha256-metadata";
    }
  }
  state.project.schemaVersion = SCHEMA_VERSION;
  return state;
}

function rewriteImportedUris(state: EditorState): EditorState {
  const copy = structuredClone(state);
  for (const asset of copy.assets) {
    if (asset.uri.startsWith("blob:")) {
      asset.uri = `local:${asset.assetId}`;
    }
    if (asset.proxyUri?.startsWith("blob:") && asset.proxyAssetId) asset.proxyUri = `local-proxy:${asset.proxyAssetId}`;
  }
  return copy;
}

function opfsFilename(assetId: string) {
  return encodeURIComponent(assetId);
}

async function getMediaDirectory(create: boolean) {
  if (typeof navigator === "undefined" || typeof navigator.storage?.getDirectory !== "function") return null;
  const root = await navigator.storage.getDirectory();
  try {
    return await root.getDirectoryHandle("cutline-media", { create });
  } catch (error) {
    if (!create && error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}

async function putOpfsBlob(assetId: string, blob: Blob) {
  const directory = await getMediaDirectory(true);
  if (!directory) return false;
  const handle = await directory.getFileHandle(opfsFilename(assetId), { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return true;
}

async function getOpfsBlob(assetId: string) {
  const directory = await getMediaDirectory(false);
  if (!directory) return null;
  try {
    return await (await directory.getFileHandle(opfsFilename(assetId))).getFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}

async function deleteOpfsBlob(assetId: string) {
  const directory = await getMediaDirectory(false);
  if (!directory) return;
  try {
    await directory.removeEntry(opfsFilename(assetId));
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
}

export function getLocalStorageBackend() {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function"
    ? "opfs"
    : "indexeddb";
}

export async function putMediaBlob(assetId: string, blob: Blob, projectId?: string): Promise<void> {
  if (!db) return;
  try {
    if (await putOpfsBlob(assetId, blob)) {
      await db.blobs.put({ assetId, mime: blob.type, storage: "opfs", projectId });
      return;
    }
  } catch {
    await deleteOpfsBlob(assetId).catch(() => undefined);
  }
  await db.blobs.put({ assetId, blob, mime: blob.type, storage: "idb", projectId });
}

export async function deleteMediaBlob(assetId: string): Promise<void> {
  if (!db) return;
  const row = await db.blobs.get(assetId);
  if (row?.storage === "opfs") await deleteOpfsBlob(assetId).catch(() => undefined);
  const url = liveUrls.get(assetId);
  if (url) URL.revokeObjectURL(url);
  liveUrls.delete(assetId);
  await db.blobs.delete(assetId);
}

export async function getMediaBlob(assetId: string): Promise<Blob | null> {
  if (!db) return null;
  const row = await db.blobs.get(assetId);
  if (!row) return null;
  if (row.storage === "opfs") return await getOpfsBlob(assetId) ?? row.blob ?? null;
  return row.blob ?? null;
}

export function registerLiveAssetUrl(assetId: string, url: string) {
  const existing = liveUrls.get(assetId);
  if (existing && existing !== url) URL.revokeObjectURL(existing);
  liveUrls.set(assetId, url);
}

export async function resolveAssetUris(state: EditorState): Promise<EditorState> {
  if (!db) return migrateState(state);
  const next = structuredClone(state);
  migrateState(next);
  for (const asset of next.assets) {
    if (!asset.uri.startsWith("idb:") && !asset.uri.startsWith("local:")) continue;
    const row = await db.blobs.get(asset.assetId);
    if (!row) {
      asset.availability = "offline";
      continue;
    }
    let blob = row.storage === "opfs" ? await getOpfsBlob(asset.assetId) : row.blob ?? null;
    if (!blob && row.blob) blob = row.blob;
    if (!blob) {
      asset.availability = "offline";
      continue;
    }
    if (row.storage !== "opfs") {
      try {
        if (await putOpfsBlob(asset.assetId, blob)) {
          await db.blobs.put({ assetId: asset.assetId, mime: row.mime, storage: "opfs", projectId: row.projectId ?? state.project.projectId });
        }
      } catch {
        // IndexedDB remains the compatible fallback.
      }
    }
    const url = URL.createObjectURL(blob);
    registerLiveAssetUrl(asset.assetId, url);
    asset.uri = url;
    asset.availability = "ready";
    if (asset.proxyAssetId && asset.proxyUri?.startsWith("local-proxy:")) {
      const proxyBlob = await getMediaBlob(asset.proxyAssetId);
      if (proxyBlob) {
        const proxyUrl = URL.createObjectURL(proxyBlob);
        registerLiveAssetUrl(asset.proxyAssetId, proxyUrl);
        asset.proxyUri = proxyUrl;
        asset.proxyStatus = "ready";
      } else {
        asset.proxyUri = undefined;
        asset.proxyStatus = "recommended";
      }
    }
  }
  return next;
}

const ACTIVE_PROJECT_KEY = "activeProjectId";

export async function loadEditor(projectId?: string): Promise<EditorState | null> {
  if (!db) return null;
  const selectedId = projectId ?? (await db.preferences.get(ACTIVE_PROJECT_KEY))?.value;
  let projectRow = selectedId ? await db.projects.get(selectedId) : undefined;
  if (!projectRow) projectRow = await db.projects.orderBy("lastOpenedAt").last();
  if (projectRow) {
    const openedAt = Date.now();
    await db.transaction("rw", db.projects, db.preferences, async () => {
      await db.projects.update(projectRow!.projectId, { lastOpenedAt: openedAt });
      await db.preferences.put({ key: ACTIVE_PROJECT_KEY, value: projectRow!.projectId });
    });
    return resolveAssetUris(projectRow.state);
  }
  const legacy = await db.snapshots.get("current");
  if (!legacy) return null;
  await persistEditor(legacy.state);
  return resolveAssetUris(legacy.state);
}

export async function persistEditor(state: EditorState): Promise<void> {
  if (!db) return;
  const savedAt = Date.now();
  const persistedState = rewriteImportedUris(state);
  await db.transaction("rw", db.projects, db.preferences, async () => {
    const existing = await db.projects.get(state.project.projectId);
    await db.projects.put({
      projectId: state.project.projectId,
      state: persistedState,
      title: state.project.title,
      createdAt: state.project.createdAt,
      savedAt,
      lastOpenedAt: existing?.lastOpenedAt ?? savedAt,
    });
    await db.preferences.put({ key: ACTIVE_PROJECT_KEY, value: state.project.projectId });
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!db) return [];
  const rows = await db.projects.orderBy("lastOpenedAt").reverse().toArray();
  return rows.map((row) => ({
    projectId: row.projectId,
    title: row.title,
    createdAt: row.createdAt,
    savedAt: row.savedAt,
    lastOpenedAt: row.lastOpenedAt,
    assetCount: row.state.assets.length,
  }));
}

export async function deleteProject(projectId: string): Promise<void> {
  if (!db) return;
  const row = await db.projects.get(projectId);
  const assetIds = row?.state.assets.flatMap((asset) => [asset.assetId, ...(asset.proxyAssetId ? [asset.proxyAssetId] : [])]) ?? [];
  await Promise.all(assetIds.map((assetId) => deleteMediaBlob(assetId)));
  await db.projects.delete(projectId);
  const active = await db.preferences.get(ACTIVE_PROJECT_KEY);
  if (active?.value === projectId) await db.preferences.delete(ACTIVE_PROJECT_KEY);
}

export async function cleanupOrphanedMedia(): Promise<void> {
  if (!db) return;
  const projects = await db.projects.toArray();
  const referenced = new Set(projects.flatMap((project) => project.state.assets.flatMap((asset) => [asset.assetId, ...(asset.proxyAssetId ? [asset.proxyAssetId] : [])])));
  const rows = await db.blobs.toArray();
  await Promise.all(rows.filter((row) => !referenced.has(row.assetId)).map((row) => deleteMediaBlob(row.assetId)));
}

const BUNDLE_MAGIC = "CUTLINE1\n";

interface BundleManifest {
  version: 1;
  state: EditorState;
  media: { assetId: string; mime: string; bytes: number }[];
}

export async function createProjectBundle(state: EditorState): Promise<Blob> {
  const bundleState = rewriteImportedUris(state);
  const media: BundleManifest["media"] = [];
  const mediaBlobs: Blob[] = [];
  for (const asset of bundleState.assets) {
    // Proxies are disposable derivatives. Keeping them out of portable bundles
    // avoids duplicate payloads and guarantees an imported project renders from
    // its original media.
    asset.proxyAssetId = undefined;
    asset.proxyUri = undefined;
    asset.proxyBytes = undefined;
    asset.proxyStatus = asset.kind === "video" ? "recommended" : undefined;
    if (!asset.uri.startsWith("local:") && !asset.uri.startsWith("idb:")) continue;
    const blob = await getMediaBlob(asset.assetId);
    if (!blob) {
      asset.availability = "offline";
      continue;
    }
    media.push({ assetId: asset.assetId, mime: blob.type || asset.mime || "application/octet-stream", bytes: blob.size });
    mediaBlobs.push(blob);
  }
  const manifest: BundleManifest = { version: 1, state: bundleState, media };
  const encodedManifest = new TextEncoder().encode(JSON.stringify(manifest));
  const length = new ArrayBuffer(4);
  new DataView(length).setUint32(0, encodedManifest.byteLength, false);
  return new Blob([BUNDLE_MAGIC, length, encodedManifest, ...mediaBlobs], { type: "application/vnd.cutline.project" });
}

function validateBundleState(value: unknown): asserts value is EditorState {
  const state = value as Partial<EditorState> | null;
  if (!state || typeof state !== "object" || !state.project || typeof state.project.projectId !== "string"
    || !Array.isArray(state.assets) || !state.branches || typeof state.branches !== "object") {
    throw new Error("This is not a valid Cutline project bundle.");
  }
}

export async function importProjectBundle(file: Blob, now = Date.now()): Promise<EditorState> {
  if (file.size < BUNDLE_MAGIC.length + 4) throw new Error("The Cutline project bundle is incomplete.");
  const magic = await file.slice(0, BUNDLE_MAGIC.length).text();
  if (magic !== BUNDLE_MAGIC) throw new Error("Choose a .cutline project bundle.");
  const manifestLength = new DataView(await file.slice(BUNDLE_MAGIC.length, BUNDLE_MAGIC.length + 4).arrayBuffer()).getUint32(0, false);
  if (manifestLength <= 0 || manifestLength > 50 * 1024 * 1024 || BUNDLE_MAGIC.length + 4 + manifestLength > file.size) {
    throw new Error("The Cutline project manifest is invalid.");
  }
  const manifest = JSON.parse(await file.slice(BUNDLE_MAGIC.length + 4, BUNDLE_MAGIC.length + 4 + manifestLength).text()) as BundleManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.media)) throw new Error("This Cutline bundle version is not supported.");
  validateBundleState(manifest.state);
  const state = migrateState(structuredClone(manifest.state));
  const newProjectId = typeof crypto !== "undefined" && crypto.randomUUID
    ? `project_local_${crypto.randomUUID()}`
    : `project_local_${now.toString(36)}_${Math.random().toString(36).slice(2)}`;
  const assetIds = new Map<string, string>();
  for (const asset of state.assets) {
    const nextId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${asset.assetId}_${now}`;
    assetIds.set(asset.assetId, nextId);
    asset.assetId = nextId;
    if (asset.uri.startsWith("local:") || asset.uri.startsWith("idb:")) asset.uri = `local:${nextId}`;
  }
  for (const branch of Object.values(state.branches)) {
    for (const track of branch.tracks) {
      for (const item of track.items) item.assetId = assetIds.get(item.assetId) ?? item.assetId;
    }
  }
  let offset = BUNDLE_MAGIC.length + 4 + manifestLength;
  const payloads: { assetId: string; blob: Blob }[] = [];
  for (const entry of manifest.media) {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || offset + entry.bytes > file.size) throw new Error("The Cutline media payload is invalid.");
    const newAssetId = assetIds.get(entry.assetId);
    if (newAssetId) payloads.push({ assetId: newAssetId, blob: file.slice(offset, offset + entry.bytes, entry.mime) });
    offset += entry.bytes;
  }
  if (offset !== file.size) throw new Error("The Cutline media payload contains unexpected trailing data.");
  state.project.projectId = newProjectId;
  state.project.createdAt = now;
  state.project.title = `${state.project.title} (imported)`.slice(0, 80);
  const storedAssetIds: string[] = [];
  try {
    for (const payload of payloads) {
      await putMediaBlob(payload.assetId, payload.blob, newProjectId);
      storedAssetIds.push(payload.assetId);
    }
    await persistEditor(state);
    return resolveAssetUris(state);
  } catch (error) {
    await Promise.all(storedAssetIds.map((assetId) => deleteMediaBlob(assetId).catch(() => undefined)));
    await db?.projects.delete(newProjectId).catch(() => undefined);
    throw error;
  }
}

export async function clearEditor(): Promise<void> {
  if (!db) return;
  for (const url of liveUrls.values()) URL.revokeObjectURL(url);
  liveUrls.clear();
  const blobRows = await db.blobs.toArray();
  await Promise.all(blobRows.filter((row) => row.storage === "opfs").map((row) => deleteOpfsBlob(row.assetId).catch(() => undefined)));
  await db.transaction("rw", db.snapshots, db.blobs, db.projects, db.preferences, async () => {
    await db.snapshots.clear();
    await db.blobs.clear();
    await db.projects.clear();
    await db.preferences.clear();
  });
}
