type TelemetryEvent =
  | { event: "project_ready"; loadMs: number; assetCount: number }
  | { event: "tool_lifecycle"; toolName: string; phase: string; durationMs?: number; errorCode?: string }
  | { event: "command_committed"; actorType: string; commandType: string; branchVersion?: number; durationDeltaMs?: number }
  | { event: "decision"; actorType: "human" | "agent"; action: "accept" | "undo" | "redo" | "reject" }
  | { event: "export_completed"; preset: string; durationMs: number; digestPrefix: string };

const KEY = "cutline.telemetry";

export function track(event: TelemetryEvent) {
  if (typeof window === "undefined") return;
  const prev = JSON.parse(sessionStorage.getItem(KEY) || "[]") as unknown[];
  prev.push({ ...event, t: Date.now() });
  sessionStorage.setItem(KEY, JSON.stringify(prev.slice(-200)));
}

export function readTelemetry() {
  if (typeof window === "undefined") return [];
  return JSON.parse(sessionStorage.getItem(KEY) || "[]") as unknown[];
}
