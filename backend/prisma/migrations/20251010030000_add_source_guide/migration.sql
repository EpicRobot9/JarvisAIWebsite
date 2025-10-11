-- Add sourceGuideId column and self-relation index to StudySet
ALTER TABLE "StudySet" ADD COLUMN IF NOT EXISTS "sourceGuideId" TEXT;

-- Create index for faster reverse lookups
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "StudySet_sourceGuideId_idx" ON "StudySet"("sourceGuideId");
EXCEPTION WHEN duplicate_table THEN
  -- ignore
END $$;

-- Optionally backfill: leave NULL; no FK constraint added here to avoid locking; Prisma handles relation in client
