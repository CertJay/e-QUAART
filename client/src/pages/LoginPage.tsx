import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, ErrorBox, Field, Input } from '../components/ui';

const DEMO = [
  ['teacher@equaart.local', 'Teacher (Grade 3 adviser)'],
  ['coordinator.bpes@equaart.local', 'Assessment Coordinator'],
  ['principal.bpes@equaart.local', 'Principal'],
  ['eps.math@equaart.local', 'EPS – Mathematics'],
  ['psds.district2@equaart.local', 'District Supervisor'],
  ['chief.cid@equaart.local', 'Chief, CID'],
  ['admin@equaart.local', 'Division Administrator'],
  ['dpo@equaart.local', 'Data Protection Officer'],
];
const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-11 w-11" />
          <div>
            <h1 className="text-xl font-bold text-ink">E-QuAART</h1>
            <p className="text-xs text-ink-3">Electronic Quality Assured Assessment Result Tool</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface-1 p-6">
          <p className="text-sm text-ink-2">From assessment results to actionable instructional intervention. Sign in with your DepEd account.</p>
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          <p className="text-[11px] text-ink-3">Authorised DepEd personnel only. Activity is logged in accordance with RA 10173.</p>
        </form>
        {SHOW_DEMO && (
          <div className="mt-4 rounded-lg border border-dashed border-line bg-surface-1 p-4">
            <div className="mb-2 text-xs font-semibold text-ink-2">Demo accounts · password <code className="rounded bg-surface-2 px-1">Equaart#2026</code></div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {DEMO.map(([e, label]) => (
                <button key={e} type="button" className="rounded px-2 py-1 text-left text-xs text-ink-2 hover:bg-surface-2" onClick={() => { setEmail(e); setPassword('Equaart#2026'); }}>
                  <span className="font-medium text-ink">{label}</span>
                  <br />
                  <span className="text-ink-3">{e}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
