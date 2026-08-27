import type { Branch, EditorState, Track } from "./types";

export const MAIN_BRANCH_ID = "branch_main";
export const SCHEMA_VERSION = 2;

export const SUPPORTED_OPERATIONS = [
  "ripple_delete",
  "replace_range",
  "extend_still",
  "split",
  "trim",
  "delete",
  "move",
  "place_clip",
  "place_audio",
  "set_transition",
  "set_gain",
  "mute_track",
  "style_captions",
  "place_broll",
  "set_crop",
  "import_media",
] as const;

function standardTracks(): Track[] {
  return [
    { trackId: "v1", kind: "video", order: 0, locked: false, muted: false, hidden: false, items: [] },
    { trackId: "v2", kind: "video_overlay", order: 1, locked: false, muted: false, hidden: false, items: [] },
    { trackId: "a1", kind: "audio", order: 2, locked: false, muted: false, hidden: false, items: [] },
    { trackId: "a2", kind: "audio", order: 3, locked: false, muted: false, hidden: false, items: [] },
    { trackId: "cc", kind: "caption", order: 4, locked: false, muted: false, hidden: false, items: [] },
  ];
}

function mainBranch(): Branch {
  return {
    branchId: MAIN_BRANCH_ID,
    name: "Main cut",
    baseBranchId: null,
    baseDigest: "",
    branchVersion: 0,
    operationIds: [],
    status: "working",
    durationMs: 0,
    tracks: standardTracks(),
    captions: [],
    captionStyle: {
      preset: "clean_lower",
      emphasis: "none",
      maxLines: 2,
      maxCharsPerLine: 42,
    },
    locks: [],
    comments: [],
    crop: {
      aspectRatio: "16:9",
      anchor: "center",
      normalizedCenter: { x: 0.5, y: 0.5 },
      scale: 1,
    },
  };
}

export function createEmptyState(now = 0, title = "Untitled cut"): EditorState {
  const branch = mainBranch();
  return {
    project: {
      projectId: `project_local_${now.toString(36)}`,
      title,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      activeBranchId: branch.branchId,
      frameRate: 30,
    },
    assets: [],
    transcript: [],
    branches: { [branch.branchId]: branch },
    history: { [branch.branchId]: { undo: [], redo: [] } },
    events: [],
    exports: [],
  };
}
