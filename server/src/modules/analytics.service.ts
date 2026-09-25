import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { computeEffectiveness } from '../domain/effectiveness.js';
import { rate, suppress, tierMetrics } from '../domain/metrics.js';
import { getSettings, type Settings } from '../domain/settings.js';
import { learnerName } from '../domain/lrn.js';
import { assertLearnerLevel, assessmentScopeSql, interventionWhere, type DataScope } from '../rbac/scope.js';

// ───────────── Filters & dimensions ─────────────
const id = z.coerce.number().int().positive().optional();
export const filterSchema = z.object({
  schoolYearId: id,
  termId: id,
  districtId: id,
  schoolId: id,
  keyStageId: id,
  gradeLevelId: id,
  sectionId: id,
  learningAreaId: id,
  assessmentTypeId: id,
  assessmentId: id,
  bandId: id,
  tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']).optional(),
  verifiedOnly: z.enum(['true', 'false']).optional(),
});
export type Filters = z.infer<typeof filterSchema>;

export const DIMENSIONS = {
  district: 'district_id',
  school: 'school_id',
  keyStage: 'key_stage_id',
  gradeLevel: 'grade_level_id',
  section: 'section_id',
  learningArea: 'learning_area_id',
  assessmentType: 'assessment_type_id',
  schoolYear: 'school_year_id',
  term: 'term_id',
  assessment: 'assessment_id',
  band: 'band_id',
  learner: 'learner_id',
} as const;
export type Dim = keyof typeof DIMENSIONS;
export const dimSchema = z.enum(Object.keys(DIMENSIONS) as [Dim, ...Dim[]]);

const LEARNER_DIMS: Dim[] = ['learner'];

/** Conditions shared by every analytic query, applied to Assessment `a`, School `s`, GradeLevel `g`. */
function assessmentConditions(scope: DataScope, f: Filters): Prisma.Sql[] {
  const c = assessmentScopeSql(scope, 'a');
  const eq = (col: string, v: number | undefined) => v !== undefined && c.push(Prisma.sql`${Prisma.raw(col)} = ${v}`);
  eq('a."schoolYearId"', f.schoolYearId);
  eq('a."termId"', f.termId);
  eq('s."districtId"', f.districtId);
  eq('a."schoolId"', f.schoolId);
  eq('g."keyStageId"', f.keyStageId);
  eq('a."gradeLevelId"', f.gradeLevelId);
  eq('a."sectionId"', f.sectionId);
  eq('a."learningAreaId"', f.learningAreaId);
  eq('a."assessmentTypeId"', f.assessmentTypeId);
  eq('a.id', f.assessmentId);
  return c;
}

