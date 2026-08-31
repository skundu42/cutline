import { current, produce } from "immer";
import { flattenWords, segmentCaptions } from "./captions";
import { digestBranch, digestProject } from "./digest";
import { ensureStandardTracks, validateImport } from "./import";
import { allowsOverlap, collectInvariantViolations, recomputeDuration } from "./invariants";
import { isValidRange, rangeDuration, rangesIntersect } from "./time";
import { linkedItems, placementConflicts } from "./linked";
import { DEFAULT_TRANSITION_DURATION_MS } from "./transitions";
import type {
  BasicClipTransition,
  Branch,
  BusContext,
  ChangedRange,
  ClipInstance,
  Command,
  CommandError,
  EditOp,
  EditorState,
  Receipt,
  Result,
  TimeRange,
  Track,
  Transition,
  Warning,
} from "./types";

const BRANCH_WRITES: Command["type"][] = [
  "ApplyEditBatch",
  "StyleCaptions",
  "PlaceBroll",
  "SetCrop",
  "AddComment",
  "ProposeCommentResolution",
  "Undo",
  "Redo",
  "PlaceClip",
  "PlaceAudio",
  "SetTransition",
  "AddTransition",
  "SetGain",
  "MuteTrack",
  "SetLock",
];
const MAX_BATCH_OPS = 40;
const MAX_UNDO = 50;

function fail(error: CommandError): Result {
  return { ok: false, error };
}

function getBranch(state: EditorState, branchId: string): Branch | undefined {
  return state.branches[branchId];
}

function requireWritableBranch(state: EditorState, command: Command): CommandError | null {
  if (!BRANCH_WRITES.includes(command.type) || !("payload" in command) || !("branchId" in command.payload)) {
    return null;
  }
  const branch = state.branches[command.payload.branchId];
  if (!branch) return { code: "BRANCH_NOT_FOUND", message: "Unknown branch" };
  if (branch.status !== "working") {
    return { code: "UNAUTHORIZED", message: `Branch ${branch.name} is ${branch.status}; create a working branch before editing` };
  }
  return null;
}

function versionCheck(branch: Branch, expected: number): CommandError | null {
  if (branch.branchVersion !== expected) {
    return {
      code: "CONFLICT",
      message: `expected version ${expected}, current is ${branch.branchVersion}`,
      branchVersion: branch.branchVersion,
    };
  }
  return null;
}

function assetCheck(state: EditorState, assetId: string): CommandError | null {
  if (!state.assets.some((asset) => asset.assetId === assetId)) {
    return { code: "ASSET_NOT_FOUND", message: `Unknown asset ${assetId}` };
  }
  return null;
}

function lockHits(branch: Branch, ranges: TimeRange[]): LockedRangeHit | null {
  for (const lock of branch.locks) {
    if (ranges.some((range) => rangesIntersect(range, lock))) {
      return { lockId: lock.lockId, range: { startMs: lock.startMs, endMs: lock.endMs } };
    }
  }
  return null;
}

interface LockedRangeHit {
  lockId: string;
  range: TimeRange;
}

function lockedRangeError(hit: LockedRangeHit) {
  return Object.assign(new Error("locked range"), {
    code: "LOCKED_RANGE" satisfies CommandError["code"],
    lockId: hit.lockId,
  });
}

function skippedLockedOperation(op: EditOp["op"], hit: LockedRangeHit, message: string) {
  return {
    skipped: { op, reason: "LOCKED_RANGE" },
    warning: { code: "LOCKED_RANGE", message, lockId: hit.lockId, range: hit.range },
    changed: [] as ChangedRange[],
  };
}

function bump(branch: Branch, operationId: string) {
  branch.branchVersion += 1;
  branch.operationIds.push(operationId);
  branch.durationMs = recomputeDuration(branch);
}

function pushHistory(state: EditorState, branchId: string, operationId: string, before: Branch, after: Branch) {
  const stack = state.history[branchId] ?? { undo: [], redo: [] };
  stack.undo.push({ operationId, before, after });
  if (stack.undo.length > MAX_UNDO) stack.undo.shift();
  stack.redo = [];
  state.history[branchId] = stack;
}

function pushEvent(state: EditorState, ctx: BusContext, command: Command, receipt: Receipt) {
  state.events.push({
    eventId: ctx.id(),
    at: ctx.now(),
    actorType: command.actor.type,
    commandType: command.type,
    branchId: receipt.branchId,
    branchVersion: receipt.branchVersion,
    summary: receipt.summary,
    durationDeltaMs: receipt.durationDeltaMs,
    changedRangeCount: receipt.changedRanges.length,
  });
}

function receiptFor(
  ctx: BusContext,
  branch: Branch,
  state: EditorState,
  summary: string,
  extra: Partial<Receipt> = {},
): Receipt {
  return {
    operationId: extra.operationId ?? ctx.id(),
    summary,
    branchId: branch.branchId,
    branchVersion: branch.branchVersion,
    stateDigest: digestBranch(branch),
    durationMs: branch.durationMs,
    changedRanges: extra.changedRanges ?? [],
    warnings: extra.warnings ?? [],
    ...extra,
  };
}

function findItem(branch: Branch, itemId: string): { track: Track; item: ClipInstance; index: number } | null {
  for (const track of branch.tracks) {
    const index = track.items.findIndex((item) => item.itemId === itemId);
    if (index >= 0) return { track, item: track.items[index], index };
  }
  return null;
}

function applyGain(branch: Branch, itemId: string, gain: number) {
  if (!Number.isFinite(gain) || gain < 0 || gain > 2) {
    throw Object.assign(new Error("gain must be between 0 and 2"), { code: "VALIDATION_ERROR" });
  }
  const found = findItem(branch, itemId);
  if (!found) throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" });
  found.item.gain = gain;
}

function applyMute(branch: Branch, trackId: string, muted: boolean) {
  const track = branch.tracks.find((item) => item.trackId === trackId);
  if (!track) throw Object.assign(new Error("unknown track"), { code: "INVARIANT_VIOLATION" });
  track.muted = muted;
}

function applyTransition(
  branch: Branch,
  itemId: string,
  transitionIn?: Transition,
  transitionOut?: Transition,
  fadeMs?: number,
) {
  const found = findItem(branch, itemId);
  if (!found) throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" });
  if (fadeMs != null && (fadeMs < 0 || fadeMs > 5000)) {
    throw Object.assign(new Error("fadeMs must be 0–5000"), { code: "VALIDATION_ERROR" });
  }
  if (transitionIn) found.item.transitionIn = transitionIn;
  if (transitionOut) found.item.transitionOut = transitionOut;
  if (fadeMs != null) found.item.fadeMs = fadeMs;
}

