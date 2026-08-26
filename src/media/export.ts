/**
 * Preview/export path freeze (PRD D1 gate).
 * Browser MediaRecorder from the canvas compositor is attempted when available.
 * The submission-quality fallback is a digest-keyed cached 720p file at
 * `/demo/golden_export_720p.mp4` so judging never waits on a live encode.
 */
export const EXPORT_PATH = "cached-golden-720p" as const;
export const GOLDEN_EXPORT_URI = "/demo/golden_export_720p.mp4";
