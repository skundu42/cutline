import { z } from "zod";

export const TransitionSchema = z.enum(["cut", "crossfade", "fade_in", "fade_out", "dissolve"]);

export const TimeRangeSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
}).refine((range) => range.endMs > range.startMs, {
  message: "endMs must be greater than startMs",
  path: ["endMs"],
});

export const ClientRequestIdSchema = z.string().trim().min(1).max(128);

export const WriteEnvelopeSchema = z.object({
  projectId: z.string(),
  branchId: z.string(),
  expectedBranchVersion: z.number().int().nonnegative(),
  clientRequestId: ClientRequestIdSchema.optional(),
});

export const ProjectStatusInput = z.object({
  projectId: z.string().optional(),
});

export const InspectProjectInput = z.object({
  projectId: z.string(),
  include: z.array(z.enum(["assets", "branches", "tracks", "locks", "analysis"])).optional(),
});

export const GetTimelineInput = z.object({
  projectId: z.string(),
  branchId: z.string(),
  range: TimeRangeSchema.optional(),
  include: z.array(z.enum(["clips", "captions", "comments", "locks"])).optional(),
});

export const ReadTranscriptInput = z.object({
  projectId: z.string(),
  branchId: z.string(),
  range: TimeRangeSchema.optional(),
  includeWords: z.boolean().optional(),
  cursor: z.string().optional(),
});

export const GetCommentsInput = z.object({
  projectId: z.string(),
  branchId: z.string(),
  status: z.enum(["open", "resolved", "proposed"]).optional(),
  range: TimeRangeSchema.optional(),
  cursor: z.string().optional(),
});

export const SelectBranchInput = z.object({
  projectId: z.string(),
  branchId: z.string(),
});

export const ControlPlaybackInput = z.object({
  projectId: z.string(),
  branchId: z.string(),
  action: z.enum(["play", "pause", "seek"]),
  timeMs: z.number().int().nonnegative().optional(),
});

export const AddCommentInput = WriteEnvelopeSchema.extend({
  range: TimeRangeSchema,
  text: z.string().trim().min(1).max(500),
});

export const ProposeCommentResolutionInput = WriteEnvelopeSchema.extend({
  commentId: z.string(),
  proposal: z.string().trim().min(1).max(500),
});

export const HistoryEditInput = WriteEnvelopeSchema;

export const CreateCutBranchInput = z.object({
  projectId: z.string(),
  baseBranchId: z.string(),
  expectedBaseVersion: z.number().int().nonnegative(),
  name: z.string().min(1).max(48),
  purpose: z.string().max(240).optional(),
  clientRequestId: ClientRequestIdSchema.optional(),
});

const EditOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("ripple_delete"),
    range: TimeRangeSchema,
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("replace_range"),
    trackId: z.string(),
    range: TimeRangeSchema,
    assetId: z.string(),
    source: z.object({ inMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }),
    transition: TransitionSchema,
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("extend_still"),
    itemId: z.string(),
    endMs: z.number().int().positive(),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("split"),
    itemId: z.string(),
    atMs: z.number().int().nonnegative(),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("trim"),
    itemId: z.string(),
    startMs: z.number().int().nonnegative().optional(),
    endMs: z.number().int().positive().optional(),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("delete"),
    itemId: z.string(),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("move"),
    itemId: z.string(),
    startMs: z.number().int().nonnegative(),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("place_clip"),
    trackId: z.string(),
    assetId: z.string(),
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
    sourceInMs: z.number().int().nonnegative().optional(),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("place_audio"),
    trackId: z.string(),
    assetId: z.string(),
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
    sourceInMs: z.number().int().nonnegative().optional(),
    gain: z.number().min(0).max(2).optional(),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("set_transition"),
    itemId: z.string(),
    transitionIn: TransitionSchema.optional(),
    transitionOut: TransitionSchema.optional(),
    fadeMs: z.number().int().min(0).max(5000).optional(),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("set_gain"),
    itemId: z.string(),
    gain: z.number().min(0).max(2),
    required: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("mute_track"),
    trackId: z.string(),
    muted: z.boolean(),
    required: z.boolean().optional(),
  }),
]);

export const ApplyEditBatchInput = WriteEnvelopeSchema.extend({
  rationale: z.string().max(500).optional(),
  operations: z.array(EditOpSchema).min(1).max(40),
});

