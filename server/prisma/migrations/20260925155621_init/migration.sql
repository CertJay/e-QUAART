-- CreateTable
CREATE TABLE "Division" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "District" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "divisionId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "District_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "School" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolIdDeped" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" INTEGER NOT NULL,
    "address" TEXT,
    "schoolType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "School_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchoolYear" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "label" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Term" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "schoolYearId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    CONSTRAINT "Term_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KeyStage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "GradeLevel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "keyStageId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "GradeLevel_keyStageId_fkey" FOREIGN KEY ("keyStageId") REFERENCES "KeyStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningArea" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "learningAreaId" INTEGER NOT NULL,
    "gradeLevelId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "curriculum" TEXT NOT NULL DEFAULT 'MATATAG',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Competency_learningAreaId_fkey" FOREIGN KEY ("learningAreaId") REFERENCES "LearningArea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Competency_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Section" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "gradeLevelId" INTEGER NOT NULL,
    "schoolYearId" INTEGER NOT NULL,
    "adviserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Section_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Section_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Section_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Section_adviserId_fkey" FOREIGN KEY ("adviserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SectionTeacher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sectionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "learningAreaId" INTEGER,
    CONSTRAINT "SectionTeacher_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SectionTeacher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SectionTeacher_learningAreaId_fkey" FOREIGN KEY ("learningAreaId") REFERENCES "LearningArea" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Learner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lrn" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "extensionName" TEXT,
    "sex" TEXT NOT NULL,
    "birthdate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Enrolment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "learnerId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "schoolYearId" INTEGER NOT NULL,
    "dateEnrolled" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "endedAt" DATETIME,
    "endReason" TEXT,
    CONSTRAINT "Enrolment_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Enrolment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Enrolment_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "resultMode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "ClassificationModel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assessmentTypeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "effectiveSchoolYearId" INTEGER,
    "masteryThreshold" REAL NOT NULL DEFAULT 0.75,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassificationModel_assessmentTypeId_fkey" FOREIGN KEY ("assessmentTypeId") REFERENCES "AssessmentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassificationBand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "modelId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "minPct" REAL,
    "maxPct" REAL,
    "descriptorKey" TEXT,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ClassificationBand_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ClassificationModel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "assessmentTypeId" INTEGER NOT NULL,
    "modelId" INTEGER NOT NULL,
    "schoolYearId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "gradeLevelId" INTEGER NOT NULL,
    "learningAreaId" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "assessmentDate" DATETIME,
    "maxScore" REAL,
    "windowOpen" DATETIME,
    "windowClose" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "returnReason" TEXT,
    "createdById" INTEGER NOT NULL,
    "submittedById" INTEGER,
    "submittedAt" DATETIME,
    "verifiedById" INTEGER,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Assessment_assessmentTypeId_fkey" FOREIGN KEY ("assessmentTypeId") REFERENCES "AssessmentType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ClassificationModel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_learningAreaId_fkey" FOREIGN KEY ("learningAreaId") REFERENCES "LearningArea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assessment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentCompetency" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assessmentId" INTEGER NOT NULL,
    "competencyId" INTEGER NOT NULL,
    "itemsTotal" INTEGER NOT NULL,
    CONSTRAINT "AssessmentCompetency_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "assessmentId" INTEGER NOT NULL,
    "learnerId" INTEGER NOT NULL,
    "rawScore" REAL,
    "percentage" REAL,
    "profileDescriptor" TEXT,
    "bandId" INTEGER,
    "tier" TEXT,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "encodedById" INTEGER NOT NULL,
    "updatedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssessmentResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentResult_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssessmentResult_bandId_fkey" FOREIGN KEY ("bandId") REFERENCES "ClassificationBand" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetencyResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "resultId" INTEGER NOT NULL,
    "competencyId" INTEGER NOT NULL,
    "itemsCorrect" INTEGER NOT NULL,
    "itemsTotal" INTEGER NOT NULL,
    "mastered" BOOLEAN NOT NULL,
    CONSTRAINT "CompetencyResult_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AssessmentResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompetencyResult_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningGap" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "learnerId" INTEGER NOT NULL,
    "assessmentResultId" INTEGER NOT NULL,
    "competencyId" INTEGER,
    "learningAreaId" INTEGER NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "schoolYearId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "masteryPct" REAL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningGap_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LearningGap_assessmentResultId_fkey" FOREIGN KEY ("assessmentResultId") REFERENCES "AssessmentResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearningGap_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "schoolId" INTEGER NOT NULL,
    "sectionId" INTEGER,
    "schoolYearId" INTEGER NOT NULL,
    "termId" INTEGER,
    "learningAreaId" INTEGER NOT NULL,
    "sourceAssessmentId" INTEGER,
    "tier" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "description" TEXT,
    "bannerProgram" TEXT,
    "frequency" TEXT,
    "startDate" DATETIME,
    "targetEndDate" DATETIME,
    "reassessmentDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "remarks" TEXT,
    "ownerId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Intervention_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Intervention_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Intervention_learningAreaId_fkey" FOREIGN KEY ("learningAreaId") REFERENCES "LearningArea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Intervention_sourceAssessmentId_fkey" FOREIGN KEY ("sourceAssessmentId") REFERENCES "Assessment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Intervention_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterventionCompetency" (
    "interventionId" INTEGER NOT NULL,
    "competencyId" INTEGER NOT NULL,

    PRIMARY KEY ("interventionId", "competencyId"),
    CONSTRAINT "InterventionCompetency_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "Intervention" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterventionCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterventionLearner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "interventionId" INTEGER NOT NULL,
    "learnerId" INTEGER NOT NULL,
    "learningGapId" INTEGER,
    "entryReason" TEXT,
    "prePercentage" REAL,
    "preBandId" INTEGER,
    "preTier" TEXT,
    "progressNote" TEXT,
    "decision" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterventionLearner_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "Intervention" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterventionLearner_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InterventionLearner_learningGapId_fkey" FOREIGN KEY ("learningGapId") REFERENCES "LearningGap" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reassessment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "interventionLearnerId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "rawScore" REAL,
    "maxScore" REAL,
    "percentage" REAL,
    "profileDescriptor" TEXT,
    "bandId" INTEGER,
    "tier" TEXT,
    "notes" TEXT,
    "recordedById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reassessment_interventionLearnerId_fkey" FOREIGN KEY ("interventionLearnerId") REFERENCES "InterventionLearner" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reassessment_bandId_fkey" FOREIGN KEY ("bandId") REFERENCES "ClassificationBand" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterventionSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "interventionId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "topic" TEXT NOT NULL,
    "notes" TEXT,
    "facilitatorId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterventionSession_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "Intervention" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "learnerId" INTEGER NOT NULL,
    "present" BOOLEAN NOT NULL,
    CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InterventionSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AttendanceRecord_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ilmp" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "learnerId" INTEGER NOT NULL,
    "learningAreaId" INTEGER NOT NULL,
    "schoolYearId" INTEGER NOT NULL,
    "termId" INTEGER,
    "identifiedGaps" TEXT NOT NULL,
    "strategies" TEXT NOT NULL,
    "monitoringNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ilmp_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ilmp_learningAreaId_fkey" FOREIGN KEY ("learningAreaId") REFERENCES "LearningArea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "privacyAcceptedAt" DATETIME,
    "passwordChangedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserScope" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "scopeType" TEXT NOT NULL,
    "divisionId" INTEGER,
    "districtId" INTEGER,
    "schoolId" INTEGER,
    "sectionId" INTEGER,
    "learningAreaId" INTEGER,
    CONSTRAINT "UserScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserScope_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UserScope_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UserScope_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UserScope_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UserScope_learningAreaId_fkey" FOREIGN KEY ("learningAreaId") REFERENCES "LearningArea" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedById" INTEGER,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity" TEXT NOT NULL,
    "retentionMonths" INTEGER NOT NULL,
    "disposalAction" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BreachIncident" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discoveredAt" DATETIME NOT NULL,
    "affectedRecords" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "npcNotifiedAt" DATETIME,
    "actionsTaken" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Division_code_key" ON "Division"("code");

-- CreateIndex
CREATE UNIQUE INDEX "District_divisionId_name_key" ON "District"("divisionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "School_schoolIdDeped_key" ON "School"("schoolIdDeped");

-- CreateIndex
CREATE INDEX "School_districtId_idx" ON "School"("districtId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolYear_label_key" ON "SchoolYear"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Term_schoolYearId_code_key" ON "Term"("schoolYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "KeyStage_code_key" ON "KeyStage"("code");

-- CreateIndex
CREATE UNIQUE INDEX "GradeLevel_code_key" ON "GradeLevel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LearningArea_code_key" ON "LearningArea"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Competency_learningAreaId_gradeLevelId_code_key" ON "Competency"("learningAreaId", "gradeLevelId", "code");

-- CreateIndex
CREATE INDEX "Section_schoolYearId_idx" ON "Section"("schoolYearId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_schoolId_schoolYearId_gradeLevelId_name_key" ON "Section"("schoolId", "schoolYearId", "gradeLevelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SectionTeacher_sectionId_userId_learningAreaId_key" ON "SectionTeacher"("sectionId", "userId", "learningAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "Learner_lrn_key" ON "Learner"("lrn");

-- CreateIndex
CREATE INDEX "Learner_lastName_firstName_idx" ON "Learner"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Enrolment_learnerId_idx" ON "Enrolment"("learnerId");

-- CreateIndex
CREATE INDEX "Enrolment_sectionId_isCurrent_idx" ON "Enrolment"("sectionId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentType_code_key" ON "AssessmentType"("code");

-- CreateIndex
CREATE INDEX "Assessment_schoolId_schoolYearId_termId_idx" ON "Assessment"("schoolId", "schoolYearId", "termId");

-- CreateIndex
CREATE INDEX "Assessment_sectionId_idx" ON "Assessment"("sectionId");

-- CreateIndex
CREATE INDEX "Assessment_learningAreaId_idx" ON "Assessment"("learningAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCompetency_assessmentId_competencyId_key" ON "AssessmentCompetency"("assessmentId", "competencyId");

-- CreateIndex
CREATE INDEX "AssessmentResult_learnerId_idx" ON "AssessmentResult"("learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResult_assessmentId_learnerId_key" ON "AssessmentResult"("assessmentId", "learnerId");

-- CreateIndex
CREATE INDEX "CompetencyResult_competencyId_idx" ON "CompetencyResult"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyResult_resultId_competencyId_key" ON "CompetencyResult"("resultId", "competencyId");

-- CreateIndex
CREATE INDEX "LearningGap_learnerId_idx" ON "LearningGap"("learnerId");

-- CreateIndex
CREATE INDEX "LearningGap_schoolId_schoolYearId_termId_idx" ON "LearningGap"("schoolId", "schoolYearId", "termId");

-- CreateIndex
CREATE INDEX "LearningGap_competencyId_idx" ON "LearningGap"("competencyId");

-- CreateIndex
CREATE INDEX "Intervention_schoolId_schoolYearId_idx" ON "Intervention"("schoolId", "schoolYearId");

-- CreateIndex
CREATE UNIQUE INDEX "InterventionLearner_interventionId_learnerId_key" ON "InterventionLearner"("interventionId", "learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_sessionId_learnerId_key" ON "AttendanceRecord"("sessionId", "learnerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserScope_userId_idx" ON "UserScope"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key" ON "UserSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_entity_key" ON "RetentionPolicy"("entity");
