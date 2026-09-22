import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, FileText, LoaderCircle, LockKeyhole } from 'lucide-react';
import { MAX_PRIVATE_NOTE_BYTES, privateNoteByteLength } from '../packages/stellar-core/src/privateNote';
import type { PrivateNoteRevision } from '../packages/stellar-core/src/privateNote';

interface Props {
  note: PrivateNoteRevision | null;
  busy: boolean;
  onSave?: (text: string) => Promise<void>;
  locked?: boolean;
  allowConceal?: boolean;
  printIncluded?: boolean;
}

export default function PrivateNoteCard({ note, busy, onSave, locked = false, allowConceal = true, printIncluded = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note?.text ?? '');
  const [concealed, setConcealed] = useState(false);
  const bytes = useMemo(() => privateNoteByteLength(draft.trim()), [draft]);
  const valid = draft.trim().length > 0 && bytes <= MAX_PRIVATE_NOTE_BYTES;

  useEffect(() => {
    if (!editing) setDraft(note?.text ?? '');
  }, [note?.revisionId, editing]);

  useEffect(() => {
    setConcealed(false);
  }, [note?.revisionId]);

  async function save() {
    if (!valid || busy || locked || !onSave) return;
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // The parent surfaces the API error. Keep the editor open so the draft is not lost.
    }
  }

  if (!note && !editing) {
    return (
      <section className="rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-lg bg-black/5 p-2 text-neutral-600 dark:bg-white/10 dark:text-neutral-300"><FileText className="h-4 w-4" /></div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Private Note</div>
              <p className="mt-0.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Optional private context for this proposal.</p>
            </div>
          </div>
          {locked ? <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-500/10 px-2.5 py-1 text-xs font-semibold text-neutral-600 dark:text-neutral-300"><LockKeyhole className="h-3.5 w-3.5" />Read-only</span> : onSave && <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold dark:border-white/10">Add note</button>}
        </div>
      </section>
    );
  }

  return (
    <section
      data-private-note-print={printIncluded ? 'include' : 'exclude'}
      className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="shrink-0 self-start rounded-xl bg-black/5 p-2.5 text-neutral-600 dark:bg-white/10 dark:text-neutral-300"><FileText className="h-5 w-5" /></div>
          <div className="min-w-0">
            <div className="font-semibold">Private Note</div>
            <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Private context shared with this proposal.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!editing && allowConceal && note && (
            <button
              type="button"
              onClick={() => setConcealed((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold dark:border-white/10"
              aria-label={concealed ? 'Show Private Note on screen' : 'Hide Private Note on screen'}
              title={concealed ? 'Show Private Note' : 'Hide Private Note'}
            >
              {concealed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {concealed ? 'Show' : 'Hide'}
            </button>
          )}
          {!editing && (locked ? <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-500/10 px-3 py-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300"><LockKeyhole className="h-3.5 w-3.5" />Read-only</span> : onSave && <button type="button" onClick={() => setEditing(true)} className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold dark:border-white/10">Revise</button>)}
        </div>
      </div>

      {!editing && note && (
        <div className={`mt-4 rounded-xl p-4 ${locked ? 'border border-black/5 bg-black/[0.018] dark:border-white/10 dark:bg-white/[0.025]' : 'bg-black/[0.035] dark:bg-white/[0.04]'}`}>
          {concealed ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400"><EyeOff className="h-4 w-4" />Private Note hidden on screen.</div>
          ) : (
            <div className="whitespace-pre-wrap break-words text-sm leading-6">{note.text}</div>
          )}
          <div className="mt-2 text-xs text-neutral-400">Added {new Date(note.createdAt).toLocaleString()}</div>
        </div>
      )}

      {editing && (
        <div className="mt-4">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} placeholder="Why are we doing this transaction?" className="w-full resize-y rounded-xl border border-black/10 bg-transparent p-3 text-sm leading-6 outline-none focus:border-emerald-500 dark:border-white/10" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className={`text-xs ${bytes > MAX_PRIVATE_NOTE_BYTES ? 'font-semibold text-red-700 dark:text-red-300' : 'text-neutral-400'}`}>{bytes}/{MAX_PRIVATE_NOTE_BYTES} bytes</div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => { setEditing(false); setDraft(note?.text ?? ''); }} className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-white/10">Cancel</button>
              <button type="button" disabled={!valid || busy} onClick={() => void save()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}Save revision</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
