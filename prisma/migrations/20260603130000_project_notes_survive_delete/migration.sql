-- Make project_notes an immutable audit trail that survives project deletion.
ALTER TABLE "project_notes" ADD COLUMN "projectName" TEXT;
ALTER TABLE "project_notes" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "project_notes" DROP CONSTRAINT "project_notes_projectId_fkey";
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "generation_projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
