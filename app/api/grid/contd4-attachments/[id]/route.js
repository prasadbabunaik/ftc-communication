import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';

// Streams a CONTD-4 project attachment stored in the DB (bytea). Region-scoped:
// an RLDC can only download files for projects in its own region; ADMIN/NLDC can
// download any. `?download=1` forces a save dialog; otherwise the browser may
// preview (PDF/images) inline.
export async function GET(request, { params }) {
  let user;
  try { user = await requireServerUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const { id } = await params;

  const att = await prisma.contd4Attachment.findUnique({
    where: { id },
    select: {
      filename: true, mimeType: true, data: true, sizeBytes: true,
      project: { select: { regionId: true } },
    },
  });
  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== att.project.regionId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const forceDownload = new URL(request.url).searchParams.get('download') === '1';
  // RFC 5987 encoding so filenames with spaces / non-ASCII survive the header.
  const safeName = att.filename.replace(/[\r\n"]/g, '');
  const disposition = `${forceDownload ? 'attachment' : 'inline'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`;

  return new NextResponse(Buffer.from(att.data), {
    headers: {
      'Content-Type': att.mimeType || 'application/octet-stream',
      'Content-Length': String(att.sizeBytes),
      'Content-Disposition': disposition,
      'Cache-Control': 'private, no-store',
    },
  });
}
