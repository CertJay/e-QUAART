import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAnyPermission, requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah, idParam, paged, paginationSchema } from '../lib/http.js';
import { learnerName } from '../domain/lrn.js';
import { assertYearAllows } from '../domain/schoolYear.js';
import { hasPermission } from '../rbac/permissions.js';
import { assertLearnerLevel, assessmentWhere, type DataScope } from '../rbac/scope.js';
import { applyEntries, effectiveScore, validateEntry, type FullAssessment, type ResultEntry } from './assessments.service.js';
import { syncLearningGaps } from './gaps.service.js';

/**
 * Controlled correction of locked results (spec §7.4):
 *   requester proposes new values + reason ─► a different reviewer approves / rejects
 *   ─► on approval the system applies the change, re-classifies and re-derives gaps
 *   ─► audit log keeps old value, new value, requester, approver and reason.
 */
export const correctionsRouter = Router();

const assessmentInclude = {
  assessmentType: true,
  model: { include: { bands: { orderBy: { sortOrder: 'asc' } } } },
  competencies: { include: { competency: true } },
  schoolYear: true,
} satisfies Prisma.AssessmentInclude;

type ResultWithAssessment = Prisma.AssessmentResultGetPayload<{
  include: { competencyResults: true; learner: true; assessment: { include: typeof assessmentInclude } };
}>;

export interface FieldChange {
  field: string;
  label: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
}

interface Proposed {
  entry: ResultEntry;
  /** The result as it was when the request was made; approval is refused if it has changed since. */
  base: ResultEntry;
}

async function loadResult(s: DataScope, resultId: number): Promise<ResultWithAssessment> {
  assertLearnerLevel(s);
  const r = await prisma.assessmentResult.findFirst({
    where: { id: resultId, assessment: assessmentWhere(s) },
    include: { competencyResults: true, learner: true, assessment: { include: assessmentInclude } },
  });
  if (!r) throw notFound('Assessment result');
  return r;
}

/** The stored result expressed as an encoding-grid entry. */
export function entryFromResult(r: ResultWithAssessment): ResultEntry {
  return {
    learnerId: r.learnerId,
    rawScore: r.rawScore,
    descriptor: r.profileDescriptor,
    isAbsent: r.isAbsent,
    remarks: r.remarks,
    competencies: r.assessment.competencies
      .map((c) => ({ competencyId: c.competencyId, itemsCorrect: r.competencyResults.find((x) => x.competencyId === c.competencyId)?.itemsCorrect ?? null }))
      .sort((x, y) => x.competencyId - y.competencyId),
  };
}

const proposalSchema = z.object({
  rawScore: z.number().nullable().optional(),
  descriptor: z.string().trim().nullable().optional(),
  isAbsent: z.boolean().optional(),
  remarks: z.string().trim().max(300).nullable().optional(),
  competencies: z.array(z.object({ competencyId: z.number().int(), itemsCorrect: z.number().int().nullable() })).optional(),
});

/** Merge a proposal onto the current entry. Itemised scores are re-summed when only items change. */
export function mergeProposal(a: FullAssessment, current: ResultEntry, p: z.infer<typeof proposalSchema>): ResultEntry {
  const comps = new Map((current.competencies ?? []).map((c) => [c.competencyId, c.itemsCorrect]));
  for (const c of p.competencies ?? []) comps.set(c.competencyId, c.itemsCorrect);
  const itemised = a.competencies.length > 0 && a.competencies.reduce((n, c) => n + c.itemsTotal, 0) === a.maxScore;
  const rawScore = p.rawScore !== undefined ? p.rawScore : p.competencies && itemised ? null : current.rawScore;
  return {
    learnerId: current.learnerId,
    rawScore,
    descriptor: p.descriptor !== undefined ? p.descriptor : current.descriptor,
    isAbsent: p.isAbsent ?? current.isAbsent,
    remarks: p.remarks !== undefined ? p.remarks : current.remarks,
    competencies: [...comps.entries()].map(([competencyId, itemsCorrect]) => ({ competencyId, itemsCorrect })).sort((x, y) => x.competencyId - y.competencyId),
  };
}

