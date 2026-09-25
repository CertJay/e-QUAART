import { useContext, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { navFor } from '../lib/nav';
import { useBootstrap, usePeriod } from '../lib/hooks';
import { ThemeContext } from './charts';
import { Icon } from './Icon';
import { Select } from './ui';
import { PrivacyNotice } from './PrivacyNotice';

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  if (!user) return null;
  const items = navFor(user);
  const sections = [...new Set(items.map((i) => i.section ?? ''))];

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-line bg-surface-1 transition lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight text-ink">E-QuAART</div>
            <div className="text-[10px] text-ink-3">Quality Assured Assessment Results</div>
          </div>
        </div>
        <nav className="h-[calc(100vh-3.5rem)] overflow-y-auto px-2 py-3">
          {sections.map((sec) => (
            <div key={sec} className="mb-3">
              {sec && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{sec}</div>}
              {items.filter((i) => (i.section ?? '') === sec).map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === '/'}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-brand-soft font-medium text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
                >
                  <Icon name={i.icon} />
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface-1/95 px-4 backdrop-blur">
          <button className="rounded p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <PeriodPicker />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium text-ink">{user.fullName}</div>
              <div className="text-[11px] text-ink-3">{user.roleLabel}{user.scopes[0] ? ` · ${user.scopes.map((s) => s.label).join(', ')}` : ''}</div>
            </div>
            <button onClick={logout} className="rounded p-1.5 text-ink-2 hover:bg-surface-2" title="Sign out" aria-label="Sign out">
              <Icon name="logout" className="h-5 w-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6" key={loc.pathname}>
          <Outlet />
        </main>
        <footer className="px-6 pb-6 text-center text-[11px] text-ink-3">
          E-QuAART handles learner personal information under the Data Privacy Act of 2012 (RA 10173). Access is logged.
        </footer>
      </div>
      {!user.privacyAcceptedAt && <PrivacyNotice />}
    </div>
  );
}

function PeriodPicker() {
  const { data } = useBootstrap();
  const { user } = useAuth();
  const p = usePeriod();
  if (!data || user?.role === 'SYSTEM_ADMIN' || user?.role === 'DPO') return null;
  const sy = data.schoolYears.find((s) => s.id === p.schoolYearId);
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="School year"
        className="h-8 w-32 text-xs"
        value={p.schoolYearId ?? ''}
        onChange={(e) => {
          p.setSchoolYearId(e.target.value ? Number(e.target.value) : undefined);
          p.setTermId(undefined);
        }}
        options={data.schoolYears.map((s) => ({ value: s.id, label: `SY ${s.label}` }))}
        placeholder="All years"
      />
      <Select
        aria-label="Term"
        className="h-8 w-40 text-xs"
        value={p.termId ?? ''}
        disabled={!sy}
        onChange={(e) => p.setTermId(e.target.value ? Number(e.target.value) : undefined)}
        options={(sy?.terms ?? []).map((t) => ({ value: t.id, label: t.name }))}
        placeholder="All terms"
      />
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useContext(ThemeContext);
  return (
    <button onClick={toggle} className="rounded p-1.5 text-ink-2 hover:bg-surface-2" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title="Toggle theme">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="h-5 w-5" />
    </button>
  );
}

export function RequirePermission({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) {
    return (
      <div className="rounded-lg border border-line bg-surface-1 p-8 text-center">
        <h1 className="text-lg font-semibold">Not available for your role</h1>
        <p className="mt-1 text-sm text-ink-2">This page needs access your account does not have. Ask your administrator if you believe this is wrong.</p>
      </div>
    );
  }
  return <>{children}</>;
}
