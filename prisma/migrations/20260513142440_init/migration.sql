-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC', 'NLDC');

-- CreateEnum
CREATE TYPE "NoteSource" AS ENUM ('MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "GenerationCategory" AS ENUM ('RENEWABLE', 'CONVENTIONAL', 'STORAGE');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('WIND', 'SOLAR', 'COAL', 'HYDRO', 'PSP', 'BESS');

-- CreateEnum
CREATE TYPE "Contd4Status" AS ENUM ('PENDING', 'RECEIVED', 'CLEARED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransmissionType" AS ENUM ('LINE', 'ICT', 'GT', 'ST');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'NLDC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grid_regions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "grid_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "GenerationCategory" NOT NULL,
    "isHybrid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plant_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pooling_stations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "voltageKv" INTEGER,
    "regionId" TEXT NOT NULL,

    CONSTRAINT "pooling_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "developerName" TEXT,
    "regionId" TEXT NOT NULL,
    "plantTypeId" TEXT NOT NULL,
    "poolingStationId" TEXT,
    "totalCapacityMw" DECIMAL(10,2) NOT NULL,
    "windCapacityMw" DECIMAL(10,2),
    "solarCapacityMw" DECIMAL(10,2),
    "bessCapacityMw" DECIMAL(10,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contd4_applications" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "applicationDate" TIMESTAMP(3) NOT NULL,
    "proposedFtcDate" TIMESTAMP(3),
    "capacityApr26Mw" DECIMAL(10,2),
    "capacityMonth" TEXT,
    "status" "Contd4Status" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contd4_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissioning_phases" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "capacityAppliedMw" DECIMAL(10,2) NOT NULL,
    "ftcCompletedMw" DECIMAL(10,2),
    "ftcCompletedDate" TIMESTAMP(3),
    "proposedFtcDate" TIMESTAMP(3),
    "capacityUnderFtcMw" DECIMAL(10,2),
    "tocIssuedMw" DECIMAL(10,2),
    "tocIssuedDate" TIMESTAMP(3),
    "capacityUnderTocMw" DECIMAL(10,2),
    "codDeclaredMw" DECIMAL(10,2),
    "codDeclaredDate" TIMESTAMP(3),
    "expectedApr26Mw" DECIMAL(10,2),
    "delayCategory" TEXT,
    "delayRemarks" TEXT,
    "otherRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissioning_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_notes" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" "NoteSource" NOT NULL DEFAULT 'MANUAL',
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transmission_audit_logs" (
    "id" TEXT NOT NULL,
    "elementId" TEXT,
    "elementName" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transmission_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transmission_elements" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "agencyOwner" TEXT NOT NULL,
    "elementName" TEXT NOT NULL,
    "elementType" "TransmissionType" NOT NULL,
    "isRe" BOOLEAN NOT NULL DEFAULT false,
    "voltageRatingKv" INTEGER,
    "capacityMva" DECIMAL(10,2),
    "lineLengthKm" DECIMAL(10,3),
    "firstEnergyDate" TIMESTAMP(3),
    "pendingFtc" BOOLEAN NOT NULL DEFAULT false,
    "proposedFtcDate" TIMESTAMP(3),
    "capacityApr26Mva" DECIMAL(10,2),
    "lineLengthApr26Km" DECIMAL(10,3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transmission_elements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "grid_regions_code_key" ON "grid_regions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plant_types_code_key" ON "plant_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pooling_stations_name_regionId_key" ON "pooling_stations"("name", "regionId");

-- CreateIndex
CREATE INDEX "generation_projects_regionId_idx" ON "generation_projects"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "contd4_applications_projectId_key" ON "contd4_applications"("projectId");

-- CreateIndex
CREATE INDEX "commissioning_phases_projectId_idx" ON "commissioning_phases"("projectId");

-- CreateIndex
CREATE INDEX "project_notes_projectId_idx" ON "project_notes"("projectId");

-- CreateIndex
CREATE INDEX "project_notes_phaseId_idx" ON "project_notes"("phaseId");

-- CreateIndex
CREATE INDEX "transmission_audit_logs_elementId_idx" ON "transmission_audit_logs"("elementId");

-- CreateIndex
CREATE INDEX "transmission_elements_regionId_idx" ON "transmission_elements"("regionId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pooling_stations" ADD CONSTRAINT "pooling_stations_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "grid_regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_projects" ADD CONSTRAINT "generation_projects_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "grid_regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_projects" ADD CONSTRAINT "generation_projects_plantTypeId_fkey" FOREIGN KEY ("plantTypeId") REFERENCES "plant_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_projects" ADD CONSTRAINT "generation_projects_poolingStationId_fkey" FOREIGN KEY ("poolingStationId") REFERENCES "pooling_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_projects" ADD CONSTRAINT "generation_projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contd4_applications" ADD CONSTRAINT "contd4_applications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "generation_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioning_phases" ADD CONSTRAINT "commissioning_phases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "generation_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "generation_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "commissioning_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transmission_audit_logs" ADD CONSTRAINT "transmission_audit_logs_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "transmission_elements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transmission_audit_logs" ADD CONSTRAINT "transmission_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transmission_elements" ADD CONSTRAINT "transmission_elements_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "grid_regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
