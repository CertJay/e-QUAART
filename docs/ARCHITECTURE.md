# E-QuAART architecture

## 1. Shape of the system

```
Browser (React SPA) ──/api/v1──▶ Express API ──Prisma / SQL──▶ PostgreSQL
   │  access token in memory           │ authenticate → resolve data scope → permission check
   └─ httpOnly refresh cookie          │ modules: reference · learners · sections · assessments
                                       │          analytics · gaps · interventions · reports
                                       │          users · governance (settings, audit, retention, breaches)
                                       └ domain (pure): classification · metrics · effectiveness
```

It is a modular monolith, which suits an MVP a small team can host on a DepEd/LGU server. Each module maps to one of the modules in the build brief (§22). The pure `domain/` layer holds every rule that turns a score into a decision, and it is unit-tested on its own.

## 2. Data model (hierarchy)

`server/prisma/schema.prisma` is the source of truth. It follows the hierarchy in the brief:

```
Division → District → School → SchoolYear/Term
   → KeyStage → GradeLevel → Section → (Enrolment) → Learner
   → LearningArea → Assessment (+ AssessmentCompetency = items per competency)
   → AssessmentResult (score / % / descriptor → band → tier) → CompetencyResult (mastered?)
   → LearningGap → Intervention (+ InterventionLearner baseline, sessions, attendance)
   → Reassessment → effectiveness (computed)
```

| Concern | Tables |
|---|---|
| Organisation | `Division`, `District`, `School`, `Section`, `SectionTeacher` |
| Calendar & curriculum (all configurable) | `SchoolYear`, `Term`, `KeyStage`, `GradeLevel`, `LearningArea`, `Competency` |
| Learners | `Learner` (unique 12-digit `lrn`), `Enrolment` (history kept across years and schools) |
| Instruments | `AssessmentType` (`PERCENTAGE` or `PROFILE`), `ClassificationModel` (mastery threshold, provisional flag), `ClassificationBand` (label, tier, min/max %, descriptor key, colour) |
| Results | `Assessment` (DRAFT → SUBMITTED → VERIFIED, or RETURNED), `AssessmentResult`, `CompetencyResult` |
| Action | `LearningGap`, `Intervention`, `InterventionCompetency`, `InterventionLearner`, `InterventionSession`, `AttendanceRecord`, `Reassessment`, `Ilmp` |
| Security & governance | `User`, `UserScope`, `UserSession`, `AuditLog`, `SystemSetting`, `RetentionPolicy`, `BreachIncident` |

The learner's longitudinal view is derived, not stored. `GET /learners/:id` returns every result, ordered by term, with the change versus the previous result for the same instrument and learning area.

## 3. Classification engine (`server/src/domain/classification.ts`)

- **Percentage instruments** (quarterly, school-based, ELLNA as seeded): `percentage = score ÷ max × 100`. The band is the one with the highest `minPct` that the percentage reaches.
- **Profile instruments** (CRLA, Phil-IRI, RMA): the teacher records the descriptor, and it maps straight to a band and tier. **No percentage rule is ever applied.**
- **Competency mastery**: `itemsCorrect / itemsTotal ≥ masteryThreshold` (per model, default 0.75). A competency gap's severity is Tier 3 when fewer than half the items are correct, otherwise Tier 2.
- Band sets are validated before saving: the bands must cover 0%, must not overlap, and descriptor keys must be unique. **Editing a model re-classifies existing results** and re-derives gaps in one transaction, and the change is audit-logged.

## 4. From results to gaps

On **submit** (and again on verify, return or reclassify), `syncLearningGaps` derives gaps from the assessment:
- one gap for each competency a learner did not master;
- one learning-area-level gap for each Tier 2/3 result that has no competency breakdown (for example, CRLA "Full Refresher").

Gaps have a status: OPEN → IN_INTERVENTION → RESOLVED. A gap is resolved when a reassessment reaches Tier 1. Gaps already linked to an intervention are never deleted.

