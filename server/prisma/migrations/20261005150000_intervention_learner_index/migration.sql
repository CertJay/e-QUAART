-- Coverage and "learners needing intervention" look interventions up by learner; without this
-- index each lookup scanned the whole table (tens of seconds at division scale).
-- CreateIndex
CREATE INDEX "InterventionLearner_learnerId_idx" ON "InterventionLearner"("learnerId");
