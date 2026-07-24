'use client';

import { useState, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Paperclip, Upload, Trash2, Download, FileText, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';
import { deleteContd4Attachment } from '@/app/actions/grid';

const MAX_BYTES = 15 * 1024 * 1024; // keep in sync with the server action

function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}

export function Contd4Attachments({ projectId, attachments = [], canEdit }) {
  const router = useRouter();
  const fileRef = useRef(null);
  const [file, setFile]       = useState(null);
  const [remarks, setRemarks] = useState('');
  const [isPending, startTransition] = useTransition();
  const [toDelete, setToDelete] = useState(null);
  const [isDeleting, startDelete] = useTransition();

  function pickFile(e) {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > MAX_BYTES) {
      toast.error(`File too large — maximum ${Math.round(MAX_BYTES / (1024 * 1024))} MB.`);
      e.target.value = '';
      return;
    }
    setFile(f);
  }

  function clearFile() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function upload() {
    if (!file) { toast.error('Please choose a file to upload.'); return; }
    startTransition(async () => {
      const fd = new FormData();
      fd.append('projectId', projectId);
      fd.append('remarks', remarks);
      fd.append('file', file);
      let result;
      try {
        const resp = await fetch('/api/grid/contd4-attachments', { method: 'POST', body: fd });
        result = await resp.json().catch(() => ({}));
        if (!resp.ok) result = { error: result?.error || `Upload failed (${resp.status}).` };
      } catch {
        result = { error: 'Upload failed — network error.' };
      }
      if (result?.error) toast.error(result.error);
      else {
        toast.success('File uploaded.');
        clearFile();
        setRemarks('');
        router.refresh();
      }
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const id = toDelete.id;
    startDelete(async () => {
      const result = await deleteContd4Attachment(id);
      setToDelete(null);
      if (result?.error) toast.error(result.error);
      else { toast.success('File removed.'); router.refresh(); }
    });
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b bg-muted/20">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Paperclip className="size-4 text-amber-600" /> Project Documents
          {attachments.length > 0 && (
            <span className="text-[10px] font-normal text-muted-foreground">· {attachments.length} file{attachments.length === 1 ? '' : 's'}</span>
          )}
        </h2>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Existing files */}
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No documents uploaded yet.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[10px]">
                  <th className="px-2.5 py-1.5 text-left font-semibold">File</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold">Remarks</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">Uploaded By</th>
                  <th className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">Date</th>
                  <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((a, i) => (
                  <tr key={a.id} className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                    <td className="px-2.5 py-1.5">
                      <a
                        href={`/api/grid/contd4-attachments/${a.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:underline max-w-[220px]"
                        title={a.filename}
                      >
                        <FileText className="size-3.5 shrink-0" />
                        <span className="truncate">{a.filename}</span>
                      </a>
                      <span className="block text-[10px] text-slate-400 mt-0.5">{fmtBytes(a.sizeBytes)}</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-slate-600 max-w-[240px]">
                      {a.remarks
                        ? <span className="whitespace-pre-wrap break-words">{a.remarks}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-2.5 py-1.5 text-slate-600 whitespace-nowrap">{a.uploadedBy?.name ?? '—'}</td>
                    <td className="px-2.5 py-1.5 text-slate-600 whitespace-nowrap tabular-nums">{fmtDate(a.createdAt)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={`/api/grid/contd4-attachments/${a.id}?download=1`}
                          className="text-slate-400 hover:text-blue-600 transition-colors"
                          title="Download"
                        >
                          <Download className="size-3.5" />
                        </a>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setToDelete(a)}
                            className="text-slate-400 hover:text-rose-600 transition-colors"
                            title="Remove this file"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Upload control */}
        {canEdit && (
          <div className="p-3 rounded-md border border-blue-200 bg-blue-50/40">
            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700 mb-2">Upload a document</p>
            <input
              ref={fileRef}
              type="file"
              onChange={pickFile}
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv"
            />
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_2fr_auto] gap-2 items-end">
              <div>
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">File *</p>
                {file ? (
                  <div className="h-10 flex items-center justify-between gap-2 px-3 rounded-md border border-input bg-background text-sm">
                    <span className="truncate">{file.name}</span>
                    <button type="button" onClick={clearFile} className="text-slate-400 hover:text-rose-600 shrink-0" title="Clear">
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="h-10 w-full justify-start font-normal text-muted-foreground" onClick={() => fileRef.current?.click()}>
                    <Upload className="size-3.5 mr-2" /> Choose file…
                  </Button>
                )}
              </div>
              <div>
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Remarks</p>
                <Input
                  placeholder="e.g. CONTD-4 clearance letter, revised layout…"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
              <Button type="button" size="sm" className="h-10" onClick={upload} disabled={isPending || !file}>
                {isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              PDF, images, Word/Excel, or text — up to {Math.round(MAX_BYTES / (1024 * 1024))} MB per file.
            </p>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="size-4" /> Remove Document?
            </DialogTitle>
            <DialogDescription>
              {toDelete && (
                <>
                  You&apos;re about to remove{' '}
                  <span className="font-semibold text-foreground">{toDelete.filename}</span>.
                  {toDelete.remarks && (
                    <span className="block mt-2 text-xs italic text-muted-foreground">
                      Remarks: &ldquo;{toDelete.remarks}&rdquo;
                    </span>
                  )}
                  <span className="block mt-3 text-xs text-rose-600">
                    This permanently deletes the file. The action is logged in the Activity feed.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setToDelete(null)} disabled={isDeleting}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={confirmDelete} disabled={isDeleting}>
                <Trash2 className="size-3.5 mr-1.5" />
                {isDeleting ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
