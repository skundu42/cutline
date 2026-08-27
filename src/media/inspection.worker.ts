import { expose } from "comlink";
import { inspectMediaBlob, type MediaInspection } from "./inspection";

export interface MediaInspectionWorkerApi {
  inspect(file: File): Promise<MediaInspection>;
}

const api: MediaInspectionWorkerApi = {
  inspect: (file) => inspectMediaBlob(file, file.type),
};

expose(api);

