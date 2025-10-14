-- Create Boards schema if missing (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='Board' AND table_schema='public') THEN
    CREATE TABLE "Board" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "viewport" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
    );
  END IF;
END$$;

-- Create BoardItem if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='BoardItem' AND table_schema='public') THEN
    CREATE TABLE "BoardItem" (
      "id" TEXT NOT NULL,
      "boardId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "x" DOUBLE PRECISION NOT NULL,
      "y" DOUBLE PRECISION NOT NULL,
      "w" DOUBLE PRECISION NOT NULL,
      "h" DOUBLE PRECISION NOT NULL,
      "z" INTEGER NOT NULL DEFAULT 0,
      "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "content" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "BoardItem_pkey" PRIMARY KEY ("id")
    );
  END IF;
END$$;

-- Create BoardEdge if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='BoardEdge' AND table_schema='public') THEN
    CREATE TABLE "BoardEdge" (
      "id" TEXT NOT NULL,
      "boardId" TEXT NOT NULL,
      "sourceId" TEXT NOT NULL,
      "targetId" TEXT NOT NULL,
      "label" TEXT,
      "style" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BoardEdge_pkey" PRIMARY KEY ("id")
    );
  END IF;
END$$;

-- Create AIProfile if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='AIProfile' AND table_schema='public') THEN
    CREATE TABLE "AIProfile" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL DEFAULT 'Default',
      "tone" TEXT NOT NULL DEFAULT 'friendly',
      "style" TEXT NOT NULL DEFAULT 'concise',
      "emotion" TEXT NOT NULL DEFAULT 'calm',
      "ttsVoice" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "AIProfile_pkey" PRIMARY KEY ("id")
    );
  END IF;
END$$;

-- Create VectorMemory if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='VectorMemory' AND table_schema='public') THEN
    CREATE TABLE "VectorMemory" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "boardId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "topic" TEXT NOT NULL DEFAULT '',
      "summary" TEXT NOT NULL DEFAULT '',
      "importance" INTEGER NOT NULL DEFAULT 0,
      "embedding" DOUBLE PRECISION[] NOT NULL,
      "payload" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "VectorMemory_pkey" PRIMARY KEY ("id")
    );
  END IF;
END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS "Board_userId_createdAt_idx" ON "Board" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "BoardItem_boardId_idx" ON "BoardItem" ("boardId");
CREATE INDEX IF NOT EXISTS "BoardEdge_boardId_idx" ON "BoardEdge" ("boardId");
CREATE UNIQUE INDEX IF NOT EXISTS "AIProfile_userId_key" ON "AIProfile" ("userId");
CREATE INDEX IF NOT EXISTS "VectorMemory_userId_boardId_idx" ON "VectorMemory" ("userId", "boardId");

-- FKs (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='Board_userId_fkey') THEN
    ALTER TABLE "Board" ADD CONSTRAINT "Board_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='BoardItem_boardId_fkey') THEN
    ALTER TABLE "BoardItem" ADD CONSTRAINT "BoardItem_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='BoardEdge_boardId_fkey') THEN
    ALTER TABLE "BoardEdge" ADD CONSTRAINT "BoardEdge_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
