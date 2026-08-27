import type { BasicClipTransition, ClipInstance, Track } from "./types";

const TIME_EPSILON_MS = 0.001;

export const DEFAULT_TRANSITION_DURATION_MS: Record<BasicClipTransition, number> = {
  crossfade: 400,
  dissolve: 500,
  slide_left: 350,
  slide_right: 350,
  dip_to_black: 500,
};

export interface ClipTransitionBoundary {
  fromItemId: string;
  toItemId: string;
  trackId: string;
  atMs: number;
  durationMs: number;
  transition: BasicClipTransition;
}

export interface ActiveClipTransition extends ClipTransitionBoundary {
  outgoing: ClipInstance;
  incoming: ClipInstance;
  progress: number;
}

export interface TransitionLayerFrame {
  opacity: number;
  translateXPercent: number;
  scale: number;
}

export interface TransitionFrame {
  outgoing: TransitionLayerFrame;
  incoming: TransitionLayerFrame;
}

export function isBasicClipTransition(value: ClipInstance["transitionIn"]): value is BasicClipTransition {
  return value === "crossfade"
    || value === "dissolve"
    || value === "slide_left"
    || value === "slide_right"
    || value === "dip_to_black";
}

export function listClipTransitions(track: Pick<Track, "trackId" | "items">): ClipTransitionBoundary[] {
  const sorted = [...track.items].sort((left, right) => left.startMs - right.startMs || left.itemId.localeCompare(right.itemId));
  const transitions: ClipTransitionBoundary[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const outgoing = sorted[index];
    const incoming = sorted[index + 1];
    if (Math.abs(outgoing.endMs - incoming.startMs) > TIME_EPSILON_MS) continue;
    if (!isBasicClipTransition(outgoing.transitionOut) || outgoing.transitionOut !== incoming.transitionIn) continue;
    const requestedDuration = Math.min(
      outgoing.transitionOutMs ?? outgoing.fadeMs ?? 0,
      incoming.transitionInMs ?? incoming.fadeMs ?? 0,
    );
    const durationMs = Math.min(requestedDuration, outgoing.endMs - outgoing.startMs, incoming.endMs - incoming.startMs);
    if (durationMs <= 0) continue;
    transitions.push({
      fromItemId: outgoing.itemId,
      toItemId: incoming.itemId,
      trackId: track.trackId,
      atMs: incoming.startMs,
      durationMs,
      transition: outgoing.transitionOut,
    });
  }
  return transitions;
}

export function getActiveClipTransition(track: Pick<Track, "trackId" | "items">, timeMs: number): ActiveClipTransition | null {
  const boundary = listClipTransitions(track).find((candidate) => timeMs >= candidate.atMs - candidate.durationMs && timeMs < candidate.atMs);
  if (!boundary) return null;
  const outgoing = track.items.find((item) => item.itemId === boundary.fromItemId);
  const incoming = track.items.find((item) => item.itemId === boundary.toItemId);
  if (!outgoing || !incoming) return null;
  const linearProgress = (timeMs - (boundary.atMs - boundary.durationMs)) / boundary.durationMs;
  const progress = linearProgress * linearProgress * (3 - 2 * linearProgress);
  return { ...boundary, outgoing, incoming, progress };
}

export function getTransitionFrame(transition: BasicClipTransition, progress: number): TransitionFrame {
  const p = Math.max(0, Math.min(1, progress));
  const base = { translateXPercent: 0, scale: 1 };
  if (transition === "slide_left") {
    return {
      outgoing: { opacity: 1, translateXPercent: -100 * p, scale: 1 },
      incoming: { opacity: 1, translateXPercent: 100 * (1 - p), scale: 1 },
    };
  }
  if (transition === "slide_right") {
    return {
      outgoing: { opacity: 1, translateXPercent: 100 * p, scale: 1 },
      incoming: { opacity: 1, translateXPercent: -100 * (1 - p), scale: 1 },
    };
  }
  if (transition === "dip_to_black") {
    return {
      outgoing: { ...base, opacity: Math.max(0, 1 - p * 2) },
      incoming: { ...base, opacity: Math.max(0, (p - 0.5) * 2) },
    };
  }
  if (transition === "dissolve") {
    return {
      outgoing: { opacity: 1 - p, translateXPercent: 0, scale: 1 + p * 0.015 },
      incoming: { opacity: p, translateXPercent: 0, scale: 1.015 - p * 0.015 },
    };
  }
  return {
    outgoing: { ...base, opacity: 1 - p },
    incoming: { ...base, opacity: p },
  };
}
