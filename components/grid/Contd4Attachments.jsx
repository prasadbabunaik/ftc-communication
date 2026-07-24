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
  const [files, setFiles]     = useState([]);
  const [remarks, setRemarks] = useState('');
  const [isPending, startTransition] = useTransition();
  const [toDelete, setToDelete] = useState(null);
  const [isDeleting, startDelete] = useTransition();

  function pickFiles(e) {
    const picked = Array.from(e.target.files ?? []);
    const tooBig = picked.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) {
      toast.error(`${tooBig.length === 1 ? `"${tooBig[0].name}" is` : `${tooBig.length} files are`} over the ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit.`);
    }
    const ok = picked.filter((f) => f.size <= MAX_BYTES);
    // Merge with any already-selected files, de-duplicating by name+size.
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...ok.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
    // Reset the input so re-picking the same file fires onChange again.
    if (fileRef.current) fileRef.current.value = '';
  }

  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearFiles() {
    setFiles([]);
    if (fileRef.current) fileRef.current.value = '';
  }

  function upload() {
    if (!files.length) { toast.error('Please choose at least one file to upload.'); return; }
    startTransition(async () => {
      const fd = new FormData();
      fd.append('projectId', projectId);
      fd.append('remarks', remarks);
      for (const f of files) fd.append('file', f);
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
        const n = result.count ?? files.length;
        toast.success(`${n} file${n === 1 ? '' : 's'} uploaded.`);
        clearFiles();
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
              multiple
              onChange={pickFiles}
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv"
            />
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_2fr_auto] gap-2 items-end">
              <div>
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Files *</p>
                <Button type="button" variant="outline" size="sm" className="h-10 w-full justify-start font-normal text-muted-foreground" onClick={() => fileRef.current?.click()}>
                  <Upload className="size-3.5 mr-2" /> {files.length ? 'Add more files…' : 'Choose files…'}
                </Button>
              </div>
              <div>
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Remarks</p>
                <Input
                  placeholder="e.g. CONTD-4 clearance letter, revised layout…"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
              <Button type="button" size="sm" className="h-10" onClick={upload} disabled={isPending || !files.length}>
                {isPending ? 'Uploading…' : files.length > 1 ? `Upload ${files.length}` : 'Upload'}
              </Button>
            </div>

            {/* Selected-file chips (removable) — shown before upload */}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {files.map((f, idx) => (
                  <span key={`${f.name}:${f.size}:${idx}`} className="inline-flex items-center gap-1.5 max-w-[240px] pl-2 pr-1 py-1 rounded border border-input bg-background text-xs">
                    <FileText className="size-3 shrink-0 text-slate-400" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-[10px] text-slate-400 shrink-0">{fmtBytes(f.size)}</span>
                    <button type="button" onClick={() => removeFile(idx)} className="text-slate-400 hover:text-rose-600 shrink-0" title="Remove">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={clearFiles} className="text-[10px] text-slate-400 hover:text-rose-600 underline ml-1 self-center">
                  clear all
                </button>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground mt-1.5">
              Select one or more files — PDF, images, Word/Excel, or text — up to {Math.round(MAX_BYTES / (1024 * 1024))} MB each. The remark applies to every file in this upload.
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
