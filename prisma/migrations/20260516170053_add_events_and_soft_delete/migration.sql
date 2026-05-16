-- AlterTable
ALTER TABLE "commissioning_phases" ADD COLUMN     "capacityPendingCodMw" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "contd4_applications" ADD COLUMN     "remarksUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "generation_projects" ADD COLUMN     "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "activeUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "grid_snapshots" ADD COLUMN     "detailsJson" JSONB;

-- AlterTable
ALTER TABLE "transmission_elements" ADD COLUMN     "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "activeUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "contd4_phases" (
    "id" TEXT NOT NULL,
    "contd4Id" TEXT NOT NULL,
    "declaredDate" TIMESTAMP(3) NOT NULL,
    "capacityMw" DECIMAL(10,2) NOT NULL,
    "capacityMonth" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contd4_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ftc_events" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "capacityMw" DECIMAL(10,2) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ftc_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "toc_events" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "capacityMw" DECIMAL(10,2) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "toc_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cod_events" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "capacityMw" DECIMAL(10,2) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cod_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contd4_phases_contd4Id_idx" ON "contd4_phases"("contd4Id");

-- CreateIndex
CREATE INDEX "ftc_events_phaseId_eventDate_idx" ON "ftc_events"("phaseId", "eventDate");

-- CreateIndex
CREATE INDEX "toc_events_phaseId_eventDate_idx" ON "toc_events"("phaseId", "eventDate");

-- CreateIndex
CREATE INDEX "cod_events_phaseId_eventDate_idx" ON "cod_events"("phaseId", "eventDate");

-- CreateIndex
CREATE INDEX "generation_projects_activeFrom_activeUntil_idx" ON "generation_projects"("activeFrom", "activeUntil");

-- CreateIndex
CREATE INDEX "transmission_elements_activeFrom_activeUntil_idx" ON "transmission_elements"("activeFrom", "activeUntil");

-- AddForeignKey
ALTER TABLE "contd4_phases" ADD CONSTRAINT "contd4_phases_contd4Id_fkey" FOREIGN KEY ("contd4Id") REFERENCES "contd4_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ftc_events" ADD CONSTRAINT "ftc_events_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "commissioning_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "toc_events" ADD CONSTRAINT "toc_events_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "commissioning_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cod_events" ADD CONSTRAINT "cod_events_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "commissioning_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
