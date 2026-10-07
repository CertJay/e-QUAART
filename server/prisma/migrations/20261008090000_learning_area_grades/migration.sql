-- Which grades take each learning area (MATATAG subjects differ by grade). NULL = every grade,
-- so existing learning areas keep working until an administrator sets their grades.
-- AlterTable
ALTER TABLE "LearningArea" ADD COLUMN "gradeLevels" JSONB;
