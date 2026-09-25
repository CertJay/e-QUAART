/** Minimal API client: in-memory bearer token, silent refresh via the httpOnly cookie. */
const BASE = '/api/v1';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionEnd: (() => void) | null = null;

export const setToken = (t: string | null) => (accessToken = t);
export const setSessionEndHandler = (fn: () => void) => (onSessionEnd = fn);

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

let restoring: Promise<{ token: string; user: Me } | null> | null = null;

/**
 * Exchange the refresh cookie for a new access token. Concurrent callers share one request:
 * refresh tokens rotate on use, so a second parallel call would present a stale token.
 */
export function refreshSession(): Promise<{ token: string; user: Me } | null> {
  restoring ??= doRefresh().finally(() => (restoring = null));
  return restoring;
}

async function doRefresh(): Promise<{ token: string; user: Me } | null> {
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (!res.ok) return null;
  const body = await res.json();
  accessToken = body.token;
  return body;
}

async function tryRefresh() {
  refreshing ??= refreshSession().then((r) => !!r).finally(() => (refreshing = null));
  return refreshing;
}

async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return raw(path, init, false);
    onSessionEnd?.();
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return body as T;
}

export type Query = Record<string, string | number | boolean | null | undefined>;
export const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: <T>(path: string, q?: Query) => raw(path + qs(q)).then((r) => parse<T>(r)),
  post: <T>(path: string, body?: unknown) => raw(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }).then((r) => parse<T>(r)),
  put: <T>(path: string, body?: unknown) => raw(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }).then((r) => parse<T>(r)),
  del: <T>(path: string) => raw(path, { method: 'DELETE' }).then((r) => parse<T>(r)),
  /** Upload a file with extra form fields; returns the parsed body even on 422 (validation report). */
  upload: async <T>(path: string, file: File, fields: Record<string, string>) => {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const res = await raw(path, { method: 'POST', body: fd });
    if (res.status === 422) return (await res.json()) as T;
    return parse<T>(res);
  },
  /** Download a file response and hand it to the browser. */
  download: async (path: string, q?: Query) => {
    const res = await raw(path + qs(q));
    if (!res.ok) await parse(res);
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await parse<{ token: string; user: Me }>(res);
  accessToken = body.token;
  return body;
}

export async function logout() {
  await raw('/auth/logout', { method: 'POST' }).catch(() => undefined);
  accessToken = null;
}

// ───────────── Shared types ─────────────
export type Role = 'TEACHER' | 'MASTER_TEACHER' | 'ASSESSMENT_COORDINATOR' | 'PRINCIPAL' | 'PSDS' | 'EPS' | 'CHIEF_CID' | 'DIVISION_ADMIN' | 'SYSTEM_ADMIN' | 'DPO';
export type Tier = 'TIER_1' | 'TIER_2' | 'TIER_3';
export interface Me {
  id: number;
  email: string;
  fullName: string;
  position: string | null;
  role: Role;
  roleLabel: string;
  permissions: string[];
  mustChangePassword: boolean;
  privacyAcceptedAt: string | null;
  lastLoginAt: string | null;
  scopes: { scopeType: string; schoolId: number | null; districtId: number | null; learningAreaId: number | null; sectionId: number | null; label: string }[];
}
export interface Paged<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; pages: number };
}
export interface Band { id: number; label: string; tier: Tier; minPct: number | null; maxPct: number | null; descriptorKey: string | null; description: string | null; color: string; sortOrder: number }
export interface Bootstrap {
  divisions: { id: number; name: string }[];
  districts: { id: number; name: string }[];
  schools: { id: number; name: string; districtId: number; schoolIdDeped: string; schoolType: string | null; isActive: boolean; address: string | null }[];
  schoolYears: { id: number; label: string; isCurrent: boolean; startDate: string; endDate: string; terms: { id: number; code: string; name: string; sortOrder: number }[] }[];
  keyStages: { id: number; code: string; name: string; sortOrder: number }[];
  gradeLevels: { id: number; code: string; name: string; keyStageId: number; sortOrder: number; isActive: boolean }[];
  learningAreas: { id: number; code: string; name: string; sortOrder: number; isActive: boolean; inScope: boolean }[];
  assessmentTypes: { id: number; code: string; name: string; description: string | null; resultMode: 'PERCENTAGE' | 'PROFILE'; isActive: boolean; models: { id: number; name: string; isProvisional: boolean; masteryThreshold: number; bands: Band[] }[] }[];
}
export interface PerfRow {
  key: number;
  label: string;
  meta?: Record<string, unknown>;
  assessed: number | null;
  learners: number | null;
  avgPct: number | null;
  tier1: number | null;
  tier2: number | null;
  tier3: number | null;
  proficiencyRate: number | null;
  atRiskRate: number | null;
  tier3Rate: number | null;
  bands: { label: string; tier: Tier; color: string; count: number }[];
  suppressed: boolean;
}
