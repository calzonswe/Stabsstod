// Shifts — plan.md §5 / M25
//
// "Stab" tab, part 2: shifts and handovers (vakthållning).
//
// - "I tjänst nu" (on duty now): the shifts covering the current moment,
//   live (30 s tick), both boundaries inclusive so at the handover moment
//   both the outgoing and the incoming person are on duty.
// - Warnings (advisory, non-blocking — plan.md §10 M25): shift over 8 h,
//   overlap under 30 min, chief of staff and decision maker changing at the
//   same time, all members of a function changing at once.
// - Roster grid per function (one column per function, shifts by start).
//   Scheduling is chief/deputy only; a correction is a retract with a reason
//   (append-only).
// - Handover notes per function: everyone who can write for the function
//   summarises the most important to hand over; a note may link a shift and
//   name the person taking over.

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent as ReactFormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  can,
  collectShiftWarnings,
  onDutyNow,
  type Actor,
  type HandoverNotePayload,
  type ShiftPayload,
  type ShiftWarning,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import {
  useShifts,
  type HandoverNoteDraft,
  type ShiftDraft,
  type ShiftView,
  type HandoverNoteView,
} from '../hooks/useShifts.js';
import { Dialog } from '../components/Dialog.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

export interface MemberRef {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  functionIds: string[];
}

export interface ShiftsProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
  functions: { id: string; name: string }[];
  members: MemberRef[];
}

// The six incident roles a person holds while on the shift.
const ROLES: ShiftPayload['role'][] = [
  'chief_of_staff',
  'deputy_chief',
  'function_lead',
  'staff_member',
  'decision_maker',
  'observer',
];

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

// datetime-local value → ISO (UTC) — the input value is local time.
function localToIso(value: string): string {
  return new Date(value).toISOString();
}