/** Classified results of finalized assessments inside the caller's scope. */
function factsCte(scope: DataScope, f: Filters): Prisma.Sql {
  const c = assessmentConditions(scope, f);
  c.push(f.verifiedOnly === 'true' ? Prisma.sql`a.status = 'VERIFIED'` : Prisma.sql`a.status IN ('SUBMITTED','VERIFIED')`);
  c.push(Prisma.sql`r."isAbsent" = false AND r.tier IS NOT NULL`);
  if (f.bandId) c.push(Prisma.sql`r."bandId" = ${f.bandId}`);
  if (f.tier) c.push(Prisma.sql`r.tier = ${f.tier}::"Tier"`);
  return Prisma.sql`
    SELECT r.id AS result_id, r."learnerId" AS learner_id, r.percentage AS pct, r.tier::text AS tier, r."bandId" AS band_id,
           a.id AS assessment_id, a."schoolId" AS school_id, s."districtId" AS district_id, a."sectionId" AS section_id,
           a."gradeLevelId" AS grade_level_id, g."keyStageId" AS key_stage_id, a."learningAreaId" AS learning_area_id,
           a."assessmentTypeId" AS assessment_type_id, a."schoolYearId" AS school_year_id, a."termId" AS term_id
    FROM "AssessmentResult" r
    JOIN "Assessment" a ON a.id = r."assessmentId"
    JOIN "School" s ON s.id = a."schoolId"
    JOIN "GradeLevel" g ON g.id = a."gradeLevelId"
    WHERE ${Prisma.join(c, ' AND ')}`;
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const n1 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

interface AggRow {
  keys: Record<string, number>;
  assessed: number;
  learners: number;
  avgPct: number | null;
  tier1: number;
  tier2: number;
  tier3: number;
}

/** Aggregate classified results, grouped by zero or more dimensions. */
export async function aggregate(scope: DataScope, f: Filters, dims: Dim[] = []): Promise<AggRow[]> {
  if (dims.some((d) => LEARNER_DIMS.includes(d))) assertLearnerLevel(scope);
  const cols = dims.map((d) => Prisma.raw(DIMENSIONS[d]));
  const select = cols.length ? Prisma.sql`${Prisma.join(cols, ', ')},` : Prisma.empty;
  const group = cols.length ? Prisma.sql`GROUP BY ${Prisma.join(cols, ', ')}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH f AS (${factsCte(scope, f)})
    SELECT ${select}
      COUNT(*) AS assessed, COUNT(DISTINCT learner_id) AS learners, AVG(pct) AS avg_pct,
      COUNT(*) FILTER (WHERE tier = 'TIER_1') AS t1,
      COUNT(*) FILTER (WHERE tier = 'TIER_2') AS t2,
      COUNT(*) FILTER (WHERE tier = 'TIER_3') AS t3
    FROM f ${group}`;
  return rows
    .filter((r) => dims.every((d) => r[DIMENSIONS[d]] !== null))
    .map((r) => ({
      keys: Object.fromEntries(dims.map((d) => [d, n(r[DIMENSIONS[d]])])),
      assessed: n(r.assessed),
      learners: n(r.learners),
      avgPct: n1(r.avg_pct),
      tier1: n(r.t1),
      tier2: n(r.t2),
      tier3: n(r.t3),
    }));
}

async function bandCounts(scope: DataScope, f: Filters, dim?: Dim) {
  const col = dim ? Prisma.raw(DIMENSIONS[dim]) : null;
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH f AS (${factsCte(scope, f)})
    SELECT ${col ? Prisma.sql`${col} AS k,` : Prisma.empty} band_id, COUNT(*) AS c FROM f
    GROUP BY ${col ? Prisma.sql`${col},` : Prisma.empty} band_id`;
  const bandIds = [...new Set(rows.map((r) => n(r.band_id)))];
  const bands = await prisma.classificationBand.findMany({ where: { id: { in: bandIds } }, include: { model: { select: { assessmentType: { select: { name: true } } } } } });
  return { rows: rows.map((r) => ({ k: n(r.k), bandId: n(r.band_id), count: n(r.c) })), bands };
}

type BandInfo = { label: string; tier: string; color: string; sortOrder: number; count: number };

/** Merge bands that share a label and tier (e.g. "Proficient" defined by two models). */
function mergeBands(rows: { bandId: number; count: number }[], bands: { id: number; label: string; tier: string; color: string; sortOrder: number }[]): BandInfo[] {
  const byId = new Map(bands.map((b) => [b.id, b]));
  const merged = new Map<string, BandInfo>();
  for (const r of rows) {
    const b = byId.get(r.bandId);
    if (!b) continue;
    const key = `${b.tier}|${b.label}`;
    const cur = merged.get(key);
    if (cur) cur.count += r.count;
    else merged.set(key, { label: b.label, tier: b.tier, color: b.color, sortOrder: b.sortOrder, count: r.count });
  }
  return [...merged.values()].sort((x, y) => x.tier.localeCompare(y.tier) || x.sortOrder - y.sortOrder);
}

// ───────────── Labels ─────────────
export interface Label {
  label: string;
  sort: string;
  meta?: Record<string, unknown>;
}

export async function labels(dim: Dim, ids: number[]): Promise<Map<number, Label>> {
  const m = new Map<number, Label>();
  if (!ids.length) return m;
  const pad = (x: number) => String(x).padStart(6, '0');
  const where = { id: { in: ids } };
  switch (dim) {
    case 'district':
      (await prisma.district.findMany({ where })).forEach((x) => m.set(x.id, { label: x.name, sort: x.name }));
      break;
    case 'school':
      (await prisma.school.findMany({ where, include: { district: true } })).forEach((x) => m.set(x.id, { label: x.name, sort: x.name, meta: { district: x.district.name, schoolIdDeped: x.schoolIdDeped } }));
      break;
    case 'keyStage':
      (await prisma.keyStage.findMany({ where })).forEach((x) => m.set(x.id, { label: x.name, sort: pad(x.sortOrder) }));
      break;
    case 'gradeLevel':
      (await prisma.gradeLevel.findMany({ where })).forEach((x) => m.set(x.id, { label: x.name, sort: pad(x.sortOrder) }));
      break;
    case 'section':
      (await prisma.section.findMany({ where, include: { gradeLevel: true, school: true } })).forEach((x) =>
        m.set(x.id, { label: `${x.gradeLevel.name} – ${x.name}`, sort: `${x.school.name}|${pad(x.gradeLevel.sortOrder)}|${x.name}`, meta: { school: x.school.name } }));
      break;
    case 'learningArea':
      (await prisma.learningArea.findMany({ where })).forEach((x) => m.set(x.id, { label: x.name, sort: `${pad(x.sortOrder)}${x.name}`, meta: { code: x.code } }));
      break;
    case 'assessmentType':
      (await prisma.assessmentType.findMany({ where })).forEach((x) => m.set(x.id, { label: x.name, sort: x.name, meta: { code: x.code, resultMode: x.resultMode } }));
      break;
    case 'schoolYear':
      (await prisma.schoolYear.findMany({ where })).forEach((x) => m.set(x.id, { label: x.label, sort: x.label }));
      break;
    case 'term':
      (await prisma.term.findMany({ where, include: { schoolYear: true } })).forEach((x) =>
        m.set(x.id, { label: `${x.name} ${x.schoolYear.label}`, sort: `${x.schoolYear.startDate.toISOString()}|${pad(x.sortOrder)}`, meta: { code: x.code, schoolYear: x.schoolYear.label } }));
      break;
    case 'assessment':
      (await prisma.assessment.findMany({ where, include: { term: true } })).forEach((x) => m.set(x.id, { label: x.title, sort: `${x.title}` }));
      break;
    case 'band':
      (await prisma.classificationBand.findMany({ where })).forEach((x) => m.set(x.id, { label: x.label, sort: `${x.tier}|${pad(x.sortOrder)}`, meta: { tier: x.tier, color: x.color } }));
      break;
    case 'learner':
      (await prisma.learner.findMany({ where })).forEach((x) => m.set(x.id, { label: learnerName(x), sort: learnerName(x), meta: { lrn: x.lrn } }));
      break;
  }
  return m;
}

// ───────────── Public analytics ─────────────

/** Rows for one dimension, with tier metrics, band distribution, and small-cell suppression. */
export async function breakdown(scope: DataScope, f: Filters, dim: Dim) {
  const settings = await getSettings();
  const [rows, bc] = await Promise.all([aggregate(scope, f, [dim]), bandCounts(scope, f, dim)]);
  const lbl = await labels(dim, rows.map((r) => r.keys[dim]));
  return rows
    .map((r) => {
      const key = r.keys[dim];
      const l = lbl.get(key) ?? { label: `#${key}`, sort: String(key) };
      const bands = mergeBands(bc.rows.filter((b) => b.k === key), bc.bands);
      return suppress({ key, label: l.label, sortKey: l.sort, meta: l.meta, learners: r.learners, avgPct: r.avgPct, ...tierMetrics(r), bands }, settings.smallCellThreshold, !scope.learnerLevel);
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export async function distribution(scope: DataScope, f: Filters) {
  const bc = await bandCounts(scope, f);
  return mergeBands(bc.rows, bc.bands);
}

/** Assessment completion: encoded results vs enrolled learners of the assessed classes. */
export async function completion(scope: DataScope, f: Filters, dim?: Dim) {
  const c = assessmentConditions(scope, f);
  const col = dim ? Prisma.raw(`x.${DIMENSIONS[dim]}`) : null;
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH x AS (
      SELECT a.id, a.status::text AS status, a."schoolId" AS school_id, s."districtId" AS district_id, a."sectionId" AS section_id,
             a."gradeLevelId" AS grade_level_id, g."keyStageId" AS key_stage_id, a."learningAreaId" AS learning_area_id,
             a."assessmentTypeId" AS assessment_type_id, a."schoolYearId" AS school_year_id, a."termId" AS term_id,
             (SELECT COUNT(*) FROM "AssessmentResult" r WHERE r."assessmentId" = a.id) AS encoded,
             (SELECT COUNT(*) FROM "Enrolment" e WHERE e."sectionId" = a."sectionId" AND e."isCurrent") AS enrolled
      FROM "Assessment" a JOIN "School" s ON s.id = a."schoolId" JOIN "GradeLevel" g ON g.id = a."gradeLevelId"
      WHERE ${Prisma.join(c, ' AND ')}
    )
    SELECT ${col ? Prisma.sql`${col} AS k,` : Prisma.empty}
      COUNT(*) AS assessments,
      COUNT(*) FILTER (WHERE x.status = 'DRAFT') AS draft,
      COUNT(*) FILTER (WHERE x.status = 'SUBMITTED') AS submitted,
      COUNT(*) FILTER (WHERE x.status = 'VERIFIED') AS verified,
      COUNT(*) FILTER (WHERE x.status = 'RETURNED') AS returned,
      SUM(LEAST(x.encoded, x.enrolled)) AS encoded,
      SUM(x.enrolled) AS enrolled
    FROM x ${col ? Prisma.sql`GROUP BY ${col}` : Prisma.empty}`;
  return rows.map((r) => ({
    key: n(r.k),
    assessments: n(r.assessments),
    draft: n(r.draft),
    submitted: n(r.submitted),
    verified: n(r.verified),
    returned: n(r.returned),
    finalized: n(r.submitted) + n(r.verified),
    encoded: n(r.encoded),
    enrolled: n(r.enrolled),
    completionRate: rate(n(r.encoded), n(r.enrolled)),
    finalizationRate: rate(n(r.submitted) + n(r.verified), n(r.assessments)),
  }));
}

const GAP_DIM_COLS: Partial<Record<Dim, string>> = {
  school: 'lg."schoolId"',
  section: 'lg."sectionId"',
  learningArea: 'lg."learningAreaId"',
  term: 'lg."termId"',
  schoolYear: 'lg."schoolYearId"',
  gradeLevel: 'sec."gradeLevelId"',
  keyStage: 'g."keyStageId"',
  district: 'sch."districtId"',
};

function gapConditions(scope: DataScope, f: Filters): Prisma.Sql[] {
  const c: Prisma.Sql[] = [];
  const inList = (col: string, ids: number[]) => c.push(ids.length ? Prisma.sql`${Prisma.raw(col)} IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`);
  if (scope.schoolIds) inList('lg."schoolId"', scope.schoolIds);
  if (scope.sectionIds) inList('lg."sectionId"', scope.sectionIds);
  if (scope.learningAreaIds) inList('lg."learningAreaId"', scope.learningAreaIds);
  const eq = (col: string, v: number | undefined) => v !== undefined && c.push(Prisma.sql`${Prisma.raw(col)} = ${v}`);
  eq('lg."schoolYearId"', f.schoolYearId);
  eq('lg."termId"', f.termId);
  eq('lg."schoolId"', f.schoolId);
  eq('lg."sectionId"', f.sectionId);
  eq('lg."learningAreaId"', f.learningAreaId);
  eq('sec."gradeLevelId"', f.gradeLevelId);
  eq('g."keyStageId"', f.keyStageId);
  eq('sch."districtId"', f.districtId);
  if (f.assessmentTypeId) c.push(Prisma.sql`a."assessmentTypeId" = ${f.assessmentTypeId}`);
  if (f.assessmentId) c.push(Prisma.sql`a.id = ${f.assessmentId}`);
  if (!c.length) c.push(Prisma.sql`TRUE`);
  return c;
}

/** Intervention coverage: learners with an identified gap who are in an intervention. */
export async function coverage(scope: DataScope, f: Filters, dim?: Dim) {
  const colExpr = dim ? GAP_DIM_COLS[dim] : undefined;
  if (dim && !colExpr) throw badRequest(`Coverage cannot be grouped by ${dim}`);
  const col = colExpr ? Prisma.raw(colExpr) : null;
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT ${col ? Prisma.sql`${col} AS k,` : Prisma.empty}
      COUNT(DISTINCT lg."learnerId") AS identified,
      COUNT(DISTINCT lg."learnerId") FILTER (WHERE EXISTS (
        SELECT 1 FROM "InterventionLearner" il JOIN "Intervention" i ON i.id = il."interventionId"
        WHERE il."learnerId" = lg."learnerId" AND i."deletedAt" IS NULL AND i."learningAreaId" = lg."learningAreaId" AND i."schoolYearId" = lg."schoolYearId"
      )) AS covered,
      COUNT(*) AS gaps,
      COUNT(*) FILTER (WHERE lg.status = 'RESOLVED') AS resolved
    FROM "LearningGap" lg
    JOIN "Section" sec ON sec.id = lg."sectionId"
    JOIN "GradeLevel" g ON g.id = sec."gradeLevelId"
    JOIN "School" sch ON sch.id = lg."schoolId"
    JOIN "AssessmentResult" r ON r.id = lg."assessmentResultId"
    JOIN "Assessment" a ON a.id = r."assessmentId"
    WHERE a."deletedAt" IS NULL AND ${Prisma.join(gapConditions(scope, f), ' AND ')}
    ${col ? Prisma.sql`GROUP BY ${col}` : Prisma.empty}`;
  return rows.map((r) => ({
    key: n(r.k),
    identified: n(r.identified),
    covered: n(r.covered),
    coverageRate: rate(n(r.covered), n(r.identified)),
    gaps: n(r.gaps),
    resolvedGaps: n(r.resolved),
  }));
}

/** Pre/post intervention outcomes for reassessed learners. */
export async function interventionOutcomes(scope: DataScope, f: Filters) {
  const iw: Prisma.InterventionWhereInput = {
    AND: [
      interventionWhere(scope),
      f.schoolId ? { schoolId: f.schoolId } : {},
      f.learningAreaId ? { learningAreaId: f.learningAreaId } : {},
      f.schoolYearId ? { schoolYearId: f.schoolYearId } : {},
      f.sectionId ? { sectionId: f.sectionId } : {},
      f.districtId ? { school: { districtId: f.districtId } } : {},
    ],
  };
  const where: Prisma.InterventionLearnerWhereInput = { intervention: iw };
  const [byStatus, learners] = await Promise.all([
    prisma.intervention.groupBy({ by: ['status'], where: iw, _count: true }),
    prisma.interventionLearner.findMany({ where, include: { reassessments: { include: { band: true }, orderBy: { date: 'desc' }, take: 1 } } }),
  ]);
  let reassessed = 0;
  let improved = 0;
  let reachedStandard = 0;
  let sumDiff = 0;
  let nDiff = 0;
  for (const il of learners) {
    const post = il.reassessments[0];
    if (!post) continue;
    reassessed++;
    const e = computeEffectiveness({ percentage: il.prePercentage, tier: il.preTier }, { percentage: post.percentage, tier: post.tier, bandLabel: post.band?.label });
    if (e?.improved) improved++;
    if (post.tier === 'TIER_1') reachedStandard++;
    if (e?.scoreDifference != null) {
      sumDiff += e.scoreDifference;
      nDiff++;
    }
  }
  return {
    interventions: byStatus.reduce((s, x) => s + x._count, 0),
    byStatus: Object.fromEntries(byStatus.map((x) => [x.status, x._count])),
    learnersInIntervention: learners.length,
    reassessed,
    improved,
    reachedStandard,
    improvementRate: rate(improved, reassessed),
    averageGain: nDiff ? Math.round((sumDiff / nDiff) * 10) / 10 : null,
  };
}

/** Least-mastered competencies with class / school / division-level gap classification (§13). */
export async function leastMastered(scope: DataScope, f: Filters, limit = 25) {
  const settings = await getSettings();
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH f AS (${factsCte(scope, f)}),
    per_section AS (
      SELECT c."competencyId" AS cid, f.section_id, f.school_id, COUNT(*) AS n, COUNT(*) FILTER (WHERE NOT c.mastered) AS nm
      FROM "CompetencyResult" c JOIN f ON f.result_id = c."resultId"
      GROUP BY 1, 2, 3
    )
    SELECT cid, SUM(n) AS assessed, SUM(nm) AS not_mastered,
      COUNT(DISTINCT section_id) AS sections,
      COUNT(DISTINCT section_id) FILTER (WHERE nm * 100.0 / n >= ${settings.classGapRate}) AS gap_sections,
      COUNT(DISTINCT school_id) AS schools,
      COUNT(DISTINCT school_id) FILTER (WHERE nm * 100.0 / n >= ${settings.classGapRate}) AS gap_schools
    FROM per_section GROUP BY cid HAVING SUM(nm) > 0
    ORDER BY SUM(nm) * 1.0 / SUM(n) DESC, SUM(nm) DESC
    LIMIT ${limit}`;
  const comps = await prisma.competency.findMany({
    where: { id: { in: rows.map((r) => n(r.cid)) } },
    include: { learningArea: { select: { id: true, code: true, name: true } }, gradeLevel: { select: { id: true, name: true } } },
  });
  const byId = new Map(comps.map((c) => [c.id, c]));
  // Max gap sections within a single school, to decide whether a school-wide pattern exists.
  const perSchool = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH f AS (${factsCte(scope, f)}),
    per_section AS (
      SELECT c."competencyId" AS cid, f.section_id, f.school_id, COUNT(*) AS n, COUNT(*) FILTER (WHERE NOT c.mastered) AS nm
      FROM "CompetencyResult" c JOIN f ON f.result_id = c."resultId" GROUP BY 1, 2, 3
    )
    SELECT cid, MAX(k) AS max_sections FROM (
      SELECT cid, school_id, COUNT(*) FILTER (WHERE nm * 100.0 / n >= ${settings.classGapRate}) AS k FROM per_section GROUP BY 1, 2
    ) t GROUP BY cid`;
  const maxSections = new Map(perSchool.map((r) => [n(r.cid), n(r.max_sections)]));
  return rows.map((r) => {
    const cid = n(r.cid);
    const c = byId.get(cid);
    const gapSchools = n(r.gap_schools);
    const level =
      gapSchools >= settings.divisionGapSchools ? 'DIVISION'
        : (maxSections.get(cid) ?? 0) >= settings.schoolGapSections ? 'SCHOOL'
          : n(r.gap_sections) >= 1 ? 'CLASS' : 'INDIVIDUAL';
    const row = {
      competencyId: cid,
      code: c?.code ?? '',
      description: c?.description ?? '',
      learningArea: c?.learningArea,
      gradeLevel: c?.gradeLevel,
      assessed: n(r.assessed),
      notMastered: n(r.not_mastered),
      notMasteredRate: rate(n(r.not_mastered), n(r.assessed)),
      sections: n(r.sections),
      gapSections: n(r.gap_sections),
      schools: n(r.schools),
      gapSchools,
      level,
    };
    return suppress(row, settings.smallCellThreshold, !scope.learnerLevel);
  });
}

/** Grade × learning-area (or any two dims) matrix for heatmaps. */
export async function heatmap(scope: DataScope, f: Filters, rowDim: Dim, colDim: Dim) {
  if (rowDim === colDim) throw badRequest('Choose two different dimensions');
  const settings = await getSettings();
  const rows = await aggregate(scope, f, [rowDim, colDim]);
  const [rl, cl] = await Promise.all([labels(rowDim, [...new Set(rows.map((r) => r.keys[rowDim]))]), labels(colDim, [...new Set(rows.map((r) => r.keys[colDim]))])]);
  const axis = (m: Map<number, Label>) => [...m.entries()].map(([key, l]) => ({ key, label: l.label, sort: l.sort })).sort((a, b) => a.sort.localeCompare(b.sort));
  return {
    rows: axis(rl),
    cols: axis(cl),
    cells: rows.map((r) => suppress({ row: r.keys[rowDim], col: r.keys[colDim], avgPct: r.avgPct, ...tierMetrics(r) }, settings.smallCellThreshold, !scope.learnerLevel)),
  };
}

/** Performance per term, optionally split into series by another dimension. */
export async function trend(scope: DataScope, f: Filters, series?: Dim) {
  const settings = await getSettings();
  const { termId: _t, ...rest } = f;
  const dims: Dim[] = series ? ['term', series] : ['term'];
  const rows = await aggregate(scope, rest, dims);
  const tl = await labels('term', [...new Set(rows.map((r) => r.keys.term))]);
  const sl = series ? await labels(series, [...new Set(rows.map((r) => r.keys[series]))]) : null;
  const terms = [...tl.entries()].map(([key, l]) => ({ key, label: l.label, sort: l.sort })).sort((a, b) => a.sort.localeCompare(b.sort));
  const seriesList = sl ? [...sl.entries()].map(([key, l]) => ({ key, label: l.label, sort: l.sort })).sort((a, b) => a.sort.localeCompare(b.sort)) : [{ key: 0, label: 'All', sort: '' }];
  const points = rows.map((r) => suppress({ term: r.keys.term, series: series ? r.keys[series] : 0, avgPct: r.avgPct, ...tierMetrics(r) }, settings.smallCellThreshold, !scope.learnerLevel));
  return { terms, series: seriesList, points };
}

/** Grade × learning-area combinations that stay above the at-risk alert rate for consecutive terms. */
export async function persistentGaps(scope: DataScope, f: Filters, settings?: Settings) {
  const st = settings ?? (await getSettings());
  const { termId: _t, schoolYearId: _sy, ...rest } = f;
  const rows = await aggregate(scope, rest, ['school', 'gradeLevel', 'learningArea', 'term']);
  const termLabels = await labels('term', [...new Set(rows.map((r) => r.keys.term))]);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.keys.school}|${r.keys.gradeLevel}|${r.keys.learningArea}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const hits: { school: number; gradeLevel: number; learningArea: number; terms: string[]; latestAtRiskRate: number | null }[] = [];
  const allTerms = [...termLabels.entries()].sort((a, b) => a[1].sort.localeCompare(b[1].sort)).map(([k]) => k);
  for (const g of groups.values()) {
    const byTerm = new Map(g.map((r) => [r.keys.term, r]));
    let run: number[] = [];
    let best: number[] = [];
    for (const t of allTerms) {
      const r = byTerm.get(t);
      const ar = r ? tierMetrics(r).atRiskRate : null;
      if (r && ar !== null && ar >= st.atRiskAlertRate && r.assessed >= st.smallCellThreshold) run.push(t);
      else if (r) run = [];
      if (run.length > best.length) best = [...run];
    }
    if (best.length >= st.persistentTerms) {
      const last = byTerm.get(best[best.length - 1])!;
      hits.push({ school: g[0].keys.school, gradeLevel: g[0].keys.gradeLevel, learningArea: g[0].keys.learningArea, terms: best.map((t) => termLabels.get(t)!.label), latestAtRiskRate: tierMetrics(last).atRiskRate });
    }
  }
  const [sl, gl, ll] = await Promise.all([
    labels('school', [...new Set(hits.map((h) => h.school))]),
    labels('gradeLevel', [...new Set(hits.map((h) => h.gradeLevel))]),
    labels('learningArea', [...new Set(hits.map((h) => h.learningArea))]),
  ]);
  return hits
    .map((h) => ({ ...h, schoolName: sl.get(h.school)?.label, gradeLevelName: gl.get(h.gradeLevel)?.label, learningAreaName: ll.get(h.learningArea)?.label }))
    .sort((a, b) => `${a.schoolName}${a.gradeLevelName}`.localeCompare(`${b.schoolName}${b.gradeLevelName}`));
}

/**
 * Schools that may need technical assistance, each with the reasons that triggered the flag.
 * Listed alphabetically — this is not a ranking.
 */
export async function schoolsNeedingSupport(scope: DataScope, f: Filters) {
  const st = await getSettings();
  const [perf, comp, cov] = await Promise.all([aggregate(scope, f, ['school']), completion(scope, f, 'school'), coverage(scope, f, 'school')]);
  const ids = [...new Set([...perf.map((p) => p.keys.school), ...comp.map((c) => c.key)])];
  const lbl = await labels('school', ids);
  const out = ids.map((sid) => {
    const p = perf.find((x) => x.keys.school === sid);
    const m = p ? tierMetrics(p) : null;
    const c = comp.find((x) => x.key === sid);
    const v = cov.find((x) => x.key === sid);
    const reasons: string[] = [];
    if (m?.atRiskRate != null && m.atRiskRate >= st.atRiskAlertRate) reasons.push(`At-risk rate ${m.atRiskRate}% (alert ≥ ${st.atRiskAlertRate}%)`);
    if (m?.tier3Rate != null && m.tier3Rate >= st.tier3AlertRate) reasons.push(`Tier 3 rate ${m.tier3Rate}% (alert ≥ ${st.tier3AlertRate}%)`);
    if (c?.completionRate != null && c.completionRate < st.completionAlertRate) reasons.push(`Assessment completion ${c.completionRate}% (target ≥ ${st.completionAlertRate}%)`);
    if (v?.coverageRate != null && v.coverageRate < st.coverageAlertRate) reasons.push(`Intervention coverage ${v.coverageRate}% (target ≥ ${st.coverageAlertRate}%)`);
    return {
      schoolId: sid,
      school: lbl.get(sid)?.label ?? `#${sid}`,
      district: lbl.get(sid)?.meta?.district,
      assessed: m?.assessed ?? 0,
      avgPct: p?.avgPct ?? null,
      proficiencyRate: m?.proficiencyRate ?? null,
      atRiskRate: m?.atRiskRate ?? null,
      tier3Rate: m?.tier3Rate ?? null,
      completionRate: c?.completionRate ?? null,
      coverageRate: v?.coverageRate ?? null,
      reasons,
      needsSupport: reasons.length > 0,
    };
  });
  return out.sort((a, b) => a.school.localeCompare(b.school));
}

/** Learners currently classified Tier 2/3 and whether they are in an intervention (learner-level roles only). */
export async function learnersNeedingIntervention(scope: DataScope, f: Filters, limit = 200) {
  assertLearnerLevel(scope);
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH f AS (${factsCte(scope, f)})
    SELECT f.result_id, f.learner_id, f.tier, f.pct, f.assessment_id, f.learning_area_id, f.section_id, f.term_id, f.school_year_id,
      EXISTS (
        SELECT 1 FROM "InterventionLearner" il JOIN "Intervention" i ON i.id = il."interventionId"
        WHERE il."learnerId" = f.learner_id AND i."deletedAt" IS NULL AND i."learningAreaId" = f.learning_area_id AND i."schoolYearId" = f.school_year_id
      ) AS in_intervention
    FROM f WHERE f.tier IN ('TIER_2','TIER_3')
    ORDER BY f.tier DESC, f.pct ASC NULLS LAST
    LIMIT ${limit}`;
  const [learners, las, assessments, sections] = await Promise.all([
    labels('learner', [...new Set(rows.map((r) => n(r.learner_id)))]),
    labels('learningArea', [...new Set(rows.map((r) => n(r.learning_area_id)))]),
    prisma.assessment.findMany({ where: { id: { in: [...new Set(rows.map((r) => n(r.assessment_id)))] } }, include: { assessmentType: true, term: true } }),
    labels('section', [...new Set(rows.map((r) => n(r.section_id)))]),
  ]);
  const aById = new Map(assessments.map((a) => [a.id, a]));
  const results = await prisma.assessmentResult.findMany({ where: { id: { in: rows.map((r) => n(r.result_id)) } }, include: { band: true } });
  const rById = new Map(results.map((r) => [r.id, r]));
  return rows.map((r) => {
    const a = aById.get(n(r.assessment_id));
    return {
      resultId: n(r.result_id),
      learnerId: n(r.learner_id),
      learner: learners.get(n(r.learner_id))?.label,
      lrn: learners.get(n(r.learner_id))?.meta?.lrn,
      section: sections.get(n(r.section_id))?.label,
      learningAreaId: n(r.learning_area_id),
      learningArea: las.get(n(r.learning_area_id))?.label,
      assessmentId: n(r.assessment_id),
      assessment: a ? `${a.assessmentType.name} · ${a.term.name}` : '',
      tier: String(r.tier),
      band: rById.get(n(r.result_id))?.band?.label,
      bandColor: rById.get(n(r.result_id))?.band?.color,
      percentage: r.pct === null ? null : Number(r.pct),
      inIntervention: Boolean(r.in_intervention),
    };
  });
}

/** Headline KPIs for dashboards. */
export async function summary(scope: DataScope, f: Filters) {
  const [agg, comp, cov, outcomes, dist] = await Promise.all([aggregate(scope, f), completion(scope, f), coverage(scope, f), interventionOutcomes(scope, f), distribution(scope, f)]);
  const a = agg[0] ?? { assessed: 0, learners: 0, avgPct: null, tier1: 0, tier2: 0, tier3: 0 };
  const enrolledLearners = await countEnrolled(scope, f);
  return {
    enrolledLearners,
    learnersAssessed: a.learners,
    averagePercentage: a.avgPct,
    ...tierMetrics(a),
    completion: comp[0] ?? null,
    coverage: cov[0] ?? null,
    outcomes,
    distribution: dist,
  };
}

async function countEnrolled(scope: DataScope, f: Filters) {
  if (scope.level === 'NONE') return 0;
  return prisma.enrolment.count({
    where: {
      isCurrent: true,
      learner: { deletedAt: null },
      schoolYearId: f.schoolYearId,
      sectionId: f.sectionId,
      section: {
        schoolId: scope.schoolIds ? { in: f.schoolId ? scope.schoolIds.filter((x) => x === f.schoolId) : scope.schoolIds } : f.schoolId,
        id: scope.sectionIds ? { in: scope.sectionIds } : undefined,
        gradeLevelId: f.gradeLevelId,
        gradeLevel: f.keyStageId ? { keyStageId: f.keyStageId } : undefined,
        school: f.districtId ? { districtId: f.districtId } : undefined,
      },
    },
  });
}