/** Field-by-field differences between two entries, labelled for people. */
export function diffEntries(a: FullAssessment, before: ResultEntry, after: ResultEntry): FieldChange[] {
  const out: FieldChange[] = [];
  const push = (field: string, label: string, o: FieldChange['oldValue'] | undefined, n: FieldChange['newValue'] | undefined) => {
    if ((o ?? null) !== (n ?? null)) out.push({ field, label, oldValue: o ?? null, newValue: n ?? null });
  };
  push('isAbsent', 'Absent', !!before.isAbsent, !!after.isAbsent);
  if (a.assessmentType.resultMode === 'PERCENTAGE') {
    push('rawScore', 'Score', before.isAbsent ? null : effectiveScore(a, before), after.isAbsent ? null : effectiveScore(a, after));
  } else {
    push('descriptor', 'Level', before.descriptor, after.descriptor);
    push('rawScore', 'Score', before.rawScore, after.rawScore);
  }
  const code = new Map(a.competencies.map((c) => [c.competencyId, c.competency.code]));
  const beforeComps = new Map((before.competencies ?? []).map((c) => [c.competencyId, c.itemsCorrect]));
  for (const c of after.competencies ?? []) {
    push(`competency:${c.competencyId}`, `${code.get(c.competencyId) ?? `Competency ${c.competencyId}`} (items correct)`, beforeComps.get(c.competencyId), c.itemsCorrect);
  }
  push('remarks', 'Remarks', before.remarks, after.remarks);
  return out;
}

const sameEntry = (x: ResultEntry, y: ResultEntry) => JSON.stringify(normalize(x)) === JSON.stringify(normalize(y));
const normalize = (e: ResultEntry) => ({
  rawScore: e.rawScore ?? null,
  descriptor: e.descriptor ?? null,
  isAbsent: !!e.isAbsent,
  remarks: e.remarks ?? null,
  competencies: (e.competencies ?? []).filter((c) => c.itemsCorrect !== null).map((c) => [c.competencyId, c.itemsCorrect]).sort(),
});

function assertCorrectable(r: ResultWithAssessment) {
  assertYearAllows(r.assessment.schoolYear, 'finalize');
  if (r.assessment.deletedAt) throw notFound('Assessment result');
  if (r.assessment.status !== 'VERIFIED') {
    throw conflict(
      r.assessment.status === 'SUBMITTED'
        ? 'This assessment is awaiting validation. Ask the validator to return it instead of filing a correction.'
        : 'This assessment is not locked yet. Edit the result directly in the encoding grid.',
    );
  }
}

