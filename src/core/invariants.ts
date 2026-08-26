import { rangesOverlap } from "./time";
import type { Asset, Branch, ClipInstance, Track } from "./types";

export function collectInvariantViolations(branch: Branch, assets: Asset[] = []): string[] {
  const violations: string[] = [];
  if (branch.durationMs < 0) {
    violations.push("duration must be >= 0");
  }

  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  let maxEnd = 0;
  for (const track of branch.tracks) {
    const sorted = [...track.items].sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      maxEnd = Math.max(maxEnd, item.endMs);
      if (item.startMs >= item.endMs) {
        violations.push(`${item.itemId} has startMs >= endMs`);
      }
      if (item.sourceInMs >= item.sourceOutMs) {
        violations.push(`${item.itemId} has invalid source range`);
      }
      if (item.endMs - item.startMs !== item.sourceOutMs - item.sourceInMs) {
        violations.push(`${item.itemId} project duration does not match source duration`);
      }
      const asset = assetById.get(item.assetId);
      if (asset?.durationMs && (asset.kind === "video" || asset.kind === "audio")) {
        if (item.sourceInMs < 0 || item.sourceOutMs > asset.durationMs) {
          violations.push(`${item.itemId} source exceeds asset bounds`);
        }
      }
      if (i > 0 && !allowsOverlap(track) && rangesOverlap(sorted[i - 1], item)) {
        violations.push(`${track.trackId} overlap between ${sorted[i - 1].itemId} and ${item.itemId}`);
      }
    }
  }

  for (const cue of branch.captions) {
    maxEnd = Math.max(maxEnd, cue.endMs);
    if (cue.startMs >= cue.endMs) {
      violations.push(`${cue.cueId} has startMs >= endMs`);
    }
  }

  for (const lock of branch.locks) {
    if (lock.startMs >= lock.endMs) {
      violations.push(`${lock.lockId} has startMs >= endMs`);
    }
  }

  if (branch.durationMs !== maxEnd) {
    violations.push(`durationMs ${branch.durationMs} !== max material end ${maxEnd}`);
  }

  return violations;
}

export function allowsOverlap(track: Track): boolean {
  return track.kind === "video_overlay";
}

export function itemRange(item: Pick<ClipInstance, "startMs" | "endMs">) {
  return { startMs: item.startMs, endMs: item.endMs };
}

export function recomputeDuration(branch: Branch): number {
  let maxEnd = 0;
  for (const track of branch.tracks) {
    for (const item of track.items) {
      maxEnd = Math.max(maxEnd, item.endMs);
    }
  }
  for (const cue of branch.captions) {
    maxEnd = Math.max(maxEnd, cue.endMs);
  }
  return maxEnd;
}
