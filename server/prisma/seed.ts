/**
 * Demo seed for E-QuAART.
 *
 * Creates reference data (key stages, grade levels, learning areas, assessment types and
 * classification models), a demo division with four fictional schools, two school years of
 * simulated assessment results, derived learning gaps, and interventions with reassessments.
 *
 * IMPORTANT: every school, learner and competency here is fictional. Classification
 * descriptors and cut-offs are seeded as *provisional* and must be validated against the
 * current DepEd / Region IV-A / SDO issuances before production use.
 *
 * Usage: npm run db:seed   (wipes the target database first)
 */
import { PrismaClient, type Prisma, type ResultMode, type Tier } from '@prisma/client';
import { hashPassword } from '../src/auth/password.js';
import { classify, competencyTier, isMastered, round2 } from '../src/domain/classification.js';
import { syncLearningGaps } from '../src/modules/gaps.service.js';

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'Equaart#2026';

// ───────────── Deterministic randomness ─────────────
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260925);
const randn = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const binom = (n: number, p: number) => {
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k++;
  return k;
};

// ───────────── Reference data ─────────────
const KEY_STAGES = [
  { code: 'KS1', name: 'Key Stage 1 (Kindergarten – Grade 3)', sortOrder: 1 },
  { code: 'KS2', name: 'Key Stage 2 (Grades 4 – 6)', sortOrder: 2 },
  { code: 'KS3', name: 'Key Stage 3 (Grades 7 – 10)', sortOrder: 3 },
  { code: 'KS4', name: 'Key Stage 4 (Grades 11 – 12)', sortOrder: 4 },
];
const GRADES = [
  ['K', 'Kindergarten', 'KS1'], ['G1', 'Grade 1', 'KS1'], ['G2', 'Grade 2', 'KS1'], ['G3', 'Grade 3', 'KS1'],
  ['G4', 'Grade 4', 'KS2'], ['G5', 'Grade 5', 'KS2'], ['G6', 'Grade 6', 'KS2'],
  ['G7', 'Grade 7', 'KS3'], ['G8', 'Grade 8', 'KS3'], ['G9', 'Grade 9', 'KS3'], ['G10', 'Grade 10', 'KS3'],
  ['G11', 'Grade 11', 'KS4'], ['G12', 'Grade 12', 'KS4'],
] as const;
const LEARNING_AREAS = [
  ['FIL', 'Filipino'], ['ENG', 'English'], ['MATH', 'Mathematics'], ['SCI', 'Science'], ['AP', 'Araling Panlipunan'],
  ['MAPEH', 'MAPEH'], ['EPP', 'EPP / TLE'], ['GMRC', 'GMRC / Values Education'], ['KDOM', 'Kindergarten Learning Domains'], ['SHS', 'Senior High School Subjects'],
] as const;

/** Illustrative competency statements (not an official MELC/MATATAG list). */
const COMPETENCY_TEMPLATES: Record<string, string[]> = {
  MATH: [
    'Reads, writes and compares whole numbers', 'Adds and subtracts with and without regrouping', 'Multiplies and divides whole numbers',
    'Represents and operates on fractions', 'Solves multi-step word problems', 'Measures length, mass and capacity',
    'Identifies and describes geometric figures', 'Organizes and interprets data in tables and graphs',
  ],
  ENG: [
    'Identifies letter–sound relationships and decodes words', 'Reads grade-level text with fluency', 'Uses context clues to determine word meaning',
    'Identifies the main idea and supporting details', 'Makes inferences and draws conclusions', 'Uses correct subject–verb agreement',
    'Writes a coherent paragraph', 'Distinguishes fact from opinion',
  ],
  FIL: [
    'Nakikilala ang mga tunog at titik (palabigkasan)', 'Nakababasa nang may katatasan', 'Natutukoy ang kahulugan ng salita batay sa gamit',
    'Natutukoy ang pangunahing kaisipan ng teksto', 'Nakabubuo ng hinuha at konklusyon', 'Nagagamit nang wasto ang mga bahagi ng pananalita',
    'Nakasusulat ng talata', 'Napagsusunod-sunod ang mga pangyayari sa kuwento',
  ],
  SCI: [
    'Describes properties of matter', 'Explains changes in matter', 'Describes the parts and functions of living things',
    'Explains interactions in ecosystems', 'Describes motion and forces', 'Explains energy transfer',
    'Describes Earth and space processes', 'Uses science process skills in investigations',
  ],
};
/** Competencies that are deliberately harder so the demo shows division-wide gaps. */
const HARD = new Set(['MATH:3', 'MATH:4', 'ENG:4', 'FIL:4', 'SCI:5']);