Group-level patterns are computed on the fly (`analytics.service.ts#leastMastered`):
- **Class-level**: at least `classGapRate`% of a class did not master the competency (default 40%).
- **School-level**: at least `schoolGapSections` classes in one school share the gap (default 2).
- **Division-level**: at least `divisionGapSchools` schools share it (default 2).
- **Persistent**: a grade × learning area stays at or above the at-risk alert rate for `persistentTerms` consecutive terms.

## 5. Metric definitions (`server/src/domain/metrics.ts`)

All dashboards and reports use these definitions, so a metric means the same thing everywhere:

| Metric | Definition |
|---|---|
| Proficiency rate | Tier 1 results ÷ classified results |
| At-risk (needs intervention) | Tier 2 + Tier 3 ÷ classified results |
| Tier 3 rate | Tier 3 ÷ classified results |
| Completion | results encoded (including absent) ÷ learners enrolled in the assessed classes |
| Intervention coverage | learners with a gap who are in an intervention for the same learning area and school year ÷ learners with a gap |
| Improvement rate | reassessed learners whose score or level improved ÷ reassessed learners |
| Effectiveness (per learner) | score difference (pts), % improvement, level change, and the decision options the data points to (continue / modify / complete / repeat / refer). The teacher decides. |

Only SUBMITTED and VERIFIED assessments feed analytics. Analytic queries accept `verifiedOnly=true`.

## 6. Access control

The permission matrix is in `server/src/rbac/permissions.ts`; data scoping is in `server/src/rbac/scope.ts`. Both are enforced in the API on every request, not just in the UI.

| Role | Scope | Learner-level data | Can change |
|---|---|---|---|
| Teacher | own advisory / assigned classes | yes | learners, classes, assessments & results (own classes), interventions |
| Master Teacher, Assessment Coordinator | own school | yes | as teacher, school-wide + **verify / return / reopen** |
| Principal | own school | yes | classes, verify; **read-only on scores** |
| PSDS | own district | aggregates only | — |
| EPS | division, assigned learning areas only | aggregates only | — |
| Chief CID | division | aggregates only | — |
| Division Admin | division | aggregates only | reference data, standards, users, settings, audit, governance |
| ICT / System Admin | — (no academic data) | no | users, settings, audit |
| DPO | — (no academic data) | no | audit, retention, breach register |

Other controls:
- **Segregation of duties**: results must be verified by someone other than the encoder.
- **Small-cell suppression**: aggregate rows covering fewer than `smallCellThreshold` learners (default 5) are masked for aggregate-only roles. Intervention learners are shown to them as "Learner n".
- **Transferees**: a learner can only be enrolled into your class with both their LRN and their last name, so an LRN cannot be used to look up other records.

## 7. Security & privacy (RA 10173)

- **Passwords**: argon2id; policy of at least 10 characters with upper case, lower case and a digit; forced change on first sign-in; account lockout after 5 failed attempts for 15 minutes; login rate limit.
- **Sessions**: 15-minute JWT access token held in memory. The refresh token is an httpOnly, SameSite=Strict cookie, rotated on every use and stored hashed. Sessions end after 30 minutes idle or 8 hours absolute. Refresh requires an `X-Requested-With` header as CSRF defence. Logout, password change and deactivation revoke sessions.
- **HTTP**: Helmet security headers, `Cache-Control: no-store` on the API, CORS allow-list, and a CSP and frame-deny in `client/nginx.conf`.
- **Audit trail**: logs sign-ins (including failures), every create/update/delete, submit/verify/return/reopen, imports, exports (flagging whether they contain personal data), and every learner-record view. Result changes store the previous and new values, and each assessment has a change-history tab.
- **Privacy notice**: shown on first use, and the acknowledgement is recorded. Exports that contain learner data are marked CONFIDENTIAL.
- **Retention policies and a breach register** (with a 72-hour NPC notification deadline) are managed by the DPO.

## 8. API

All endpoints are under `/api/v1`. The error envelope is `{ error: { code, message, details } }`. List endpoints take `?page&perPage` and return `{ data, meta }`.