function applyTransitionBetween(
  branch: Branch,
  fromItemId: string,
  toItemId: string,
  transition: "cut" | BasicClipTransition,
  requestedDurationMs?: number,
) {
  const from = findItem(branch, fromItemId);
  const to = findItem(branch, toItemId);
  if (!from || !to) {
    throw Object.assign(new Error("Both transition clips must exist"), { code: "INVARIANT_VIOLATION" });
  }
  if (from.track.trackId !== to.track.trackId) {
    throw Object.assign(new Error("Transition clips must be on the same track"), { code: "VALIDATION_ERROR" });
  }
  if (from.track.kind !== "video" && from.track.kind !== "video_overlay") {
    throw Object.assign(new Error("Between-clip transitions require a visual track"), { code: "VALIDATION_ERROR" });
  }
  const sorted = [...from.track.items].sort((left, right) => left.startMs - right.startMs || left.itemId.localeCompare(right.itemId));
  const fromIndex = sorted.findIndex((item) => item.itemId === fromItemId);
  if (fromIndex < 0 || sorted[fromIndex + 1]?.itemId !== toItemId || Math.abs(from.item.endMs - to.item.startMs) > 0.001) {
    throw Object.assign(new Error("Transition clips must be adjacent, with the outgoing clip immediately before the incoming clip"), { code: "VALIDATION_ERROR" });
  }
  const durationMs = transition === "cut"
    ? 0
    : requestedDurationMs ?? DEFAULT_TRANSITION_DURATION_MS[transition];
  if (!Number.isInteger(durationMs) || durationMs < (transition === "cut" ? 0 : 50) || durationMs > 5000) {
    throw Object.assign(new Error("Transition duration must be an integer from 50–5000ms"), { code: "VALIDATION_ERROR" });
  }
  const maxDurationMs = Math.min(from.item.endMs - from.item.startMs, to.item.endMs - to.item.startMs);
  if (durationMs > maxDurationMs) {
    throw Object.assign(new Error(`Transition duration cannot exceed the shorter clip (${Math.floor(maxDurationMs)}ms)`), { code: "VALIDATION_ERROR" });
  }
  const changedRange = {
    startMs: Math.max(from.item.startMs, from.item.endMs - durationMs),
    endMs: transition === "cut" ? Math.min(to.item.endMs, to.item.startMs + 1) : to.item.startMs,
  };
  const hit = lockHits(branch, [changedRange]);
  if (hit) {
    throw Object.assign(new Error("locked range"), { code: "LOCKED_RANGE", lockId: hit.lockId });
  }
  from.item.transitionOut = transition;
  to.item.transitionIn = transition;
  from.item.transitionOutMs = durationMs;
  to.item.transitionInMs = durationMs;
  return { from, to, durationMs, changedRange };
}

function buildPlacedItem(
  state: EditorState,
  _branch: Branch,
  ctx: BusContext,
  opts: {
    assetId: string;
    trackId: string;
    startMs: number;
    durationMs?: number;
    sourceInMs?: number;
    gain?: number;
    fit?: ClipInstance["fit"];
    anchor?: ClipInstance["anchor"];
    transitionIn?: Transition;
    transitionOut?: Transition;
    fadeMs?: number;
    linkGroupId?: string | null;
  },
): ClipInstance {
  const asset = state.assets.find((item) => item.assetId === opts.assetId);
  if (!asset) throw Object.assign(new Error("unknown asset"), { code: "ASSET_NOT_FOUND" });
  const sourceInMs = opts.sourceInMs ?? 0;
  const remaining = Math.max(0, (asset.durationMs ?? 0) - sourceInMs);
  const hold = asset.kind === "graphic" || asset.kind === "image";
  const durationMs = opts.durationMs ?? (hold ? 3000 : remaining);
  if (durationMs <= 0) {
    throw Object.assign(new Error("invalid duration"), { code: "INVALID_RANGE" });
  }
  const item: ClipInstance = {
    itemId: ctx.id(),
    assetId: opts.assetId,
    trackId: opts.trackId,
    startMs: opts.startMs,
    endMs: opts.startMs + durationMs,
    sourceInMs,
    sourceOutMs: sourceInMs + durationMs,
    label: asset.label,
    fit: opts.fit,
    anchor: opts.anchor,
    gain: opts.gain,
    transitionIn: opts.transitionIn,
    transitionOut: opts.transitionOut,
    fadeMs: opts.fadeMs,
    linkGroupId: opts.linkGroupId,
  };
  if (asset.durationMs && item.sourceOutMs > asset.durationMs && (asset.kind === "video" || asset.kind === "audio")) {
    item.sourceOutMs = asset.durationMs;
    item.endMs = item.startMs + (item.sourceOutMs - item.sourceInMs);
  }
  return item;
}

function placeOnTrack(
  branch: Branch,
  item: ClipInstance,
  replaceExisting: boolean,
  required: boolean,
  change: string,
): ChangedRange[] {
  const track = branch.tracks.find((entry) => entry.trackId === item.trackId);
  if (!track) {
    throw Object.assign(new Error("unknown track"), { code: "INVARIANT_VIOLATION" });
  }
  const range = { startMs: item.startMs, endMs: item.endMs };
  const replaced = replaceExisting ? placementConflicts(branch, [item.trackId], range) : [];
  const hit = lockHits(branch, [range, ...replaced]);
  if (hit) {
    if (required) {
      throw Object.assign(new Error("locked range"), {
        code: "LOCKED_RANGE" satisfies CommandError["code"],
        lockId: hit.lockId,
      });
    }
    return [];
  }
  if (replaceExisting) {
    const removedIds = new Set(replaced.map((existing) => existing.itemId));
    for (const affectedTrack of branch.tracks) affectedTrack.items = affectedTrack.items.filter((existing) => !removedIds.has(existing.itemId));
  } else if (!allowsOverlap(track) && track.items.some((existing) => rangesIntersect(existing, range))) {
    throw Object.assign(new Error(`${track.trackId} overlap`), { code: "INVARIANT_VIOLATION" });
  }
  track.items.push(item);
  track.items.sort((a, b) => a.startMs - b.startMs);
  branch.durationMs = recomputeDuration(branch);
  return [
    ...replaced.map((existing) => ({ startMs: existing.startMs, endMs: existing.endMs, changes: ["delete"] })),
    { startMs: item.startMs, endMs: item.endMs, changes: [change] },
  ];
}

function shiftRange<T extends { startMs: number; endMs: number }>(
  entity: T,
  cut: TimeRange,
): T | null {
  const dur = rangeDuration(cut);
  if (entity.endMs <= cut.startMs) return entity;
  if (entity.startMs >= cut.endMs) {
    return { ...entity, startMs: entity.startMs - dur, endMs: entity.endMs - dur };
  }
  if (entity.startMs >= cut.startMs && entity.endMs <= cut.endMs) return null;
  if (entity.startMs < cut.startMs && entity.endMs > cut.endMs) {
    return { ...entity, endMs: entity.endMs - dur };
  }
  if (entity.startMs < cut.startMs) {
    return { ...entity, endMs: cut.startMs };
  }
  return {
    ...entity,
    startMs: cut.startMs,
    endMs: entity.endMs - dur,
  };
}

function rippleDelete(branch: Branch, range: TimeRange, id: () => string) {
  const cut = rangeDuration(range);
  for (const track of branch.tracks) {
    const next: ClipInstance[] = [];
    for (const item of track.items) {
      if (item.endMs <= range.startMs) {
        next.push(item);
        continue;
      }
      if (item.startMs >= range.endMs) {
        next.push({ ...item, startMs: item.startMs - cut, endMs: item.endMs - cut });
        continue;
      }
      if (item.startMs >= range.startMs && item.endMs <= range.endMs) {
        continue;
      }
      if (item.startMs < range.startMs && item.endMs > range.endMs) {
        const leftDur = range.startMs - item.startMs;
        const rightDur = item.endMs - range.endMs;
        next.push({
          ...item,
          endMs: range.startMs,
          sourceOutMs: item.sourceInMs + leftDur,
        });
        next.push({
          ...item,
          itemId: id(),
          startMs: range.startMs,
          endMs: range.startMs + rightDur,
          sourceInMs: item.sourceOutMs - rightDur,
        });
        continue;
      }
      if (item.startMs < range.startMs) {
        const keep = range.startMs - item.startMs;
        next.push({
          ...item,
          endMs: range.startMs,
          sourceOutMs: item.sourceInMs + keep,
        });
        continue;
      }
      const trimIn = range.endMs - item.startMs;
      next.push({
        ...item,
        startMs: range.startMs,
        endMs: item.endMs - cut,
        sourceInMs: item.sourceInMs + trimIn,
      });
    }
    track.items = next.filter((item) => item.endMs > item.startMs);
  }
  branch.captions = branch.captions
    .map((cue) => shiftRange(cue, range))
    .filter((cue): cue is NonNullable<typeof cue> => Boolean(cue && cue.endMs > cue.startMs));
  branch.comments = branch.comments
    .map((comment) => {
      const shifted = shiftRange({ ...comment, startMs: comment.range.startMs, endMs: comment.range.endMs }, range);
      if (!shifted) return null;
      return { ...comment, range: { startMs: shifted.startMs, endMs: shifted.endMs } };
    })
    .filter((comment): comment is NonNullable<typeof comment> => Boolean(comment));
  branch.durationMs = recomputeDuration(branch);
}

