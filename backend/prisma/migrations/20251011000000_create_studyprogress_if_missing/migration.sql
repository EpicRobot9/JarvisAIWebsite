-- Idempotent creation of StudyProgress for fresh databases where earlier schema didn't include it
-- This avoids failures in later migrations that assume the table exists.

-- Create table if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'StudyProgress' AND table_schema = 'public'
  ) THEN
    CREATE TABLE "StudyProgress" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "studySetId" TEXT NOT NULL,
      "sectionsCompleted" TEXT[] DEFAULT ARRAY[]::TEXT[],
      "timeSpent" INTEGER NOT NULL DEFAULT 0,
      "lastStudied" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "bookmarks" TEXT[] DEFAULT ARRAY[]::TEXT[],
      CONSTRAINT "StudyProgress_pkey" PRIMARY KEY ("id")
    );
  END IF;
END$$;

-- Unique (userId, studySetId)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StudyProgress_userId_studySetId_key'
  ) THEN
    ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_userId_studySetId_key" UNIQUE ("userId", "studySetId");
  END IF;
END$$;

-- FKs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'StudyProgress_userId_fkey'
  ) THEN
    ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'StudyProgress_studySetId_fkey'
  ) THEN
    ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- Index for lookups
CREATE INDEX IF NOT EXISTS "StudyProgress_studySetId_idx" ON "StudyProgress" ("studySetId");
