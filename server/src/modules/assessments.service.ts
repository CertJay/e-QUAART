import type { Assessment, AssessmentCompetency, AssessmentResult, AssessmentType, ClassificationBand, ClassificationModel, Competency, CompetencyResult, Prisma } from '@prisma/client';
import { classify, isMastered } from '../domain/classification.js';
import { isValidLrn, normalizeLrn } from '../domain/lrn.js';

export type FullAssessment = Assessment & {
  assessmentType: AssessmentType;
  model: ClassificationModel & { bands: ClassificationBand[] };
  competencies: (AssessmentCompetency & { competency: Competency })[];
};

export interface ResultEntry {
  learnerId: number;
  rawScore?: number | null;
  descriptor?: string | null;
  isAbsent?: boolean;
  remarks?: string | null;
  competencies?: { competencyId: number; itemsCorrect: number | null }[];
}

export interface EntryIssue {
  learnerId?: number;
  row?: number;
  field?: string;
  message: string;
}

/** Validate one learner's result against the assessment configuration. Returns problems (empty = valid). */
export function validateEntry(a: FullAssessment, e: ResultEntry): EntryIssue[] {
  const issues: EntryIssue[] = [];
  const push = (field: string, message: string) => issues.push({ learnerId: e.learnerId, field, message });
  if (e.isAbsent) return issues;
  const mode = a.assessmentType.resultMode;
  const compTotals = new Map(a.competencies.map((c) => [c.competencyId, c.itemsTotal]));

  for (const c of e.competencies ?? []) {
    const total = compTotals.get(c.competencyId);
    if (total === undefined) {
      push('competencies', 'Competency is not part of this assessment');
      continue;
    }
    if (c.itemsCorrect === null || c.itemsCorrect === undefined) continue;
    if (!Number.isInteger(c.itemsCorrect) || c.itemsCorrect < 0) push('competencies', 'Items correct must be a whole number of 0 or more');
    else if (c.itemsCorrect > total) push('competencies', `Items correct (${c.itemsCorrect}) exceed the ${total} items for this competency`);
  }

  if (mode === 'PERCENTAGE') {
    const score = effectiveScore(a, e);
    if (score === null || score === undefined || Number.isNaN(score)) push('rawScore', 'Score is missing');
    else if (score < 0) push('rawScore', 'Score cannot be negative');
    else if (a.maxScore != null && score > a.maxScore) push('rawScore', `Score (${score}) exceeds the maximum score (${a.maxScore})`);
    // When the competency items make up the whole test, the parts must add up to the score.
    const itemsSum = a.competencies.reduce((s, c) => s + c.itemsTotal, 0);
    const given = (e.competencies ?? []).filter((c) => c.itemsCorrect !== null && c.itemsCorrect !== undefined);
    if (a.competencies.length && given.length === a.competencies.length && itemsSum === a.maxScore && e.rawScore != null) {
      const sum = given.reduce((s, c) => s + (c.itemsCorrect ?? 0), 0);
      if (sum !== e.rawScore) push('rawScore', `Competency items add up to ${sum} but the score is ${e.rawScore}`);
    }
  } else {
    if (!e.descriptor) push('descriptor', 'Select the learner’s profile / level');
    else if (!a.model.bands.some((b) => b.descriptorKey?.toLowerCase() === e.descriptor!.trim().toLowerCase() || b.label.toLowerCase() === e.descriptor!.trim().toLowerCase())) {
      push('descriptor', `"${e.descriptor}" is not a valid level for ${a.assessmentType.name}`);
    }
    if (e.rawScore != null && a.maxScore != null && (e.rawScore < 0 || e.rawScore > a.maxScore)) push('rawScore', `Score must be between 0 and ${a.maxScore}`);
  }
  return issues;
}

/** Raw score, falling back to the sum of competency items when the whole test is itemised. */
export function effectiveScore(a: FullAssessment, e: ResultEntry): number | null {
  if (e.rawScore !== null && e.rawScore !== undefined) return e.rawScore;
  const itemsSum = a.competencies.reduce((s, c) => s + c.itemsTotal, 0);
  const given = (e.competencies ?? []).filter((c) => c.itemsCorrect !== null && c.itemsCorrect !== undefined);
  if (a.competencies.length && given.length === a.competencies.length && itemsSum === a.maxScore) {
    return given.reduce((s, c) => s + (c.itemsCorrect ?? 0), 0);
  }
  return null;
}

