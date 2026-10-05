import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { isoDate } from '../lib/format';
import { LIMITS, learnerBirthdateBounds, requestKey } from '../lib/validation';
import { Button, ErrorBox, Field, Input, Modal, Select } from './ui';

export interface LearnerInput { id?: number; lrn: string; firstName: string; middleName?: string | null; lastName: string; extensionName?: string | null; sex: 'MALE' | 'FEMALE' | ''; birthdate?: string | null; status?: string; updatedAt?: string }

export function LearnerForm({ open, onClose, initial, sectionId, onSaved }: { open: boolean; onClose: () => void; initial?: LearnerInput; sectionId?: number; onSaved: () => void }) {
  const [v, setV] = useState<LearnerInput>(initial ?? { lrn: '', firstName: '', lastName: '', sex: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  // One key per opened form: a double click or a retry after a dropped connection replays the
  // first result instead of registering the learner twice.
  const [key, setKey] = useState(requestKey);
  const bounds = learnerBirthdateBounds();
  const set = (k: keyof LearnerInput) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const duplicate = error instanceof ApiError && error.code === 'POSSIBLE_DUPLICATE';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { lrn, updatedAt, id: _id, ...rest } = v;
    const body = { ...(v.id ? rest : { ...rest, lrn }), middleName: v.middleName || null, extensionName: v.extensionName || null, birthdate: v.birthdate || null };
    try {
      if (v.id) await api.put(`/learners/${v.id}`, { ...body, expectedUpdatedAt: updatedAt });
      else await api.post('/learners', { ...body, sectionId, confirmNotDuplicate: confirmDuplicate || undefined }, { idempotencyKey: key });
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
      // A rejected request is final for its key; the corrected resubmission gets a new one.
      if (err instanceof ApiError && err.status < 500) setKey(requestKey());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={v.id ? 'Edit learner' : 'Register learner'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="learner-form" type="submit" disabled={busy || (duplicate && !confirmDuplicate)}>{busy ? 'Saving…' : 'Save'}</Button></>}>
      <form id="learner-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label="LRN (12 digits)" className="col-span-2" hint={v.id ? 'The LRN is the permanent learner identifier and cannot be changed.' : 'The Learner Reference Number is the unique identifier; duplicates are rejected.'}>
          <Input required inputMode="numeric" pattern="[0-9 \-]{12,16}" value={v.lrn} onChange={set('lrn')} readOnly={!!v.id} />
        </Field>
        <Field label="Last name"><Input required maxLength={LIMITS.learnerName} autoComplete="off" value={v.lastName} onChange={set('lastName')} /></Field>
        <Field label="First name"><Input required maxLength={LIMITS.learnerName} autoComplete="off" value={v.firstName} onChange={set('firstName')} /></Field>
        <Field label="Middle name" hint="Leave blank if none"><Input maxLength={LIMITS.learnerName} autoComplete="off" value={v.middleName ?? ''} onChange={set('middleName')} /></Field>
        <Field label="Extension (Jr., III)"><Input maxLength={LIMITS.extensionName} list="name-extensions" value={v.extensionName ?? ''} onChange={set('extensionName')} /></Field>
        <datalist id="name-extensions">{['Jr.', 'Sr.', 'II', 'III', 'IV', 'V'].map((x) => <option key={x} value={x} />)}</datalist>
        <Field label="Sex"><Select required value={v.sex} onChange={set('sex')} options={[{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }]} placeholder="Select…" /></Field>
        <Field label="Birthdate" hint={`Learners aged ${LIMITS.learnerMinAge}–${LIMITS.learnerMaxAge}`}><Input type="date" min={bounds.min} max={bounds.max} value={isoDate(v.birthdate)} onChange={set('birthdate')} /></Field>
        {v.id && (
          <Field label="Status" className="col-span-2">
            <Select value={v.status ?? 'ACTIVE'} onChange={set('status')} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'TRANSFERRED_OUT', label: 'Transferred out' }, { value: 'DROPPED', label: 'Dropped' }, { value: 'GRADUATED', label: 'Graduated' }]} />
          </Field>
        )}
        <div className="col-span-2"><ErrorBox error={error} /></div>
        {duplicate && (
          <label className="col-span-2 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmDuplicate} onChange={(e) => setConfirmDuplicate(e.target.checked)} />
            I checked the LRN: this is a different learner who happens to share the name and birthdate.
          </label>
        )}
      </form>
    </Modal>
  );
}

export function EnrolExistingForm({ open, onClose, sectionId, onSaved }: { open: boolean; onClose: () => void; sectionId: number; onSaved: () => void }) {
  const [lrn, setLrn] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(requestKey);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/learners/enrol-existing', { lrn, lastName, sectionId }, { idempotencyKey: key });
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.status < 500) setKey(requestKey());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Enrol an existing learner" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="enrol-form" type="submit" disabled={busy}>{busy ? 'Enrolling…' : 'Enrol'}</Button></>}>
      <form id="enrol-form" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-2">For transferees and learners already registered in e-QuAART. Enter the LRN and last name exactly as recorded; the learner's history comes with them.</p>
        <Field label="LRN"><Input required inputMode="numeric" maxLength={16} value={lrn} onChange={(e) => setLrn(e.target.value)} /></Field>
        <Field label="Last name"><Input required maxLength={LIMITS.learnerName} value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}
