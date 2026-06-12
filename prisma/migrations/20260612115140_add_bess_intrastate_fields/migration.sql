-- AlterTable
ALTER TABLE "generation_projects" ADD COLUMN     "energyCommissionedMwh" DECIMAL(12,2),
ADD COLUMN     "isIntrastate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stateName" TEXT;