// ───────────── Demo organisation ─────────────
const SCHOOLS = [
  { key: 'BPES', name: 'Bagong Pag-asa Elementary School', id: '900101', district: 'District I', type: 'ELEMENTARY', grades: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'], sections: ['Sampaguita', 'Rosal'], size: 24, effect: 0.1, coverage: 0.9 },
  { key: 'MES', name: 'Malinis Elementary School', id: '900102', district: 'District I', type: 'ELEMENTARY', grades: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'], sections: ['Ilang-Ilang'], size: 27, effect: 0.35, coverage: 0.8 },
  { key: 'LES', name: 'Luntian Elementary School', id: '900201', district: 'District II', type: 'ELEMENTARY', grades: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'], sections: ['Camia'], size: 26, effect: -0.55, coverage: 0.35 },
  { key: 'TNHS', name: 'Tanglaw National High School', id: '900301', district: 'District II', type: 'SECONDARY', grades: ['G7', 'G8', 'G9', 'G10'], sections: ['Rizal', 'Mabini'], size: 30, effect: 0.0, coverage: 0.7 },
] as const;

const FIRST_M = ['Juan', 'Jose', 'Mark', 'John Paul', 'Christian', 'Angelo', 'Carlo', 'Miguel', 'Rafael', 'Joshua', 'Paolo', 'Gabriel', 'Nathaniel', 'Ramon', 'Emmanuel', 'Kyle', 'Justin', 'Adrian', 'Lorenzo', 'Vincent'];
const FIRST_F = ['Maria', 'Angel', 'Princess', 'Andrea', 'Kristine', 'Nicole', 'Althea', 'Bea', 'Camille', 'Danica', 'Erica', 'Hannah', 'Isabel', 'Jasmine', 'Katrina', 'Leah', 'Mika', 'Patricia', 'Samantha', 'Trisha'];
const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Villanueva', 'Ramos', 'Aquino', 'Castillo', 'Flores', 'Gonzales', 'Rivera', 'Navarro', 'Dela Cruz', 'De Leon', 'Salazar', 'Pascual', 'Manalo', 'Soriano', 'Domingo', 'Mercado', 'Tolentino', 'Lopez', 'Francisco', 'Valdez', 'Aguilar', 'Pineda'];
const MIDDLE = ['Santos', 'Reyes', 'Cruz', 'Lim', 'Tan', 'Go', 'Yap', 'Sy', 'Uy', 'Chua', 'Morales', 'Ignacio'];

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

interface BandSeed { label: string; tier: Tier; minPct?: number; maxPct?: number; descriptorKey?: string; description?: string; color: string; sortOrder: number }

// Colour language shared by every model: blue = meets standard, amber = targeted, red/orange = intensive.
const QUARTERLY_BANDS: BandSeed[] = [
  { label: 'Proficient', tier: 'TIER_1', minPct: 80, maxPct: 100, color: '#2563eb', sortOrder: 1, description: 'Meets the expected learning standard' },
  { label: 'Approaching Proficiency', tier: 'TIER_2', minPct: 70, maxPct: 79.99, color: '#0891b2', sortOrder: 2, description: 'Close to the standard; targeted support' },
  { label: 'Developing', tier: 'TIER_2', minPct: 60, maxPct: 69.99, color: '#d97706', sortOrder: 3, description: 'Partially meets the standard; targeted support' },
  { label: 'Beginning', tier: 'TIER_3', minPct: 0, maxPct: 59.99, color: '#dc2626', sortOrder: 4, description: 'Struggling with the standard; intensive support' },
];

export async function seed() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to wipe and seed a production database without --force');
  }
  const t0 = Date.now();
  await wipe();

  // Calendar
  const syPast = await prisma.schoolYear.create({ data: { label: '2025-2026', startDate: new Date('2025-06-16'), endDate: new Date('2026-04-15'), isCurrent: false } });
  const syCur = await prisma.schoolYear.create({ data: { label: '2026-2027', startDate: new Date('2026-06-15'), endDate: new Date('2027-04-14'), isCurrent: true } });
  const termDefs = [['BOSY', 'Beginning of School Year', 0], ['Q1', 'Quarter 1', 1], ['Q2', 'Quarter 2', 2], ['Q3', 'Quarter 3', 3], ['Q4', 'Quarter 4', 4], ['EOSY', 'End of School Year', 5]] as const;
  const terms: Record<number, Record<string, number>> = {};
  for (const sy of [syPast, syCur]) {
    terms[sy.id] = {};
    for (const [code, name, sortOrder] of termDefs) terms[sy.id][code] = (await prisma.term.create({ data: { schoolYearId: sy.id, code, name, sortOrder } })).id;
  }

  // Curriculum structure
  const ks: Record<string, number> = {};
  for (const k of KEY_STAGES) ks[k.code] = (await prisma.keyStage.create({ data: k })).id;
  const grade: Record<string, { id: number; sortOrder: number }> = {};
  for (const [i, [code, name, k]] of GRADES.entries()) grade[code] = await prisma.gradeLevel.create({ data: { code, name, sortOrder: i, keyStageId: ks[k] } });
  const la: Record<string, number> = {};
  for (const [i, [code, name]] of LEARNING_AREAS.entries()) la[code] = (await prisma.learningArea.create({ data: { code, name, sortOrder: i } })).id;

  const comps: Record<string, { id: number; code: string; difficulty: number }[]> = {};
  for (const [laCode, templates] of Object.entries(COMPETENCY_TEMPLATES)) {
    for (const g of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10']) {
      const list = [];
      for (const [i, description] of templates.entries()) {
        const code = `${laCode}${g.slice(1)}-${String(i + 1).padStart(2, '0')}`;
        const c = await prisma.competency.create({ data: { learningAreaId: la[laCode], gradeLevelId: grade[g].id, code, description, curriculum: 'OTHER' } });
        list.push({ id: c.id, code, difficulty: (HARD.has(`${laCode}:${i}`) ? 1.0 : 0) + randn() * 0.3 });
      }
      comps[`${laCode}:${g}`] = list;
    }
  }

  // Assessment types & provisional classification models
  const types: Record<string, { typeId: number; modelId: number; mode: ResultMode; bands: Prisma.ClassificationBandGetPayload<object>[]; threshold: number }> = {};
  const mkType = async (code: string, name: string, mode: ResultMode, description: string, bands: BandSeed[], notes: string) => {
    const t = await prisma.assessmentType.create({ data: { code, name, resultMode: mode, description } });
    const m = await prisma.classificationModel.create({
      data: {
        assessmentTypeId: t.id, name: `${name} classification (seed)`, version: '2026.1', isProvisional: true, masteryThreshold: 0.75, notes,
        bands: { create: bands.map((b) => ({ ...b, minPct: b.minPct ?? null, maxPct: b.maxPct ?? null, descriptorKey: b.descriptorKey ?? null })) },
      },
      include: { bands: true },
    });
    types[code] = { typeId: t.id, modelId: m.id, mode, bands: m.bands, threshold: m.masteryThreshold };
  };
  const confirm = 'Seeded for demonstration. Confirm levels and cut-offs against the current DepEd / SDO issuance before use.';
  await mkType('QUARTERLY', 'Quarterly / End-of-Term Assessment', 'PERCENTAGE', 'Written quarterly assessment per learning area, itemised by competency.', QUARTERLY_BANDS, confirm);
  await mkType('SBA', 'School-Based Assessment', 'PERCENTAGE', 'Other school-administered tests (diagnostic, summative, periodical).', QUARTERLY_BANDS, confirm);
  await mkType('CRLA', 'CRLA — Comprehensive Rapid Literacy Assessment', 'PROFILE', 'Key Stage 1 reading profile (Grades 1–3).', [
    { label: 'Grade Ready', descriptorKey: 'GRADE_READY', tier: 'TIER_1', color: '#2563eb', sortOrder: 1 },
    { label: 'Light Refresher', descriptorKey: 'LIGHT_REFRESHER', tier: 'TIER_2', color: '#0891b2', sortOrder: 2 },
    { label: 'Moderate Refresher', descriptorKey: 'MODERATE_REFRESHER', tier: 'TIER_2', color: '#d97706', sortOrder: 3 },
    { label: 'Full Refresher', descriptorKey: 'FULL_REFRESHER', tier: 'TIER_3', color: '#dc2626', sortOrder: 4 },
  ], confirm);
  await mkType('PHIL_IRI', 'Phil-IRI — Philippine Informal Reading Inventory', 'PROFILE', 'Reading level from graded passages (Grades 2–10).', [
    { label: 'Independent', descriptorKey: 'INDEPENDENT', tier: 'TIER_1', color: '#2563eb', sortOrder: 1 },
    { label: 'Instructional', descriptorKey: 'INSTRUCTIONAL', tier: 'TIER_2', color: '#d97706', sortOrder: 2 },
    { label: 'Frustration', descriptorKey: 'FRUSTRATION', tier: 'TIER_3', color: '#dc2626', sortOrder: 3 },
  ], confirm);
  await mkType('RMA', 'RMA — Rapid Mathematics Assessment', 'PROFILE', 'Key Stage 1 numeracy skill profile (Grades 1–3).', [
    { label: 'At Grade Level', descriptorKey: 'AT_GRADE_LEVEL', tier: 'TIER_1', color: '#2563eb', sortOrder: 1 },
    { label: 'Transitioning', descriptorKey: 'TRANSITIONING', tier: 'TIER_2', color: '#0891b2', sortOrder: 2 },
    { label: 'Developing', descriptorKey: 'DEVELOPING', tier: 'TIER_2', color: '#d97706', sortOrder: 3 },
    { label: 'High Emerging', descriptorKey: 'HIGH_EMERGING', tier: 'TIER_3', color: '#ea580c', sortOrder: 4 },
    { label: 'Low Emerging', descriptorKey: 'LOW_EMERGING', tier: 'TIER_3', color: '#dc2626', sortOrder: 5 },
  ], `${confirm} RMA descriptors in particular are placeholders.`);
  await mkType('ELLNA', 'ELLNA — Early Language, Literacy and Numeracy Assessment', 'PERCENTAGE', 'Key Stage 1 exit benchmark (Grade 3).', [
    { label: 'Highly Proficient', tier: 'TIER_1', minPct: 90, maxPct: 100, color: '#1d4ed8', sortOrder: 1 },
    { label: 'Proficient', tier: 'TIER_1', minPct: 75, maxPct: 89.99, color: '#2563eb', sortOrder: 2 },
    { label: 'Nearly Proficient', tier: 'TIER_2', minPct: 50, maxPct: 74.99, color: '#d97706', sortOrder: 3 },
    { label: 'Low Proficient', tier: 'TIER_3', minPct: 25, maxPct: 49.99, color: '#ea580c', sortOrder: 4 },
    { label: 'Not Proficient', tier: 'TIER_3', minPct: 0, maxPct: 24.99, color: '#dc2626', sortOrder: 5 },
  ], confirm);

  // Organisation
  const division = await prisma.division.create({ data: { code: 'SDO-DEMO', name: 'Schools Division Office (Demo)', regionName: 'Region IV-A CALABARZON' } });
  const districts: Record<string, number> = {};
  for (const d of ['District I', 'District II']) districts[d] = (await prisma.district.create({ data: { name: d, divisionId: division.id } })).id;
  const schools: Record<string, number> = {};
  for (const s of SCHOOLS) schools[s.key] = (await prisma.school.create({ data: { name: s.name, schoolIdDeped: s.id, districtId: districts[s.district], schoolType: s.type, address: `${s.district}, Demo Division` } })).id;

  // Users
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mkUser = async (email: string, fullName: string, role: Prisma.UserCreateInput['role'], position: string, scopes: Prisma.UserScopeCreateWithoutUserInput[]) =>
    prisma.user.create({ data: { email, fullName, role, position, passwordHash, mustChangePassword: false, scopes: { create: scopes } } });
  const users: Record<string, number> = {};
  users.admin = (await mkUser('admin@equaart.local', 'Division Administrator', 'DIVISION_ADMIN', 'Education Program Specialist II (Planning)', [{ scopeType: 'DIVISION', division: { connect: { id: division.id } } }])).id;
  users.ict = (await mkUser('ict@equaart.local', 'ICT Unit Administrator', 'SYSTEM_ADMIN', 'Information Technology Officer I', [{ scopeType: 'DIVISION', division: { connect: { id: division.id } } }])).id;
  users.dpo = (await mkUser('dpo@equaart.local', 'Division Data Protection Officer', 'DPO', 'Data Protection Officer', [{ scopeType: 'DIVISION', division: { connect: { id: division.id } } }])).id;
  users.cid = (await mkUser('chief.cid@equaart.local', 'Dr. Elena M. Villareal', 'CHIEF_CID', 'Chief Education Supervisor, CID', [{ scopeType: 'DIVISION', division: { connect: { id: division.id } } }])).id;
  users.epsMath = (await mkUser('eps.math@equaart.local', 'Ricardo P. Dizon', 'EPS', 'Education Program Supervisor – Mathematics', [{ scopeType: 'LEARNING_AREA', learningArea: { connect: { id: la.MATH } } }])).id;
  users.epsLang = (await mkUser('eps.languages@equaart.local', 'Liza C. Manansala', 'EPS', 'Education Program Supervisor – English & Filipino', [{ scopeType: 'LEARNING_AREA', learningArea: { connect: { id: la.ENG } } }, { scopeType: 'LEARNING_AREA', learningArea: { connect: { id: la.FIL } } }])).id;
  users.psds = (await mkUser('psds.district2@equaart.local', 'Arnel B. Cortez', 'PSDS', 'Public Schools District Supervisor – District II', [{ scopeType: 'DISTRICT', district: { connect: { id: districts['District II'] } } }])).id;

  const principals: Record<string, number> = {};
  const coordinators: Record<string, number> = {};
  for (const s of SCHOOLS) {
    const k = s.key.toLowerCase();
    principals[s.key] = (await mkUser(`principal.${k}@equaart.local`, `Principal, ${s.name}`, 'PRINCIPAL', s.type === 'SECONDARY' ? 'School Principal II' : 'School Principal I', [{ scopeType: 'SCHOOL', school: { connect: { id: schools[s.key] } } }])).id;
    coordinators[s.key] = (await mkUser(`coordinator.${k}@equaart.local`, `Assessment Coordinator, ${s.name}`, 'ASSESSMENT_COORDINATOR', 'Master Teacher I / School Testing Coordinator', [{ scopeType: 'SCHOOL', school: { connect: { id: schools[s.key] } } }])).id;
  }
  users.mt = (await mkUser('mt.bpes@equaart.local', 'Rowena T. Salcedo', 'MASTER_TEACHER', 'Master Teacher II', [{ scopeType: 'SCHOOL', school: { connect: { id: schools.BPES } } }])).id;

  // Sections, learners & enrolments
  interface Kid { id: number; theta: number; laSkill: Record<string, number>; sex: 'MALE' | 'FEMALE' }
  interface Sec { id: number; schoolKey: string; gradeCode: string; name: string; adviserId: number; kids: Kid[] }
  const current: Sec[] = [];
  const past: Sec[] = [];
  let lrnSeq = 0;
  const usedEmails = new Set<string>();
  for (const s of SCHOOLS) {
    for (const g of s.grades) {
      for (const secName of s.sections) {
        const isDemoTeacher = s.key === 'BPES' && g === 'G3' && secName === 'Sampaguita';
        const sexT = rand() < 0.8 ? 'F' : 'M';
        const tFirst = sexT === 'F' ? pick(FIRST_F) : pick(FIRST_M);
        const tLast = pick(LAST);
        let email = isDemoTeacher ? 'teacher@equaart.local' : `t.${s.key.toLowerCase()}.${g.toLowerCase()}.${secName.toLowerCase().replace(/[^a-z]/g, '')}@equaart.local`;
        while (usedEmails.has(email)) email = email.replace('@', '1@');
        usedEmails.add(email);
        const adviser = await mkUser(email, `${tFirst} ${tLast}`, 'TEACHER', pick(['Teacher I', 'Teacher II', 'Teacher III']), [{ scopeType: 'SCHOOL', school: { connect: { id: schools[s.key] } } }]);
        const sec = await prisma.section.create({ data: { name: secName, schoolId: schools[s.key], gradeLevelId: grade[g].id, schoolYearId: syCur.id, adviserId: adviser.id } });
        const n = s.size + Math.floor(rand() * 5) - 2;
        const learnerRows: Prisma.LearnerCreateManyInput[] = [];
        for (let i = 0; i < n; i++) {
          const sex = rand() < 0.5 ? 'MALE' : 'FEMALE';
          const yob = 2026 - (grade[g].sortOrder + 5);
          learnerRows.push({
            lrn: `${s.id}${String(yob).slice(2)}${String(++lrnSeq).padStart(4, '0')}`,
            firstName: sex === 'MALE' ? pick(FIRST_M) : pick(FIRST_F),
            middleName: pick(MIDDLE),
            lastName: pick(LAST),
            sex,
            birthdate: new Date(Date.UTC(yob, Math.floor(rand() * 12), 1 + Math.floor(rand() * 28))),
            createdById: adviser.id,
          });
        }
        const created = await prisma.learner.createManyAndReturn({ data: learnerRows });
        await prisma.enrolment.createMany({ data: created.map((l) => ({ learnerId: l.id, sectionId: sec.id, schoolYearId: syCur.id, dateEnrolled: new Date('2026-06-15') })) });
        const kids: Kid[] = created.map((l) => ({ id: l.id, sex: l.sex, theta: randn(), laSkill: { MATH: randn() * 0.5, ENG: randn() * 0.5, FIL: randn() * 0.5, SCI: randn() * 0.5 } }));
        current.push({ id: sec.id, schoolKey: s.key, gradeCode: g, name: secName, adviserId: adviser.id, kids });
        if (isDemoTeacher) users.teacher = adviser.id;

        // The same learners one school year earlier (not for entry grades G1 / G7).
        if (g !== 'G1' && g !== 'G7') {
          const prevGrade = `G${Number(g.slice(1)) - 1}`;
          const psec = await prisma.section.create({ data: { name: secName, schoolId: schools[s.key], gradeLevelId: grade[prevGrade].id, schoolYearId: syPast.id, adviserId: adviser.id } });
          await prisma.enrolment.createMany({ data: created.map((l) => ({ learnerId: l.id, sectionId: psec.id, schoolYearId: syPast.id, dateEnrolled: new Date('2025-06-16'), isCurrent: false, endedAt: new Date('2026-04-15'), endReason: 'Promoted' })) });
          past.push({ id: psec.id, schoolKey: s.key, gradeCode: prevGrade, name: secName, adviserId: adviser.id, kids });
        }
      }
    }
  }
  // A subject teacher assignment at the high school, to demonstrate non-adviser access.
  const tnhsMath = await mkUser('t.tnhs.math@equaart.local', 'Dennis R. Umali', 'TEACHER', 'Teacher III (Mathematics)', [{ scopeType: 'SCHOOL', school: { connect: { id: schools.TNHS } } }]);
  for (const sec of current.filter((x) => x.schoolKey === 'TNHS' && (x.gradeCode === 'G7' || x.gradeCode === 'G8'))) {
    await prisma.sectionTeacher.create({ data: { sectionId: sec.id, userId: tnhsMath.id, learningAreaId: la.MATH } });
  }

  // ───────────── Assessments & results ─────────────
  const schoolEffect = Object.fromEntries(SCHOOLS.map((s) => [s.key, s.effect]));
  const subjectsFor = (g: string) => (['G1', 'G2'].includes(g) ? ['MATH', 'ENG', 'FIL'] : ['MATH', 'ENG', 'FIL', 'SCI']);
  const termIndex: Record<string, number> = { BOSY: 0, Q1: 1, Q2: 2, Q3: 3, Q4: 4, EOSY: 5 };
  let assessmentCount = 0;

  async function makeAssessment(opts: {
    sec: Sec; syId: number; termCode: string; typeCode: string; laCode: string; status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'RETURNED';
    encodeFraction?: number; date: Date; returnReason?: string; growthBase: number;
  }) {
    const { sec, syId, termCode, typeCode, laCode } = opts;
    const t = types[typeCode];
    const g = grade[sec.gradeCode];
    const compList = typeCode === 'QUARTERLY' ? (() => {
      const all = comps[`${laCode}:${sec.gradeCode}`];
      const q = termIndex[termCode];
      return [0, 1, 2, 3].map((i) => all[((q - 1) * 2 + i) % all.length]);
    })() : [];
    const items = compList.map((_, i) => (i % 2 === 0 ? 10 : 8));
    const maxScore = typeCode === 'QUARTERLY' ? items.reduce((a, b) => a + b, 0) : null;
    const schoolName = SCHOOLS.find((s) => s.key === sec.schoolKey)!;
    const typeName = { QUARTERLY: 'Quarterly Assessment', CRLA: 'CRLA', PHIL_IRI: 'Phil-IRI', RMA: 'RMA' }[typeCode] ?? typeCode;
    const laName = LEARNING_AREAS.find(([c]) => c === laCode)![1];
    const a = await prisma.assessment.create({
      data: {
        title: `${typeName} – ${laName} – ${GRADES.find(([c]) => c === sec.gradeCode)![1]} ${sec.name} (${termDefs.find(([c]) => c === termCode)![1]})`,
        assessmentTypeId: t.typeId, modelId: t.modelId, schoolYearId: syId, termId: terms[syId][termCode], gradeLevelId: g.id, learningAreaId: la[laCode],
        schoolId: schools[sec.schoolKey], sectionId: sec.id, assessmentDate: opts.date, maxScore,
        windowOpen: opts.date, windowClose: new Date(opts.date.getTime() + 21 * 86400000),
        status: opts.status, returnReason: opts.returnReason ?? null,
        createdById: sec.adviserId,
        submittedById: opts.status === 'DRAFT' ? null : sec.adviserId,
        submittedAt: opts.status === 'DRAFT' ? null : new Date(opts.date.getTime() + 7 * 86400000),
        verifiedById: opts.status === 'VERIFIED' ? coordinators[sec.schoolKey] : null,
        verifiedAt: opts.status === 'VERIFIED' ? new Date(opts.date.getTime() + 12 * 86400000) : null,
        competencies: { create: compList.map((c, i) => ({ competencyId: c.id, itemsTotal: items[i] })) },
      },
    });
    assessmentCount++;
    const encodeN = Math.round(sec.kids.length * (opts.encodeFraction ?? 1));
    const resultRows: Prisma.AssessmentResultCreateManyInput[] = [];
    const compByLearner = new Map<number, { competencyId: number; itemsCorrect: number; itemsTotal: number; mastered: boolean }[]>();
    for (const kid of sec.kids.slice(0, encodeN)) {
      const absent = rand() < 0.015;
      if (absent) {
        resultRows.push({ assessmentId: a.id, learnerId: kid.id, isAbsent: true, encodedById: sec.adviserId });
        continue;
      }
      const ability = kid.theta + (kid.laSkill[laCode] ?? 0) + schoolEffect[sec.schoolKey] + (laCode === 'MATH' ? -0.25 : 0) + opts.growthBase + 0.12 * termIndex[termCode] + randn() * 0.25;
      if (t.mode === 'PERCENTAGE') {
        const cr = compList.map((c, i) => {
          const correct = binom(items[i], logistic(1.25 * (ability - c.difficulty) + 1.75));
          return { competencyId: c.id, itemsCorrect: correct, itemsTotal: items[i], mastered: isMastered(correct, items[i], t.threshold) };
        });
        const raw = cr.reduce((s, x) => s + x.itemsCorrect, 0);
        const c = classify({ mode: 'PERCENTAGE', rawScore: raw, maxScore }, t.bands);
        resultRows.push({ assessmentId: a.id, learnerId: kid.id, rawScore: raw, percentage: c.percentage, bandId: c.band?.id, tier: c.tier, encodedById: sec.adviserId });
        compByLearner.set(kid.id, cr);
      } else {
        const keys = [...t.bands].sort((x, y) => x.sortOrder - y.sortOrder).map((b) => b.descriptorKey!);
        // Higher ability → better (lower sortOrder) descriptor.
        const cut = ({ 3: [0.35, -0.75], 4: [0.6, -0.1, -0.8], 5: [0.9, 0.2, -0.45, -1.1] } as Record<number, number[]>)[keys.length];
        let idx = cut.findIndex((x) => ability > x);
        if (idx === -1) idx = keys.length - 1;
        const descriptor = keys[Math.min(idx, keys.length - 1)];
        const c = classify({ mode: 'PROFILE', descriptor }, t.bands);
        resultRows.push({ assessmentId: a.id, learnerId: kid.id, profileDescriptor: descriptor, bandId: c.band?.id, tier: c.tier, encodedById: sec.adviserId });
      }
    }
    const results = await prisma.assessmentResult.createManyAndReturn({ data: resultRows, select: { id: true, learnerId: true } });
    const crRows = results.flatMap((r) => (compByLearner.get(r.learnerId) ?? []).map((c) => ({ ...c, resultId: r.id })));
    if (crRows.length) await prisma.competencyResult.createMany({ data: crRows });
    if (opts.status === 'SUBMITTED' || opts.status === 'VERIFIED') await syncLearningGaps(prisma as unknown as Prisma.TransactionClient, a.id);
    return a;
  }

  const d = (s: string) => new Date(s);
  // Past school year: everything verified.
  for (const sec of past) {
    const g = sec.gradeCode;
    const isKS1 = ['G1', 'G2', 'G3'].includes(g);
    for (const [termCode, date] of [['BOSY', '2025-07-01'], ['EOSY', '2026-03-20']] as const) {
      if (isKS1) {
        await makeAssessment({ sec, syId: syPast.id, termCode, typeCode: 'CRLA', laCode: 'FIL', status: 'VERIFIED', date: d(date), growthBase: -0.45 });
        await makeAssessment({ sec, syId: syPast.id, termCode, typeCode: 'RMA', laCode: 'MATH', status: 'VERIFIED', date: d(date), growthBase: -0.45 });
      } else {
        await makeAssessment({ sec, syId: syPast.id, termCode, typeCode: 'PHIL_IRI', laCode: 'ENG', status: 'VERIFIED', date: d(date), growthBase: -0.45 });
        await makeAssessment({ sec, syId: syPast.id, termCode, typeCode: 'PHIL_IRI', laCode: 'FIL', status: 'VERIFIED', date: d(date), growthBase: -0.45 });
      }
    }
    for (const [termCode, date] of [['Q1', '2025-08-25'], ['Q2', '2025-10-27'], ['Q3', '2026-01-26'], ['Q4', '2026-03-30']] as const) {
      for (const laCode of subjectsFor(g)) await makeAssessment({ sec, syId: syPast.id, termCode, typeCode: 'QUARTERLY', laCode, status: 'VERIFIED', date: d(date), growthBase: -0.45 });
    }
  }
  // Current school year: BOSY and Q1 finalized, Q2 in progress.
  for (const sec of current) {
    const g = sec.gradeCode;
    const isKS1 = ['G1', 'G2', 'G3'].includes(g);
    if (isKS1) {
      await makeAssessment({ sec, syId: syCur.id, termCode: 'BOSY', typeCode: 'CRLA', laCode: 'FIL', status: 'VERIFIED', date: d('2026-06-29'), growthBase: 0 });
      await makeAssessment({ sec, syId: syCur.id, termCode: 'BOSY', typeCode: 'RMA', laCode: 'MATH', status: 'VERIFIED', date: d('2026-06-29'), growthBase: 0 });
    } else {
      await makeAssessment({ sec, syId: syCur.id, termCode: 'BOSY', typeCode: 'PHIL_IRI', laCode: 'ENG', status: 'VERIFIED', date: d('2026-06-29'), growthBase: 0 });
      await makeAssessment({ sec, syId: syCur.id, termCode: 'BOSY', typeCode: 'PHIL_IRI', laCode: 'FIL', status: 'VERIFIED', date: d('2026-06-29'), growthBase: 0 });
    }
    for (const laCode of subjectsFor(g)) {
      const q1Status = sec.schoolKey === 'LES' && laCode === 'SCI' ? 'SUBMITTED' : 'VERIFIED';
      await makeAssessment({ sec, syId: syCur.id, termCode: 'Q1', typeCode: 'QUARTERLY', laCode, status: q1Status, date: d('2026-08-24'), growthBase: 0 });
    }
    const isDemo = sec.adviserId === users.teacher;
    for (const laCode of subjectsFor(g)) {
      if (isDemo) {
        // The demo teacher's class shows each workflow state.
        if (laCode === 'MATH') await makeAssessment({ sec, syId: syCur.id, termCode: 'Q2', typeCode: 'QUARTERLY', laCode, status: 'DRAFT', encodeFraction: 0.6, date: d('2026-09-21'), growthBase: 0 });
        if (laCode === 'FIL') await makeAssessment({ sec, syId: syCur.id, termCode: 'Q2', typeCode: 'QUARTERLY', laCode, status: 'SUBMITTED', date: d('2026-09-18'), growthBase: 0 });
        if (laCode === 'SCI') await makeAssessment({ sec, syId: syCur.id, termCode: 'Q2', typeCode: 'QUARTERLY', laCode, status: 'RETURNED', returnReason: 'Please re-check the scores of two learners against the answer sheets.', date: d('2026-09-15'), growthBase: 0 });
        continue;
      }
      const r = rand();
      if (r < 0.35) await makeAssessment({ sec, syId: syCur.id, termCode: 'Q2', typeCode: 'QUARTERLY', laCode, status: 'VERIFIED', date: d('2026-09-14'), growthBase: 0 });
      else if (r < 0.6) await makeAssessment({ sec, syId: syCur.id, termCode: 'Q2', typeCode: 'QUARTERLY', laCode, status: 'SUBMITTED', date: d('2026-09-16'), growthBase: 0 });
      else if (r < 0.8) await makeAssessment({ sec, syId: syCur.id, termCode: 'Q2', typeCode: 'QUARTERLY', laCode, status: 'DRAFT', encodeFraction: 0.4 + rand() * 0.5, date: d('2026-09-21'), growthBase: 0 });
    }
  }

  // ───────────── Interventions ─────────────
  const STRATEGIES: Record<string, string[]> = {
    MATH: ['Small-group targeted instruction with manipulatives', 'Concrete–pictorial–abstract remediation', 'Peer tutoring and math drills'],
    ENG: ['Guided reading in small groups', 'Explicit vocabulary and comprehension strategy lessons', 'Reading buddy programme'],
    FIL: ['Pagbasa sa maliit na pangkat (guided reading)', 'Remedial na pagbasa gamit ang mga kuwento', 'Sistematikong palabigkasan'],
    SCI: ['Hands-on investigation stations', 'Concept-mapping review sessions', 'Differentiated review worksheets'],
  };
  let interventionCount = 0;
  async function makeInterventions(sections: Sec[], syId: number, termCode: string, startDate: Date, reassessProb: number) {
    for (const sec of sections) {
      const schoolCfg = SCHOOLS.find((s) => s.key === sec.schoolKey)!;
      for (const laCode of ['MATH', 'ENG', 'FIL']) {
        const gaps = await prisma.learningGap.findMany({
          where: { sectionId: sec.id, termId: terms[syId][termCode], learningAreaId: la[laCode], competencyId: { not: null } },
          include: { competency: true, assessmentResult: { include: { assessment: { include: { model: true } } } } },
        });
        if (!gaps.length) continue;
        const counts = new Map<number, number>();
        for (const g of gaps) counts.set(g.competencyId!, (counts.get(g.competencyId!) ?? 0) + 1);
        const [topCid] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const targetGaps = gaps.filter((g) => g.competencyId === topCid);
        const chosen = targetGaps.filter(() => rand() < schoolCfg.coverage);
        if (chosen.length < 2) continue;
        const comp = targetGaps[0].competency!;
        const tier: Tier = chosen.filter((g) => g.severity === 'TIER_3').length > chosen.length / 2 ? 'TIER_3' : 'TIER_2';
        const allReassessed = rand() < reassessProb;
        const endDate = new Date(startDate.getTime() + 35 * 86400000);
        const i = await prisma.intervention.create({
          data: {
            title: `${laCode === 'FIL' ? 'Remedyal' : 'Remediation'}: ${comp.code} ${comp.description.slice(0, 60)}`,
            schoolId: schools[sec.schoolKey], sectionId: sec.id, schoolYearId: syId, termId: terms[syId][termCode], learningAreaId: la[laCode],
            sourceAssessmentId: targetGaps[0].assessmentResult.assessmentId, tier, type: tier === 'TIER_3' ? 'INTENSIVE' : 'TARGETED',
            strategy: pick(STRATEGIES[laCode]), description: `Learners who did not master ${comp.code} in the ${termCode} assessment.`,
            frequency: pick(['3x a week, 30 minutes', 'Daily, 20 minutes', '2x a week, 45 minutes']),
            bannerProgram: laCode === 'MATH' ? null : pick(['None', 'Catch-up Fridays', 'ARAL Programme']),
            startDate, targetEndDate: endDate, reassessmentDate: endDate,
            status: allReassessed ? 'COMPLETED' : 'ONGOING', ownerId: sec.adviserId, createdById: sec.adviserId,
            competencies: { create: [{ competencyId: comp.id }] },
          },
        });
        interventionCount++;
        const sessionCount = 4 + Math.floor(rand() * 5);
        const members = [];
        for (const g of chosen) {
          members.push(await prisma.interventionLearner.create({
            data: { interventionId: i.id, learnerId: g.learnerId, learningGapId: g.id, prePercentage: g.masteryPct, preTier: g.severity, entryReason: `Not mastered: ${comp.code} (${g.masteryPct}% in ${termCode})` },
          }));
        }
        for (let k = 0; k < sessionCount; k++) {
          await prisma.interventionSession.create({
            data: {
              interventionId: i.id, date: new Date(startDate.getTime() + k * 4 * 86400000), topic: `Session ${k + 1}: ${comp.description.slice(0, 50)}`, facilitatorId: sec.adviserId,
              attendance: { create: members.map((m) => ({ learnerId: m.learnerId, present: rand() < 0.86 })) },
            },
          });
        }
        for (const m of members) {
          if (!allReassessed && rand() < 0.5) continue;
          const gain = 14 + randn() * 12 + (schoolCfg.effect > 0 ? 4 : 0);
          const post = Math.max(0, Math.min(100, round2((m.prePercentage ?? 40) + gain)));
          const items = 10;
          const raw = Math.round((post / 100) * items);
          const pct = round2((raw / items) * 100);
          const tierPost = competencyTier(pct, 0.75);
          await prisma.reassessment.create({ data: { interventionLearnerId: m.id, date: endDate, rawScore: raw, maxScore: items, percentage: pct, tier: tierPost, recordedById: sec.adviserId, notes: 'Post-intervention competency check' } });
          await prisma.interventionLearner.update({ where: { id: m.id }, data: { decision: tierPost === 'TIER_1' ? 'COMPLETE' : pct > (m.prePercentage ?? 0) ? 'CONTINUE' : 'MODIFY', decidedAt: endDate } });
          await prisma.learningGap.update({ where: { id: m.learningGapId! }, data: tierPost === 'TIER_1' ? { status: 'RESOLVED', resolvedAt: endDate } : { status: 'IN_INTERVENTION' } });
        }
        for (const m of members) {
          const g = await prisma.learningGap.findUnique({ where: { id: m.learningGapId! } });
          if (g?.status === 'OPEN') await prisma.learningGap.update({ where: { id: g.id }, data: { status: 'IN_INTERVENTION' } });
        }
      }
    }
  }
  await makeInterventions(past, syPast.id, 'Q1', d('2025-09-08'), 0.95);
  await makeInterventions(past, syPast.id, 'Q3', d('2026-02-09'), 0.9);
  await makeInterventions(current, syCur.id, 'Q1', d('2026-09-07'), 0.35);

  // Reading remediation for CRLA Full/Moderate Refresher learners (profile-level gaps).
  for (const sec of current.filter((s) => ['G1', 'G2', 'G3'].includes(s.gradeCode) && s.schoolKey !== 'LES')) {
    const gaps = await prisma.learningGap.findMany({
      where: { sectionId: sec.id, termId: terms[syCur.id].BOSY, learningAreaId: la.FIL, competencyId: null, severity: 'TIER_3' },
      include: { assessmentResult: true },
    });
    if (gaps.length < 2) continue;
    const i = await prisma.intervention.create({
      data: {
        title: 'Reading remediation for CRLA Full Refresher learners', schoolId: schools[sec.schoolKey], sectionId: sec.id, schoolYearId: syCur.id, termId: terms[syCur.id].BOSY,
        learningAreaId: la.FIL, sourceAssessmentId: gaps[0].assessmentResult.assessmentId, tier: 'TIER_3', type: 'INTENSIVE', strategy: 'Daily one-on-one and small-group reading remediation',
        frequency: 'Daily, 30 minutes', bannerProgram: 'ARAL Programme', startDate: d('2026-07-06'), targetEndDate: d('2026-09-30'), reassessmentDate: d('2026-09-30'), status: 'ONGOING',
        ownerId: sec.adviserId, createdById: sec.adviserId,
      },
    });
    interventionCount++;
    const bands = types.CRLA.bands;
    for (const g of gaps) {
      const m = await prisma.interventionLearner.create({ data: { interventionId: i.id, learnerId: g.learnerId, learningGapId: g.id, preTier: 'TIER_3', preBandId: g.assessmentResult.bandId, entryReason: 'CRLA BOSY: Full Refresher' } });
      await prisma.learningGap.update({ where: { id: g.id }, data: { status: 'IN_INTERVENTION' } });
      if (rand() < 0.6) {
        const key = pick(['FULL_REFRESHER', 'MODERATE_REFRESHER', 'MODERATE_REFRESHER', 'LIGHT_REFRESHER']);
        const band = bands.find((b) => b.descriptorKey === key)!;
        await prisma.reassessment.create({ data: { interventionLearnerId: m.id, date: d('2026-09-15'), profileDescriptor: key, bandId: band.id, tier: band.tier, recordedById: sec.adviserId, notes: 'Mid-point reading check' } });
      }
    }
  }

  // ───────────── Governance defaults ─────────────
  await prisma.retentionPolicy.createMany({
    data: [
      { entity: 'Learner', retentionMonths: 120, disposalAction: 'ANONYMIZE', legalBasis: 'RA 10173 §11(e); retained while the learner is enrolled plus the period set by DepEd records schedules' },
      { entity: 'AssessmentResult', retentionMonths: 84, disposalAction: 'ANONYMIZE', legalBasis: 'Legitimate educational purpose; aggregates retained for trend analysis' },
      { entity: 'Intervention', retentionMonths: 60, disposalAction: 'ANONYMIZE', legalBasis: 'Monitoring of learner support' },
      { entity: 'AuditLog', retentionMonths: 60, disposalAction: 'ARCHIVE', legalBasis: 'Accountability and security (NPC Circular 16-01)' },
      { entity: 'UserSession', retentionMonths: 6, disposalAction: 'DELETE', legalBasis: 'Security monitoring' },
    ],
  });
  await prisma.auditLog.create({ data: { action: 'CREATE', entity: 'System', entityId: 'seed', afterJson: { note: 'Demo data seeded', assessments: assessmentCount, interventions: interventionCount } } });

  const [learners, results, gaps] = await Promise.all([prisma.learner.count(), prisma.assessmentResult.count(), prisma.learningGap.count()]);
  console.log(`Seeded ${learners} learners, ${assessmentCount} assessments, ${results} results, ${gaps} learning gaps, ${interventionCount} interventions in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  console.log(`Demo password for every account: ${DEMO_PASSWORD}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  seed()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