function changedForRipple(range: TimeRange, durationMs: number): ChangedRange[] {
  return [{ startMs: range.startMs, endMs: durationMs, changes: ["ripple_delete"] }];
}

function applyOp(
  state: EditorState,
  branch: Branch,
  op: EditOp,
  ctx: BusContext,
): { skipped?: { op: string; reason: string }; warning?: Warning; changed: ChangedRange[] } {
  const required = op.required !== false;

  if (op.op === "ripple_delete") {
    if (!isValidRange(op.range) || op.range.endMs > branch.durationMs + 1) {
      throw Object.assign(new Error("invalid range"), { code: "INVALID_RANGE" satisfies CommandError["code"] });
    }
    const changed = changedForRipple(op.range, branch.durationMs);
    const hit = lockHits(branch, changed);
    if (hit) {
      if (required) {
        throw Object.assign(new Error("locked range"), {
          code: "LOCKED_RANGE" satisfies CommandError["code"],
          lockId: hit.lockId,
        });
      }
      return {
        skipped: { op: op.op, reason: "LOCKED_RANGE" },
        warning: {
          code: "LOCKED_RANGE",
          message: `Skipped tightening ${hit.range.startMs / 1000}–${hit.range.endMs / 1000} s.`,
          lockId: hit.lockId,
          range: hit.range,
        },
        changed: [],
      };
    }
    rippleDelete(branch, op.range, ctx.id);
    return { changed };
  }

  if (op.op === "replace_range") {
    const assetErr = assetCheck(state, op.assetId);
    if (assetErr) throw Object.assign(new Error(assetErr.message), { code: assetErr.code });
    if (!isValidRange(op.range)) {
      throw Object.assign(new Error("invalid range"), { code: "INVALID_RANGE" satisfies CommandError["code"] });
    }
    const replacementDur = op.source.endMs - op.source.inMs;
    if (replacementDur <= 0) {
      throw Object.assign(new Error("invalid source"), { code: "INVALID_RANGE" satisfies CommandError["code"] });
    }
    const delta = replacementDur - rangeDuration(op.range);
    const changed: ChangedRange[] =
      delta === 0
        ? [{ startMs: op.range.startMs, endMs: op.range.endMs, changes: ["replace_range"] }]
        : [{ startMs: op.range.startMs, endMs: branch.durationMs, changes: ["replace_range"] }];
    const hit = lockHits(branch, changed);
    if (hit) {
      if (required) {
        throw Object.assign(new Error("locked range"), {
          code: "LOCKED_RANGE" satisfies CommandError["code"],
          lockId: hit.lockId,
        });
      }
      return {
        skipped: { op: op.op, reason: "LOCKED_RANGE" },
        warning: {
          code: "LOCKED_RANGE",
          message: "Skipped replace that would move a protected range.",
          lockId: hit.lockId,
          range: hit.range,
        },
        changed: [],
      };
    }
    const track = branch.tracks.find((t) => t.trackId === op.trackId);
    if (!track) {
      throw Object.assign(new Error("unknown track"), { code: "INVARIANT_VIOLATION" satisfies CommandError["code"] });
    }
    rippleDelete(branch, op.range, ctx.id);
    const linkGroupId = op.trackId === "v1" ? ctx.id() : undefined;
    const makeItem = (trackId: string): ClipInstance => ({
      itemId: ctx.id(),
      assetId: op.assetId,
      trackId,
      startMs: op.range.startMs,
      endMs: op.range.startMs + replacementDur,
      sourceInMs: op.source.inMs,
      sourceOutMs: op.source.endMs,
      label: op.assetId,
      transitionIn: op.transition,
      transitionOut: op.transition,
      linkGroupId,
    });
    const item = makeItem(op.trackId);
    const newIds = new Set<string>([item.itemId]);
    track.items.push(item);
    if (op.trackId === "v1") {
      const audio = branch.tracks.find((t) => t.trackId === "a1");
      if (audio) {
        const audioItem = makeItem("a1");
        newIds.add(audioItem.itemId);
        audio.items.push(audioItem);
      }
    }
    for (const t of branch.tracks) {
      t.items.sort((a, b) => a.startMs - b.startMs);
      for (const clip of t.items) {
        if (newIds.has(clip.itemId)) continue;
        if (clip.startMs >= op.range.startMs) {
          clip.startMs += replacementDur;
          clip.endMs += replacementDur;
        }
      }
    }
    for (const cue of branch.captions) {
      if (cue.startMs >= op.range.startMs) {
        cue.startMs += replacementDur;
        cue.endMs += replacementDur;
      }
    }
    branch.durationMs = recomputeDuration(branch);
    return { changed };
  }

  if (op.op === "extend_still") {
    const found = findItem(branch, op.itemId);
    if (!found) {
      throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" satisfies CommandError["code"] });
    }
    if (op.endMs <= found.item.startMs) {
      throw Object.assign(new Error("invalid range"), { code: "INVALID_RANGE" satisfies CommandError["code"] });
    }
    const changed: ChangedRange[] = [
      {
        startMs: found.item.startMs,
        endMs: Math.max(found.item.endMs, op.endMs),
        changes: ["extend_still"],
      },
    ];
    const hit = lockHits(branch, changed);
    if (hit) {
      if (required) {
        throw Object.assign(new Error("locked range"), {
          code: "LOCKED_RANGE" satisfies CommandError["code"],
          lockId: hit.lockId,
        });
      }
      return {
        skipped: { op: op.op, reason: "LOCKED_RANGE" },
        warning: { code: "LOCKED_RANGE", message: "Skipped extend into a lock.", lockId: hit.lockId, range: hit.range },
        changed: [],
      };
    }
    const extra = op.endMs - found.item.endMs;
    found.item.endMs = op.endMs;
    found.item.sourceOutMs += extra;
    branch.durationMs = recomputeDuration(branch);
    return { changed };
  }

  if (op.op === "split") {
    const found = findItem(branch, op.itemId);
    if (!found || op.atMs <= found.item.startMs || op.atMs >= found.item.endMs) {
      throw Object.assign(new Error("invalid split"), { code: "INVALID_RANGE" satisfies CommandError["code"] });
    }
    const hit = lockHits(branch, [{ startMs: op.atMs, endMs: Math.min(found.item.endMs, op.atMs + 1) }]);
    if (hit) {
      if (required) throw lockedRangeError(hit);
      return skippedLockedOperation(op.op, hit, "Skipped a split inside a protected range.");
    }
    const offset = op.atMs - found.item.startMs;
    const right: ClipInstance = {
      ...found.item,
      itemId: ctx.id(),
      startMs: op.atMs,
      sourceInMs: found.item.sourceInMs + offset,
      transitionIn: undefined,
      transitionInMs: undefined,
    };
    found.item.endMs = op.atMs;
    found.item.sourceOutMs = found.item.sourceInMs + offset;
    found.item.transitionOut = undefined;
    found.item.transitionOutMs = undefined;
    found.track.items.push(right);
    found.track.items.sort((a, b) => a.startMs - b.startMs);
    return { changed: [{ startMs: found.item.startMs, endMs: right.endMs, changes: ["split"] }] };
  }

  if (op.op === "trim") {
    const found = findItem(branch, op.itemId);
    if (!found) {
      throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" satisfies CommandError["code"] });
    }
    const startMs = op.startMs ?? found.item.startMs;
    const endMs = op.endMs ?? found.item.endMs;
    if (endMs <= startMs) {
      throw Object.assign(new Error("invalid trim"), { code: "INVALID_RANGE" satisfies CommandError["code"] });
    }
    const trimChanged = {
      startMs: Math.min(found.item.startMs, startMs),
      endMs: Math.max(found.item.endMs, endMs),
    };
    const trimLock = lockHits(branch, [trimChanged]);
    if (trimLock) {
      if (required) throw lockedRangeError(trimLock);
      return skippedLockedOperation(op.op, trimLock, "Skipped a trim that intersects a protected range.");
    }
    const deltaIn = startMs - found.item.startMs;
    const deltaOut = found.item.endMs - endMs;
    found.item.startMs = startMs;
    found.item.endMs = endMs;
    found.item.sourceInMs += deltaIn;
    found.item.sourceOutMs -= deltaOut;
    branch.durationMs = recomputeDuration(branch);
    return { changed: [{ ...trimChanged, changes: ["trim"] }] };
  }

  if (op.op === "delete") {
    const found = findItem(branch, op.itemId);
    if (!found) {
      throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" satisfies CommandError["code"] });
    }
    const changed = [{ startMs: found.item.startMs, endMs: found.item.endMs, changes: ["delete"] }];
    const hit = lockHits(branch, changed);
    if (hit) {
      if (required) throw lockedRangeError(hit);
      return skippedLockedOperation(op.op, hit, "Skipped deleting a clip in a protected range.");
    }
    found.track.items.splice(found.index, 1);
    branch.durationMs = recomputeDuration(branch);
    return { changed };
  }

  if (op.op === "move") {
    const found = findItem(branch, op.itemId);
    if (!found) {
      throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" satisfies CommandError["code"] });
    }
    const dur = found.item.endMs - found.item.startMs;
    const moveChanged = {
      startMs: Math.min(found.item.startMs, op.startMs),
      endMs: Math.max(found.item.endMs, op.startMs + dur),
    };
    const moveLock = lockHits(branch, [moveChanged]);
    if (moveLock) {
      if (required) throw lockedRangeError(moveLock);
      return skippedLockedOperation(op.op, moveLock, "Skipped a move that intersects a protected range.");
    }
    found.item.startMs = op.startMs;
    found.item.endMs = op.startMs + dur;
    found.track.items.sort((a, b) => a.startMs - b.startMs);
    branch.durationMs = recomputeDuration(branch);
    return { changed: [{ ...moveChanged, changes: ["move"] }] };
  }

  if (op.op === "place_clip") {
    const assetErr = assetCheck(state, op.assetId);
    if (assetErr) throw Object.assign(new Error(assetErr.message), { code: assetErr.code });
    const linkGroupId = op.trackId === "v1" ? ctx.id() : undefined;
    const item = buildPlacedItem(state, branch, ctx, {
      assetId: op.assetId,
      trackId: op.trackId,
      startMs: op.startMs,
      durationMs: op.durationMs,
      sourceInMs: op.sourceInMs,
      linkGroupId,
    });
    const hit = lockHits(branch, [{ startMs: item.startMs, endMs: item.endMs }]);
    if (hit && !required) return skippedLockedOperation(op.op, hit, "Skipped placing a clip in a protected range.");
    const changed = placeOnTrack(branch, item, false, required, "place_clip");
    const asset = state.assets.find((candidate) => candidate.assetId === op.assetId);
    if (changed.length && op.trackId === "v1" && asset?.kind === "video" && asset.hasAudio !== false) {
      const audioItem = buildPlacedItem(state, branch, ctx, {
        assetId: op.assetId,
        trackId: "a1",
        startMs: op.startMs,
        durationMs: item.endMs - item.startMs,
        sourceInMs: op.sourceInMs,
        gain: 1,
        linkGroupId,
      });
      changed.push(...placeOnTrack(branch, audioItem, false, required, "place_linked_audio"));
    }
    return { changed };
  }

  if (op.op === "place_audio") {
    const assetErr = assetCheck(state, op.assetId);
    if (assetErr) throw Object.assign(new Error(assetErr.message), { code: assetErr.code });
    const item = buildPlacedItem(state, branch, ctx, {
      assetId: op.assetId,
      trackId: op.trackId,
      startMs: op.startMs,
      durationMs: op.durationMs,
      sourceInMs: op.sourceInMs,
      gain: op.gain,
    });
    const hit = lockHits(branch, [{ startMs: item.startMs, endMs: item.endMs }]);
    if (hit && !required) return skippedLockedOperation(op.op, hit, "Skipped placing audio in a protected range.");
    return { changed: placeOnTrack(branch, item, false, required, "place_audio") };
  }

  if (op.op === "set_transition") {
    const found = findItem(branch, op.itemId);
    if (!found) throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" });
    const hit = lockHits(branch, [{ startMs: found.item.startMs, endMs: found.item.endMs }]);
    if (hit) {
      if (required) throw lockedRangeError(hit);
      return skippedLockedOperation(op.op, hit, "Skipped changing a transition in a protected range.");
    }
    applyTransition(branch, op.itemId, op.transitionIn, op.transitionOut, op.fadeMs);
    return { changed: [{ startMs: found.item.startMs, endMs: found.item.endMs, changes: ["set_transition"] }] };
  }

  if (op.op === "add_transition") {
    try {
      const applied = applyTransitionBetween(branch, op.fromItemId, op.toItemId, op.transition, op.durationMs);
      return { changed: [{ ...applied.changedRange, changes: ["add_transition"] }] };
    } catch (error) {
      const coded = error as Error & { code?: CommandError["code"]; lockId?: string };
      if (!required && coded.code === "LOCKED_RANGE") {
        return {
          skipped: { op: op.op, reason: "LOCKED_RANGE" },
          warning: { code: "LOCKED_RANGE", message: "Skipped a transition in a protected range.", lockId: coded.lockId },
          changed: [],
        };
      }
      throw error;
    }
  }

  if (op.op === "set_gain") {
    const found = findItem(branch, op.itemId);
    if (!found) throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" });
    const hit = lockHits(branch, [{ startMs: found.item.startMs, endMs: found.item.endMs }]);
    if (hit) {
      if (required) throw lockedRangeError(hit);
      return skippedLockedOperation(op.op, hit, "Skipped changing gain in a protected range.");
    }
    applyGain(branch, op.itemId, op.gain);
    return { changed: [{ startMs: found.item.startMs, endMs: found.item.endMs, changes: ["set_gain"] }] };
  }

  if (op.op === "mute_track") {
    const hit = lockHits(branch, [{ startMs: 0, endMs: branch.durationMs }]);
    if (hit) {
      if (required) throw lockedRangeError(hit);
      return skippedLockedOperation(op.op, hit, "Skipped muting a track that contains protected material.");
    }
    applyMute(branch, op.trackId, op.muted);
    return { changed: [{ startMs: 0, endMs: branch.durationMs, changes: ["mute_track"] }] };
  }

  if (op.op === "set_link") {
    if (op.itemIds.length < 1 || op.itemIds.length > 20) throw Object.assign(new Error("Choose between 1 and 20 clips to update linking"), { code: "VALIDATION_ERROR" });
    if (op.linked && op.itemIds.length < 2) throw Object.assign(new Error("Choose at least two clips to link"), { code: "VALIDATION_ERROR" });
    const found = op.itemIds.map((itemId) => findItem(branch, itemId));
    if (found.some((item) => !item)) throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" });
    const ranges = found.map((item) => ({ startMs: item!.item.startMs, endMs: item!.item.endMs }));
    const hit = lockHits(branch, ranges);
    if (hit) {
      if (required) throw lockedRangeError(hit);
      return skippedLockedOperation(op.op, hit, "Skipped changing clip links in a protected range.");
    }
    const groupId = op.linked ? ctx.id() : null;
    for (const item of found) item!.item.linkGroupId = groupId;
    return { changed: ranges.map((range) => ({ ...range, changes: [op.linked ? "link_clips" : "unlink_clips"] })) };
  }

  throw Object.assign(new Error("unsupported"), { code: "UNSUPPORTED_OPERATION" satisfies CommandError["code"] });
}

