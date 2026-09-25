import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { learnerName } from '../domain/lrn.js';
import { computeEffectiveness } from '../domain/effectiveness.js';
import { assertAcademic, assertLearnerLevel, assessmentWhere, interventionWhere, type DataScope } from '../rbac/scope.js';
import * as A from './analytics.service.js';
import { findLearnerInScope } from './learners.js';
import { gapWhere } from './gaps.js';

export const reportsRouter = Router();

type Cell = string | number | null | undefined;
interface Column {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'percent';
}
interface Section {
  heading: string;
  note?: string;
  columns: Column[];
  rows: Record<string, unknown>[];
}
export interface Report {
  title: string;
  subtitle?: string;
  containsPersonalData: boolean;
  sections: Section[];
}

const TIER_LABEL: Record<string, string> = { TIER_1: 'Tier 1', TIER_2: 'Tier 2', TIER_3: 'Tier 3' };
const tierLabel = (t: string | null | undefined) => (t ? TIER_LABEL[t] ?? t : null);

const perfCols = (first: string): Column[] => [
  { key: 'label', label: first },
  { key: 'assessed', label: 'Results', type: 'number' },
  { key: 'learners', label: 'Learners', type: 'number' },
  { key: 'avgPct', label: 'Avg %', type: 'percent' },
  { key: 'proficiencyRate', label: 'Meeting standard %', type: 'percent' },
  { key: 'atRiskRate', label: 'Needs intervention %', type: 'percent' },
  { key: 'tier1', label: 'Tier 1', type: 'number' },
  { key: 'tier2', label: 'Tier 2', type: 'number' },
  { key: 'tier3', label: 'Tier 3', type: 'number' },
];

async function perfSection(s: DataScope, f: A.Filters, dim: A.Dim, heading: string, first: string): Promise<Section> {
  const rows = await A.breakdown(s, f, dim);
  return {
    heading,
    note: rows.some((r) => r.suppressed) ? 'Rows marked "suppressed" cover too few learners to display without risking identification.' : undefined,
    columns: perfCols(first),
    rows: rows.map((r) => ({ ...r, label: r.suppressed ? `${r.label} (suppressed)` : r.label })),
  };
}

async function gapSection(s: DataScope, f: A.Filters): Promise<Section> {
  const rows = await A.leastMastered(s, f, 50);
  return {
    heading: 'Least-mastered competencies',
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Competency' },
      { key: 'la', label: 'Learning area' },
      { key: 'grade', label: 'Grade' },
      { key: 'assessed', label: 'Assessed', type: 'number' },
      { key: 'notMastered', label: 'Not mastered', type: 'number' },
      { key: 'notMasteredRate', label: 'Not mastered %', type: 'percent' },
      { key: 'gapSections', label: 'Classes with gap', type: 'number' },
      { key: 'gapSchools', label: 'Schools with gap', type: 'number' },
      { key: 'level', label: 'Gap level' },
    ],
    rows: rows.map((r) => ({ ...r, la: r.learningArea?.name, grade: r.gradeLevel?.name })),
  };
}

async function completionSection(s: DataScope, f: A.Filters, dim: A.Dim, first: string): Promise<Section> {
  const rows = await A.completion(s, f, dim);
  const lbl = await A.labels(dim, rows.map((r) => r.key));
  return {
    heading: 'Assessment completion',
    columns: [
      { key: 'label', label: first },
      { key: 'assessments', label: 'Assessments', type: 'number' },
      { key: 'finalized', label: 'Submitted/verified', type: 'number' },
      { key: 'verified', label: 'Verified', type: 'number' },
      { key: 'encoded', label: 'Results encoded', type: 'number' },
      { key: 'enrolled', label: 'Learners enrolled', type: 'number' },
      { key: 'completionRate', label: 'Completion %', type: 'percent' },
    ],
    rows: rows.map((r) => ({ ...r, label: lbl.get(r.key)?.label ?? '' })).sort((a, b) => String(a.label).localeCompare(String(b.label))),
  };
}

