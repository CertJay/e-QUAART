-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assessmentResultId" INTEGER NOT NULL,
    "assessmentId" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "schoolYearId" INTEGER NOT NULL,
    "changes" JSONB NOT NULL,
    "proposed" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" INTEGER NOT NULL,
    "reviewedById" INTEGER,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CorrectionRequest_assessmentResultId_fkey" FOREIGN KEY ("assessmentResultId") REFERENCES "AssessmentResult" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CorrectionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CorrectionRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SchoolYear" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SchoolYear" ("createdAt", "endDate", "id", "isCurrent", "label", "startDate", "updatedAt") SELECT "createdAt", "endDate", "id", "isCurrent", "label", "startDate", "updatedAt" FROM "SchoolYear";
DROP TABLE "SchoolYear";
ALTER TABLE "new_SchoolYear" RENAME TO "SchoolYear";
CREATE UNIQUE INDEX "SchoolYear_label_key" ON "SchoolYear"("label");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CorrectionRequest_assessmentResultId_status_idx" ON "CorrectionRequest"("assessmentResultId", "status");

-- CreateIndex
CREATE INDEX "CorrectionRequest_schoolId_status_idx" ON "CorrectionRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "CorrectionRequest_assessmentId_idx" ON "CorrectionRequest"("assessmentId");

-- Existing data: school years that ended before the current one starts are treated as closed.
UPDATE "SchoolYear" SET "status" = 'CLOSED'
WHERE "isCurrent" = false
  AND "endDate" < (SELECT "startDate" FROM "SchoolYear" WHERE "isCurrent" = true LIMIT 1);

-- Database-level backstop (spec §5.4, §7.3): results of a CLOSED or ARCHIVED school year are
-- read-only whichever code path tries to change them. The API checks first and returns a
-- friendly 423; these triggers fire only if that check is ever bypassed.
CREATE TRIGGER "AssessmentResult_closed_year_insert" BEFORE INSERT ON "AssessmentResult"
WHEN (SELECT sy."status" FROM "Assessment" a JOIN "SchoolYear" sy ON sy."id" = a."schoolYearId" WHERE a."id" = NEW."assessmentId") IN ('CLOSED', 'ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'SCHOOL_YEAR_READ_ONLY: results of a closed school year cannot be changed'); END;

CREATE TRIGGER "AssessmentResult_closed_year_update" BEFORE UPDATE ON "AssessmentResult"
WHEN (SELECT sy."status" FROM "Assessment" a JOIN "SchoolYear" sy ON sy."id" = a."schoolYearId" WHERE a."id" = OLD."assessmentId") IN ('CLOSED', 'ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'SCHOOL_YEAR_READ_ONLY: results of a closed school year cannot be changed'); END;

CREATE TRIGGER "AssessmentResult_closed_year_delete" BEFORE DELETE ON "AssessmentResult"
WHEN (SELECT sy."status" FROM "Assessment" a JOIN "SchoolYear" sy ON sy."id" = a."schoolYearId" WHERE a."id" = OLD."assessmentId") IN ('CLOSED', 'ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'SCHOOL_YEAR_READ_ONLY: results of a closed school year cannot be changed'); END;

CREATE TRIGGER "CompetencyResult_closed_year_insert" BEFORE INSERT ON "CompetencyResult"
WHEN (SELECT sy."status" FROM "AssessmentResult" r JOIN "Assessment" a ON a."id" = r."assessmentId" JOIN "SchoolYear" sy ON sy."id" = a."schoolYearId" WHERE r."id" = NEW."resultId") IN ('CLOSED', 'ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'SCHOOL_YEAR_READ_ONLY: results of a closed school year cannot be changed'); END;

CREATE TRIGGER "CompetencyResult_closed_year_update" BEFORE UPDATE ON "CompetencyResult"
WHEN (SELECT sy."status" FROM "AssessmentResult" r JOIN "Assessment" a ON a."id" = r."assessmentId" JOIN "SchoolYear" sy ON sy."id" = a."schoolYearId" WHERE r."id" = OLD."resultId") IN ('CLOSED', 'ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'SCHOOL_YEAR_READ_ONLY: results of a closed school year cannot be changed'); END;

CREATE TRIGGER "CompetencyResult_closed_year_delete" BEFORE DELETE ON "CompetencyResult"
WHEN (SELECT sy."status" FROM "AssessmentResult" r JOIN "Assessment" a ON a."id" = r."assessmentId" JOIN "SchoolYear" sy ON sy."id" = a."schoolYearId" WHERE r."id" = OLD."resultId") IN ('CLOSED', 'ARCHIVED')
BEGIN SELECT RAISE(ABORT, 'SCHOOL_YEAR_READ_ONLY: results of a closed school year cannot be changed'); END;
