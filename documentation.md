# E-QuAART — Electronic Quality Assured Assessment Result Tool

Division/School-Based Assessment Results Management, Analytics, Intervention, and Monitoring System.

E-QuAART takes assessment results and turns them into instructional action:

```
Assessment → Data capture → Quality assurance → Analysis → Learning gaps
   → Intervention → Monitoring → Reassessment → Evidence of improvement
```

It pulls together results from CRLA, Phil-IRI, RMA, ELLNA, quarterly/end-of-term and school-based assessments. It classifies each result using configurable, instrument-specific performance levels. It then finds learning gaps for individual learners, classes, schools and the division, and tracks the interventions planned from those gaps until reassessment shows whether they worked.

It is **not** an exam-delivery platform, a grading system of record, or a replacement for LIS/EBEIS. The LRN is used as the learner identifier.

---

## Quick start (development)

Requirements: Node.js 22+, PostgreSQL 14+.

```bash
npm install
cp server/.env.example server/.env            # set DATABASE_URL and JWT_SECRET
npm run db:migrate                            # apply migrations
npm run db:seed                               # demo data (wipes the target DB)
npm run dev                                   # API on :4000, web on :5173
```

Open http://localhost:5173. Every demo account uses the password **`Equaart#2026`**:

| Account | Role | What to look at |
|---|---|---|
| `teacher@equaart.local` | Teacher, Grade 3 adviser | Dashboard, encoding grid (draft Q2 Math), learning-gap groups, interventions, reassessment |
| `coordinator.bpes@equaart.local` | Assessment Coordinator | Verification queue, return / reopen, school analytics |
| `principal.bpes@equaart.local` | School Head | School dashboard, drill-down School → Grade → Class → Learning area → Assessment → Learner |
| `eps.math@equaart.local` | EPS (Mathematics) | Mathematics across schools, cross-school competency gaps |
| `eps.languages@equaart.local` | EPS (English & Filipino) | Same, for two learning areas |
| `psds.district2@equaart.local` | District Supervisor | Schools in District II only |
| `chief.cid@equaart.local` | Chief, CID | Division overview, technical-assistance flags, division report |
| `admin@equaart.local` | Division Administrator | Users & scopes, curriculum, assessment standards, settings, audit |
| `ict@equaart.local` | ICT / System Admin | Accounts and settings only (no academic data) |
| `dpo@equaart.local` | Data Protection Officer | Audit trail, exports of learner data, retention, breach register |

The demo division has four **fictional** schools, 837 learners, two school years of simulated results (about 20,000), the learning gaps derived from them, and about 260 interventions with reassessments. Luntian Elementary School is deliberately weaker so the "needs technical assistance" flags have something to show.

## Tests

```bash
npm test          # server: unit + integration tests against PostgreSQL; client: unit tests
npm run typecheck
npm run build
```

The server integration tests need a separate database. They read `TEST_DATABASE_URL` (default `postgresql://equaart:equaart@localhost:5432/equaart_test`), apply migrations, and seed it. The setup refuses any URL that doesn't contain "test".

The tests cover the MVP acceptance criteria in the build spec, including:
- quarterly tiers are computed from the configured bands;
- CRLA "Full Refresher" is classified Tier 3 with no percentage rule;
- verified results are locked, and every edit is audit-logged;
- a mismatched scope gets 403/404;
- division-level gaps are detected across two or more schools;
- an intervention goes from a gap through a session and a reassessment to an effectiveness result;
- exports are audit-logged, and small cells are suppressed;
- list endpoints are paginated.

## Deployment

`docker-compose.yml` runs PostgreSQL, the API, and nginx serving the web build with `/api` proxied:

```bash
DB_PASSWORD=... JWT_SECRET=$(openssl rand -hex 48) PUBLIC_URL=https://equaart.example.gov.ph \
COOKIE_SECURE=true docker compose up -d --build
```

The API container runs `prisma migrate deploy` on start. It never seeds. Create the first division administrator with `docker compose exec api npx tsx scripts/create-admin.ts --email ... --name "..." --division "..." --code ...` (prints a one-time password), then configure everything else in the UI. Put TLS in front of `web`. Back up the `db-data` volume every night and test restores (see `docs/ARCHITECTURE.md` § Operations).

## Repository layout

```
server/   Express + TypeScript API, Prisma/PostgreSQL
  prisma/        schema, migrations, demo seed
  src/auth       login, sessions (rotating refresh cookie + short-lived JWT), password policy
  src/rbac       permission matrix and data-scope resolution (enforced on every query)
  src/domain     pure logic: classification engine, metric definitions, intervention effectiveness
  src/modules    reference data, learners, sections, assessments, analytics, gaps,
                 interventions, reports, users, governance
  tests/         unit + API integration tests
client/   React + Vite + Tailwind + TanStack Query + Recharts
docs/     architecture, data model, RBAC, metrics, spec traceability
```

## Important: validate before production use

- **Performance levels are seed data and are flagged *provisional*.** This covers the quarterly bands, CRLA, Phil-IRI, RMA and ELLNA descriptors and cut-offs. The RMA descriptors in particular are placeholders. Confirm them against the current DepEd / Region IV-A / SDO issuances under **Assessment standards**. Saving a change re-classifies existing results and is audit-logged.
- **Competencies are illustrative.** Load the official MELC/MATATAG lists under **Curriculum**.
- Retention periods, alert thresholds and the small-cell threshold are defaults. Agree them with the DPO and CID.

See `docs/ARCHITECTURE.md` for the open items and for what is intentionally not yet built (offline PWA, LIS integration, early warning).
