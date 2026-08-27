import { sha256 } from "js-sha256";
import type { Branch, EditorState } from "./types";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      const v = rec[key];
      if (v === undefined) continue;
      out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function canonicalBranchState(branch: Branch) {
  return {
    branchId: branch.branchId,
    baseBranchId: branch.baseBranchId,
    durationMs: branch.durationMs,
    status: branch.status,
    tracks: branch.tracks.map((track) => ({
      trackId: track.trackId,
      kind: track.kind,
      order: track.order,
      locked: track.locked,
      muted: track.muted,
      hidden: track.hidden,
      items: [...track.items]
        .sort((a, b) => a.startMs - b.startMs || a.itemId.localeCompare(b.itemId))
        .map((item) => ({
          itemId: item.itemId,
          assetId: item.assetId,
          trackId: item.trackId,
          startMs: item.startMs,
          endMs: item.endMs,
          sourceInMs: item.sourceInMs,
          sourceOutMs: item.sourceOutMs,
          label: item.label,
          fit: item.fit ?? null,
          anchor: item.anchor ?? null,
          transform: item.transform ?? null,
          gain: item.gain ?? null,
          transitionIn: item.transitionIn ?? null,
          transitionOut: item.transitionOut ?? null,
          transitionInMs: item.transitionInMs ?? null,
          transitionOutMs: item.transitionOutMs ?? null,
          fadeMs: item.fadeMs ?? null,
        })),
    })),
    captions: [...branch.captions]
      .sort((a, b) => a.startMs - b.startMs || a.cueId.localeCompare(b.cueId))
      .map((cue) => ({
        cueId: cue.cueId,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        styleId: cue.styleId,
        words: cue.words ?? null,
      })),
    captionStyle: branch.captionStyle,
    locks: [...branch.locks]
      .sort((a, b) => a.startMs - b.startMs || a.lockId.localeCompare(b.lockId))
      .map((lock) => ({
        lockId: lock.lockId,
        startMs: lock.startMs,
        endMs: lock.endMs,
        label: lock.label,
      })),
    comments: [...branch.comments]
      .sort((a, b) => a.range.startMs - b.range.startMs || a.commentId.localeCompare(b.commentId))
      .map((comment) => ({
        commentId: comment.commentId,
        authorType: comment.authorType,
        range: comment.range,
        text: comment.text,
        status: comment.status,
        resolutionProposal: comment.resolutionProposal ?? null,
      })),
    crop: branch.crop,
  };
}

export function digestBranch(branch: Branch): string {
  const json = JSON.stringify(sortKeys(canonicalBranchState(branch)));
  return `sha256:${sha256(json)}`;
}

export function digestProject(state: EditorState): string {
  const payload = {
    projectId: state.project.projectId,
    schemaVersion: state.project.schemaVersion,
    activeBranchId: state.project.activeBranchId,
    selectedFinalBranchId: state.project.selectedFinalBranchId ?? null,
    assets: state.assets.map((asset) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      checksum: asset.checksum,
      durationMs: asset.durationMs ?? null,
    })),
    transcript: state.transcript.map((segment) => ({
      segmentId: segment.segmentId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
    branches: Object.keys(state.branches)
      .sort()
      .map((id) => ({
        branchId: id,
        digest: digestBranch(state.branches[id]),
        version: state.branches[id].branchVersion,
      })),
  };
  return `sha256:${sha256(JSON.stringify(sortKeys(payload)))}`;
}