// ───────────── Create ─────────────
correctionsRouter.post('/', requirePermission('correction:request'), ah(async (req, res) => {
  const s = req.scope!;
  const b = z.object({
    assessmentResultId: z.number().int(),
    changes: proposalSchema,
    reason: z.string().trim().min(10, 'Explain the error (at least 10 characters)').max(1000),
    evidence: z.string().trim().max(1000).nullable().optional(),
  }).parse(req.body);
  const r = await loadResult(s, b.assessmentResultId);
  assertCorrectable(r);
  // Corrections come from the class adviser (the encoder) or a school leader, never a subject teacher.
  if (req.user!.role === 'TEACHER') {
    const sec = await prisma.section.findUniqueOrThrow({ where: { id: r.assessment.sectionId } });
    if (sec.adviserId !== req.user!.id) throw forbidden('Only the class adviser can request a correction for this class');
  }
  const a = r.assessment;
  const pending = await prisma.correctionRequest.findFirst({ where: { assessmentResultId: r.id, status: 'PENDING' } });
  if (pending) throw conflict('A correction request for this result is already pending. Wait for its decision or cancel it first.', { correctionRequestId: pending.id });

  const known = new Set(a.competencies.map((c) => c.competencyId));
  if ((b.changes.competencies ?? []).some((c) => !known.has(c.competencyId))) throw badRequest('Competency is not part of this assessment');
  const base = entryFromResult(r);
  const entry = mergeProposal(a, base, b.changes);
  const issues = validateEntry(a, entry);
  if (issues.length) throw badRequest('The corrected values are not valid', issues);
  const changes = diffEntries(a, base, entry);
  if (!changes.length) throw badRequest('The proposed values are the same as the current result');

  const cr = await prisma.correctionRequest.create({
    data: {
      assessmentResultId: r.id,
      assessmentId: a.id,
      schoolId: a.schoolId,
      sectionId: a.sectionId,
      schoolYearId: a.schoolYearId,
      changes: changes as unknown as Prisma.InputJsonValue,
      proposed: { entry, base } as unknown as Prisma.InputJsonValue,
      reason: b.reason,
      evidence: b.evidence ?? null,
      requestedById: req.user!.id,
    },
  });
  await audit(req, 'CORRECTION_REQUEST', 'CorrectionRequest', cr.id, null, { assessmentResultId: r.id, assessmentId: a.id, learnerId: r.learnerId, changes, reason: b.reason, evidence: b.evidence ?? null });
  res.status(201).json(cr);
}));

// ───────────── Read ─────────────
const listInclude = {
  requestedBy: { select: { id: true, fullName: true } },
  reviewedBy: { select: { id: true, fullName: true } },
  assessmentResult: {
    select: {
      id: true,
      learner: { select: { id: true, lrn: true, firstName: true, middleName: true, lastName: true, extensionName: true } },
      assessment: { select: { id: true, title: true, status: true, schoolYear: { select: { label: true, status: true } }, section: { select: { name: true } } } },
    },
  },
} satisfies Prisma.CorrectionRequestInclude;
type Listed = Prisma.CorrectionRequestGetPayload<{ include: typeof listInclude }>;

const present = (req: Request, c: Listed) => {
  const { assessmentResult: ar, proposed: _p, ...rest } = c;
  const me = req.user!;
  return {
    ...rest,
    learner: { id: ar.learner.id, lrn: ar.learner.lrn, name: learnerName(ar.learner) },
    assessment: ar.assessment,
    canReview: c.status === 'PENDING' && c.requestedById !== me.id && hasPermission(me.role, 'correction:review'),
    canCancel: c.status === 'PENDING' && c.requestedById === me.id,
  };
};

const scopedWhere = (s: DataScope): Prisma.CorrectionRequestWhereInput => {
  assertLearnerLevel(s);
  return { assessmentResult: { assessment: assessmentWhere(s) } };
};

correctionsRouter.get('/', requireAnyPermission('correction:request', 'correction:review'), ah(async (req, res) => {
  const s = req.scope!;
  const { page, perPage } = paginationSchema.parse(req.query);
  const q = z.object({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    assessmentId: z.coerce.number().int().optional(),
    mine: z.enum(['true', 'false']).optional(),
  }).parse(req.query);
  const where: Prisma.CorrectionRequestWhereInput = {
    AND: [scopedWhere(s), { status: q.status, assessmentId: q.assessmentId }, q.mine === 'true' ? { requestedById: req.user!.id } : {}],
  };
  const [total, rows, pendingForMe] = await Promise.all([
    prisma.correctionRequest.count({ where }),
    prisma.correctionRequest.findMany({ where, include: listInclude, orderBy: [{ createdAt: 'desc' }], skip: (page - 1) * perPage, take: perPage }),
    hasPermission(req.user!.role, 'correction:review')
      ? prisma.correctionRequest.count({ where: { AND: [scopedWhere(s), { status: 'PENDING', requestedById: { not: req.user!.id } }] } })
      : Promise.resolve(0),
  ]);
  res.json({ ...paged(rows.map((c) => present(req, c)), total, page, perPage), pendingForMe });
}));

