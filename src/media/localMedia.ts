import { wrap, type Remote } from "comlink";
import { inspectMediaBlob, type MediaInspection } from "./inspection";
import type { MediaInspectionWorkerApi } from "./inspection.worker";

let inspectionWorker: Worker | null = null;
let inspectionApi: Remote<MediaInspectionWorkerApi> | null = null;

function getInspectionApi() {
  if (typeof Worker === "undefined") return null;
  if (!inspectionWorker) {
    inspectionWorker = new Worker(new URL("./inspection.worker.ts", import.meta.url), {
      type: "module",
      name: "cutline-media-inspection",
    });
    inspectionApi = wrap<MediaInspectionWorkerApi>(inspectionWorker);
  }
  return inspectionApi;
}

export async function inspectMediaFile(file: File): Promise<MediaInspection> {
  const api = getInspectionApi();
  if (!api) return inspectMediaBlob(file, file.type);
  try {
    return await api.inspect(file);
  } catch {
    inspectionWorker?.terminate();
    inspectionWorker = null;
    inspectionApi = null;
    return inspectMediaBlob(file, file.type);
  }
}

export function getLocalMediaCapabilities() {
  return {
    localOnly: true,
    mediaEngine: "mediabunny",
    mediaWorker: typeof Worker !== "undefined",
    webCodecs: typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined",
    previewProxies: typeof VideoEncoder !== "undefined",
    captionFormats: ["srt", "vtt"],
  } as const;
}