type Snapshot = Pick<AssessmentResult, 'rawScore' | 'percentage' | 'profileDescriptor' | 'tier' | 'isAbsent' | 'remarks'> & {
  band: string | null;
  competencies: Record<number, number>;
};

const snapshot = (r: (AssessmentResult & { band?: ClassificationBand | null; competencyResults: CompetencyResult[] }) | null): Snapshot | null =>
  r && {
    rawScore: r.rawScore,
    percentage: r.percentage,
    profileDescriptor: r.profileDescriptor,
    tier: r.tier,
    band: r.band?.label ?? null,
    isAbsent: r.isAbsent,
    remarks: r.remarks,
    competencies: Object.fromEntries(r.competencyResults.map((c) => [c.competencyId, c.itemsCorrect])),
  };

/**
 * Write validated entries: classify each result through the configured model, compute
 * competency mastery, and return a before/after change list for the audit trail.
 */
export async function applyEntries(tx: Prisma.TransactionClient, a: FullAssessment, entries: ResultEntry[], userId: number) {
  const existing = await tx.assessmentResult.findMany({
    where: { assessmentId: a.id, learnerId: { in: entries.map((e) => e.learnerId) } },
    include: { competencyResults: true, band: true },
  });
  const byLearner = new Map(existing.map((r) => [r.learnerId, r]));
  const compTotals = new Map(a.competencies.map((c) => [c.competencyId, c.itemsTotal]));
  const changes: { resultId: number; learnerId: number; before: Snapshot | null; after: Snapshot }[] = [];

  for (const e of entries) {
    const score = e.isAbsent ? null : effectiveScore(a, e);
    const c = e.isAbsent
      ? { percentage: null, band: null, tier: null }
      : classify({ mode: a.assessmentType.resultMode, rawScore: score, maxScore: a.maxScore, descriptor: e.descriptor }, a.model.bands);
    const band = c.band as ClassificationBand | null;
    const data = {
      rawScore: score,
      percentage: c.percentage,
      profileDescriptor: e.isAbsent ? null : (band?.descriptorKey ?? e.descriptor ?? null),
      bandId: band?.id ?? null,
      tier: c.tier,
      isAbsent: !!e.isAbsent,
      remarks: e.remarks ?? null,
    };
    const prev = byLearner.get(e.learnerId) ?? null;
    const result = prev
      ? await tx.assessmentResult.update({ where: { id: prev.id }, data: { ...data, updatedById: userId } })
      : await tx.assessmentResult.create({ data: { ...data, assessmentId: a.id, learnerId: e.learnerId, encodedById: userId } });

    const comps = e.isAbsent ? [] : (e.competencies ?? []).filter((x) => x.itemsCorrect !== null && x.itemsCorrect !== undefined);
    await tx.competencyResult.deleteMany({ where: { resultId: result.id, competencyId: { notIn: comps.map((x) => x.competencyId) } } });
    for (const x of comps) {
      const total = compTotals.get(x.competencyId)!;
      const mastered = isMastered(x.itemsCorrect!, total, a.model.masteryThreshold);
      await tx.competencyResult.upsert({
        where: { resultId_competencyId: { resultId: result.id, competencyId: x.competencyId } },
        create: { resultId: result.id, competencyId: x.competencyId, itemsCorrect: x.itemsCorrect!, itemsTotal: total, mastered },
        update: { itemsCorrect: x.itemsCorrect!, itemsTotal: total, mastered },
      });
    }
    const after: Snapshot = {
      ...data,
      band: band?.label ?? null,
      competencies: Object.fromEntries(comps.map((x) => [x.competencyId, x.itemsCorrect!])),
    };
    const before = snapshot(prev);
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ resultId: result.id, learnerId: e.learnerId, before, after });
  }
  return changes;
}

// ───────────── Import parsing ─────────────
export interface ImportContext {
  assessment: FullAssessment & { gradeLevel: { code: string; name: string }; learningArea: { code: string; name: string }; section: { name: string } };
  rosterByLrn: Map<string, { learnerId: number; enrolled: boolean }>;
  existingLearnerIds: Set<number>;
}

