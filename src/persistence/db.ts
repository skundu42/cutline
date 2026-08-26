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
  blob: Blob;
  mime: string;
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
      asset.uri = `idb:${asset.assetId}`;
    }
  }
  return copy;
}

export async function putMediaBlob(assetId: string, blob: Blob): Promise<void> {
  if (!db) return;
  await db.blobs.put({ assetId, blob, mime: blob.type });
}

export async function resolveAssetUris(state: EditorState): Promise<EditorState> {
  if (!db) return migrateState(state);
  const next = structuredClone(state);
  migrateState(next);
  for (const asset of next.assets) {
    if (!asset.uri.startsWith("idb:")) continue;
    const row = await db.blobs.get(asset.assetId);
    if (!row) continue;
    const existing = liveUrls.get(asset.assetId);
    if (existing) URL.revokeObjectURL(existing);
    const url = URL.createObjectURL(row.blob);
    liveUrls.set(asset.assetId, url);
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
  await db.transaction("rw", db.snapshots, db.blobs, async () => {
    await db.snapshots.clear();
    await db.blobs.clear();
  });
}
