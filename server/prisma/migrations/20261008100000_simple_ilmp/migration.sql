-- Simple, automatically drafted ILMPs: support level instead of schedules; who finalized.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ilmp" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "learnerId" INTEGER NOT NULL,
    "learningAreaId" INTEGER NOT NULL,
    "schoolYearId" INTEGER NOT NULL,
    "termId" INTEGER,
    "identifiedGaps" TEXT NOT NULL,
    "strategies" TEXT NOT NULL,
    "monitoringNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "supportLevel" TEXT,
    "sectionId" INTEGER,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "finalizedById" INTEGER,
    "finalizedAt" DATETIME,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ilmp_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ilmp_learningAreaId_fkey" FOREIGN KEY ("learningAreaId") REFERENCES "LearningArea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Ilmp" ("createdAt", "createdById", "id", "identifiedGaps", "learnerId", "learningAreaId", "monitoringNotes", "schoolYearId", "status", "strategies", "termId", "updatedAt") SELECT "createdAt", "createdById", "id", "identifiedGaps", "learnerId", "learningAreaId", "monitoringNotes", "schoolYearId", "status", "strategies", "termId", "updatedAt" FROM "Ilmp";
DROP TABLE "Ilmp";
ALTER TABLE "new_Ilmp" RENAME TO "Ilmp";
CREATE INDEX "Ilmp_sectionId_status_idx" ON "Ilmp"("sectionId", "status");
CREATE INDEX "Ilmp_learnerId_idx" ON "Ilmp"("learnerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

