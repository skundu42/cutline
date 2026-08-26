import type { Branch, ChangedRange, TimeRange } from "./types";

export interface BranchDelta {
  durationDeltaMs: number;
  addedItemIds: string[];
  removedItemIds: string[];
  changedItemIds: string[];
  captionStyleChanged: boolean;
  cropChanged: boolean;
  changedRanges: ChangedRange[];
  commentCoverage: { left: number; right: number };
}

function intersects(range: TimeRange | undefined, startMs: number, endMs: number) {
  return !range || (startMs < range.endMs && range.startMs < endMs);
}

function itemMap(branch: Branch, range?: TimeRange) {
  const map = new Map<string, { startMs: number; endMs: number; assetId: string; sourceInMs: number; sourceOutMs: number }>();
  for (const track of branch.tracks) {
    for (const item of track.items) {
      if (intersects(range, item.startMs, item.endMs)) map.set(item.itemId, item);
    }
  }
  return map;
}

export function compareBranches(left: Branch, right: Branch, range?: TimeRange): BranchDelta {
  const a = itemMap(left, range);
  const b = itemMap(right, range);
  const addedItemIds: string[] = [];
  const removedItemIds: string[] = [];
  const changedItemIds: string[] = [];
  const changedRanges: ChangedRange[] = [];

  for (const [id, item] of b) {
    const prev = a.get(id);
    if (!prev) {
      addedItemIds.push(id);
      changedRanges.push({ startMs: item.startMs, endMs: item.endMs, changes: ["added"] });
    } else if (
      prev.startMs !== item.startMs ||
      prev.endMs !== item.endMs ||
      prev.assetId !== item.assetId ||
      prev.sourceInMs !== item.sourceInMs ||
      prev.sourceOutMs !== item.sourceOutMs
    ) {
      changedItemIds.push(id);
      changedRanges.push({
        startMs: Math.min(prev.startMs, item.startMs),
        endMs: Math.max(prev.endMs, item.endMs),
        changes: ["changed"],
      });
    }
  }
  for (const [id, item] of a) {
    if (!b.has(id)) {
      removedItemIds.push(id);
      changedRanges.push({ startMs: item.startMs, endMs: item.endMs, changes: ["removed"] });
    }
  }

  return {
    durationDeltaMs: right.durationMs - left.durationMs,
    addedItemIds,
    removedItemIds,
    changedItemIds,
    captionStyleChanged: JSON.stringify(left.captionStyle) !== JSON.stringify(right.captionStyle),
    cropChanged: JSON.stringify(left.crop) !== JSON.stringify(right.crop),
    changedRanges,
    commentCoverage: {
      left: left.comments.filter((comment) => intersects(range, comment.range.startMs, comment.range.endMs)).length,
      right: right.comments.filter((comment) => intersects(range, comment.range.startMs, comment.range.endMs)).length,
    },
  };
}
