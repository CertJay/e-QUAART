import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { isoDate } from '../lib/format';
import { Button, ErrorBox, Field, Input, Modal, Select } from './ui';

export interface LearnerInput { id?: number; lrn: string; firstName: string; middleName?: string | null; lastName: string; extensionName?: string | null; sex: 'MALE' | 'FEMALE' | ''; birthdate?: string | null; status?: string }

export function LearnerForm({ open, onClose, initial, sectionId, onSaved }: { open: boolean; onClose: () => void; initial?: LearnerInput; sectionId?: number; onSaved: () => void }) {
  const [v, setV] = useState<LearnerInput>(initial ?? { lrn: '', firstName: '', lastName: '', sex: '' });
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof LearnerInput) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = { ...v, middleName: v.middleName || null, extensionName: v.extensionName || null, birthdate: v.birthdate || null };
    try {
      if (v.id) await api.put(`/learners/${v.id}`, body);
      else await api.post('/learners', { ...body, sectionId });
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={v.id ? 'Edit learner' : 'Register learner'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="learner-form" type="submit">Save</Button></>}>
      <form id="learner-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
        <Field label="LRN (12 digits)" className="col-span-2" hint="The Learner Reference Number is the unique identifier; duplicates are rejected.">
          <Input required inputMode="numeric" pattern="[0-9 \-]{12,16}" value={v.lrn} onChange={set('lrn')} />
        </Field>
        <Field label="Last name"><Input required value={v.lastName} onChange={set('lastName')} /></Field>
        <Field label="First name"><Input required value={v.firstName} onChange={set('firstName')} /></Field>
        <Field label="Middle name"><Input value={v.middleName ?? ''} onChange={set('middleName')} /></Field>
        <Field label="Extension (Jr., III)"><Input value={v.extensionName ?? ''} onChange={set('extensionName')} /></Field>
        <Field label="Sex"><Select required value={v.sex} onChange={set('sex')} options={[{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }]} placeholder="Select…" /></Field>
        <Field label="Birthdate"><Input type="date" value={isoDate(v.birthdate)} onChange={set('birthdate')} /></Field>
        {v.id && (
          <Field label="Status" className="col-span-2">
            <Select value={v.status ?? 'ACTIVE'} onChange={set('status')} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'TRANSFERRED_OUT', label: 'Transferred out' }, { value: 'DROPPED', label: 'Dropped' }, { value: 'GRADUATED', label: 'Graduated' }]} />
          </Field>
        )}
        <div className="col-span-2"><ErrorBox error={error} /></div>
      </form>
    </Modal>
  );
}

export function EnrolExistingForm({ open, onClose, sectionId, onSaved }: { open: boolean; onClose: () => void; sectionId: number; onSaved: () => void }) {
  const [lrn, setLrn] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/learners/enrol-existing', { lrn, lastName, sectionId });
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Enrol an existing learner" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button form="enrol-form" type="submit">Enrol</Button></>}>
      <form id="enrol-form" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-2">For transferees and learners already registered in E-QuAART. Enter the LRN and last name exactly as recorded; the learner's history comes with them.</p>
        <Field label="LRN"><Input required value={lrn} onChange={(e) => setLrn(e.target.value)} /></Field>
        <Field label="Last name"><Input required value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}
