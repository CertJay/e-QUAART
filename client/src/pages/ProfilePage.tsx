import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox, Field, Input, Notice, PageHeader } from '../components/ui';
import { dateTime } from '../lib/format';

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError({ message: 'The new passwords do not match' });
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      setOk(true);
      setCur(''); setNext(''); setConfirm('');
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Current password"><Input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New password" hint="At least 10 characters with upper- and lowercase letters and a digit."><Input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Confirm new password"><Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <ErrorBox error={error} />
      {ok && <Notice>Password changed. Your other sessions were signed out.</Notice>}
      <Button type="submit">Change password</Button>
    </form>
  );
}

export function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const { reload, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Card title={forced ? 'Set your password' : 'Change password'} subtitle={forced ? 'You signed in with a temporary password. Choose a new one to continue.' : undefined} actions={<Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>}>
          <PasswordForm onDone={reload} />
        </Card>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title="Profile" subtitle="Your account, access scope and password." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Account">
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-ink-3">Name</dt><dd className="col-span-2">{user.fullName}</dd>
            <dt className="text-ink-3">Email</dt><dd className="col-span-2">{user.email}</dd>
            <dt className="text-ink-3">Position</dt><dd className="col-span-2">{user.position ?? '—'}</dd>
            <dt className="text-ink-3">Role</dt><dd className="col-span-2">{user.roleLabel}</dd>
            <dt className="text-ink-3">Scope</dt><dd className="col-span-2">{user.scopes.map((s) => s.label).join(', ') || '—'}</dd>
            <dt className="text-ink-3">Privacy notice</dt><dd className="col-span-2">{user.privacyAcceptedAt ? `Acknowledged ${dateTime(user.privacyAcceptedAt)}` : 'Not yet acknowledged'}</dd>
          </dl>
        </Card>
        <Card title="Change password"><PasswordForm onDone={() => undefined} /></Card>
      </div>
    </>
  );
}
