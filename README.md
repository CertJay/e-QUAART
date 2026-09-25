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

> **This is the `sqlite-local` branch.** The database is a single file (`server/prisma/equaart.db`). It needs no database server, no Docker and no administrator rights. The `claude/peaceful-keller-iql393` branch has the same application on PostgreSQL, for division-wide hosting.

## Run it on a Windows laptop without admin rights

You only need Node.js. It is available as a plain zip that needs no installer.

1. **Get Node.js (portable).**
   - Download the **Windows Binary (.zip)**, 64-bit, version 22 LTS, from https://nodejs.org/en/download (for example `node-v22.x.x-win-x64.zip`).
   - Extract it somewhere you own, for example `C:\Users\<you>\tools\node`.
2. **Put Node on your PATH (current user only, no admin).**
   - Press Start, type *"environment variables for your account"*, and open it.
   - Edit **Path** under *User variables*, add `C:\Users\<you>\tools\node`, and click OK.
   - Open a **new** Command Prompt and check that `node -v` and `npm -v` both print a version.
   - *Alternative without touching settings:* run `set PATH=C:\Users\<you>\tools\node;%PATH%` in each new Command Prompt.
3. **Get the code.**
   - Either `git clone` it (if Git is available), or on GitHub switch to the `sqlite-local` branch, choose **Code → Download ZIP**, and extract it.
4. **Install and set up.** In a Command Prompt, inside the project folder:
   ```bat
   npm install
   npm run setup
   ```
   `setup` creates `server\.env` with a random secret, creates the database file, and loads the demo data (about 30 seconds). Use `npm run setup -- --empty` to start with no demo data.
5. **Run it.**
   ```bat
   npm run dev
   ```
   Open http://localhost:5173. Stop it with Ctrl+C.

**For everyday use without the development tools**, build it once with `npm run build`, then run `npm start` and open http://localhost:4000. A single Node process serves both the pages and the API. Other computers on the same network can use `http://<this-laptop's-IP>:4000`, if Windows Firewall allows it. Allowing it may need IT, but only for that one port.

**If `npm install` fails behind an office proxy or firewall:**
- `npm install` downloads packages from registry.npmjs.org.
- Prisma also downloads its database engine from binaries.prisma.sh.
- Ask IT to allow those two sites, or set your proxy for your user only with `npm config set proxy http://proxy:port` and `npm config set https-proxy http://proxy:port`.

**Backups:**
- The whole database is the one file `server\prisma\equaart.db`.
- Stop the app, then copy that file (plus any `equaart.db-wal` next to it) to a safe place, such as an encrypted USB drive or approved cloud storage.
- It contains learner personal data, so treat the copy accordingly.

**Starting fresh with real data:**
- Run `npm run setup -- --empty`, then create the first administrator:
  ```bat
  npm run create-admin -- --email you@deped.gov.ph --name "Your Name" --division "SDO Cavite Province" --code SDO-CAV
  ```
- It prints a one-time password.
- Configure schools, calendar, curriculum and assessment standards in the app.

**How far SQLite goes:** one school or a small group of users on one machine or a school LAN is fine. SQLite allows only one write at a time; other writes wait a few milliseconds. For a whole division with hundreds of teachers encoding at the same time, use the PostgreSQL branch on a proper server.

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
npm test          # server: unit + integration tests against a SQLite test file; client: unit tests
npm run typecheck
npm run build
```

The server integration tests use a separate SQLite file (`TEST_DATABASE_URL`, default `file:./test.db`), which is re-created and seeded on every run.

The tests cover the MVP acceptance criteria in the build spec, including:
- quarterly tiers are computed from the configured bands;
- CRLA "Full Refresher" is classified Tier 3 with no percentage rule;
- verified results are locked, and every edit is audit-logged;
- a mismatched scope gets 403/404;
- division-level gaps are detected across two or more schools;
- an intervention goes from a gap through a session and a reassessment to an effectiveness result;
- exports are audit-logged, and small cells are suppressed;
- list endpoints are paginated.

## Deployment on a server (optional)

On a machine that does have Docker, `docker-compose.yml` runs a single container. It serves the API and the web pages on port 4000, and keeps the SQLite file on a volume:

```bash
JWT_SECRET=$(openssl rand -hex 48) docker compose up -d --build
docker compose exec app npx tsx scripts/create-admin.ts --email ... --name "..." --division "..." --code ...
```

Put HTTPS in front of it and set `COOKIE_SECURE=true`. Back up the volume's `equaart.db` every night.

## Repository layout

```
server/   Express + TypeScript API, Prisma/SQLite (serves the built client too)
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