async function loadRequest(s: DataScope, id: number) {
  const c = await prisma.correctionRequest.findFirst({ where: { id, ...scopedWhere(s) }, include: listInclude });
  if (!c) throw notFound('Correction request');
  return c;
}

correctionsRouter.get('/:id', requireAnyPermission('correction:request', 'correction:review'), ah(async (req, res) => {
  res.json(present(req, await loadRequest(req.scope!, idParam(req))));
}));

// ───────────── Decide ─────────────
correctionsRouter.post('/:id/decision', requirePermission('correction:review'), ah(async (req, res) => {
  const s = req.scope!;
  const b = z.object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(1000).optional(),
  }).refine((x) => x.decision === 'APPROVE' || (x.note?.length ?? 0) >= 5, { message: 'Give the reason for rejecting (at least 5 characters)', path: ['note'] }).parse(req.body);
  const c = await loadRequest(s, idParam(req));
  if (c.status !== 'PENDING') throw conflict(`This request is already ${c.status.toLowerCase()}`);
  if (c.requestedById === req.user!.id) throw forbidden('A correction must be decided by someone other than the requester');
  const r = await loadResult(s, c.assessmentResultId);
  const reviewed = { reviewedById: req.user!.id, reviewedAt: new Date(), reviewNote: b.note ?? null };

  if (b.decision === 'REJECT') {
    const u = await prisma.correctionRequest.update({ where: { id: c.id }, data: { ...reviewed, status: 'REJECTED' }, include: listInclude });
    await audit(req, 'CORRECTION_REJECT', 'CorrectionRequest', c.id, { status: 'PENDING' }, { status: 'REJECTED', note: b.note });
    return res.json(present(req, u));
  }

  assertCorrectable(r);
  const proposed = c.proposed as unknown as Proposed;
  if (!sameEntry(entryFromResult(r), proposed.base)) {
    throw new AppError(409, 'STALE_REQUEST', 'The result has changed since this correction was requested. Reject it and ask for a new request.');
  }
  const issues = validateEntry(r.assessment, proposed.entry);
  if (issues.length) throw badRequest('The corrected values are no longer valid for this assessment', issues);

  const { applied, gaps, updated } = await prisma.$transaction(async (tx) => {
    const applied = await applyEntries(tx, r.assessment, [proposed.entry], req.user!.id);
    const gaps = await syncLearningGaps(tx, r.assessment.id);
    const updated = await tx.correctionRequest.update({ where: { id: c.id }, data: { ...reviewed, status: 'APPROVED' }, include: listInclude });
    return { applied, gaps, updated };
  }, { timeout: 60000 });

  for (const ch of applied) {
    await audit(req, 'CORRECTION_APPLY', 'AssessmentResult', ch.resultId, ch.before, {
      ...ch.after,
      assessmentId: r.assessment.id,
      learnerId: r.learnerId,
      correctionRequestId: c.id,
      requestedBy: c.requestedBy.fullName,
      approvedBy: req.user!.fullName,
      reason: c.reason,
    });
  }
  await audit(req, 'CORRECTION_APPROVE', 'CorrectionRequest', c.id, { status: 'PENDING' }, { status: 'APPROVED', note: b.note ?? null, gaps });
  res.json({ ...present(req, updated), gaps });
}));

correctionsRouter.post('/:id/cancel', requirePermission('correction:request'), ah(async (req, res) => {
  const c = await loadRequest(req.scope!, idParam(req));
  if (c.requestedById !== req.user!.id) throw forbidden('Only the requester can cancel a correction request');
  if (c.status !== 'PENDING') throw conflict(`This request is already ${c.status.toLowerCase()}`);
  const u = await prisma.correctionRequest.update({ where: { id: c.id }, data: { status: 'CANCELLED' }, include: listInclude });
  await audit(req, 'CORRECTION_CANCEL', 'CorrectionRequest', c.id, { status: 'PENDING' }, { status: 'CANCELLED' });
  res.json(present(req, u));
}));
