-- Add foreign keys and indexes for StudyProgress if not already present
DO $$
BEGIN
  -- Add userId FK
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'StudyProgress_userId_fkey'
  ) THEN
    ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Add studySetId FK
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'StudyProgress_studySetId_fkey'
  ) THEN
    ALTER TABLE "StudyProgress" ADD CONSTRAINT "StudyProgress_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- Ensure index on studySetId exists (besides unique composite)
CREATE INDEX IF NOT EXISTS "StudyProgress_studySetId_idx" ON "StudyProgress" ("studySetId");