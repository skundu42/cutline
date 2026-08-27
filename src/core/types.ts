export type AspectRatio = "16:9" | "9:16" | "1:1";
export type TrackKind = "video" | "video_overlay" | "audio" | "caption";
export type ActorType = "human" | "agent";
export type ActorSurface = "ui" | "webmcp";
export type BranchStatus = "working" | "accepted" | "discarded";
export type FitMode = "cover" | "contain";
export type CropAnchor = "center" | "face" | "safe_region";
export type Transition = "cut" | "crossfade" | "fade_in" | "fade_out" | "dissolve";
export type CaptionPreset = "bold_center" | "clean_lower" | "technical_card";
export type CaptionEmphasis = "none" | "active_word";
export type CommentStatus = "open" | "resolved" | "proposed";
export type TranscriptMarker = "silence" | "false_start" | "alternate_take";

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface Actor {
  type: ActorType;
  surface: ActorSurface;
}

export interface Asset {
  assetId: string;
  kind: "video" | "audio" | "image" | "graphic";
  label: string;
  uri: string;
  durationMs?: number;
  width?: number;
  height?: number;
  checksum: string;
  preparedTags: string[];
  posterUri?: string;
  mime?: string;
  bytes?: number;
  imported?: boolean;
  hasAudio?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  safeRegions?: { name: string; x: number; y: number; width: number; height: number }[];
}

export interface ClipInstance {
  itemId: string;
  assetId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  label: string;
  fit?: FitMode;
  anchor?: CropAnchor;
  transform?: { x: number; y: number; scale: number };
  gain?: number;
  transitionIn?: Transition;
  transitionOut?: Transition;
  fadeMs?: number;
  status?: string;
}

export interface CaptionCue {
  cueId: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: { startMs: number; endMs: number; text: string }[];
  styleId: CaptionPreset;
}

export interface CaptionStyle {
  preset: CaptionPreset;
  emphasis: CaptionEmphasis;
  maxLines: 1 | 2;
  maxCharsPerLine: number;
}

export interface Track {
  trackId: string;
  kind: TrackKind;
  order: number;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  items: ClipInstance[];
}

export interface LockedRange {
  lockId: string;
  startMs: number;
  endMs: number;
  label: string;
  createdByHumanAt: number;
}

export interface Comment {
  commentId: string;
  authorType: ActorType;
  range: TimeRange;
  text: string;
  status: CommentStatus;
  linkedOperationId?: string;
  resolutionProposal?: string;
}

export interface ProjectCrop {
  aspectRatio: AspectRatio;
  anchor: CropAnchor;
  normalizedCenter: { x: number; y: number };
  scale: number;
}

export interface Branch {
  branchId: string;
  name: string;
  baseBranchId: string | null;
  baseDigest: string;
  branchVersion: number;
  operationIds: string[];
  status: BranchStatus;
  durationMs: number;
  tracks: Track[];
  captions: CaptionCue[];
  captionStyle: CaptionStyle;
  locks: LockedRange[];
  comments: Comment[];
  crop: ProjectCrop;
}

export interface Project {
  projectId: string;
  title: string;
  schemaVersion: number;
  createdAt: number;
  activeBranchId: string;
  selectedFinalBranchId?: string;
  frameRate: number;
}

