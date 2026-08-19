import { useRef, useState } from 'react';
import { downloadBackup } from '../lib/backup.js';
import { downloadText, highlightsToMarkdown, highlightsToText } from '../lib/exportNotes.js';
import { canPrint, printNotes } from '../lib/printNotes.js';

function Row({ title, detail, action, onClick, disabled, busy }) {
  return (
    <button type="button" className="exportrow" onClick={onClick} disabled={disabled || busy}>
      <span className="exportrow-text">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="exportrow-action">{busy ? 'Working…' : action}</span>
    </button>
  );
}

export default function NotesExportSheet({
  groups,
  shown,
  total,
  filtered,
  onRestoreBackup,
  notify,
  onClose,
}) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(null);
  const stamp = new Date().toISOString().slice(0, 10);
  const scope = filtered ? `the ${shown} highlight${shown === 1 ? '' : 's'} shown` : 'every highlight';

  const flatHighlights = groups.flatMap((group) => group.entries.map((e) => e.highlight));

  const saveBackup = async () => {
    setBusy('backup');
    try {
      const counts = await downloadBackup(filtered ? flatHighlights : null);
      notify(
        `Backup saved — ${counts.highlights} highlight${counts.highlights === 1 ? '' : 's'} from ${counts.books} book${counts.books === 1 ? '' : 's'}`,
        'success',
      );
      onClose();
    } catch (err) {
      notify(err?.message || 'Could not save the backup', 'error');
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file) => {
    if (!file) return;
    setBusy('restore');
    try {
      const report = await onRestoreBackup(file);
      const parts = [];
      if (report.restored) {
        parts.push(`${report.restored} highlight${report.restored === 1 ? '' : 's'} restored`);
      }
      if (report.refiled) {
        parts.push(`${report.refiled} put back into ${report.refiled === 1 ? 'its' : 'their'} project`);
      }
      if (report.projects) {
        parts.push(`${report.projects} project${report.projects === 1 ? '' : 's'}`);
      }
      if (report.skipped) parts.push(`${report.skipped} already here`);
      if (report.placeholders.length) {
        parts.push(
          `${report.placeholders.length} book${report.placeholders.length === 1 ? '' : 's'} listed without files`,
        );
      }
      if (report.orphaned) parts.push(`${report.orphaned} could not be placed`);
      notify(parts.length ? parts.join(' · ') : 'Nothing new in that backup', 'success');
      if (report.placeholders.length) {
        notify(
          'Import those books again and their highlights will reattach automatically.',
        );
      }
      onClose();
    } catch (err) {
      notify(err?.message || 'Could not read that backup', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Export and backup"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title">Export &amp; backup</h2>
        <p className="set-hint">Covers {scope}, in the order shown.</p>

        <div className="exportgroup">
          <h3>Export</h3>
          <Row
            title="PDF"
            detail="A formatted document, one section per book."
            action="Export"
            disabled={!shown || !canPrint}
            onClick={() => {
              onClose();
              // Let the sheet unmount so it is not captured in the printout.
              setTimeout(() => printNotes(`Highlights ${stamp}`), 250);
            }}
          />
          <Row
            title="Markdown"
            detail="Block quotes and notes, ready for a notes app."
            action=".md"
            disabled={!shown}
            onClick={() => {
              downloadText(`highlights-${stamp}.md`, highlightsToMarkdown(groups), 'text/markdown');
              notify('Markdown file saved', 'success');
              onClose();
            }}
          />
          <Row
            title="Plain text"
            detail="No formatting, for anywhere else."
            action=".txt"
            disabled={!shown}
            onClick={() => {
              downloadText(`highlights-${stamp}.txt`, highlightsToText(groups));
              notify('Text file saved', 'success');
              onClose();
            }}
          />
        </div>

        <div className="exportgroup">
          <h3>Backup</h3>
          <Row
            title="Save a backup"
            detail="A JSON file this app can read back, keeping colours, notes and positions."
            action=".json"
            disabled={!shown}
            busy={busy === 'backup'}
            onClick={saveBackup}
          />
          <Row
            title="Restore from a backup"
            detail="Merges a backup in. Nothing is deleted, and restoring twice is harmless."
            action="Choose file"
            busy={busy === 'restore'}
            onClick={() => fileInput.current?.click()}
          />
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              restore(file);
            }}
          />
          <p className="set-hint">
            A backup holds your highlights and notes, not the book files — those stay where you keep
            them. {total > 0 && `Right now that is ${total} highlight${total === 1 ? '' : 's'}.`}
          </p>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