export default function Shifts({
  store,
  incidentId,
  authorId,
  actor,
  functions,
  members,
}: ShiftsProps) {
  const { t } = useTranslation();
  const {
    shifts,
    notes,
    loading,
    error,
    createShift,
    retractShift,
    addNote,
    retractNote,
    refresh,
  } = useShifts(store, incidentId, authorId);

  const canSchedule = actor
    ? can(
        actor,
        'write',
        { entityType: 'shift', incidentId, functionId: null },
        {},
      )
    : false;

  // Live "now" (refreshed every 30 s).
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(
      () => setNow(new Date().toISOString()),
      30_000,
    );
    return () => clearInterval(timer);
  }, []);

  const liveShifts = useMemo(
    () =>
      shifts
        .filter((s) => !s.retracted && s.current)
        .map((s) => ({
          view: s,
          payload: s.current!.payload as ShiftPayload,
        })),
    [shifts],
  );

  const shiftInfos = useMemo(
    () =>
      liveShifts.map((s) => ({
        functionId: s.payload.functionId,
        userId: s.payload.userId,
        start: s.payload.start,
        end: s.payload.end,
        role: s.payload.role,
      })),
    [liveShifts],
  );

  const warnings = useMemo(
    () => collectShiftWarnings(shiftInfos),
    [shiftInfos],
  );
  const onDuty = useMemo(
    () => onDutyNow(shiftInfos, now),
    [shiftInfos, now],
  );

  const nameOf = (userId: string): string => {
    const m = members.find((m) => m.id === userId);
    return m ? (m.displayName ?? m.username) : userId;
  };
  const functionNameOf = (functionId: string | null): string => {
    const fn = functions.find((f) => f.id === functionId);
    return fn ? fn.name : (functionId ?? '—');
  };
  const roleLabel = (role: string): string => t(`shifts.role.${role}`);

  if (loading) {
    return <div className="text-slate-500">{t('shifts.loading')}</div>;
  }

  const shiftById = (id: string) =>
    liveShifts.find((s) => s.view.entityId === id)?.payload;

  return (
    <div className="space-y-6">
      {error && <ErrorNotice message={error} onRetry={() => void refresh()} />}

      {/* On duty now */}
      <section
        data-testid="on-duty-now"
        className="bg-white border border-emerald-200 rounded-lg shadow-sm p-4"
      >
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          {t('shifts.onDutyNow')}
        </h2>
        {onDuty.length === 0 ? (
          <div className="text-sm text-slate-500">
            {t('shifts.onDutyNowEmpty')}
          </div>
        ) : (
          <ul className="text-sm text-slate-800 space-y-1">
            {onDuty.map((info) => (
              <li
                key={`${info.functionId}:${info.userId}:${info.start}`}
              >
                <span className="font-medium">{nameOf(info.userId)}</span>
                {' — '}
                {functionNameOf(info.functionId)}
                {' '}
                <span className="text-slate-600">
                  ({roleLabel(info.role)},{formatClock(info.start)}–
                  {formatClock(info.end)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Warnings (advisory, non-blocking) */}
      {warnings.length > 0 && (
        <section
          data-testid="shift-warnings"
          className="bg-amber-50 border border-amber-300 rounded-lg p-4"
        >
          <h2 className="text-lg font-semibold text-amber-900 mb-2">
            {t('shifts.warnings')}
          </h2>
          <ul className="text-sm text-amber-900 space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="font-medium">
                  {t(warningLabelKey(w))}
                </span>
                {' '}
                {warningDetails(w, nameOf, functionNameOf, t('shifts.warning.gap'))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Schedule form (chief / deputy only) */}
      {canSchedule && (
        <ScheduleShiftForm
          functions={functions}
          members={members}
          onSubmit={async (draft) => {
            await createShift(draft);
          }}
        />
      )}

      {/* Roster grid per function */}
      <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          {t('shifts.roster')}
        </h2>
        {liveShifts.length === 0 ? (
          <div className="text-sm text-slate-500">{t('shifts.empty')}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {functions.map((fn) => {
              const fnShifts = liveShifts
                .filter((s) => s.payload.functionId === fn.id)
                .sort(
                  (a, b) =>
                    Date.parse(a.payload.start) - Date.parse(b.payload.start),
                );
              return (
                <div
                  key={fn.id}
                  data-testid={`roster-${fn.id}`}
                  className="border border-slate-200 rounded p-2"
                >
                  <h3 className="text-sm font-semibold text-slate-800 mb-1">
                    {fn.name}
                  </h3>
                  {fnShifts.length === 0 ? (
                    <div className="text-xs text-slate-500">—</div>
                  ) : (
                    <ul className="space-y-2">
                      {fnShifts.map(({ view, payload }) => (
                        <ShiftRow
                          key={view.entityId}
                          view={view}
                          payload={payload}
                          userName={nameOf(payload.userId)}
                          roleLabel={roleLabel(payload.role)}
                          canManage={canSchedule}
                          onRetract={retractShift}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Handover notes per function */}
      {functions.map((fn) => {
        const mayWriteNote = actor
          ? can(
              actor,
              'write',
              {
                entityType: 'handover_note',
                incidentId,
                functionId: fn.id,
              },
              {},
            )
          : false;
        const fnNotes = notes
          .filter(
            (n) => !n.retracted && n.current && n.functionId === fn.id,
          )
          .sort(
            (a, b) =>
              (b.current?.createdAtClient ?? '').localeCompare(
                a.current?.createdAtClient ?? '',
              ),
          );
        if (fnNotes.length === 0 && !mayWriteNote) return null;
        return (
          <section
            key={fn.id}
            data-testid={`notes-${fn.id}`}
            className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-3"
          >
            <h2 className="text-lg font-semibold text-slate-900">
              {fn.name} — {t('shifts.notes')}
            </h2>
            {fnNotes.length === 0 ? (
              <div className="text-sm text-slate-500">
                {t('shifts.notesEmpty')}
              </div>
            ) : (
              <ul className="space-y-2">
                {fnNotes.map((n) => (
                  <NoteRow
                    key={n.entityId}
                    view={n}
                    payload={n.current!.payload as HandoverNotePayload}
                    shiftLabel={(id: string) =>
                      shiftById(id)
                        ? `${nameOf(shiftById(id)!.userId)} ${formatClock(
                            shiftById(id)!.start,
                          )}`
                        : id
                    }
                    nameOf={nameOf}
                    canRetract={
                      actor
                        ? can(
                            actor,
                            'retract',
                            {
                              entityType: 'handover_note',
                              incidentId,
                              functionId: fn.id,
                              authorId: n.current!.authorId,
                            },
                            {},
                          )
                        : false
                    }
                    onRetract={retractNote}
                  />
                ))}
              </ul>
            )}
            {mayWriteNote && actor && (
              <NoteForm
                functionId={fn.id}
                authorId={actor.userId}
                shifts={liveShifts
                  .filter((s) => s.payload.functionId === fn.id)
                  .map((s) => ({
                    entityId: s.view.entityId,
                    label: `${nameOf(s.payload.userId)} ${formatClock(
                      s.payload.start,
                    )}–${formatClock(s.payload.end)}`,
                  }))}
                members={members}
                onSave={(draft) => addNote(draft, fn.id)}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function warningLabelKey(w: ShiftWarning): string {
  switch (w.kind) {
    case 'shift_over_8h':
      return 'shifts.warning.over8h';
    case 'overlap_under_30min':
      return 'shifts.warning.overlap';
    case 'chief_and_decision_maker_changing_at_once':
      return 'shifts.warning.chiefDecision';
    case 'whole_function_changing_at_once':
      return 'shifts.warning.wholeFunction';
  }
}

function warningDetails(
  w: ShiftWarning,
  nameOf: (id: string) => string,
  functionNameOf: (id: string | null) => string,
  gapWord: string,
): string {
  switch (w.kind) {
    case 'shift_over_8h':
      return `${nameOf(w.userId)} ${formatWhen(w.start)}–${formatWhen(w.end)}`;
    case 'overlap_under_30min':
      return `${nameOf(w.firstUserId)} → ${nameOf(w.secondUserId)} ${formatWhen(w.time)} (${
        w.overlapMs < 0 ? gapWord : `${Math.round(w.overlapMs / 60_000)} min`
      })`;
    case 'chief_and_decision_maker_changing_at_once':
      return formatWhen(w.time);
    case 'whole_function_changing_at_once':
      return `${functionNameOf(w.functionId)} ${formatWhen(w.time)}`;
  }
}

// ---------------------------------------------------------------------------
// Schedule form (chief / deputy only)
// ---------------------------------------------------------------------------

interface ScheduleShiftFormProps {
  functions: { id: string; name: string }[];
  members: MemberRef[];
  onSubmit: (draft: ShiftDraft) => Promise<void>;
}

function ScheduleShiftForm({
  functions,
  members,
  onSubmit,
}: ScheduleShiftFormProps) {
  const { t } = useTranslation();
  const [functionId, setFunctionId] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ShiftPayload['role']>('staff_member');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: ReactFormEvent) => {
    e.preventDefault();
    if (!functionId || !userId || !start || !end) {
      setErr(t('shifts.form.required'));
      return;
    }
    if (Date.parse(localToIso(end)) <= Date.parse(localToIso(start))) {
      setErr(t('shifts.form.endAfterStart'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await onSubmit({
        functionId,
        userId,
        start: localToIso(start),
        end: localToIso(end),
        role,
      });
      setFunctionId('');
      setUserId('');
      setRole('staff_member');
      setStart('');
      setEnd('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-3"
    >
      <h2 className="text-lg font-semibold text-slate-900">
        {t('shifts.schedule')}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('shifts.form.function')}
          </span>
          <select
            data-testid="schedule-function"
            value={functionId}
            onChange={(e) => setFunctionId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1 bg-white"
          >
            <option value="">—</option>
            {functions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('shifts.form.user')}
          </span>
          <select
            data-testid="schedule-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1 bg-white"
          >
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName ?? m.username}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('shifts.form.role')}
          </span>
          <select
            data-testid="schedule-role"
            value={role}
            onChange={(e) =>
              setRole(e.target.value as ShiftPayload['role'])
            }
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1 bg-white"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`shifts.role.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('shifts.form.start')}
          </span>
          <input
            data-testid="schedule-start"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('shifts.form.end')}
          </span>
          <input
            data-testid="schedule-end"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
          />
        </label>
      </div>
      {err && <div className="text-sm text-red-700">{err}</div>}
      <div>
        <button
          type="submit"
          disabled={busy}
          className="bg-blue-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
        >
          {busy ? t('shifts.form.saving') : t('shifts.form.save')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One shift in the roster (with retract-with-reason for chief/deputy)
// ---------------------------------------------------------------------------

interface ShiftRowProps {
  view: ShiftView;
  payload: ShiftPayload;
  userName: string;
  roleLabel: string;
  canManage: boolean;
  onRetract: (entityId: string, reason: string) => Promise<void>;
}

function ShiftRow({
  view,
  payload,
  userName,
  roleLabel,
  canManage,
  onRetract,
}: ShiftRowProps) {
  const { t } = useTranslation();
  const [retractOpen, setRetractOpen] = useState(false);
  const [retractReason, setRetractReason] = useState('');

  const doRetract = async () => {
    if (!retractReason.trim()) return;
    await onRetract(view.entityId, retractReason.trim());
  };

  return (
    <li
      data-testid={`shift-row-${view.entityId}`}
      className="text-sm border-b border-slate-100 pb-1"
    >
      <div className="font-medium text-slate-800">
        {userName}{' '}
        <span className="text-slate-500 font-normal">({roleLabel})</span>
      </div>
      <div className="text-slate-700">
        {formatWhen(payload.start)} – {formatWhen(payload.end)}{' '}
        <span className="text-slate-500">
          ({formatDuration(Date.parse(payload.end) - Date.parse(payload.start))})
        </span>
      </div>
      {canManage && (
        <div className="mt-1 space-y-1">
          <button
            type="button"
            onClick={() => setRetractOpen((v) => !v)}
            className="text-xs text-red-700 border border-red-300 rounded px-2 py-0.5"
          >
            {t('shifts.remove')}
          </button>
          {retractOpen && (
            <Dialog title={t('shifts.retract.title')} onClose={() => setRetractOpen(false)}>
              <div className="space-y-2">
                <input
                  type="text"
                  value={retractReason}
                  onChange={(e) => setRetractReason(e.target.value)}
                  placeholder={t('shifts.retract.reason')}
                  aria-label={t('shifts.retract.reason')}
                  className="w-full border border-red-300 rounded px-2 py-1 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!retractReason.trim()}
                    onClick={() => void doRetract()}
                    className="text-xs bg-red-700 text-white rounded px-2 py-0.5 disabled:opacity-50"
                  >
                    {t('shifts.retract.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetractOpen(false)}
                    className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-0.5"
                  >
                    {t('shifts.retract.cancel')}
                  </button>
                </div>
              </div>
            </Dialog>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Handover notes: one row per note, one form per writable function
// ---------------------------------------------------------------------------

interface NoteRowProps {
  view: HandoverNoteView;
  payload: HandoverNotePayload;
  shiftLabel: (id: string) => string;
  nameOf: (id: string) => string;
  canRetract: boolean;
  onRetract: (entityId: string, reason: string) => Promise<void>;
}

function NoteRow({
  view,
  payload,
  shiftLabel,
  nameOf,
  canRetract,
  onRetract,
}: NoteRowProps) {
  const { t } = useTranslation();
  const [retractOpen, setRetractOpen] = useState(false);
  const [retractReason, setRetractReason] = useState('');

  const doRetract = async () => {
    if (!retractReason.trim()) return;
    await onRetract(view.entityId, retractReason.trim());
  };

  return (
    <li
      data-testid={`note-${view.entityId}`}
      className="border border-slate-200 rounded p-2 text-sm bg-slate-50"
    >
      <div className="text-slate-800">
        <span className="font-medium">{nameOf(payload.fromUserId)}</span>
        {' → '}
        {payload.toUserId ? nameOf(payload.toUserId) : t('shifts.note.unspecified')}
        {' · '}
        <span className="text-slate-600">
          {payload.shiftId ? shiftLabel(payload.shiftId) : t('shifts.note.standalone')}
        </span>
      </div>
      <div className="text-slate-800 whitespace-pre-wrap">{payload.text}</div>
      <div className="text-xs text-slate-500">
        {formatWhen(view.current!.createdAtClient)}
      </div>
      {canRetract && (
        <div className="mt-1 space-y-1">
          <button
            type="button"
            onClick={() => setRetractOpen((v) => !v)}
            className="text-xs text-red-700 border border-red-300 rounded px-2 py-0.5"
          >
            {t('shifts.remove')}
          </button>
          {retractOpen && (
            <Dialog title={t('shifts.retract.title')} onClose={() => setRetractOpen(false)}>
              <div className="space-y-2">
                <input
                  type="text"
                  value={retractReason}
                  onChange={(e) => setRetractReason(e.target.value)}
                  placeholder={t('shifts.retract.reason')}
                  aria-label={t('shifts.retract.reason')}
                  className="w-full border border-red-300 rounded px-2 py-1 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!retractReason.trim()}
                    onClick={() => void doRetract()}
                    className="text-xs bg-red-700 text-white rounded px-2 py-0.5 disabled:opacity-50"
                  >
                    {t('shifts.retract.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetractOpen(false)}
                    className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-0.5"
                  >
                    {t('shifts.retract.cancel')}
                  </button>
                </div>
              </div>
            </Dialog>
          )}
        </div>
      )}
    </li>
  );
}

interface NoteFormProps {
  functionId: string;
  authorId: string;
  shifts: { entityId: string; label: string }[];
  members: MemberRef[];
  onSave: (draft: HandoverNoteDraft, functionId: string) => Promise<void>;
}

function NoteForm({
  functionId,
  authorId,
  shifts,
  members,
  onSave,
}: NoteFormProps) {
  const { t } = useTranslation();
  const [shiftId, setShiftId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: ReactFormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setErr(t('shifts.noteForm.required'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await onSave(
        {
          ...(shiftId ? { shiftId } : {}),
          fromUserId: authorId,
          ...(toUserId ? { toUserId } : {}),
          text: text.trim(),
        },
        functionId,
      );
      setShiftId('');
      setToUserId('');
      setText('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="border border-slate-300 rounded p-3 space-y-2 bg-slate-50"
    >
      <h4 className="text-sm font-semibold text-slate-800">
        {t('shifts.noteForm.title')}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('shifts.noteForm.shift')}
          </span>
          <select
            data-testid={`note-shift-${functionId}`}
            value={shiftId}
            onChange={(e) => setShiftId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1 bg-white"
          >
            <option value="">—</option>
            {shifts.map((s) => (
              <option key={s.entityId} value={s.entityId}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('shifts.noteForm.to')}
          </span>
          <select
            data-testid={`note-to-${functionId}`}
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1 bg-white"
          >
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName ?? m.username}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">
          {t('shifts.noteForm.text')}
        </span>
        <textarea
          data-testid={`note-text-${functionId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={t('shifts.noteForm.textPlaceholder')}
          className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
        />
      </label>
      {err && <div className="text-sm text-red-700">{err}</div>}
      <div>
        <button
          type="submit"
          disabled={busy}
          className="text-sm bg-blue-700 text-white rounded px-3 py-1 disabled:opacity-50"
        >
          {busy ? t('shifts.noteForm.saving') : t('shifts.noteForm.save')}
        </button>
      </div>
    </form>
  );
}
