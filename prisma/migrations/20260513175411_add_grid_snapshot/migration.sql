-- CreateTable
CREATE TABLE "grid_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "label" TEXT,
    "t1Json" JSONB NOT NULL,
    "t2Json" JSONB NOT NULL,
    "t3Json" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grid_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grid_snapshots_snapshotDate_key" ON "grid_snapshots"("snapshotDate");
