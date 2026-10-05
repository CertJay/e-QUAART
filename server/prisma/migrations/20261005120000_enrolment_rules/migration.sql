-- Spec §6: the LRN is permanent and a learner holds one active section per school year.
-- Neither rule can be expressed in schema.prisma, so both live here as raw SQL. The API
-- checks first and returns a friendly message; these fire only if that check is bypassed.

-- Existing data: if a learner somehow has several current enrolments in one school year,
-- keep the most recent and end the others before the unique index is created.
UPDATE "Enrolment" SET "isCurrent" = false, "endedAt" = CURRENT_TIMESTAMP, "endReason" = 'Superseded (single-section rule)'
WHERE "isCurrent" = true
  AND EXISTS (
    SELECT 1 FROM "Enrolment" e2
    WHERE e2."learnerId" = "Enrolment"."learnerId"
      AND e2."schoolYearId" = "Enrolment"."schoolYearId"
      AND e2."isCurrent" = true
      AND (e2."dateEnrolled" > "Enrolment"."dateEnrolled" OR (e2."dateEnrolled" = "Enrolment"."dateEnrolled" AND e2."id" > "Enrolment"."id"))
  );

-- One active (current) enrolment per learner per school year.
CREATE UNIQUE INDEX "Enrolment_one_current_per_year" ON "Enrolment"("learnerId", "schoolYearId") WHERE "isCurrent" = true;

-- The LRN can never change once the learner is created.
CREATE TRIGGER "Learner_lrn_immutable" BEFORE UPDATE OF "lrn" ON "Learner"
WHEN NEW."lrn" IS NOT OLD."lrn"
BEGIN SELECT RAISE(ABORT, 'LRN_IMMUTABLE: a learner''s LRN cannot be changed'); END;
