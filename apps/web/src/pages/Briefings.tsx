// Briefings — plan.md §5 / M24
//
// "Stab" tab, part 1: staff briefings (stabsorientering) on an operative
// rhythm.
//
// - The chief of staff (or deputy) schedules a single or recurring briefing;
//   the agenda pre-fills from the template for the kind (plan.md §7).
// - Each function pre-fills its report before the briefing: the four
//   prepare-questions of the handbook (done / planned / challenges /
//   collaboration needs). The report form is shown per own function.
// - The briefing view runs the meeting: agenda, reports side by side, and a
//   minutes box (new version on save).
// - A live countdown to the next planned occurrence (recurring briefings
//   expand through shared briefingOccurrences / nextBriefingTime).
//
// Permissions (can()): briefings = chief/deputy only; briefing_report =
// members of the reporting function (chief/deputy: any function).

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent as ReactFormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BriefingStatus,
  can,
  getTemplate,
  nextBriefingTime,
  type Actor,
  type BriefingPayload,
  type BriefingReportPayload,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import {
  useBriefings,
  type BriefingDraft,
  type BriefingView,
  type ReportDraft,
  type ReportView,
} from '../hooks/useBriefings.js';

export interface BriefingsProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
  functions: { id: string; name: string }[];
}

const KIND_TEMPLATE: Record<BriefingPayload['kind'], string | null> = {
  first_gathering: 'first_gathering_agenda',
  first_briefing: 'first_staff_briefing_agenda',
  recurring: 'recurring_briefing_agenda',
  other: null,
};

function templateFor(
  kind: BriefingPayload['kind'],
  lng: string,
): string[] {
  const id = KIND_TEMPLATE[kind];
  if (!id) return [];
  const tpl = getTemplate(id);
  return tpl ? tpl[lng === 'en' ? 'en' : 'sv'] : [];
}

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

function formatCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// datetime-local value → ISO (UTC) — the input value is local time.
function localToIso(value: string): string {
  return new Date(value).toISOString();
}

interface ScheduleFormState {
  title: string;
  scheduledAt: string; // datetime-local value
  kind: BriefingPayload['kind'];
  agendaText: string; // one agenda item per line
  recurring: boolean;
  intervalHours: string;
  maxCount: string;
  endsAt: string; // datetime-local value, optional
}

function initialScheduleForm(lng: string): ScheduleFormState {
  return {
    title: '',
    scheduledAt: '',
    kind: 'recurring',
    // Pre-fill the agenda from the template for the default kind.
    agendaText: templateFor('recurring', lng).join('\n'),
    recurring: false,
    intervalHours: '2',
    maxCount: '',
    endsAt: '',
  };
}

