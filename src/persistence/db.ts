import Dexie, { type EntityTable } from "dexie";
import { ensureStandardTracks } from "@/core/import";
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
}

class CutlineDB extends Dexie {
  snapshots!: EntityTable<StateRow, "id">;
  blobs!: EntityTable<BlobRow, "assetId">;

  constructor() {
    super("cutline");
    this.version(1).stores({
      snapshots: "id",
    });
    this.version(2).stores({
      snapshots: "id",
      blobs: "assetId",
    });
  }
}

const db = typeof indexedDB === "undefined" ? null : new CutlineDB();
const liveUrls = new Map<string, string>();

function migrateState(state: EditorState): EditorState {
  for (const branch of Object.values(state.branches)) {
    ensureStandardTracks(branch);
  }
  return state;
}

function rewriteImportedUris(state: EditorState): EditorState {
  const copy = structuredClone(state);
  for (const asset of copy.assets) {
    if (asset.uri.startsWith("blob:")) {
      asset.uri = `local:${asset.assetId}`;
    }
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

export async function putMediaBlob(assetId: string, blob: Blob): Promise<void> {
  if (!db) return;
  try {
    if (await putOpfsBlob(assetId, blob)) {
      await db.blobs.put({ assetId, mime: blob.type, storage: "opfs" });
      return;
    }
  } catch {
    await deleteOpfsBlob(assetId).catch(() => undefined);
  }
  await db.blobs.put({ assetId, blob, mime: blob.type, storage: "idb" });
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
    if (!row) continue;
    let blob = row.storage === "opfs" ? await getOpfsBlob(asset.assetId) : row.blob ?? null;
    if (!blob && row.blob) blob = row.blob;
    if (!blob) continue;
    if (row.storage !== "opfs") {
      try {
        if (await putOpfsBlob(asset.assetId, blob)) {
          await db.blobs.put({ assetId: asset.assetId, mime: row.mime, storage: "opfs" });
        }
      } catch {
        // IndexedDB remains the compatible fallback.
      }
    }
    const url = URL.createObjectURL(blob);
    registerLiveAssetUrl(asset.assetId, url);
    asset.uri = url;
  }
  return next;
}

export async function loadEditor(): Promise<EditorState | null> {
  if (!db) return null;
  const row = await db.snapshots.get("current");
  if (!row) return null;
  return resolveAssetUris(row.state);
}

export async function persistEditor(state: EditorState): Promise<void> {
  if (!db) return;
  await db.snapshots.put({ id: "current", state: rewriteImportedUris(state), savedAt: Date.now() });
}

export async function clearEditor(): Promise<void> {
  if (!db) return;
  for (const url of liveUrls.values()) URL.revokeObjectURL(url);
  liveUrls.clear();
  const blobRows = await db.blobs.toArray();
  await Promise.all(blobRows.filter((row) => row.storage === "opfs").map((row) => deleteOpfsBlob(row.assetId).catch(() => undefined)));
  await db.transaction("rw", db.snapshots, db.blobs, async () => {
    await db.snapshots.clear();
    await db.blobs.clear();
  });
}