export interface TranscriptWord {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptSegment {
  segmentId: string;
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
  confidence: number;
  markers?: TranscriptMarker[];
  words?: TranscriptWord[];
}

export interface HistoryEntry {
  operationId: string;
  before: Branch;
  after: Branch;
}

export interface AuditEvent {
  eventId: string;
  at: number;
  actorType: ActorType;
  commandType: string;
  branchId?: string;
  branchVersion?: number;
  summary: string;
  durationDeltaMs?: number;
  changedRangeCount?: number;
}

export interface ExportArtifact {
  exportId: string;
  branchId: string;
  stateDigest: string;
  durationMs: number;
  width: number;
  height: number;
  createdAt: number;
  uri: string;
  bytes?: number;
}

export interface EditorState {
  project: Project;
  assets: Asset[];
  transcript: TranscriptSegment[];
  branches: Record<string, Branch>;
  history: Record<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>;
  events: AuditEvent[];
  exports: ExportArtifact[];
}

export interface ChangedRange extends TimeRange {
  changes?: string[];
}

export interface Warning {
  code: string;
  message: string;
  lockId?: string;
  range?: TimeRange;
}

export interface Receipt {
  operationId: string;
  summary: string;
  branchId?: string;
  branchVersion?: number;
  stateDigest: string;
  durationMs?: number;
  durationDeltaMs?: number;
  changedRanges: ChangedRange[];
  warnings: Warning[];
  appliedOperationCount?: number;
  skippedOperations?: { op: string; reason: string }[];
  verification?: { action: string; startMs: number; endMs: number };
}

export type ErrorCode =
  | "PROJECT_NOT_READY"
  | "PROJECT_NOT_FOUND"
  | "BRANCH_NOT_FOUND"
  | "INVALID_RANGE"
  | "LOCKED_RANGE"
  | "ASSET_NOT_FOUND"
  | "CONFLICT"
  | "INVARIANT_VIOLATION"
  | "PREVIEW_FAILED"
  | "UNSUPPORTED_OPERATION"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

export interface CommandError {
  code: ErrorCode;
  message: string;
  branchVersion?: number;
  lockId?: string;
  violations?: string[];
}

export type Result =
  | { ok: true; state: EditorState; receipt: Receipt }
  | { ok: false; error: CommandError };

export interface BusContext {
  now: () => number;
  id: () => string;
}

export type EditOp =
  | {
      op: "ripple_delete";
      range: TimeRange;
      required?: boolean;
    }
  | {
      op: "replace_range";
      trackId: string;
      range: TimeRange;
      assetId: string;
      source: { inMs: number; endMs: number };
      transition: Transition;
      required?: boolean;
    }
  | {
      op: "extend_still";
      itemId: string;
      endMs: number;
      required?: boolean;
    }
  | {
      op: "split";
      itemId: string;
      atMs: number;
      required?: boolean;
    }
  | {
      op: "trim";
      itemId: string;
      startMs?: number;
      endMs?: number;
      required?: boolean;
    }
  | {
      op: "delete";
      itemId: string;
      required?: boolean;
    }
  | {
      op: "move";
      itemId: string;
      startMs: number;
      required?: boolean;
    }
  | {
      op: "place_clip";
      trackId: string;
      assetId: string;
      startMs: number;
      durationMs: number;
      sourceInMs?: number;
      required?: boolean;
    }
  | {
      op: "place_audio";
      trackId: string;
      assetId: string;
      startMs: number;
      durationMs: number;
      sourceInMs?: number;
      gain?: number;
      required?: boolean;
    }
  | {
      op: "set_transition";
      itemId: string;
      transitionIn?: Transition;
      transitionOut?: Transition;
      fadeMs?: number;
      required?: boolean;
    }
  | {
      op: "set_gain";
      itemId: string;
      gain: number;
      required?: boolean;
    }
  | {
      op: "mute_track";
      trackId: string;
      muted: boolean;
      required?: boolean;
    };

export type Command =
  | {
      type: "ImportTranscript";
      actor: Actor;
      payload: {
        label: string;
        segments: TranscriptSegment[];
      };
    }
  | {
      type: "CreateBranch";
      actor: Actor;
      payload: {
        baseBranchId: string;
        expectedBaseVersion: number;
        name: string;
        purpose?: string;
      };
    }
  | {
      type: "ApplyEditBatch";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        rationale?: string;
        operations: EditOp[];
      };
    }
  | {
      type: "StyleCaptions";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        source: "transcript";
        range?: TimeRange;
        preset: CaptionPreset;
        emphasis: CaptionEmphasis;
        maxLines: 1 | 2;
        maxCharsPerLine: number;
      };
    }
  | {
      type: "PlaceBroll";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        assetId: string;
        trackId: "v2";
        range: TimeRange;
        sourceInMs?: number;
        fit: FitMode;
        anchor: CropAnchor;
        transitionIn: Transition;
        transitionOut: Transition;
        replaceExisting?: boolean;
      };
    }
  | {
      type: "SetCrop";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        target: { kind: "project" } | { kind: "clip"; itemId: string };
        aspectRatio?: AspectRatio;
        anchor?: CropAnchor;
        normalizedCenter?: { x: number; y: number };
        scale?: number;
      };
    }
  | {
      type: "AddComment";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        range: TimeRange;
        text: string;
      };
    }
  | {
      type: "ProposeCommentResolution";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        commentId: string;
        proposal: string;
      };
    }
  | {
      type: "SetLock";
      actor: Actor;
      payload:
        | {
            action: "lock";
            branchId: string;
            expectedBranchVersion: number;
            range: TimeRange;
            label: string;
          }
        | {
            action: "unlock";
            branchId: string;
            expectedBranchVersion: number;
            lockId: string;
          };
    }
  | {
      type: "AcceptBranch";
      actor: Actor;
      payload: { branchId: string; expectedBranchVersion: number };
    }
  | {
      type: "SelectActiveBranch";
      actor: Actor;
      payload: { branchId: string };
    }
  | {
      type: "Undo";
      actor: Actor;
      payload: { branchId: string };
    }
  | {
      type: "Redo";
      actor: Actor;
      payload: { branchId: string };
    }
  | {
      type: "ResetProject";
      actor: Actor;
    }
  | {
      type: "RecordExport";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        uri: string;
        width: number;
        height: number;
        bytes?: number;
      };
    }
  | {
      type: "ImportAsset";
      actor: Actor;
      payload: {
        assetId?: string;
        kind: "video" | "audio" | "image" | "graphic";
        label: string;
        uri: string;
        durationMs: number;
        width?: number;
        height?: number;
        mime: string;
        bytes?: number;
        checksum: string;
        posterUri?: string;
        hasAudio?: boolean;
        videoCodec?: string;
        audioCodec?: string;
      };
    }
  | {
      type: "PlaceClip";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        assetId: string;
        trackId: "v1" | "v2";
        startMs: number;
        sourceInMs?: number;
        durationMs?: number;
        fit?: FitMode;
        anchor?: CropAnchor;
        transitionIn?: Transition;
        transitionOut?: Transition;
        fadeMs?: number;
        replaceExisting?: boolean;
      };
    }
  | {
      type: "PlaceAudio";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        assetId: string;
        trackId: "a1" | "a2";
        range: TimeRange;
        sourceInMs?: number;
        gain?: number;
        transitionIn?: Transition;
        transitionOut?: Transition;
        fadeMs?: number;
        replaceExisting?: boolean;
      };
    }
  | {
      type: "SetTransition";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        itemId: string;
        transitionIn?: Transition;
        transitionOut?: Transition;
        fadeMs?: number;
      };
    }
  | {
      type: "SetGain";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        itemId: string;
        gain: number;
      };
    }
  | {
      type: "MuteTrack";
      actor: Actor;
      payload: {
        branchId: string;
        expectedBranchVersion: number;
        trackId: string;
        muted: boolean;
      };
    };
