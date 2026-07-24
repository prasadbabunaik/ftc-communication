-- CreateTable
CREATE TABLE "contd4_attachments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "remarks" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contd4_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contd4_attachments_projectId_idx" ON "contd4_attachments"("projectId");

-- AddForeignKey
ALTER TABLE "contd4_attachments" ADD CONSTRAINT "contd4_attachments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "generation_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contd4_attachments" ADD CONSTRAINT "contd4_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
