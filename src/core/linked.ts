import { rangesIntersect } from "./time";
import type { Branch, ClipInstance, TimeRange } from "./types";

/** Explicit groups take precedence; null deliberately disables legacy A/V linking. */
export function linkedItems(branch: Branch, itemId: string): ClipInstance[] {
  const items = branch.tracks.flatMap((track) => track.items);
  const item = items.find((candidate) => candidate.itemId === itemId);
  if (!item) return [];
  if (item.linkGroupId) return items.filter((candidate) => candidate.linkGroupId === item.linkGroupId);
  if (item.linkGroupId === null || !["v1", "a1"].includes(item.trackId)) return [item];
  const partnerTrack = item.trackId === "v1" ? "a1" : "v1";
  const partners = items.filter((candidate) => candidate.trackId === partnerTrack
    && candidate.linkGroupId === undefined && candidate.assetId === item.assetId
    && (["startMs", "endMs", "sourceInMs", "sourceOutMs"] as const).every((key) =>
      Math.abs(candidate[key] - item[key]) < 0.001));
  return partners.length === 1 ? [item, partners[0]] : [item];
}

/** Whole-clip replacement includes linked material, even on another track. */
export function placementConflicts(branch: Branch, trackIds: string[], range: TimeRange): ClipInstance[] {
  const conflicts = new Map<string, ClipInstance>();
  for (const track of branch.tracks.filter((candidate) => trackIds.includes(candidate.trackId))) {
    for (const item of track.items.filter((candidate) => rangesIntersect(candidate, range))) {
      for (const linked of linkedItems(branch, item.itemId)) conflicts.set(linked.itemId, linked);
    }
  }
  return [...conflicts.values()];
}
