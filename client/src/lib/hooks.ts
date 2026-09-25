import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Bootstrap, type Query } from '../api/client';

export function useBootstrap() {
  return useQuery({ queryKey: ['bootstrap'], queryFn: () => api.get<Bootstrap>('/reference/bootstrap'), staleTime: 5 * 60_000 });
}

export function useApi<T>(path: string | null, q?: Query, opts: { staleTime?: number } = {}) {
  return useQuery({ queryKey: [path, q], queryFn: () => api.get<T>(path!, q), enabled: !!path, staleTime: opts.staleTime ?? 30_000 });
}

/** School year / term selected in the top bar; every analytic view starts from these. */
export interface Period {
  schoolYearId?: number;
  termId?: number;
  setSchoolYearId: (id?: number) => void;
  setTermId: (id?: number) => void;
}
export const PeriodContext = createContext<Period | null>(null);
export function usePeriod() {
  const p = useContext(PeriodContext);
  if (!p) throw new Error('usePeriod outside provider');
  return p;
}
