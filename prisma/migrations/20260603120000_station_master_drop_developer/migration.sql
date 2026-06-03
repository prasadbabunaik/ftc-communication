-- developerName is no longer captured anywhere — drop it.
ALTER TABLE "generation_projects" DROP COLUMN IF EXISTS "developerName";

-- Master list of generating stations, imported from the canonical Station
-- list spreadsheet. Drives the searchable station-name dropdown.
CREATE TABLE "generating_stations" (
  "id"                 TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "poolingStationName" TEXT,
  "regionCode"         TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "generating_stations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "generating_stations_name_key" ON "generating_stations" ("name");
CREATE INDEX "generating_stations_regionCode_idx" ON "generating_stations" ("regionCode");
