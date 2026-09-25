import { useState } from 'react';
import { api } from '../../api/client';
import { Button, Card, ErrorBox, Input, PageHeader, Spinner, Table } from '../../components/ui';
import { useApi } from '../../lib/hooks';

interface Setting { key: string; value: number; default: number; description: string }

export function SettingsPage() {
  const q = useApi<Setting[]>('/governance/settings', undefined, { staleTime: 0 });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <PageHeader title="System settings" subtitle="Thresholds used for flags, learning-gap levels and privacy protection. Changes apply immediately to every dashboard and are audit-logged." />
      <ErrorBox error={error} />
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : (
          <Table rows={q.data ?? []} rowKey={(r) => r.key} columns={[
            { key: 'key', label: 'Setting', render: (r) => <div><div className="font-mono text-xs">{r.key}</div><div className="text-xs text-ink-2">{r.description}</div></div> },
            { key: 'default', label: 'Default', align: 'right' },
            { key: 'value', label: 'Value', render: (r) => <Input className="h-8 w-24" type="number" value={draft[r.key] ?? String(r.value)} onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })} aria-label={r.key} /> },
            { key: 'act', label: '', render: (r) => draft[r.key] !== undefined && Number(draft[r.key]) !== r.value ? <Button size="sm" onClick={async () => {
              try { await api.put(`/governance/settings/${r.key}`, { value: Number(draft[r.key]) }); setDraft((d) => { const n = { ...d }; delete n[r.key]; return n; }); q.refetch(); } catch (e) { setError(e); }
            }}>Save</Button> : null },
          ]} />
        )}
      </Card>
    </>
  );
}