const truthy = (v: string | undefined) => ['y', 'yes', 'true', '1', 'absent', 'a'].includes((v ?? '').trim().toLowerCase());
const num = (v: string | undefined) => {
  const t = (v ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Turn uploaded rows into result entries, collecting every problem before anything is written.
 * Recognised columns: lrn, score, descriptor|level, absent, remarks, grade_level, section,
 * learning_area, and one `comp:<CODE>` column per competency (items correct).
 */
export function parseResultRows(rows: Record<string, string>[], ctx: ImportContext) {
  const a = ctx.assessment;
  const errors: EntryIssue[] = [];
  const warnings: EntryIssue[] = [];
  const entries: ResultEntry[] = [];
  const seen = new Map<string, number>();
  const compByCode = new Map(a.competencies.map((c) => [c.competency.code.toLowerCase(), c.competencyId]));

  rows.forEach((r, i) => {
    const row = i + 2;
    const err = (field: string, message: string) => errors.push({ row, field, message });
    const lrn = normalizeLrn(r.lrn);
    if (!lrn) return err('lrn', 'LRN is missing');
    if (!isValidLrn(lrn)) return err('lrn', `"${r.lrn}" is not a valid 12-digit LRN`);
    const prev = seen.get(lrn);
    if (prev) return err('lrn', `Duplicate LRN in file (also on row ${prev})`);
    seen.set(lrn, row);
    const learner = ctx.rosterByLrn.get(lrn);
    if (!learner) return err('lrn', 'Learner is not enrolled in this class (invalid learner or section)');
    if (!learner.enrolled) warnings.push({ row, field: 'lrn', message: 'Learner is no longer currently enrolled in this class' });

    const gl = (r.grade_level ?? r.grade ?? '').trim().toLowerCase();
    if (gl && ![a.gradeLevel.code.toLowerCase(), a.gradeLevel.name.toLowerCase(), a.gradeLevel.name.replace(/grade\s*/i, '').toLowerCase()].includes(gl)) {
      err('grade_level', `Grade level "${r.grade_level ?? r.grade}" does not match this assessment (${a.gradeLevel.name})`);
    }
    if (r.section && r.section.trim().toLowerCase() !== a.section.name.toLowerCase()) {
      err('section', `Section "${r.section}" does not match this assessment (${a.section.name})`);
    }
    const la = (r.learning_area ?? r.subject ?? '').trim().toLowerCase();
    if (la && la !== a.learningArea.code.toLowerCase() && la !== a.learningArea.name.toLowerCase()) {
      err('learning_area', `Learning area "${r.learning_area ?? r.subject}" does not match this assessment (${a.learningArea.name})`);
    }

    const isAbsent = truthy(r.absent);
    const rawScore = num(r.score ?? r.raw_score);
    if (Number.isNaN(rawScore)) err('score', `Score "${r.score ?? r.raw_score}" is not a number`);
    const competencies: ResultEntry['competencies'] = [];
    for (const [k, v] of Object.entries(r)) {
      if (!k.startsWith('comp:')) continue;
      const code = k.slice(5);
      const cid = compByCode.get(code);
      if (!cid) {
        err(k, `Column ${k} does not match a competency of this assessment`);
        continue;
      }
      const n = num(v);
      if (Number.isNaN(n)) err(k, `"${v}" is not a number`);
      else competencies.push({ competencyId: cid, itemsCorrect: n });
    }
    const entry: ResultEntry = {
      learnerId: learner.learnerId,
      rawScore: Number.isNaN(rawScore) ? null : rawScore,
      descriptor: (r.descriptor ?? r.level ?? r.profile ?? '').trim() || null,
      isAbsent,
      remarks: (r.remarks ?? '').trim() || null,
      competencies,
    };
    for (const iss of validateEntry(a, entry)) errors.push({ row, field: iss.field, message: iss.message });
    if (ctx.existingLearnerIds.has(learner.learnerId)) warnings.push({ row, field: 'lrn', message: 'A result already exists for this learner and will be replaced' });
    entries.push(entry);
  });
  return { entries, errors, warnings };
}