type LinkedEdit = Extract<EditOp, { op: "split" | "move" | "trim" | "delete" }>;
type OpResult = ReturnType<typeof applyOp>;
type LinkedEcho = { operation: LinkedEdit; result: OpResult };

function applyLinkedOp(state: EditorState, branch: Branch, op: EditOp, ctx: BusContext, echoes: Map<string, LinkedEcho>): OpResult {
  if (op.op !== "split" && op.op !== "move" && op.op !== "trim" && op.op !== "delete") {
    if (["set_link", "ripple_delete", "replace_range", "extend_still"].includes(op.op)) echoes.clear();
    return applyOp(state, branch, op, ctx);
  }
  const key = `${op.op}:${op.itemId}`;
  const echo = echoes.get(key);
  if (echo) {
    const expected = echo.operation;
    const currentItem = findItem(branch, op.itemId)?.item;
    const stillEquivalent = echo.result.skipped || op.op === "delete" || (currentItem && (
      (expected.op === "split" && currentItem.endMs === expected.atMs)
      || (expected.op === "move" && Math.abs(currentItem.startMs - expected.startMs) < 0.001)
      || (expected.op === "trim" && Math.abs(currentItem.startMs - expected.startMs!) < 0.001 && Math.abs(currentItem.endMs - expected.endMs!) < 0.001)
    ));
    const matches = op.op === "delete"
      || (op.op === "split" && expected.op === "split" && op.atMs === expected.atMs)
      || (op.op === "move" && expected.op === "move" && Math.abs(op.startMs - expected.startMs) < 0.001)
      || (op.op === "trim" && expected.op === "trim"
        && (op.startMs === undefined || Math.abs(op.startMs - expected.startMs!) < 0.001)
        && (op.endMs === undefined || Math.abs(op.endMs - expected.endMs!) < 0.001));
    if (!matches || !stillEquivalent) throw Object.assign(new Error("Conflicting edits target linked clips. Unlink them before editing independently."), { code: "VALIDATION_ERROR" });
    echoes.delete(key);
    if (echo.result.skipped && op.required !== false) {
      throw Object.assign(new Error("A linked clip is protected"), { code: "LOCKED_RANGE", lockId: echo.result.warning?.lockId });
    }
    return { ...echo.result, changed: [] };
  }

  const members = linkedItems(branch, op.itemId).map((item) => ({ ...item }));
  const anchor = members.find((item) => item.itemId === op.itemId);
  if (!anchor) return applyOp(state, branch, op, ctx);
  const operations: LinkedEdit[] = members.map((item) => {
    if (op.op === "move") return { ...op, itemId: item.itemId, startMs: item.startMs + op.startMs - anchor.startMs };
    if (op.op === "trim") return { ...op, itemId: item.itemId,
      startMs: item.startMs + (op.startMs ?? anchor.startMs) - anchor.startMs,
      endMs: item.endMs + (op.endMs ?? anchor.endMs) - anchor.endMs };
    return { ...op, itemId: item.itemId };
  });
  const ranges = operations.map((operation, index) => {
    const item = members[index];
    if (operation.op === "split") return { startMs: operation.atMs, endMs: operation.atMs + 1 };
    if (operation.op === "move") return { startMs: Math.min(item.startMs, operation.startMs), endMs: Math.max(item.endMs, operation.startMs + item.endMs - item.startMs) };
    if (operation.op === "trim") return { startMs: Math.min(item.startMs, operation.startMs!), endMs: Math.max(item.endMs, operation.endMs!) };
    return { startMs: item.startMs, endMs: item.endMs };
  });
  const hit = lockHits(branch, ranges);
  let result: OpResult;
  if (hit) {
    if (op.required !== false) throw lockedRangeError(hit);
    result = skippedLockedOperation(op.op, hit, "Skipped the entire linked edit because a clip is protected.");
  } else {
    const priorIds = new Set(branch.tracks.flatMap((track) => track.items.map((item) => item.itemId)));
    result = { changed: operations.flatMap((operation) => applyOp(state, branch, { ...operation, required: true }, ctx).changed) };
    if (op.op === "split" && (members.length > 1 || anchor.linkGroupId)) {
      const leftGroup = ctx.id();
      const rightGroup = ctx.id();
      const memberIds = new Set(members.map((item) => item.itemId));
      for (const track of branch.tracks) for (const item of track.items) {
        if (memberIds.has(item.itemId)) item.linkGroupId = leftGroup;
        else if (!priorIds.has(item.itemId)) item.linkGroupId = rightGroup;
      }
    }
  }
  for (const operation of operations) {
    echoes.delete(`${operation.op}:${operation.itemId}`);
    if (operation.itemId !== op.itemId) echoes.set(`${operation.op}:${operation.itemId}`, { operation, result });
  }
  return result;
}

