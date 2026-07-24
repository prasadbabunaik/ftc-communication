import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, canEditGridData } from '@/lib/server-auth';

// Upload a CONTD-4 project document (with an optional remark). Multipart is
// parsed natively by the route handler. Bytes are stored in the DB (bytea) so
// they're reachable from both the dev and prod deployments that share one
// database — see the Contd4Attachment model comment.

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB per file
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

function revalidateGridPages(projectId) {
  for (const p of ['/dashboard', '/ftc', '/hybrid-ftc', '/contd4', '/generation', '/bess-data']) {
    revalidatePath(p);
  }
  if (projectId) revalidatePath(`/generation/${projectId}`);
}

export async function POST(request) {
  let user;
  try { user = await requireServerUser(); }
  catch { return NextResponse.json({ error: 'Session expired. Please log in again.' }, { status: 401 }); }
  if (!canEditGridData(user.role)) {
    return NextResponse.json({ error: 'Your role is read-only for grid data.' }, { status: 403 });
  }

  let form;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 }); }

  const projectId = String(form.get('projectId') ?? '');
  const remarksRaw = form.get('remarks');
  const remarks = remarksRaw != null && String(remarksRaw).trim()
    ? String(remarksRaw).trim().slice(0, 2000) : null;
  // Accept one or many files under the `file` key — the remark applies to each.
  const files = form.getAll('file').filter((f) => f && typeof f !== 'string' && typeof f.arrayBuffer === 'function');

  if (!projectId) return NextResponse.json({ error: 'Missing project.' }, { status: 400 });
  if (files.length === 0) {
    return NextResponse.json({ error: 'Please choose at least one file to upload.' }, { status: 400 });
  }

  // Validate every file before writing any, so a bad file rejects the batch
  // cleanly instead of leaving a partial upload.
  const prepared = [];
  for (const file of files) {
    const name = (String(file.name || 'attachment').replace(/[\r\n"]/g, '').trim() || 'attachment').slice(0, 255);
    if (file.size === 0) return NextResponse.json({ error: `"${name}" is empty.` }, { status: 400 });
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: `"${name}" is too large — maximum ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB per file.` }, { status: 413 });
    }
    const mimeType = String(file.type || 'application/octet-stream');
    if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
      return NextResponse.json({ error: `"${name}" is an unsupported file type. Allowed: PDF, images, Word/Excel, text/CSV.` }, { status: 415 });
    }
    prepared.push({ name, mimeType, file });
  }

  const project = await prisma.generationProject.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, regionId: true },
  });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  }

  // Read all bytes, then persist the whole batch in one transaction.
  const withBytes = await Promise.all(prepared.map(async (p) => ({
    ...p, bytes: Buffer.from(await p.file.arrayBuffer()),
  })));

  await prisma.$transaction(async (tx) => {
    for (const { name, mimeType, bytes } of withBytes) {
      await tx.contd4Attachment.create({
        data: {
          projectId, filename: name, mimeType, sizeBytes: bytes.length,
          data: bytes, remarks, uploadedById: user.id,
        },
      });
      await tx.projectNote.create({
        data: {
          projectId, projectName: project.name, userId: user.id,
          text: `File attached: ${name}${remarks ? ` — ${remarks}` : ''}`,
          source: 'SYSTEM',
        },
      });
    }
  });

  revalidateGridPages(projectId);
  return NextResponse.json({ success: true, count: withBytes.length });
}