async function interventionRows(s: DataScope, f: A.Filters) {
  return prisma.intervention.findMany({
    where: { AND: [interventionWhere(s), { schoolYearId: f.schoolYearId, schoolId: f.schoolId, learningAreaId: f.learningAreaId, sectionId: f.sectionId }] },
    include: {
      school: { select: { name: true } },
      learningArea: { select: { name: true } },
      section: { select: { name: true, gradeLevel: { select: { name: true } } } },
      owner: { select: { fullName: true } },
      learners: { include: { learner: true, reassessments: { include: { band: true }, orderBy: { date: 'desc' }, take: 1 } } },
    },
    orderBy: [{ school: { name: 'asc' } }, { title: 'asc' }],
  });
}

// ───────────── Report builders ─────────────
const REPORT_TYPES = ['learner', 'class', 'grade-level', 'school', 'learning-area', 'assessment', 'learning-gaps', 'interventions', 'intervention-effectiveness', 'division'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

async function describeFilters(f: A.Filters) {
  const parts: string[] = [];
  const add = async (dim: A.Dim, v: number | undefined, prefix = '') => {
    if (!v) return;
    const l = (await A.labels(dim, [v])).get(v);
    if (l) parts.push(prefix + l.label);
  };
  await add('schoolYear', f.schoolYearId, 'SY ');
  await add('term', f.termId);
  await add('district', f.districtId);
  await add('school', f.schoolId);
  await add('keyStage', f.keyStageId);
  await add('gradeLevel', f.gradeLevelId);
  await add('section', f.sectionId);
  await add('learningArea', f.learningAreaId);
  await add('assessmentType', f.assessmentTypeId);
  return parts.join(' · ');
}

export async function buildReport(s: DataScope, type: ReportType, f: A.Filters, learnerId?: number): Promise<Report> {
  assertAcademic(s);
  const subtitle = await describeFilters(f);
  switch (type) {
    case 'learner': {
      assertLearnerLevel(s);
      if (!learnerId) throw badRequest('Select a learner');
      const l = await findLearnerInScope(s, learnerId);
      const results = await prisma.assessmentResult.findMany({
        where: { learnerId, assessment: { deletedAt: null } },
        include: { band: true, assessment: { include: { assessmentType: true, learningArea: true, term: true, schoolYear: true, gradeLevel: true } }, competencyResults: { include: { competency: true } } },
      });
      results.sort((a, b) => a.assessment.schoolYear.label.localeCompare(b.assessment.schoolYear.label) || a.assessment.term.sortOrder - b.assessment.term.sortOrder);
      const gaps = await prisma.learningGap.findMany({ where: { learnerId }, include: { competency: true, assessmentResult: { include: { assessment: { include: { learningArea: true, term: true } } } } } });
      const ils = await prisma.interventionLearner.findMany({ where: { learnerId, intervention: { deletedAt: null } }, include: { intervention: { include: { learningArea: true } }, reassessments: { include: { band: true }, orderBy: { date: 'desc' }, take: 1 } } });
      const enrol = await prisma.enrolment.findFirst({ where: { learnerId, isCurrent: true }, include: { section: { include: { gradeLevel: true, school: true } }, schoolYear: true } });
      return {
        title: `Learner Assessment Report — ${learnerName(l)}`,
        subtitle: `LRN ${l.lrn}${enrol ? ` · ${enrol.section.school.name} · ${enrol.section.gradeLevel.name} – ${enrol.section.name} · SY ${enrol.schoolYear.label}` : ''}`,
        containsPersonalData: true,
        sections: [
          {
            heading: 'Assessment history',
            columns: [
              { key: 'sy', label: 'SY' }, { key: 'term', label: 'Term' }, { key: 'type', label: 'Assessment' }, { key: 'la', label: 'Learning area' },
              { key: 'score', label: 'Score' }, { key: 'pct', label: '%', type: 'percent' }, { key: 'level', label: 'Level' }, { key: 'tier', label: 'Tier' },
            ],
            rows: results.map((r) => ({
              sy: r.assessment.schoolYear.label, term: r.assessment.term.name, type: r.assessment.assessmentType.name, la: r.assessment.learningArea.name,
              score: r.isAbsent ? 'Absent' : r.rawScore != null ? `${r.rawScore}${r.assessment.maxScore ? ` / ${r.assessment.maxScore}` : ''}` : '',
              pct: r.percentage, level: r.band?.label ?? '', tier: tierLabel(r.tier),
            })),
          },
          {
            heading: 'Competency results',
            columns: [{ key: 'term', label: 'Term' }, { key: 'la', label: 'Learning area' }, { key: 'code', label: 'Code' }, { key: 'desc', label: 'Competency' }, { key: 'items', label: 'Items' }, { key: 'mastered', label: 'Mastered' }],
            rows: results.flatMap((r) => r.competencyResults.map((c) => ({
              term: `${r.assessment.term.name} ${r.assessment.schoolYear.label}`, la: r.assessment.learningArea.name, code: c.competency.code, desc: c.competency.description,
              items: `${c.itemsCorrect}/${c.itemsTotal}`, mastered: c.mastered ? 'Yes' : 'No',
            }))),
          },
          {
            heading: 'Learning gaps',
            columns: [{ key: 'term', label: 'Term' }, { key: 'la', label: 'Learning area' }, { key: 'gap', label: 'Gap' }, { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' }],
            rows: gaps.map((g) => ({ term: g.assessmentResult.assessment.term.name, la: g.assessmentResult.assessment.learningArea.name, gap: g.competency ? `${g.competency.code} ${g.competency.description}` : 'Overall performance below standard', severity: tierLabel(g.severity), status: g.status })),
          },
          {
            heading: 'Interventions',
            columns: [{ key: 'title', label: 'Intervention' }, { key: 'la', label: 'Learning area' }, { key: 'status', label: 'Status' }, { key: 'pre', label: 'Pre %', type: 'percent' }, { key: 'post', label: 'Post %', type: 'percent' }, { key: 'change', label: 'Change' }, { key: 'decision', label: 'Decision' }],
            rows: ils.map((il) => {
              const post = il.reassessments[0];
              const e = computeEffectiveness({ percentage: il.prePercentage, tier: il.preTier }, post ? { percentage: post.percentage, tier: post.tier, bandLabel: post.band?.label } : null);
              return { title: il.intervention.title, la: il.intervention.learningArea.name, status: il.intervention.status, pre: il.prePercentage, post: post?.percentage, change: e?.levelChange ?? 'Not yet reassessed', decision: il.decision ?? '' };
            }),
          },
        ],
      };
    }
    case 'class': {
      if (!f.sectionId) throw badRequest('Select a class');
      const sections: Section[] = [await perfSection(s, f, 'learningArea', 'Performance by learning area', 'Learning area'), await perfSection(s, f, 'assessment', 'Performance by assessment', 'Assessment')];
      if (s.learnerLevel) {
        const at = await A.learnersNeedingIntervention(s, f, 500);
        sections.push({
          heading: 'Learners requiring intervention',
          columns: [{ key: 'lrn', label: 'LRN' }, { key: 'learner', label: 'Learner' }, { key: 'learningArea', label: 'Learning area' }, { key: 'assessment', label: 'Assessment' }, { key: 'percentage', label: '%', type: 'percent' }, { key: 'band', label: 'Level' }, { key: 'tierL', label: 'Tier' }, { key: 'inInt', label: 'In intervention' }],
          rows: at.map((r) => ({ ...r, lrn: String(r.lrn ?? ''), tierL: tierLabel(r.tier), inInt: r.inIntervention ? 'Yes' : 'No' })),
        });
      }
      sections.push(await gapSection(s, f));
      return { title: 'Class Assessment Report', subtitle, containsPersonalData: s.learnerLevel, sections };
    }
    case 'grade-level':
      if (!f.gradeLevelId) throw badRequest('Select a grade level');
      return {
        title: 'Grade-Level Assessment Report', subtitle, containsPersonalData: false,
        sections: [await perfSection(s, f, 'section', 'Performance by class', 'Class'), await perfSection(s, f, 'learningArea', 'Performance by learning area', 'Learning area'), await gapSection(s, f)],
      };
    case 'school':
      if (!f.schoolId && s.schoolIds?.length !== 1) throw badRequest('Select a school');
      f = { ...f, schoolId: f.schoolId ?? s.schoolIds![0] };
      return {
        title: 'School Assessment Report', subtitle: await describeFilters(f), containsPersonalData: false,
        sections: [
          await perfSection(s, f, 'gradeLevel', 'Performance by grade level', 'Grade level'),
          await perfSection(s, f, 'learningArea', 'Performance by learning area', 'Learning area'),
          await perfSection(s, f, 'assessmentType', 'Performance by assessment type', 'Assessment type'),
          await completionSection(s, f, 'gradeLevel', 'Grade level'),
          await gapSection(s, f),
        ],
      };
    case 'learning-area':
      if (!f.learningAreaId) throw badRequest('Select a learning area');
      return {
        title: 'Learning Area Report', subtitle, containsPersonalData: false,
        sections: [
          await perfSection(s, f, s.level === 'DIVISION' || s.level === 'DISTRICT' ? 'school' : 'gradeLevel', s.level === 'DIVISION' || s.level === 'DISTRICT' ? 'Performance by school' : 'Performance by grade level', s.level === 'DIVISION' || s.level === 'DISTRICT' ? 'School' : 'Grade level'),
          await perfSection(s, f, 'keyStage', 'Performance by key stage', 'Key stage'),
          await perfSection(s, f, 'term', 'Performance across terms', 'Term'),
          await gapSection(s, f),
        ],
      };
    case 'assessment': {
      if (!f.assessmentId) throw badRequest('Select an assessment');
      const a = await prisma.assessment.findFirst({ where: { id: f.assessmentId, ...assessmentWhere(s) }, include: { assessmentType: true, section: { include: { gradeLevel: true } }, school: true, term: true, schoolYear: true, learningArea: true, competencies: { include: { competency: true } } } });
      if (!a) throw notFound('Assessment');
      const dist = await A.distribution(s, f);
      const sections: Section[] = [
        { heading: 'Performance level distribution', columns: [{ key: 'label', label: 'Level' }, { key: 'tierL', label: 'Tier' }, { key: 'count', label: 'Learners', type: 'number' }], rows: dist.map((d) => ({ ...d, tierL: tierLabel(d.tier) })) },
      ];
      const comp = await prisma.competencyResult.groupBy({ by: ['competencyId', 'mastered'], where: { result: { assessmentId: a.id } }, _count: true });
      sections.push({
        heading: 'Competency mastery',
        columns: [{ key: 'code', label: 'Code' }, { key: 'desc', label: 'Competency' }, { key: 'mastered', label: 'Mastered', type: 'number' }, { key: 'not', label: 'Not mastered', type: 'number' }, { key: 'rate', label: 'Mastery %', type: 'percent' }],
        rows: a.competencies.map((c) => {
          const m = comp.find((x) => x.competencyId === c.competencyId && x.mastered)?._count ?? 0;
          const nm = comp.find((x) => x.competencyId === c.competencyId && !x.mastered)?._count ?? 0;
          return { code: c.competency.code, desc: c.competency.description, mastered: m, not: nm, rate: m + nm ? Math.round((m / (m + nm)) * 1000) / 10 : null };
        }),
      });
      if (s.learnerLevel) {
        const results = await prisma.assessmentResult.findMany({ where: { assessmentId: a.id }, include: { learner: true, band: true }, orderBy: [{ learner: { lastName: 'asc' } }] });
        sections.push({
          heading: 'Learner results',
          columns: [{ key: 'lrn', label: 'LRN' }, { key: 'name', label: 'Learner' }, { key: 'score', label: 'Score' }, { key: 'pct', label: '%', type: 'percent' }, { key: 'level', label: 'Level' }, { key: 'tier', label: 'Tier' }, { key: 'remarks', label: 'Remarks' }],
          rows: results.map((r) => ({ lrn: r.learner.lrn, name: learnerName(r.learner), score: r.isAbsent ? 'Absent' : (r.rawScore ?? ''), pct: r.percentage, level: r.band?.label ?? r.profileDescriptor ?? '', tier: tierLabel(r.tier), remarks: r.remarks ?? '' })),
        });
      }
      return { title: `Assessment Report — ${a.title}`, subtitle: `${a.school.name} · ${a.section.gradeLevel.name} – ${a.section.name} · ${a.term.name} SY ${a.schoolYear.label} · Status: ${a.status}`, containsPersonalData: s.learnerLevel, sections };
    }
    case 'learning-gaps': {
      const sections: Section[] = [await gapSection(s, f)];
      const pg = await A.persistentGaps(s, f);
      sections.push({
        heading: 'Persistent gaps (consecutive terms above the at-risk alert rate)',
        columns: [{ key: 'schoolName', label: 'School' }, { key: 'gradeLevelName', label: 'Grade' }, { key: 'learningAreaName', label: 'Learning area' }, { key: 'termsL', label: 'Terms' }, { key: 'latestAtRiskRate', label: 'Latest at-risk %', type: 'percent' }],
        rows: pg.map((p) => ({ ...p, termsL: p.terms.join(', ') })),
      });
      if (s.learnerLevel) {
        const gaps = await prisma.learningGap.findMany({ where: { AND: [gapWhere(s, f), { status: { not: 'RESOLVED' } }] }, include: { learner: true, competency: true, assessmentResult: { include: { assessment: { include: { learningArea: true, term: true, section: true } } } } }, take: 2000, orderBy: [{ learner: { lastName: 'asc' } }] });
        sections.push({
          heading: 'Individual learning gaps (open)',
          columns: [{ key: 'lrn', label: 'LRN' }, { key: 'name', label: 'Learner' }, { key: 'section', label: 'Class' }, { key: 'la', label: 'Learning area' }, { key: 'gap', label: 'Competency / gap' }, { key: 'mastery', label: 'Mastery %', type: 'percent' }, { key: 'status', label: 'Status' }],
          rows: gaps.map((g) => ({ lrn: g.learner.lrn, name: learnerName(g.learner), section: g.assessmentResult.assessment.section.name, la: g.assessmentResult.assessment.learningArea.name, gap: g.competency ? `${g.competency.code} ${g.competency.description}` : 'Overall level below standard', mastery: g.masteryPct, status: g.status })),
        });
      }
      return { title: 'Learning Gap Report', subtitle, containsPersonalData: s.learnerLevel, sections };
    }
    case 'interventions': {
      const rows = await interventionRows(s, f);
      return {
        title: 'Intervention Report', subtitle, containsPersonalData: false,
        sections: [{
          heading: 'Interventions',
          columns: [{ key: 'school', label: 'School' }, { key: 'title', label: 'Intervention' }, { key: 'la', label: 'Learning area' }, { key: 'tier', label: 'Tier' }, { key: 'strategy', label: 'Strategy' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Responsible' }, { key: 'learners', label: 'Learners', type: 'number' }, { key: 'reassessed', label: 'Reassessed', type: 'number' }, { key: 'improved', label: 'Improved', type: 'number' }],
          rows: rows.map((i) => {
            const re = i.learners.filter((l) => l.reassessments.length);
            return {
              school: i.school.name, title: i.title, la: i.learningArea.name, tier: tierLabel(i.tier), strategy: i.strategy, status: i.status, owner: i.owner.fullName,
              learners: i.learners.length, reassessed: re.length,
              improved: re.filter((l) => computeEffectiveness({ percentage: l.prePercentage, tier: l.preTier }, { percentage: l.reassessments[0].percentage, tier: l.reassessments[0].tier, bandLabel: l.reassessments[0].band?.label })?.improved).length,
            };
          }),
        }],
      };
    }
    case 'intervention-effectiveness': {
      const rows = await interventionRows(s, f);
      const out = await A.interventionOutcomes(s, f);
      let n = 0;
      return {
        title: 'Intervention Effectiveness Report', subtitle, containsPersonalData: s.learnerLevel,
        sections: [
          {
            heading: 'Summary',
            columns: [{ key: 'metric', label: 'Indicator' }, { key: 'value', label: 'Value' }],
            rows: [
              { metric: 'Interventions', value: out.interventions },
              { metric: 'Learners in interventions', value: out.learnersInIntervention },
              { metric: 'Learners reassessed', value: out.reassessed },
              { metric: 'Learners who improved', value: out.improved },
              { metric: 'Improvement rate (%)', value: out.improvementRate },
              { metric: 'Reached expected standard', value: out.reachedStandard },
              { metric: 'Average gain (percentage points)', value: out.averageGain },
            ],
          },
          {
            heading: 'Pre- and post-intervention results',
            columns: [{ key: 'intervention', label: 'Intervention' }, { key: 'learner', label: 'Learner' }, { key: 'pre', label: 'Pre %', type: 'percent' }, { key: 'preTier', label: 'Pre tier' }, { key: 'post', label: 'Post %', type: 'percent' }, { key: 'postTier', label: 'Post tier' }, { key: 'diff', label: 'Difference (pts)', type: 'number' }, { key: 'rel', label: '% improvement', type: 'percent' }, { key: 'change', label: 'Level change' }, { key: 'decision', label: 'Decision' }],
            rows: rows.flatMap((i) => i.learners.map((l) => {
              const post = l.reassessments[0];
              const e = computeEffectiveness({ percentage: l.prePercentage, tier: l.preTier }, post ? { percentage: post.percentage, tier: post.tier, bandLabel: post.band?.label } : null);
              n++;
              return {
                intervention: i.title, learner: s.learnerLevel ? learnerName(l.learner) : `Learner ${n}`, pre: l.prePercentage, preTier: tierLabel(l.preTier),
                post: post?.percentage, postTier: tierLabel(post?.tier), diff: e?.scoreDifference, rel: e?.percentImprovement, change: e?.levelChange ?? 'Not yet reassessed', decision: l.decision ?? '',
              };
            })),
          },
        ],
      };
    }
    case 'division': {
      const support = await A.schoolsNeedingSupport(s, f);
      return {
        title: 'Division Assessment Report', subtitle, containsPersonalData: false,
        sections: [
          await perfSection(s, f, 'district', 'Performance by district', 'District'),
          await perfSection(s, f, 'school', 'Performance by school (alphabetical — not a ranking)', 'School'),
          await perfSection(s, f, 'keyStage', 'Performance by key stage', 'Key stage'),
          await perfSection(s, f, 'gradeLevel', 'Performance by grade level', 'Grade level'),
          await perfSection(s, f, 'learningArea', 'Performance by learning area', 'Learning area'),
          await completionSection(s, f, 'school', 'School'),
          {
            heading: 'Schools flagged for technical assistance',
            columns: [{ key: 'school', label: 'School' }, { key: 'district', label: 'District' }, { key: 'reasonsL', label: 'Reasons' }],
            rows: support.filter((x) => x.needsSupport).map((x) => ({ ...x, district: String(x.district ?? ''), reasonsL: x.reasons.join('; ') })),
          },
          await gapSection(s, f),
        ],
      };
    }
  }
}

// ───────────── Renderers ─────────────
/** Neutralise spreadsheet formula injection in exported text cells. */
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const fmt = (v: unknown, c: Column) => (v === null || v === undefined || v === '' ? '' : c.type === 'percent' && typeof v === 'number' ? `${v}` : String(v));

function toCsv(r: Report) {
  const lines: Cell[][] = [[r.title], ...(r.subtitle ? [[r.subtitle]] : []), [`Generated ${new Date().toISOString()}`], []];
  for (const s of r.sections) {
    lines.push([s.heading]);
    lines.push(s.columns.map((c) => c.label));
    for (const row of s.rows) lines.push(s.columns.map((c) => (typeof row[c.key] === 'string' ? safe(fmt(row[c.key], c)) : fmt(row[c.key], c))));
    lines.push([]);
  }
  return '﻿' + stringify(lines);
}

async function toXlsx(r: Report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E-QuAART';
  const used = new Set<string>();
  for (const s of r.sections) {
    let name = s.heading.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Sheet';
    while (used.has(name)) name = `${name.slice(0, 26)}_${used.size}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.addRow([r.title]).font = { bold: true, size: 13 };
    if (r.subtitle) ws.addRow([r.subtitle]);
    ws.addRow([s.heading]).font = { bold: true };
    if (s.note) ws.addRow([s.note]).font = { italic: true };
    const header = ws.addRow(s.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }));
    for (const row of s.rows) ws.addRow(s.columns.map((c) => (row[c.key] === undefined ? null : typeof row[c.key] === 'string' ? safe(row[c.key] as string) : (row[c.key] as Cell))));
    s.columns.forEach((c, i) => (ws.getColumn(i + 1).width = Math.min(60, Math.max(10, c.label.length + 2, ...s.rows.map((row) => String(row[c.key] ?? '').length + 2)))));
    if (r.containsPersonalData) ws.addRow([]).getCell(1).value = 'CONFIDENTIAL — contains personal information protected under the Data Privacy Act of 2012 (RA 10173).';
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toPdf(r: Report, generatedBy: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: r.title, Author: 'E-QuAART' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 72;
    doc.fillColor('#1e3a8a').fontSize(9).font('Helvetica-Bold').text('E-QuAART · Electronic Quality Assured Assessment Result Tool', { align: 'left' });
    doc.fillColor('#111827').fontSize(16).text(r.title);
    doc.font('Helvetica').fontSize(9).fillColor('#4b5563');
    if (r.subtitle) doc.text(r.subtitle);
    doc.text(`Generated ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} by ${generatedBy}`);
    doc.moveDown(0.6);

    for (const s of r.sections) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(s.heading);
      if (s.note) doc.font('Helvetica-Oblique').fontSize(8).fillColor('#6b7280').text(s.note);
      doc.moveDown(0.3);
      if (!s.rows.length) {
        doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('No data for the selected filters.');
        doc.moveDown(0.8);
        continue;
      }
      const weights = s.columns.map((c) => (c.type ? 1 : ['description', 'desc', 'gap', 'reasonsL', 'title', 'strategy', 'label', 'intervention'].includes(c.key) ? 3 : 1.5));
      const total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / total) * W);
      const drawRow = (cells: string[], bold: boolean, fill?: string) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
        const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: widths[i] - 6 }))) + 6;
        if (doc.y + h > doc.page.height - 50) {
          doc.addPage();
        }
        const y = doc.y;
        if (fill) doc.rect(36, y, W, h).fill(fill);
        let x = 36;
        cells.forEach((t, i) => {
          doc.fillColor(bold && fill ? '#ffffff' : '#111827').text(t, x + 3, y + 3, { width: widths[i] - 6, align: s.columns[i].type ? 'right' : 'left' });
          x += widths[i];
        });
        doc.moveTo(36, y + h).lineTo(36 + W, y + h).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        doc.x = 36;
        doc.y = y + h;
      };
      drawRow(s.columns.map((c) => c.label), true, '#1e3a8a');
      s.rows.forEach((row) => drawRow(s.columns.map((c) => fmt(row[c.key], c) || '—'), false));
      doc.moveDown(0.8);
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor('#6b7280');
      const footer = `${r.containsPersonalData ? 'CONFIDENTIAL — contains personal information protected under RA 10173. ' : ''}Page ${i + 1} of ${range.count}`;
      doc.text(footer, 36, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

reportsRouter.get('/types', (_req, res) => res.json(REPORT_TYPES));

reportsRouter.get('/:type', requirePermission('report:export'), ah(async (req, res) => {
  const type = z.enum(REPORT_TYPES).parse(req.params.type);
  const format = z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json').parse(req.query.format);
  const f = A.filterSchema.parse(req.query);
  const learnerId = req.query.learnerId ? Number(req.query.learnerId) : undefined;
  const report = await buildReport(req.scope!, type, f, learnerId);
  const fname = `equaart-${type}-${new Date().toISOString().slice(0, 10)}`;
  if (format !== 'json') await audit(req, 'EXPORT', 'Report', type, null, { format, filters: f, learnerId, containsPersonalData: report.containsPersonalData });
  if (format === 'json') return res.json(report);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`);
    return res.send(toCsv(report));
  }
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return res.send(await toXlsx(report));
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
  res.send(await toPdf(report, req.user!.fullName));
}));