export const StyleCaptionsInput = WriteEnvelopeSchema.extend({
  source: z.literal("transcript"),
  range: TimeRangeSchema.optional(),
  preset: z.enum(["bold_center", "clean_lower", "technical_card"]),
  emphasis: z.enum(["none", "active_word"]),
  maxLines: z.union([z.literal(1), z.literal(2)]),
  maxCharsPerLine: z.number().int().min(18).max(42),
});

export const PlaceBrollInput = WriteEnvelopeSchema.extend({
  assetId: z.string(),
  trackId: z.literal("v2"),
  range: TimeRangeSchema,
  sourceInMs: z.number().int().nonnegative().optional(),
  fit: z.enum(["cover", "contain"]),
  anchor: z.enum(["center", "face", "safe_region"]),
  transitionIn: TransitionSchema,
  transitionOut: TransitionSchema,
  replaceExisting: z.boolean().optional(),
});

export const SetCropInput = WriteEnvelopeSchema.extend({
  target: z.union([
    z.object({ kind: z.literal("project") }),
    z.object({ kind: z.literal("clip"), itemId: z.string() }),
  ]),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  anchor: z.enum(["center", "face", "safe_region"]).optional(),
  normalizedCenter: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  scale: z.number().min(1).max(3).optional(),
}).refine((input) => input.aspectRatio != null || input.anchor != null || input.normalizedCenter != null || input.scale != null, {
  message: "At least one crop property is required",
});

export const PreviewRangeInput = z.object({
  projectId: z.string(),
  branchId: z.string(),
  stateDigest: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  quality: z.enum(["proxy", "720p"]).optional(),
});

export const CompareCutsInput = z.object({
  projectId: z.string(),
  leftBranchId: z.string(),
  rightBranchId: z.string(),
  range: TimeRangeSchema.optional(),
});

export const ImportMediaInput = z.object({
  projectId: z.string(),
  uri: z.string().min(1),
  label: z.string().min(1).max(80),
  kind: z.enum(["video", "audio", "image", "graphic"]),
  mime: z.string().min(1),
  durationMs: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
  checksum: z.string().optional(),
  clientRequestId: ClientRequestIdSchema.optional(),
});

export const PlaceClipInput = WriteEnvelopeSchema.extend({
  assetId: z.string(),
  trackId: z.enum(["v1", "v2"]),
  startMs: z.number().int().nonnegative(),
  sourceInMs: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().positive().optional(),
  fit: z.enum(["cover", "contain"]).optional(),
  anchor: z.enum(["center", "face", "safe_region"]).optional(),
  transitionIn: TransitionSchema.optional(),
  transitionOut: TransitionSchema.optional(),
  fadeMs: z.number().int().min(0).max(5000).optional(),
  replaceExisting: z.boolean().optional(),
});

export const PlaceAudioInput = WriteEnvelopeSchema.extend({
  assetId: z.string(),
  trackId: z.enum(["a1", "a2"]),
  range: TimeRangeSchema,
  sourceInMs: z.number().int().nonnegative().optional(),
  gain: z.number().min(0).max(2).optional(),
  transitionIn: TransitionSchema.optional(),
  transitionOut: TransitionSchema.optional(),
  fadeMs: z.number().int().min(0).max(5000).optional(),
  replaceExisting: z.boolean().optional(),
});

export const SetTransitionInput = WriteEnvelopeSchema.extend({
  itemId: z.string(),
  transitionIn: TransitionSchema.optional(),
  transitionOut: TransitionSchema.optional(),
  fadeMs: z.number().int().min(0).max(5000).optional(),
}).refine((input) => input.transitionIn != null || input.transitionOut != null || input.fadeMs != null, {
  message: "At least one transition property is required",
});

export const SplitClipInput = WriteEnvelopeSchema.extend({
  itemId: z.string(),
  atMs: z.number().int().nonnegative(),
});

export const TrimClipInput = WriteEnvelopeSchema.extend({
  itemId: z.string(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().positive().optional(),
}).refine((input) => input.startMs != null || input.endMs != null, {
  message: "A trim start or end is required",
});

export const SetGainInput = WriteEnvelopeSchema.extend({
  itemId: z.string(),
  gain: z.number().min(0).max(2),
});

export const MuteTrackInput = WriteEnvelopeSchema.extend({
  trackId: z.string(),
  muted: z.boolean(),
});

export const DeleteClipInput = WriteEnvelopeSchema.extend({
  itemId: z.string(),
});

export function jsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
}
