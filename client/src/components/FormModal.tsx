import { useState } from 'react';
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea } from './ui';

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  options?: { value: string | number; label: string }[];
  hint?: string;
  required?: boolean;
}

/** Generic create/edit dialog for reference data. Values are passed through as typed by `type`. */
export function FormModal({ title, fields, initial, onClose, onSubmit }: { title: string; fields: FieldDef[]; initial?: Record<string, unknown>; onClose: () => void; onSubmit: (v: Record<string, unknown>) => Promise<unknown> }) {
  const [v, setV] = useState<Record<string, unknown>>(() => ({ ...(initial ?? {}) }));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = v[f.key];
      if (f.type === 'number' || (f.type === 'select' && f.options?.every((o) => typeof o.value === 'number'))) out[f.key] = raw === '' || raw === undefined || raw === null ? null : Number(raw);
      else if (f.type === 'checkbox') out[f.key] = !!raw;
      else if (f.type === 'date') out[f.key] = raw ? String(raw).slice(0, 10) : null;
      else out[f.key] = raw === '' ? null : raw;
    }
    try {
      await onSubmit(out);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={submit}>Save</Button></>}>
      <div className="grid gap-3">
        {fields.map((f) => {
          const val = v[f.key];
          const set = (x: unknown) => setV((s) => ({ ...s, [f.key]: x }));
          if (f.type === 'checkbox') return <label key={f.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!val} onChange={(e) => set(e.target.checked)} />{f.label}</label>;
          return (
            <Field key={f.key} label={f.label} hint={f.hint}>
              {f.type === 'select' ? <Select value={String(val ?? '')} onChange={(e) => set(e.target.value)} options={f.options ?? []} placeholder="Select…" />
                : f.type === 'textarea' ? <Textarea value={String(val ?? '')} onChange={(e) => set(e.target.value)} />
                : <Input type={f.type ?? 'text'} required={f.required} value={f.type === 'date' ? String(val ?? '').slice(0, 10) : String(val ?? '')} onChange={(e) => set(e.target.value)} />}
            </Field>
          );
        })}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
