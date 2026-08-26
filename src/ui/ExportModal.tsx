"use client";

import { digestBranch, formatTimecode } from "@/core";
import { activeBranch, useEditorStore } from "@/store/editorStore";
import { useEffect, useRef } from "react";

function CloseIcon() {
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function DownloadIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14" /></svg>;
}

export function ExportModal() {
  const open = useEditorStore((s) => s.exportOpen);
  const setExportOpen = useEditorStore((s) => s.setExportOpen);
  const editor = useEditorStore((s) => s.editor);
  const dispatch = useEditorStore((s) => s.dispatch);
  const branch = activeBranch(editor);
  const accepted = editor.project.selectedFinalBranchId;
  const ready = accepted === branch.branchId;
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
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]") ?? []);
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
          <div><span>Final delivery</span><h2 id="export-title">Export your cut</h2></div>
          <button ref={closeRef} className="icon-button" onClick={() => setExportOpen(false)} aria-label="Close export dialog"><CloseIcon /></button>
        </header>

        <div className="human-gate"><span aria-hidden="true">H</span><div><strong>Human approval required</strong><p id="export-description">Only you can export. Agents can prepare and preview cuts, but final delivery stays in your control.</p></div></div>

        <div className="export-summary">
          <div className="export-preview"><div className={`export-frame ratio-${branch.crop.aspectRatio.replace(":", "-")}`}><span>720p</span><small>{branch.crop.aspectRatio}</small></div></div>
          <dl>
            <div><dt>Branch</dt><dd>{branch.name}</dd></div>
            <div><dt>Duration</dt><dd>{formatTimecode(branch.durationMs)}</dd></div>
            <div><dt>Resolution</dt><dd>720 × 1280</dd></div>
            <div><dt>Format</dt><dd>MP4 · H.264</dd></div>
            <div className="digest-row"><dt>State digest</dt><dd title={digestBranch(branch)}>{digestBranch(branch).slice(0, 22)}…</dd></div>
          </dl>
        </div>

        {!accepted ? <div className="export-notice" role="status">Accept a branch in Compare before exporting.</div> : !ready ? <div className="export-notice" role="status">Switch to the accepted branch to export it.</div> : null}

        <footer className="export-footer">
          <button className="secondary-button" onClick={() => setExportOpen(false)}>Cancel</button>
          {ready ? (
            <a
              data-testid="download-export"
              className="primary-button"
              href="/demo/golden_export_720p.mp4"
              download={`cutline-${branch.branchId}.mp4`}
              onClick={() => dispatch({ type: "RecordExport", actor: { type: "human", surface: "ui" }, payload: { branchId: branch.branchId, expectedBranchVersion: branch.branchVersion, uri: "/demo/golden_export_720p.mp4", width: 720, height: 1280 } })}
            ><DownloadIcon /> Download MP4</a>
          ) : <button className="primary-button" disabled><DownloadIcon /> Download MP4</button>}
        </footer>
      </section>
    </div>
  );
}
