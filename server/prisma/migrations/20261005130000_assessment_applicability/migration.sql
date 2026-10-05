-- Spec §3.5: each assessment type lists the grade levels it applies to.
ALTER TABLE "AssessmentType" ADD COLUMN "applicableGrades" JSONB;