function mapTranscript(state: EditorState, branch: Branch) {
  const v1 = branch.tracks.find((t) => t.trackId === "v1");
  if (!v1?.items.length) return state.transcript;
  return state.transcript.flatMap((segment) => {
    const mappedWords = (segment.words ?? []).flatMap((word) => {
      const hit = v1.items.find((item) => word.startMs >= item.sourceInMs && word.startMs < item.sourceOutMs);
      if (!hit) return [];
      const startMs = hit.startMs + (word.startMs - hit.sourceInMs);
      const endMs = hit.startMs + (word.endMs - hit.sourceInMs);
      return [{ ...word, startMs, endMs }];
    });
    if (!mappedWords.length && !segment.markers?.includes("silence")) return [];
    if (!mappedWords.length) return [];
    return [
      {
        ...segment,
        startMs: mappedWords[0].startMs,
        endMs: mappedWords[mappedWords.length - 1].endMs,
        words: mappedWords,
      },
    ];
  });
}

export function readMappedTranscript(state: EditorState, branchId: string) {
  const branch = state.branches[branchId];
  if (!branch) return [];
  return mapTranscript(state, branch);
}

export function applyCommand(state: EditorState, command: Command, ctx: BusContext): Result {
  const unwritable = requireWritableBranch(state, command);
  if (unwritable) return fail(unwritable);

  if (command.type === "ResetProject") {
    return {
      ok: true,
      state,
      receipt: {
        operationId: ctx.id(),
        summary: "Reset is handled by the store against the canonical snapshot.",
        stateDigest: digestProject(state),
        changedRanges: [],
        warnings: [],
      },
    };
  }

  try {
    const next = produce(state, (draft) => {
      for (const branch of Object.values(draft.branches)) {
        ensureStandardTracks(branch);
      }

      if (command.type === "SetAgentPolicy") {
        draft.project.agentMutationPolicy = command.payload.policy;
        const receipt: Receipt = {
          operationId: ctx.id(),
          summary: command.payload.policy === "plan_only" ? "Agent edits now require review." : "Agent edits may apply directly.",
          stateDigest: digestProject(draft),
          changedRanges: [],
          warnings: [],
        };
        pushEvent(draft, ctx, command, receipt);
        (draft as EditorState & { __receipt?: Receipt }).__receipt = receipt;
        return;
      } else if (command.type === "ImportAsset") {
        const invalid = validateImport(command.payload);
        if (invalid) throw Object.assign(new Error(invalid.message), { code: invalid.code });
        const assetId = command.payload.assetId ?? ctx.id();
        if (draft.assets.some((asset) => asset.assetId === assetId)) {
          throw Object.assign(new Error("asset already exists"), { code: "VALIDATION_ERROR" });
        }
        draft.assets.push({
          assetId,
          kind: command.payload.kind,
          label: command.payload.label,
          uri: command.payload.uri,
          durationMs: command.payload.durationMs,
          width: command.payload.width,
          height: command.payload.height,
          checksum: command.payload.checksum,
          checksumAlgorithm: command.payload.checksumAlgorithm,
          availability: "ready",
          preparedTags: ["imported"],
          posterUri: command.payload.posterUri,
          mime: command.payload.mime,
          bytes: command.payload.bytes,
          imported: true,
          hasAudio: command.payload.hasAudio,
          videoCodec: command.payload.videoCodec,
          audioCodec: command.payload.audioCodec,
          waveformPeaks: command.payload.waveformPeaks,
          proxyAssetId: command.payload.proxyAssetId,
          proxyUri: command.payload.proxyUri,
          proxyBytes: command.payload.proxyBytes,
          proxyStatus: command.payload.proxyStatus,
        });
        const receipt: Receipt = {
          operationId: ctx.id(),
          summary: `Imported ${command.payload.label}.`,
          stateDigest: digestProject(draft),
          changedRanges: [],
          warnings: [],
        };
        pushEvent(draft, ctx, command, receipt);
        (draft as EditorState & { __receipt?: Receipt }).__receipt = receipt;
        return;
      }

      if (command.type === "ImportTranscript") {
        if (!command.payload.segments.length || command.payload.segments.length > 10_000) {
          throw Object.assign(new Error("Transcript must contain between 1 and 10,000 timed cues"), { code: "VALIDATION_ERROR" });
        }
        const previousCount = draft.transcript.length;
        draft.transcript = structuredClone(command.payload.segments);
        let clearedCaptionCount = 0;
        for (const branch of Object.values(draft.branches)) {
          if (!branch.captions.length) continue;
          clearedCaptionCount += branch.captions.length;
          branch.captions = [];
          bump(branch, ctx.id());
        }
        const receipt: Receipt = {
          operationId: ctx.id(),
          summary: `Attached ${command.payload.segments.length} transcript cues from ${command.payload.label}.`,
          stateDigest: digestProject(draft),
          changedRanges: [],
          warnings: clearedCaptionCount
            ? [{ code: "CAPTIONS_RESET", message: `Cleared ${clearedCaptionCount} caption cues so they can be regenerated from the new transcript.` }]
            : previousCount
              ? [{ code: "TRANSCRIPT_REPLACED", message: `Replaced ${previousCount} existing transcript cues.` }]
              : [],
        };
        pushEvent(draft, ctx, command, receipt);
        (draft as EditorState & { __receipt?: Receipt }).__receipt = receipt;
        return;
      }

      if (command.type === "CreateBranch") {
        const base = getBranch(draft, command.payload.baseBranchId);
        if (!base) throw Object.assign(new Error("branch"), { code: "BRANCH_NOT_FOUND" });
        const versionErr = versionCheck(base, command.payload.expectedBaseVersion);
        if (versionErr) throw Object.assign(new Error(versionErr.message), versionErr);
        if (command.payload.name.length < 1 || command.payload.name.length > 48) {
          throw Object.assign(new Error("name"), { code: "VALIDATION_ERROR" });
        }
        if (Object.keys(draft.branches).length >= 8) {
          throw Object.assign(new Error("branch limit"), { code: "VALIDATION_ERROR" });
        }
        const branchId = ctx.id();
        const clone = structuredClone(current(base));
        clone.branchId = branchId;
        clone.name = command.payload.name;
        clone.baseBranchId = base.branchId;
        clone.baseDigest = digestBranch(base);
        clone.branchVersion = 0;
        clone.operationIds = [];
        clone.status = "working";
        draft.branches[branchId] = clone;
        draft.history[branchId] = { undo: [], redo: [] };
        draft.project.activeBranchId = branchId;
        const receipt = receiptFor(ctx, clone, draft, `Created working branch “${clone.name}”.`);
        draft.events.push({
          eventId: ctx.id(),
          at: ctx.now(),
          actorType: command.actor.type,
          commandType: command.type,
          branchId,
          branchVersion: 0,
          summary: receipt.summary,
        });
        (draft as EditorState & { __receipt?: Receipt }).__receipt = receipt;
        return;
      }

      if (command.type === "SelectActiveBranch") {
        if (!draft.branches[command.payload.branchId]) {
          throw Object.assign(new Error("branch"), { code: "BRANCH_NOT_FOUND" });
        }
        draft.project.activeBranchId = command.payload.branchId;
        const branch = draft.branches[command.payload.branchId];
        (draft as EditorState & { __receipt?: Receipt }).__receipt = receiptFor(
          ctx,
          branch,
          draft,
          `Viewing ${branch.name}`,
        );
        return;
      }

      if (command.type === "Undo") {
        const stack = draft.history[command.payload.branchId];
        if (!stack?.undo.length) {
          throw Object.assign(new Error("nothing to undo"), { code: "VALIDATION_ERROR" });
        }
        const entry = stack.undo.pop()!;
        stack.redo.push(entry);
        draft.branches[command.payload.branchId] = structuredClone(current(entry.before));
        const branch = draft.branches[command.payload.branchId];
        (draft as EditorState & { __receipt?: Receipt }).__receipt = receiptFor(
          ctx,
          branch,
          draft,
          "Undid last edit group.",
        );
        return;
      }

      if (command.type === "Redo") {
        const stack = draft.history[command.payload.branchId];
        if (!stack?.redo.length) {
          throw Object.assign(new Error("nothing to redo"), { code: "VALIDATION_ERROR" });
        }
        const entry = stack.redo.pop()!;
        stack.undo.push(entry);
        draft.branches[command.payload.branchId] = structuredClone(current(entry.after));
        const branch = draft.branches[command.payload.branchId];
        (draft as EditorState & { __receipt?: Receipt }).__receipt = receiptFor(
          ctx,
          branch,
          draft,
          "Redid last edit group.",
        );
        return;
      }

      const branchId =
        "payload" in command && command.payload && "branchId" in command.payload
          ? command.payload.branchId
          : draft.project.activeBranchId;
      const branch = getBranch(draft, branchId);
      if (!branch) throw Object.assign(new Error("branch"), { code: "BRANCH_NOT_FOUND" });
      const before = structuredClone(current(branch));

      if ("payload" in command && command.payload && "expectedBranchVersion" in command.payload) {
        const versionErr = versionCheck(branch, command.payload.expectedBranchVersion);
        if (versionErr) throw Object.assign(new Error(versionErr.message), versionErr);
      }

      let receipt: Receipt;

      if (command.type === "ApplyEditBatch") {
        if (command.payload.operations.length > MAX_BATCH_OPS) {
          throw Object.assign(new Error("too many ops"), { code: "VALIDATION_ERROR" });
        }
        const skipped: { op: string; reason: string }[] = [];
        const warnings: Warning[] = [];
        const changed: ChangedRange[] = [];
        let applied = 0;
        const durationBefore = branch.durationMs;
        const linkedEchoes = new Map<string, LinkedEcho>();
        for (const op of command.payload.operations) {
          const result = applyLinkedOp(draft, branch, op, ctx, linkedEchoes);
          if (result.skipped) {
            skipped.push(result.skipped);
            if (result.warning) warnings.push(result.warning);
            continue;
          }
          applied += 1;
          changed.push(...result.changed);
        }
        const violations = collectInvariantViolations(branch, draft.assets);
        if (violations.length) {
          throw Object.assign(new Error(violations.join("; ")), {
            code: "INVARIANT_VIOLATION",
            violations,
          });
        }
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, `Applied ${applied} of ${command.payload.operations.length} requested edits.`, {
          operationId,
          appliedOperationCount: applied,
          skippedOperations: skipped,
          warnings,
          changedRanges: changed,
          durationDeltaMs: branch.durationMs - durationBefore,
          verification: { action: "preview_range", startMs: 0, endMs: Math.min(8000, branch.durationMs) },
        });
      } else if (command.type === "StyleCaptions") {
        const mapped = mapTranscript(draft, branch);
        const { cues, overflowWarnings } = segmentCaptions({
          words: flattenWords(mapped),
          range: command.payload.range,
          preset: command.payload.preset,
          maxLines: command.payload.maxLines,
          maxCharsPerLine: command.payload.maxCharsPerLine,
          id: ctx.id,
        });
        if (command.payload.range) {
          branch.captions = branch.captions.filter(
            (cue) => !rangesIntersect(cue, command.payload.range!),
          );
          branch.captions.push(...cues);
          branch.captions.sort((a, b) => a.startMs - b.startMs);
        } else {
          branch.captions = cues;
        }
        branch.captionStyle = {
          preset: command.payload.preset,
          emphasis: command.payload.emphasis,
          maxLines: command.payload.maxLines,
          maxCharsPerLine: command.payload.maxCharsPerLine,
        };
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, `Styled ${cues.length} caption cues.`, {
          operationId,
          warnings: overflowWarnings.map((message) => ({ code: "CAPTION_OVERFLOW", message })),
          changedRanges: cues.length
            ? [{ startMs: cues[0].startMs, endMs: cues[cues.length - 1].endMs, changes: ["caption_reflow"] }]
            : [],
        });
      } else if (command.type === "PlaceBroll") {
        const assetErr = assetCheck(draft, command.payload.assetId);
        if (assetErr) throw Object.assign(new Error(assetErr.message), assetErr);
        if (!isValidRange(command.payload.range)) {
          throw Object.assign(new Error("invalid range"), { code: "INVALID_RANGE" });
        }
        const hit = lockHits(branch, [command.payload.range]);
        if (hit) {
          throw Object.assign(new Error("locked"), { code: "LOCKED_RANGE", lockId: hit.lockId });
        }
        const track = branch.tracks.find((t) => t.trackId === "v2");
        if (!track) throw Object.assign(new Error("v2"), { code: "INVARIANT_VIOLATION" });
        if (command.payload.replaceExisting) {
          track.items = track.items.filter((item) => !rangesIntersect(item, command.payload.range));
        }
        const asset = draft.assets.find((a) => a.assetId === command.payload.assetId)!;
        const sourceInMs = command.payload.sourceInMs ?? 0;
        const dur = rangeDuration(command.payload.range);
        const item: ClipInstance = {
          itemId: ctx.id(),
          assetId: command.payload.assetId,
          trackId: "v2",
          startMs: command.payload.range.startMs,
          endMs: command.payload.range.endMs,
          sourceInMs,
          sourceOutMs: sourceInMs + dur,
          label: asset.label,
          fit: command.payload.fit,
          anchor: command.payload.anchor,
          transitionIn: command.payload.transitionIn,
          transitionOut: command.payload.transitionOut,
        };
        if (asset.durationMs && item.sourceOutMs > asset.durationMs && (asset.kind === "video" || asset.kind === "audio")) {
          item.sourceOutMs = asset.durationMs;
          item.endMs = item.startMs + (item.sourceOutMs - item.sourceInMs);
        }
        track.items.push(item);
        track.items.sort((a, b) => a.startMs - b.startMs);
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, `Placed ${asset.label} on V2.`, {
          operationId,
          changedRanges: [{ startMs: item.startMs, endMs: item.endMs, changes: ["place_broll"] }],
        });
      } else if (command.type === "SetCrop") {
        if (command.payload.target.kind === "project") {
          if (command.payload.aspectRatio) branch.crop.aspectRatio = command.payload.aspectRatio;
          if (command.payload.anchor) branch.crop.anchor = command.payload.anchor;
          if (command.payload.normalizedCenter) branch.crop.normalizedCenter = command.payload.normalizedCenter;
          if (command.payload.scale) branch.crop.scale = command.payload.scale;
          if (branch.crop.anchor === "face" || branch.crop.anchor === "safe_region") {
            const primaryClip = branch.tracks.find((track) => track.trackId === "v1")?.items[0];
            const primaryAsset = primaryClip
              ? draft.assets.find((asset) => asset.assetId === primaryClip.assetId)
              : undefined;
            const region = primaryAsset?.safeRegions?.find((candidate) => candidate.name === branch.crop.anchor)
              ?? primaryAsset?.safeRegions?.[0];
            if (region) {
              branch.crop.normalizedCenter = {
                x: region.x + region.width / 2,
                y: region.y + region.height / 2,
              };
            }
          }
        } else {
          const found = findItem(branch, command.payload.target.itemId);
          if (!found) throw Object.assign(new Error("clip"), { code: "INVARIANT_VIOLATION" });
          found.item.anchor = command.payload.anchor ?? found.item.anchor;
          if (command.payload.normalizedCenter && command.payload.scale) {
            found.item.transform = {
              x: command.payload.normalizedCenter.x,
              y: command.payload.normalizedCenter.y,
              scale: command.payload.scale,
            };
          }
        }
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, `Updated crop to ${branch.crop.aspectRatio}.`, {
          operationId,
          changedRanges: [{ startMs: 0, endMs: branch.durationMs, changes: ["crop"] }],
        });
      } else if (command.type === "AddComment") {
        branch.comments.push({
          commentId: ctx.id(),
          authorType: command.actor.type,
          range: command.payload.range,
          text: command.payload.text,
          status: "open",
        });
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, "Pinned a time-coded comment.", {
          operationId,
          changedRanges: [command.payload.range],
        });
      } else if (command.type === "ProposeCommentResolution") {
        const comment = branch.comments.find((c) => c.commentId === command.payload.commentId);
        if (!comment) throw Object.assign(new Error("comment"), { code: "VALIDATION_ERROR" });
        comment.resolutionProposal = command.payload.proposal;
        comment.status = "resolved";
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, "Resolved comment.", { operationId, changedRanges: [comment.range] });
      } else if (command.type === "SetLock") {
        let changedRange: TimeRange | null = null;
        if (command.payload.action === "lock") {
          if (!isValidRange(command.payload.range) || command.payload.range.endMs > branch.durationMs) {
            throw Object.assign(new Error("Lock range must be ordered and within the branch duration"), { code: "INVALID_RANGE" });
          }
          branch.locks.push({
            lockId: ctx.id(),
            startMs: command.payload.range.startMs,
            endMs: command.payload.range.endMs,
            label: command.payload.label,
            createdAt: ctx.now(),
            createdBy: command.actor.type,
          });
          changedRange = command.payload.range;
        } else if (command.payload.action === "unlock") {
          const lockId = command.payload.lockId;
          const existing = branch.locks.find((lock) => lock.lockId === lockId);
          if (!existing) throw Object.assign(new Error("Unknown lock"), { code: "VALIDATION_ERROR" });
          changedRange = { startMs: existing.startMs, endMs: existing.endMs };
          branch.locks = branch.locks.filter((lock) => lock.lockId !== lockId);
        }
        const operationId = ctx.id();
        if (!changedRange) throw Object.assign(new Error("Lock change did not resolve a range"), { code: "VALIDATION_ERROR" });
        bump(branch, operationId);
        receipt = receiptFor(
          ctx,
          branch,
          draft,
          command.payload.action === "lock" ? "Protected a range." : "Removed a lock.",
          { operationId, changedRanges: [{ ...changedRange, changes: [command.payload.action === "lock" ? "lock_range" : "unlock_range"] }] },
        );
      } else if (command.type === "AcceptBranch") {
        for (const candidate of Object.values(draft.branches)) {
          if (candidate.status === "accepted") candidate.status = "working";
        }
        branch.status = "accepted";
        draft.project.selectedFinalBranchId = branch.branchId;
        const operationId = ctx.id();
        receipt = receiptFor(ctx, branch, draft, `Selected ${branch.name} as the final cut.`, { operationId });
      } else if (command.type === "RecordExport") {
        draft.exports.push({
          exportId: ctx.id(),
          branchId: branch.branchId,
          stateDigest: digestBranch(branch),
          durationMs: branch.durationMs,
          width: command.payload.width,
          height: command.payload.height,
          createdAt: ctx.now(),
          uri: command.payload.uri,
          bytes: command.payload.bytes,
        });
        receipt = receiptFor(ctx, branch, draft, "Export recorded.", {
          changedRanges: [],
        });
      } else if (command.type === "PublishExport") {
        const artifact = draft.exports.find((candidate) => candidate.exportId === command.payload.exportId);
        if (!artifact || artifact.branchId !== branch.branchId) {
          throw Object.assign(new Error("Unknown export for this branch"), { code: "VALIDATION_ERROR" });
        }
        artifact.publishedAt = ctx.now();
        artifact.publishedBy = command.actor.type;
        receipt = receiptFor(ctx, branch, draft, "Published local export.", {
          changedRanges: [],
        });
      } else if (command.type === "PlaceClip") {
        const assetErr = assetCheck(draft, command.payload.assetId);
        if (assetErr) throw Object.assign(new Error(assetErr.message), assetErr);
        const linkGroupId = command.payload.trackId === "v1" ? ctx.id() : undefined;
        const item = buildPlacedItem(draft, branch, ctx, {
          assetId: command.payload.assetId,
          trackId: command.payload.trackId,
          startMs: command.payload.startMs,
          durationMs: command.payload.durationMs,
          sourceInMs: command.payload.sourceInMs,
          fit: command.payload.fit,
          anchor: command.payload.anchor,
          transitionIn: command.payload.transitionIn,
          transitionOut: command.payload.transitionOut,
          fadeMs: command.payload.fadeMs,
          linkGroupId,
        });
        const replaceExisting = command.payload.replaceExisting ?? false;
        const changed = placeOnTrack(branch, item, replaceExisting, true, "place_clip");
        const asset = draft.assets.find((entry) => entry.assetId === command.payload.assetId)!;
        if (command.payload.trackId === "v1" && asset.kind === "video" && asset.hasAudio !== false) {
          const audioItem = buildPlacedItem(draft, branch, ctx, {
            assetId: command.payload.assetId,
            trackId: "a1",
            startMs: command.payload.startMs,
            durationMs: item.endMs - item.startMs,
            sourceInMs: command.payload.sourceInMs,
            gain: 1,
            transitionIn: command.payload.transitionIn,
            transitionOut: command.payload.transitionOut,
            fadeMs: command.payload.fadeMs,
            linkGroupId,
          });
          changed.push(...placeOnTrack(branch, audioItem, replaceExisting, true, "place_linked_audio"));
        }
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, `Placed ${asset.label} on ${command.payload.trackId.toUpperCase()}${command.payload.trackId === "v1" && asset.kind === "video" && asset.hasAudio !== false ? " with linked audio" : ""}.`, {
          operationId,
          changedRanges: changed,
        });
      } else if (command.type === "PlaceAudio") {
        const assetErr = assetCheck(draft, command.payload.assetId);
        if (assetErr) throw Object.assign(new Error(assetErr.message), assetErr);
        if (!isValidRange(command.payload.range)) {
          throw Object.assign(new Error("invalid range"), { code: "INVALID_RANGE" });
        }
        const item = buildPlacedItem(draft, branch, ctx, {
          assetId: command.payload.assetId,
          trackId: command.payload.trackId,
          startMs: command.payload.range.startMs,
          durationMs: rangeDuration(command.payload.range),
          sourceInMs: command.payload.sourceInMs,
          gain: command.payload.gain,
          transitionIn: command.payload.transitionIn,
          transitionOut: command.payload.transitionOut,
          fadeMs: command.payload.fadeMs,
        });
        const changed = placeOnTrack(branch, item, command.payload.replaceExisting ?? false, true, "place_audio");
        const operationId = ctx.id();
        bump(branch, operationId);
        const asset = draft.assets.find((entry) => entry.assetId === command.payload.assetId)!;
        receipt = receiptFor(ctx, branch, draft, `Placed ${asset.label} on ${command.payload.trackId.toUpperCase()}.`, {
          operationId,
          changedRanges: changed,
        });
      } else if (command.type === "SetTransition") {
        const target = findItem(branch, command.payload.itemId);
        if (!target) throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" });
        const hit = lockHits(branch, [{ startMs: target.item.startMs, endMs: target.item.endMs }]);
        if (hit) throw lockedRangeError(hit);
        applyTransition(
          branch,
          command.payload.itemId,
          command.payload.transitionIn,
          command.payload.transitionOut,
          command.payload.fadeMs,
        );
        const found = findItem(branch, command.payload.itemId)!;
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, "Updated clip transition.", {
          operationId,
          changedRanges: [{ startMs: found.item.startMs, endMs: found.item.endMs, changes: ["set_transition"] }],
        });
      } else if (command.type === "AddTransition") {
        const applied = applyTransitionBetween(
          branch,
          command.payload.fromItemId,
          command.payload.toItemId,
          command.payload.transition,
          command.payload.durationMs,
        );
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(
          ctx,
          branch,
          draft,
          command.payload.transition === "cut"
            ? `Removed the transition between ${applied.from.item.label} and ${applied.to.item.label}.`
            : `Added a ${command.payload.transition.replaceAll("_", " ")} transition between ${applied.from.item.label} and ${applied.to.item.label}.`,
          {
            operationId,
            changedRanges: [{ ...applied.changedRange, changes: ["add_transition"] }],
            verification: {
              action: "preview_range",
              startMs: Math.max(0, applied.to.item.startMs - Math.max(applied.durationMs, 500)),
              endMs: Math.min(branch.durationMs, applied.to.item.startMs + 500),
            },
          },
        );
      } else if (command.type === "SetGain") {
        const target = findItem(branch, command.payload.itemId);
        if (!target) throw Object.assign(new Error("unknown item"), { code: "INVARIANT_VIOLATION" });
        const hit = lockHits(branch, [{ startMs: target.item.startMs, endMs: target.item.endMs }]);
        if (hit) throw lockedRangeError(hit);
        applyGain(branch, command.payload.itemId, command.payload.gain);
        const found = findItem(branch, command.payload.itemId)!;
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(ctx, branch, draft, `Set gain to ${command.payload.gain}.`, {
          operationId,
          changedRanges: [{ startMs: found.item.startMs, endMs: found.item.endMs, changes: ["set_gain"] }],
        });
      } else if (command.type === "MuteTrack") {
        const hit = lockHits(branch, [{ startMs: 0, endMs: branch.durationMs }]);
        if (hit) throw lockedRangeError(hit);
        applyMute(branch, command.payload.trackId, command.payload.muted);
        const operationId = ctx.id();
        bump(branch, operationId);
        receipt = receiptFor(
          ctx,
          branch,
          draft,
          command.payload.muted ? `Muted ${command.payload.trackId.toUpperCase()}.` : `Unmuted ${command.payload.trackId.toUpperCase()}.`,
          { operationId, changedRanges: [{ startMs: 0, endMs: branch.durationMs, changes: ["mute_track"] }] },
        );
      } else {
        throw Object.assign(new Error("unsupported"), { code: "UNSUPPORTED_OPERATION" });
      }

      const violations = collectInvariantViolations(branch, draft.assets);
      if (violations.length) throw Object.assign(new Error(violations.join("; ")), { code: "INVARIANT_VIOLATION", violations });
      if (command.type !== "AcceptBranch" && command.type !== "RecordExport" && command.type !== "PublishExport") {
        pushHistory(draft, branch.branchId, receipt.operationId, before, structuredClone(current(branch)));
      }
      pushEvent(draft, ctx, command, receipt);
      (draft as EditorState & { __receipt?: Receipt }).__receipt = receipt;
    });

    const receipt = (next as EditorState & { __receipt?: Receipt }).__receipt;
    if (!receipt) return fail({ code: "VALIDATION_ERROR", message: "No receipt" });
    const clean = produce(next, (draft) => {
      delete (draft as EditorState & { __receipt?: Receipt }).__receipt;
    });
    return { ok: true, state: clean, receipt };
  } catch (error) {
    const err = error as CommandError & Error;
    return fail({
      code: (err.code as CommandError["code"]) ?? "VALIDATION_ERROR",
      message: err.message,
      branchVersion: err.branchVersion,
      lockId: err.lockId,
      violations: err.violations,
    });
  }
}

export function createBusContext(seed = 0): BusContext {
  let n = seed;
  return {
    now: () => 0,
    id: () => `id_${String(++n).padStart(4, "0")}`,
  };
}