export default function Briefings({
  store,
  incidentId,
  authorId,
  actor,
  functions,
}: BriefingsProps) {
  const { t, i18n } = useTranslation();
  const {
    briefings,
    reports,
    loading,
    error,
    createBriefing,
    editBriefing,
    retractBriefing,
    saveReport,
  } = useBriefings(store, incidentId, authorId);

  const canSchedule = actor
    ? can(
        actor,
        'write',
        { entityType: 'briefing', incidentId, functionId: null },
        {},
      )
    : false;

  // Live "now" for the countdown (refreshed every 30 s).
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(
      () => setNow(new Date().toISOString()),
      30_000,
    );
    return () => clearInterval(timer);
  }, []);

  const liveBriefings = useMemo(
    () =>
      briefings
        .filter((b) => !b.retracted && b.current)
        .map((b) => ({
          view: b,
          payload: b.current!.payload as BriefingPayload,
        })),
    [briefings],
  );

  const next = useMemo(
    () =>
      nextBriefingTime(
        liveBriefings.map((b) => ({
          id: b.view.entityId,
          scheduledAt: b.payload.scheduledAt,
          status: b.payload.status,
          recurrence: b.payload.recurrence,
        })),
        now,
      ),
    [liveBriefings, now],
  );

  if (loading) {
    return <div className="text-slate-500">{t('briefings.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-red-700">{error}</div>}

      {/* Countdown to the next planned briefing. */}
      {next && (
        <div className="bg-white border border-blue-200 rounded-lg shadow-sm p-4">
          <div className="text-sm font-medium text-blue-900">
            {t('briefings.next')}
          </div>
          <div className="text-lg text-blue-900">
            {t('briefings.nextIn')} {formatCountdown(new Date(next.time).getTime() - new Date(now).getTime())}
            {' · '}
            {formatWhen(next.time)} ({formatClock(next.time)})
          </div>
        </div>
      )}

      {canSchedule && (
        <ScheduleForm
          key={incidentId}
          lng={i18n.language}
          saving={false}
          onSubmit={async (draft) => {
            await createBriefing(draft);
          }}
        />
      )}

      {liveBriefings.length === 0 && (
        <div className="text-slate-500">{t('briefings.empty')}</div>
      )}

      {[...liveBriefings]
        .sort(
          (a, b) =>
            new Date(a.payload.scheduledAt).getTime() -
            new Date(b.payload.scheduledAt).getTime(),
        )
        .map(({ view, payload }) => (
          <BriefingCard
            key={view.entityId}
            view={view}
            payload={payload}
            canManage={canSchedule}
            functions={functions}
            actor={actor}
            incidentId={incidentId}
            reports={reports}
            onEdit={editBriefing}
            onRetract={retractBriefing}
            onSaveReport={saveReport}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule form (chief / deputy only)
// ---------------------------------------------------------------------------

interface ScheduleFormProps {
  lng: string;
  saving: boolean;
  onSubmit: (draft: BriefingDraft) => Promise<void>;
}

function ScheduleForm({ lng, saving, onSubmit }: ScheduleFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ScheduleFormState>(() =>
    initialScheduleForm(lng),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const setKind = (kind: BriefingPayload['kind']) => {
    setForm((f) => ({
      ...f,
      kind,
      // Pre-fill the agenda from the template for the kind.
      agendaText: templateFor(kind, lng).join('\n'),
    }));
  };

  const submit = async (e: ReactFormEvent) => {
    e.preventDefault();
    const agenda = form.agendaText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (!form.title.trim() || !form.scheduledAt || agenda.length === 0) {
      setErr(t('briefings.form.required'));
      return;
    }
    const draft: BriefingDraft = {
      title: form.title.trim(),
      scheduledAt: localToIso(form.scheduledAt),
      kind: form.kind,
      agenda,
      status: BriefingStatus.planned,
      ...(form.recurring
        ? {
            recurrence: {
              intervalHours: Math.max(1, Math.round(Number(form.intervalHours) || 1)),
              ...(form.maxCount.trim()
                ? {
                    maxCount: Math.max(
                      1,
                      Math.round(Number(form.maxCount) || 1),
                    ),
                  }
                : {}),
              ...(form.endsAt ? { endsAt: localToIso(form.endsAt) } : {}),
            },
          }
        : {}),
    };
    setBusy(true);
    try {
      await onSubmit(draft);
      setForm(initialScheduleForm(lng));
      setErr('');
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
        {t('briefings.schedule')}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('briefings.form.title')}
          </span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={t('briefings.form.titlePlaceholder')}
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('briefings.form.scheduledAt')}
          </span>
          <input
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">
            {t('briefings.form.kind')}
          </span>
          <select
            value={form.kind}
            onChange={(e) =>
              setKind(e.target.value as BriefingPayload['kind'])
            }
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1 bg-white"
          >
            <option value="first_gathering">
              {t('briefings.kind.first_gathering')}
            </option>
            <option value="first_briefing">
              {t('briefings.kind.first_briefing')}
            </option>
            <option value="recurring">
              {t('briefings.kind.recurring')}
            </option>
            <option value="other">{t('briefings.kind.other')}</option>
          </select>
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.recurring}
              onChange={(e) =>
                setForm({ ...form, recurring: e.target.checked })
              }
            />
            {t('briefings.form.recurring')}
          </label>
          {form.recurring && (
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-xs">
                <span className="text-slate-600">
                  {t('briefings.form.intervalHours')}
                </span>
                <input
                  type="number"
                  min={1}
                  value={form.intervalHours}
                  onChange={(e) =>
                    setForm({ ...form, intervalHours: e.target.value })
                  }
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
                />
              </label>
              <label className="block text-xs">
                <span className="text-slate-600">
                  {t('briefings.form.maxCount')}
                </span>
                <input
                  type="number"
                  min={1}
                  value={form.maxCount}
                  onChange={(e) =>
                    setForm({ ...form, maxCount: e.target.value })
                  }
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
                />
              </label>
              <label className="block text-xs">
                <span className="text-slate-600">
                  {t('briefings.form.endsAt')}
                </span>
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(e) =>
                    setForm({ ...form, endsAt: e.target.value })
                  }
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
                />
              </label>
            </div>
          )}
        </div>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">
          {t('briefings.form.agenda')}
        </span>
        <textarea
          value={form.agendaText}
          onChange={(e) => setForm({ ...form, agendaText: e.target.value })}
          rows={6}
          placeholder={t('briefings.form.agendaPlaceholder')}
          className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
        />
      </label>
      {err && <div className="text-sm text-red-700">{err}</div>}
      <div>
        <button
          type="submit"
          disabled={busy || saving}
          className="bg-blue-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
        >
          {busy || saving ? t('briefings.form.saving') : t('briefings.form.save')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Briefing card: agenda, minutes box, reports side by side, report forms
// ---------------------------------------------------------------------------

interface BriefingCardProps {
  view: BriefingView;
  payload: BriefingPayload;
  canManage: boolean;
  functions: { id: string; name: string }[];
  actor: Actor | null;
  incidentId: string;
  reports: ReportView[];
  onEdit: (entityId: string, draft: BriefingDraft) => Promise<void>;
  onRetract: (entityId: string, reason: string) => Promise<void>;
  onSaveReport: (
    briefingId: string,
    functionId: string | null,
    draft: ReportDraft,
  ) => Promise<void>;
}

function BriefingCard({
  view,
  payload,
  canManage,
  functions,
  actor,
  incidentId,
  reports,
  onEdit,
  onRetract,
  onSaveReport,
}: BriefingCardProps) {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState(payload.minutes ?? '');
  const [minutesBusy, setMinutesBusy] = useState(false);
  const [retractOpen, setRetractOpen] = useState(false);
  const [retractReason, setRetractReason] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);

  const setStatus = async (status: BriefingPayload['status']) => {
    setStatusBusy(true);
    try {
      await onEdit(view.entityId, { ...payload, status, minutes: payload.minutes });
    } finally {
      setStatusBusy(false);
    }
  };

  const saveMinutes = async () => {
    setMinutesBusy(true);
    try {
      await onEdit(view.entityId, { ...payload, minutes });
    } finally {
      setMinutesBusy(false);
    }
  };

  const doRetract = async () => {
    if (!retractReason.trim()) return;
    await onRetract(view.entityId, retractReason.trim());
  };

  const briefingReports = reports.filter(
    (r) => r.briefingId === view.entityId && !r.retracted && r.current,
  );
  const reportFor = (functionId: string): ReportView | undefined =>
    briefingReports.find((r) => r.functionId === functionId);

  const myFunctionIds = actor?.functionIds ?? [];

  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-slate-900">
          {payload.title}
        </h3>
        <span className="text-sm text-slate-600">
          {t(`briefings.kind.${payload.kind}`)}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${
            payload.status === 'planned'
              ? 'bg-blue-50 text-blue-800 border-blue-200'
              : payload.status === 'held'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {t(`briefings.status.${payload.status}`)}
        </span>
        <span className="text-sm text-slate-600">
          {formatWhen(payload.scheduledAt)}
        </span>
        {payload.recurrence && (
          <span className="text-xs text-slate-500">
            {t('briefings.recurrenceEvery')}{' '}
            {payload.recurrence.intervalHours}{' '}
            {t('briefings.recurrenceHours')}
            {payload.recurrence.maxCount
              ? ` · ${t('briefings.recurrenceMax')} ${payload.recurrence.maxCount}`
              : ''}
            {payload.recurrence.endsAt
              ? ` · ${t('briefings.recurrenceUntil')} ${formatWhen(payload.recurrence.endsAt)}`
              : ''}
          </span>
        )}
        {canManage && (
          <div className="ml-auto flex gap-2">
            {payload.status === 'planned' && (
              <button
                type="button"
                disabled={statusBusy}
                onClick={() => void setStatus(BriefingStatus.held)}
                className="text-sm text-emerald-800 border border-emerald-300 rounded px-2 py-1 disabled:opacity-50"
              >
                {t('briefings.markHeld')}
              </button>
            )}
            {payload.status === 'planned' && (
              <button
                type="button"
                disabled={statusBusy}
                onClick={() => void setStatus(BriefingStatus.cancelled)}
                className="text-sm text-slate-600 border border-slate-300 rounded px-2 py-1 disabled:opacity-50"
              >
                {t('briefings.cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setRetractOpen((v) => !v)}
              className="text-sm text-red-700 border border-red-300 rounded px-2 py-1"
            >
              {t('briefings.remove')}
            </button>
          </div>
        )}
      </header>

      {retractOpen && (
        <div className="p-3 bg-red-50 border border-red-200 rounded space-y-2">
          <div className="text-sm font-medium text-red-900">
            {t('briefings.retract.reason')}
          </div>
          <input
            type="text"
            value={retractReason}
            onChange={(e) => setRetractReason(e.target.value)}
            placeholder={t('briefings.retract.reason')}
            className="w-full border border-red-300 rounded px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!retractReason.trim()}
              onClick={() => void doRetract()}
              className="text-sm bg-red-700 text-white rounded px-3 py-1 disabled:opacity-50"
            >
              {t('briefings.retract.confirm')}
            </button>
            <button
              type="button"
              onClick={() => setRetractOpen(false)}
              className="text-sm text-slate-600 border border-slate-300 rounded px-3 py-1"
            >
              {t('briefings.retract.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Agenda */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-1">
          {t('briefings.agenda')}
        </h4>
        <ol className="list-decimal list-inside text-sm text-slate-800 space-y-0.5">
          {payload.agenda.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      </div>

      {/* Minutes box */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-1">
          {t('briefings.minutes')}
        </h4>
        {canManage ? (
          <div className="space-y-2">
            <textarea
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              rows={3}
              placeholder={t('briefings.minutesPlaceholder')}
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={minutesBusy}
                onClick={() => void saveMinutes()}
                className="text-sm bg-blue-700 text-white rounded px-3 py-1 disabled:opacity-50"
              >
                {minutesBusy ? t('briefings.form.saving') : t('briefings.saveMinutes')}
              </button>
              <span className="text-xs text-slate-500">
                {t('briefings.minutesReminder')}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-600 whitespace-pre-wrap">
            {payload.minutes || t('briefings.minutesEmpty')}
          </div>
        )}
      </div>

      {/* Reports side by side (one per function) */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2">
          {t('briefings.reports')}
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {functions.map((fn) => {
            const rep = reportFor(fn.id);
            const p = rep?.current
              ? (rep.current.payload as BriefingReportPayload)
              : null;
            return (
              <div
                key={fn.id}
                className="border border-slate-200 rounded p-2 text-sm bg-slate-50"
              >
                <div className="font-medium text-slate-800 mb-1">
                  {fn.name}
                </div>
                {p ? (
                  <dl className="space-y-1 text-slate-700">
                    <ReportLine label={t('briefings.report.done')} value={p.done} />
                    <ReportLine
                      label={t('briefings.report.planned')}
                      value={p.planned}
                    />
                    <ReportLine
                      label={t('briefings.report.challenges')}
                      value={p.challenges}
                    />
                    <ReportLine
                      label={t('briefings.report.collaborationNeeds')}
                      value={p.collaborationNeeds}
                    />
                  </dl>
                ) : (
                  <div className="text-slate-500">
                    {t('briefings.report.missing')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Report forms — one per own function (members of the reporting
          function may write; chief/deputy any function). */}
      {actor &&
        myFunctionIds.map((fnId) => {
          const fn = functions.find((f) => f.id === fnId);
          const mayWrite = can(
            actor,
            'write',
            {
              entityType: 'briefing_report',
              incidentId,
              functionId: fnId,
            },
            {},
          );
          if (!mayWrite || !fn) return null;
          const existing = reportFor(fnId);
          const existingPayload = existing?.current
            ? (existing.current.payload as BriefingReportPayload)
            : null;
          return (
            <ReportForm
              key={fnId}
              briefingId={view.entityId}
              functionId={fnId}
              functionName={fn.name}
              initial={
                existingPayload
                  ? {
                      done: existingPayload.done,
                      planned: existingPayload.planned,
                      challenges: existingPayload.challenges,
                      collaborationNeeds:
                        existingPayload.collaborationNeeds,
                    }
                  : { done: '', planned: '', challenges: '', collaborationNeeds: '' }
              }
              onSave={onSaveReport}
            />
          );
        })}
    </section>
  );
}

function ReportLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-medium text-slate-500">{label}: </dt>
      <dd className="inline text-slate-800">{value || '—'}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report form (per own function): the four prepare-questions of the handbook
// ---------------------------------------------------------------------------

interface ReportFormProps {
  briefingId: string;
  functionId: string;
  functionName: string;
  initial: ReportDraft;
  onSave: (
    briefingId: string,
    functionId: string | null,
    draft: ReportDraft,
  ) => Promise<void>;
}

function ReportForm({
  briefingId,
  functionId,
  functionName,
  initial,
  onSave,
}: ReportFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ReportDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: ReactFormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await onSave(briefingId, functionId, draft);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    key: keyof ReportDraft,
    placeholder: string,
  ) => (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <textarea
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        rows={2}
        placeholder={placeholder}
        data-testid={`report-${functionId}-${key}`}
        className="mt-1 w-full border border-slate-300 rounded px-2 py-1"
      />
    </label>
  );

  return (
    <form
      onSubmit={submit}
      className="border border-slate-300 rounded p-3 space-y-2 bg-slate-50"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-800">
          {t('briefings.reportForm.title')} — {functionName}
        </h4>
        <button
          type="submit"
          disabled={busy}
          className="text-sm bg-blue-700 text-white rounded px-3 py-1 disabled:opacity-50"
        >
          {busy ? t('briefings.form.saving') : t('briefings.reportForm.save')}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {field(
          t('briefings.report.done'),
          'done',
          t('briefings.report.donePlaceholder'),
        )}
        {field(
          t('briefings.report.planned'),
          'planned',
          t('briefings.report.plannedPlaceholder'),
        )}
        {field(
          t('briefings.report.challenges'),
          'challenges',
          t('briefings.report.challengesPlaceholder'),
        )}
        {field(
          t('briefings.report.collaborationNeeds'),
          'collaborationNeeds',
          t('briefings.report.collaborationNeedsPlaceholder'),
        )}
      </div>
      {err && <div className="text-sm text-red-700">{err}</div>}
    </form>
  );
}
