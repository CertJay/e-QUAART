import { useState } from 'react';
import { api } from '../api/client';
import { Button, ErrorBox, Modal, Notice, Table } from './ui';

interface Issue { row?: number; field?: string; message: string }
interface Report { committed: boolean; summary: Record<string, number>; errors: Issue[]; warnings: Issue[] }

/**
 * Two-step import: validate the whole file first (nothing is written), then import only when
 * there are no errors.
 */
export function ImportDialog({ open, onClose, path, fields, title, help, onDone }: { open: boolean; onClose: () => void; path: string; fields: Record<string, string>; title: string; help: React.ReactNode; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setFile(null); setReport(null); setError(null); };
  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.upload<Report>(path, file, { ...fields, dryRun: String(dryRun) });
      setReport(r);
      if (r.committed) onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const close = () => { reset(); onClose(); };
  return (
    <Modal open={open} onClose={close} title={title} wide footer={
      report?.committed ? <Button onClick={close}>Done</Button> : (
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button variant="secondary" disabled={!file || busy} onClick={() => run(true)}>Validate file</Button>
          <Button disabled={!file || busy || !report || report.errors.length > 0} onClick={() => run(false)} title={!report ? 'Validate the file first' : undefined}>Import</Button>
        </>
      )
    }>
      <div className="space-y-3">
        <div className="text-sm text-ink-2">{help}</div>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} className="block text-sm" aria-label="Choose file" />
        <ErrorBox error={error} />
        {report && (
          <>
            {report.committed ? <Notice>Import complete. {Object.entries(report.summary).map(([k, v]) => `${k}: ${v}`).join(' · ')}</Notice>
              : report.errors.length ? <Notice tone="warn">{report.errors.length} problem{report.errors.length > 1 ? 's' : ''} found. Nothing was imported — fix the file and validate again.</Notice>
              : <Notice>File is valid ({report.summary.rows} rows). Review any warnings, then click Import.</Notice>}
            {report.errors.length > 0 && <IssueTable title="Errors" issues={report.errors} />}
            {report.warnings.length > 0 && <IssueTable title="Warnings" issues={report.warnings} />}
          </>
        )}
      </div>
    </Modal>
  );
}

function IssueTable({ title, issues }: { title: string; issues: Issue[] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-ink-2">{title} ({issues.length})</div>
      <div className="max-h-60 overflow-y-auto rounded border border-line">
        <Table dense rows={issues.map((x, i) => ({ ...x, i }))} rowKey={(r) => r.i} columns={[
          { key: 'row', label: 'Row', render: (r) => r.row ?? '—' },
          { key: 'field', label: 'Column', render: (r) => r.field || '—' },
          { key: 'message', label: 'Problem' },
        ]} />
      </div>
    </div>
  );
}
