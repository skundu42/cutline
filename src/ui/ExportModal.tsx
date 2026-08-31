"use client";

import { digestBranch, formatTimecode } from "@/core";
import { getRenderCapabilities, getRenderSize, type RenderFormat, type RenderPreset } from "@/media/export";
import { activeBranch, useEditorStore } from "@/store/editorStore";
import { useEffect, useRef, useState } from "react";

function CloseIcon() {
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function DownloadIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14" /></svg>;
}

function RenderIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m8 5 11 7-11 7V5Z"/><path d="M3 3h18v18H3z"/></svg>;
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportModal() {
  const open = useEditorStore((state) => state.exportOpen);
  const setExportOpen = useEditorStore((state) => state.setExportOpen);
  const editor = useEditorStore((state) => state.editor);
  const renderState = useEditorStore((state) => state.renderState);
  const renderExport = useEditorStore((state) => state.renderExport);
  const cancelRender = useEditorStore((state) => state.cancelRender);
  const branch = activeBranch(editor);
  const [preset, setPreset] = useState<RenderPreset>("720p");
  const [format, setFormat] = useState<RenderFormat>("webm");
  const capabilities = getRenderCapabilities();
  const containsVideo = editor.assets.some((asset) => asset.kind === "video" && branch.tracks.some((track) => track.items.some((item) => item.assetId === asset.assetId)));
  const renderSupported = typeof MediaRecorder === "undefined" ? null : capabilities[format];
  const output = renderState.status === "ready" && renderState.width && renderState.height
    ? { width: renderState.width, height: renderState.height }
    : getRenderSize(branch.crop.aspectRatio, preset);
  const rendering = renderState.status === "preparing" || renderState.status === "rendering";
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExportOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], select:not([disabled])") ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open, setExportOpen]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportOpen(false); }}>
      <section ref={dialogRef} className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" aria-describedby="export-description">
        <header className="export-heading">
          <div><span>Local delivery</span><h2 id="export-title">Render your cut</h2></div>
          <button ref={closeRef} className="icon-button" onClick={() => setExportOpen(false)} aria-label="Close render dialog"><CloseIcon /></button>
        </header>

        <div className="local-render-note"><span aria-hidden="true">L</span><div><strong>Rendered entirely on this device</strong><p id="export-description">Cutline composites the current timeline in your browser. Original clips and the finished file are never uploaded.</p></div></div>

        <div className="export-summary">
          <div className="export-preview"><div className={`export-frame ratio-${branch.crop.aspectRatio.replace(":", "-")}`}><span>720p</span><small>{branch.crop.aspectRatio}</small></div></div>
          <dl>
            <div><dt>Branch</dt><dd>{branch.name}</dd></div>
            <div><dt>Duration</dt><dd>{formatTimecode(branch.durationMs)}</dd></div>
            <div><dt>Resolution</dt><dd>{output.width} × {output.height}</dd></div>
            <div><dt>Format</dt><dd>{(renderState.format ?? format).toUpperCase()} · browser native</dd></div>
            <div><dt>Estimated time</dt><dd>{containsVideo ? `About ${Math.max(1, Math.ceil(branch.durationMs / 1000))} sec` : capabilities.acceleratedStills ? "Faster than real time" : `About ${Math.max(1, Math.ceil(branch.durationMs / 1000))} sec`}</dd></div>
            {renderState.mode ? <div><dt>Render mode</dt><dd>{renderState.mode === "accelerated" ? "Accelerated" : "Real time"}</dd></div> : null}
            {renderState.status === "ready" ? <div><dt>File size</dt><dd>{formatBytes(renderState.bytes)}</dd></div> : null}
            <div className="digest-row"><dt>State digest</dt><dd title={digestBranch(branch)}>{digestBranch(branch).slice(0, 22)}…</dd></div>
          </dl>
        </div>

        <div className="render-options"><label className="render-preset"><span>Output quality</span><select value={preset} disabled={rendering || renderState.status === "ready"} onChange={(event) => setPreset(event.target.value as RenderPreset)}><option value="720p">720p · best quality</option><option value="480p">480p · smaller file</option></select></label><label className="render-preset"><span>Container</span><select value={format} disabled={rendering || renderState.status === "ready"} onChange={(event) => setFormat(event.target.value as RenderFormat)}><option value="webm">WebM · widest support</option>{capabilities.mp4 ? <option value="mp4">MP4 · H.264/AAC</option> : null}</select></label></div>
        {renderSupported === false ? <div className="export-notice" role="alert">This browser cannot create a local {format.toUpperCase()} video. Choose WebM or use a current browser with the required encoders.</div> : null}

        {rendering ? (
          <div className="render-progress" role="status" aria-live="polite">
            <div><span>{renderState.status === "preparing" ? "Preparing local media" : containsVideo ? "Rendering in real time" : capabilities.acceleratedStills ? "Encoding locally" : "Rendering in real time"}</span><strong>{Math.round(renderState.progress * 100)}%</strong></div>
            <progress max={1} value={renderState.progress} />
            <p>Keep this tab open. {containsVideo || !capabilities.acceleratedStills ? "Video rendering takes about as long as the cut." : "This still-image timeline can finish faster than playback."}</p>
          </div>
        ) : null}
        {renderState.status === "ready" ? <div className="render-ready" role="status"><span>Render complete</span><p>The download matches the current timeline digest.</p></div> : null}
        {renderState.status === "failed" ? <div className="export-notice" role="alert">{renderState.error}</div> : null}
        {renderState.status === "cancelled" ? <div className="export-notice" role="status">Render cancelled. Your timeline was not changed.</div> : null}

        <footer className="export-footer">
          {rendering ? (
            <button className="secondary-button" onClick={cancelRender}>Cancel render</button>
          ) : (
            <button className="secondary-button" onClick={() => setExportOpen(false)}>Close</button>
          )}
          {renderState.status === "ready" && renderState.downloadUrl && renderState.filename ? (
            <a data-testid="download-export" className="primary-button" href={renderState.downloadUrl} download={renderState.filename}><DownloadIcon /> Download video</a>
          ) : (
            <button data-testid="render-export" className="primary-button" disabled={rendering || branch.durationMs === 0 || renderSupported === false} onClick={() => void renderExport(preset, undefined, undefined, format)}><RenderIcon /> {renderState.status === "failed" || renderState.status === "cancelled" ? "Render again" : `Render ${preset}`}</button>
          )}
        </footer>
      </section>
    </div>
  );
}
