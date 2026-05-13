'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, ArrowRight, Pencil } from 'lucide-react';
import { addProjectNote } from '@/app/actions/grid';
import { Button } from '@/components/ui/button';

function AutoResizeTextarea({ value, onChange, className, ...props }) {
  const ref = useRef(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    requestAnimationFrame(resize);
  }, [value]);

  return (
    <textarea ref={ref} value={value} onChange={onChange} className={className} {...props} />
  );
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function SystemEntry({ note }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted border border-border">
            <Pencil className="size-2.5 text-muted-foreground" />
          </div>
          <span className="text-xs font-semibold text-foreground">{note.field ?? 'System'}</span>
          <span className="text-xs text-muted-foreground">updated</span>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
          <Clock className="size-2.5" />
          {fmtDateTime(note.createdAt)}
        </span>
      </div>

      {note.field ? (
        <div className="ml-6 space-y-1">
          {note.oldValue ? (
            <div className="flex items-start gap-2">
              <span className="text-[10px] text-muted-foreground w-5 shrink-0 pt-0.5">was</span>
              <span className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded px-2 py-0.5 line-through break-all leading-relaxed whitespace-pre-wrap">{note.oldValue}</span>
            </div>
          ) : null}
          <div className="flex items-start gap-2">
            <span className="text-[10px] text-muted-foreground w-5 shrink-0 pt-0.5">{note.oldValue ? 'now' : 'set'}</span>
            <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-2 py-0.5 font-medium break-all leading-relaxed whitespace-pre-wrap">{note.newValue || '—'}</span>
          </div>
        </div>
      ) : (
        <p className="ml-6 text-xs text-muted-foreground">{note.text}</p>
      )}

      <p className="mt-2 ml-6 text-[10px] text-muted-foreground/60">by {note.user?.name ?? 'System'}</p>
    </div>
  );
}

function ManualEntry({ note }) {
  const initials = note.user?.name?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() ?? 'U';
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 shadow-xs">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-primary leading-none">{initials}</span>
          </div>
          <span className="text-xs font-semibold text-foreground">{note.user?.name ?? 'Unknown'}</span>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
          <Clock className="size-2.5" />
          {fmtDateTime(note.createdAt)}
        </span>
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap ml-8 leading-relaxed">{note.text}</p>
    </div>
  );
}

export function AuditFeed({ projectId, notes = [], canAdd = true }) {
  const [text, setText]           = useState('');
  const [isPending, startTransition] = useTransition();
  const [localError, setLocalError]  = useState('');
  const router = useRouter();

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setLocalError('');
    startTransition(async () => {
      const result = await addProjectNote(projectId, trimmed);
      if (result?.error) {
        setLocalError(result.error);
      } else {
        setText('');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Timeline */}
      {notes.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/10 py-6 text-center">
          <p className="text-xs text-muted-foreground">No activity yet.</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
          {notes.map((note) =>
            note.source === 'SYSTEM'
              ? <SystemEntry key={note.id} note={note} />
              : <ManualEntry key={note.id} note={note} />,
          )}
        </div>
      )}

      {/* Add note form */}
      {canAdd && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <AutoResizeTextarea
            className="w-full min-h-[64px] rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground"
            placeholder="Add an engineering note, issue, or revision record…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
          />
          {localError && <p className="text-xs text-destructive">{localError}</p>}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{text.length}/2000</span>
            <Button type="submit" size="sm" disabled={isPending || !text.trim()}>
              {isPending ? 'Saving…' : 'Add Note'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
