-- Login / logout activity audit trail (admin-only view).
CREATE TABLE "auth_activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "method" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_activity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auth_activity_createdAt_idx" ON "auth_activity"("createdAt");
CREATE INDEX "auth_activity_userId_createdAt_idx" ON "auth_activity"("userId", "createdAt");
ALTER TABLE "auth_activity" ADD CONSTRAINT "auth_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
