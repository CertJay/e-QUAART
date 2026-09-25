import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth/middleware.js';
import { ah } from '../lib/http.js';
import { METRIC_DEFINITIONS } from '../domain/metrics.js';
import { assertAcademic } from '../rbac/scope.js';
import * as A from './analytics.service.js';

export const analyticsRouter = Router();
analyticsRouter.use(requirePermission('analytics:read'), (req, _res, next) => {
  assertAcademic(req.scope!);
  next();
});

const filters = (q: unknown) => A.filterSchema.parse(q);

analyticsRouter.get('/definitions', (_req, res) => res.json(METRIC_DEFINITIONS));
analyticsRouter.get('/summary', ah(async (req, res) => res.json(await A.summary(req.scope!, filters(req.query)))));
analyticsRouter.get('/distribution', ah(async (req, res) => res.json(await A.distribution(req.scope!, filters(req.query)))));
analyticsRouter.get('/breakdown', ah(async (req, res) => {
  const dim = A.dimSchema.parse(req.query.dim);
  res.json(await A.breakdown(req.scope!, filters(req.query), dim));
}));
analyticsRouter.get('/trend', ah(async (req, res) => {
  const series = req.query.series ? A.dimSchema.parse(req.query.series) : undefined;
  res.json(await A.trend(req.scope!, filters(req.query), series));
}));
analyticsRouter.get('/heatmap', ah(async (req, res) => {
  const rows = A.dimSchema.parse(req.query.rows ?? 'gradeLevel');
  const cols = A.dimSchema.parse(req.query.cols ?? 'learningArea');
  res.json(await A.heatmap(req.scope!, filters(req.query), rows, cols));
}));
analyticsRouter.get('/completion', ah(async (req, res) => {
  const dim = req.query.dim ? A.dimSchema.parse(req.query.dim) : undefined;
  const rows = await A.completion(req.scope!, filters(req.query), dim);
  if (!dim) return res.json(rows[0] ?? null);
  const lbl = await A.labels(dim, rows.map((r) => r.key));
  res.json(rows.map((r) => ({ ...r, label: lbl.get(r.key)?.label ?? `#${r.key}`, sortKey: lbl.get(r.key)?.sort ?? '' })).sort((a, b) => a.sortKey.localeCompare(b.sortKey)));
}));
analyticsRouter.get('/coverage', ah(async (req, res) => {
  const dim = req.query.dim ? A.dimSchema.parse(req.query.dim) : undefined;
  const rows = await A.coverage(req.scope!, filters(req.query), dim);
  if (!dim) return res.json(rows[0] ?? null);
  const lbl = await A.labels(dim, rows.map((r) => r.key));
  res.json(rows.map((r) => ({ ...r, label: lbl.get(r.key)?.label ?? `#${r.key}` })));
}));
analyticsRouter.get('/interventions', ah(async (req, res) => res.json(await A.interventionOutcomes(req.scope!, filters(req.query)))));
analyticsRouter.get('/least-mastered', ah(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(200).default(25).parse(req.query.limit);
  res.json(await A.leastMastered(req.scope!, filters(req.query), limit));
}));
analyticsRouter.get('/persistent-gaps', ah(async (req, res) => res.json(await A.persistentGaps(req.scope!, filters(req.query)))));
analyticsRouter.get('/schools-support', ah(async (req, res) => res.json(await A.schoolsNeedingSupport(req.scope!, filters(req.query)))));
analyticsRouter.get('/learners-at-risk', ah(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(500).default(200).parse(req.query.limit);
  res.json(await A.learnersNeedingIntervention(req.scope!, filters(req.query), limit));
}));