```
POST /auth/login | /auth/refresh | /auth/logout | /auth/change-password     GET /me   POST /me/privacy-ack
GET  /reference/bootstrap   CRUD /reference/{districts,schools,school-years,terms,key-stages,grade-levels,learning-areas,competencies,assessment-types,classification-models}
GET/POST/PUT /sections, /sections/:id(/teachers)          GET /sections/staff/:schoolId
GET/POST/PUT/DELETE /learners  POST /learners/import | /learners/enrol-existing | /learners/enrolments/:id/end | /learners/:id/ilmps
GET/POST/PUT/DELETE /assessments   PUT /assessments/:id/results   POST /assessments/:id/results/import
GET /assessments/:id/{qa,template,history}   POST /assessments/:id/{submit,verify,return,reopen}
GET /analytics/{summary,breakdown?dim=,distribution,trend?series=,heatmap?rows=&cols=,completion,coverage,interventions,least-mastered,persistent-gaps,schools-support,learners-at-risk,definitions}
GET /gaps  GET /gaps/groups
GET/POST/PUT/DELETE /interventions   POST /interventions/:id/{learners,sessions}   PUT/DELETE /interventions/:id/learners/:ilId
POST /interventions/:id/learners/:ilId/reassessments   GET /interventions/queue/reassessment
GET /reports/:type?format=json|csv|xlsx|pdf   (learner, class, grade-level, school, learning-area, assessment, learning-gaps, interventions, intervention-effectiveness, division)
GET/POST/PUT /users (+ /users/:id/reset-password)   GET/PUT /governance/{settings,audit-logs,retention,breaches}
```

Analytic filters are the same everywhere: `schoolYearId, termId, districtId, schoolId, keyStageId, gradeLevelId, sectionId, learningAreaId, assessmentTypeId, assessmentId, bandId, tier, verifiedOnly`.

Dimensions: `district, school, keyStage, gradeLevel, section, learningArea, assessmentType, schoolYear, term, assessment, band, learner`. The `learner` dimension is available only to learner-level roles.

## 9. Operations

- **Backups**: nightly `pg_dump -Fc`, with copies kept off-site and encrypted. Test a restore every term. Enable encryption at rest on the database volume.
- **Migrations**: `npm run db:migrate` (`prisma migrate deploy`). Schema changes go through `prisma migrate dev` in development.
- **Performance**: analytics are single SQL aggregations over indexed columns. On the demo data every dashboard query takes about 20–250 ms. At full division scale, add materialized views if a query exceeds 2 seconds.
- **Retention disposal** is a documented manual procedure for now (export → DPO approval → anonymize or delete). The rules are stored in `RetentionPolicy`.

## 10. Build-spec traceability and gaps

Implemented (MVP, Phase 1):
- auth and RBAC with scoping;
- reference data, and configurable instruments and bands;
- learners and enrolment, including CSV/XLSX roster import;
- assessment set-up with per-competency items;
- a grid encoder with live classification, and CSV/XLSX result import with full validation and a downloadable template;
- QA checks and the submit/verify/return/reopen workflow;
- automated classification and gap derivation;
- learner, class, school and division analytics (distributions, least-mastered, trends, heatmaps, persistent gaps, technical-assistance flags);
- interventions with baseline, sessions, attendance, reassessment, effectiveness and decisions;
- ILMP;
- ten report types in CSV, Excel and PDF;
- audit trail, retention, breach register and privacy notice.

Not built yet (Phase 2/3 of the spec, or needing decisions):
- **Offline-first PWA encoding and sync.** The data model uses server IDs; sync would add `client_uuid` and `version`.
- **Notifications** (in-app and email), scheduled exports, and background jobs (reports are generated synchronously).
- **Item analysis** (difficulty and discrimination) — results are captured per competency, not per item.
- **Early-warning module and LIS/EBEIS integration** — these need DepEd authorization.
- **Optional TOTP multi-factor authentication for administrators.**
- **Automated retention disposal jobs.**

Open items to confirm with the SDO (spec §16):
- the official descriptors and cut-offs for each instrument;
- MELC vs MATATAG competency lists;
- whether per-competency data is available for every instrument;
- the LIS roster export format;
- hosting;
- retention periods;
- parent access.
