// Resources — plan.md §5 / M27
//
// "Stab" tab, part 4: resources, staffing and logistics (samordning).
//
// - Resource table: name, type, quantity, unit, location, status
//   (available / deployed / requested / unavailable).
// - Summary per type and per status.
// - Staffing overview: for each function, members assigned vs members on
//   duty (have a shift covering now — both boundaries inclusive).
//
// Permissions (can()): the record's functionId is the function the resource
// belongs to / is requested for. Members of that function edit,
// chief/deputy any, observers see only; retract = author or chief/deputy.

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent as ReactFormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResourceStatus,
  ResourceType,
  RESOURCE_STATUS_ORDER,
  RESOURCE_TYPE_ORDER,
  can,
  type Actor,
  type ResourcePayload,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { useResources, type ResourceDraft, type ResourceView } from '../hooks/useResources.js';

export interface ResourcesProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
  functions: { id: string; name: string }[];
  members: {
    id: string;
    username: string;
    displayName: string | null;
    role: string;
    functionIds: string[];
  }[];
}

function resourceTypeLabel(type: ResourcePayload['type'], t: (key: string) => string): string {
  return t(`resources.type.${type}`);
}

function resourceStatusLabel(status: ResourcePayload['status'], t: (key: string) => string): string {
  return t(`resources.status.${status}`);
}

export default function Resources({
  store,
  incidentId,
  authorId,
  actor,
  functions,
  members,
}: ResourcesProps) {
  const { t } = useTranslation();
  const {
    resources,
    loading,
    error,
    createResource,
    retractResource,
  } = useResources(store, incidentId, authorId);

  // The record's functionId is the author's own function (chief/deputy → null).
  const myFunctionId = actor?.functionIds[0] ?? null;
  const canCreate = actor
    ? can(
        actor,
        'write',
        { entityType: 'resource', incidentId, functionId: myFunctionId },
        {},
      )
    : false;

  const live = useMemo(
    () => resources.filter((r) => !r.retracted && r.current),
    [resources],
  );

  const canMaintain = (view: { functionId: string | null }): boolean =>
    actor
      ? can(
          actor,
          'write',
          {
            entityType: 'resource',
            incidentId,
            functionId: view.functionId,
          },
          {},
        )
      : false;

  const canRetractRes = (view: {
    functionId: string | null;
    authorId?: string;
  }): boolean =>
    actor
      ? can(
          actor,
          'retract',
          {
            entityType: 'resource',
            incidentId,
            functionId: view.functionId,
            authorId: view.authorId,
          },
          {},
        )
      : false;

  // ------------------------------------------------------------------
  // Staffing overview: functions vs members on duty
  // ------------------------------------------------------------------

  const [shiftRecords, setShiftRecords] = useState<Array<{
    entityId: string;
    functionId: string | null;
    payload: { userId: string; start: string; end: string };
  }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!store) return;
      const records = await store.getRecordsByIncident(incidentId);
      const shifts = records
        .filter((r) => r.entityType === 'shift' && r.kind === 'put')
        .map((r) => ({
          entityId: r.entityId,
          functionId: r.functionId,
          payload: r.payload as { userId: string; start: string; end: string },
        }));
      if (!cancelled) setShiftRecords(shifts);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, incidentId]);

  const now = Date.now();
  const onDutyUserIds = new Set(
    shiftRecords
      .filter((s) => Date.parse(s.payload.start) <= now && Date.parse(s.payload.end) >= now)
      .map((s) => s.payload.userId),
  );

  const staffing = functions.map((fn) => {
    const fnMembers = members.filter((m) => m.functionIds.includes(fn.id));
    const onDuty = fnMembers.filter((m) => onDutyUserIds.has(m.id)).length;
    return { fn, members: fnMembers, onDuty };
  });

  // ------------------------------------------------------------------
  // Summaries
  // ------------------------------------------------------------------

  const summaryByType = RESOURCE_TYPE_ORDER.map((type) => ({
    type,
    count: live.filter((r) => (r.current!.payload as ResourcePayload).type === type).length,
  }));
  const summaryByStatus = RESOURCE_STATUS_ORDER.map((stat) => ({
    status: stat,
    count: live.filter((r) => (r.current!.payload as ResourcePayload).status === stat).length,
  }));

  const content = (
    <div className="space-y-4">
      {canCreate && (
        <CreateResourceForm
          onCreated={(draft) => createResource(draft, myFunctionId)}
        />
      )}

      {/* Resource table */}
      <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          {t('resources.table')}
        </h2>
        {live.length === 0 ? (
          <div className="text-sm text-slate-500">{t('resources.empty')}</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left pb-2">{t('resources.col.name')}</th>
                <th className="text-left pb-2">{t('resources.col.type')}</th>
                <th className="text-left pb-2">{t('resources.col.quantity')}</th>
                <th className="text-left pb-2">{t('resources.col.unit')}</th>
                <th className="text-left pb-2">{t('resources.col.location')}</th>
                <th className="text-left pb-2">{t('resources.col.status')}</th>
                <th className="text-left pb-2">{t('resources.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {live.map((resource) => (
                <ResourceRow
                  key={resource.entityId}
                  resource={resource}
                  canMaintain={canMaintain(resource)}
                  canRetract={canRetractRes({
                    functionId: resource.functionId,
                    authorId: resource.current!.authorId,
                  })}
                  onRetract={retractResource}
                  t={t}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Summary per type and per status */}
      <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          {t('resources.summary')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              {t('resources.summaryByType')}
            </h3>
            <ul className="space-y-1">
              {summaryByType.map((s) => (
                <li key={s.type} className="text-sm flex justify-between">
                  <span>{resourceTypeLabel(s.type, t)}</span>
                  <span className="text-slate-500">{s.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              {t('resources.summaryByStatus')}
            </h3>
            <ul className="space-y-1">
              {summaryByStatus.map((s) => (
                <li key={s.status} className="text-sm flex justify-between">
                  <span>{resourceStatusLabel(s.status, t)}</span>
                  <span className="text-slate-500">{s.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Staffing overview */}
      <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          {t('resources.staffing')}
        </h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="text-left pb-2">{t('resources.col.function')}</th>
              <th className="text-left pb-2">{t('resources.col.members')}</th>
              <th className="text-left pb-2">{t('resources.col.onDuty')}</th>
            </tr>
          </thead>
          <tbody>
            {staffing.map((s) => (
              <tr key={s.fn.id} className="border-b border-slate-100">
                <td className="py-2 text-slate-800">{s.fn.name}</td>
                <td className="py-2 text-slate-700">{s.members.length}</td>
                <td className="py-2 text-slate-700">
                  {s.onDuty} / {s.members.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">
          {t('resources.staffingHint')}
        </p>
      </section>
    </div>
  );

  if (loading) {
    return <div className="text-center py-6 text-slate-500">{t('resources.loading')}</div>;
  }

  if (error) {
    return <div className="text-sm text-red-700">{error}</div>;
  }

  return content;
}

// ---------------------------------------------------------------------------
// Resource row — own component so retract state (useState) lives at hook top level
// ---------------------------------------------------------------------------

interface ResourceRowProps {
  resource: ResourceView;
  canMaintain: boolean;
  canRetract: boolean;
  onRetract: (entityId: string, reason: string) => Promise<void>;
  t: (key: string) => string;
}

function ResourceRow({
  resource,
  canMaintain,
  canRetract,
  onRetract,
  t,
}: ResourceRowProps) {
  const [retractOpen, setRetractOpen] = useState(false);
  const [retractReason, setRetractReason] = useState('');

  const payload = (resource.current!.payload as ResourcePayload);

  const doRetract = async () => {
    if (!retractReason.trim()) return;
    await onRetract(resource.entityId, retractReason.trim());
  };

  return (
    <tr
      key={resource.entityId}
      data-testid={`resource-row-${resource.entityId}`}
      className="border-b border-slate-100"
    >
      <td className="py-2 text-slate-800">{payload.name}</td>
      <td className="py-2 text-slate-700">
        {resourceTypeLabel(payload.type, t)}
      </td>
      <td className="py-2 text-slate-700">{payload.quantity}</td>
      <td className="py-2 text-slate-700">{payload.unit ?? '—'}</td>
      <td className="py-2 text-slate-700">{payload.location ?? '—'}</td>
      <td className="py-2">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
            payload.status === 'available'
              ? 'bg-emerald-100 text-emerald-700'
              : payload.status === 'deployed'
                ? 'bg-blue-100 text-blue-700'
                : payload.status === 'requested'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-700'
          }`}
        >
          {resourceStatusLabel(payload.status, t)}
        </span>
      </td>
      <td className="py-2 text-slate-700">{payload.notes ?? '—'}</td>
      <td className="py-2">
        {canMaintain && canRetract && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setRetractOpen((v) => !v)}
              data-testid={`resource-retract-toggle-${resource.entityId}`}
              className="text-xs text-red-700 border border-red-300 rounded px-2 py-0.5"
            >
              {t('resources.remove')}
            </button>
            {retractOpen && (
              <div className="p-1 bg-red-50 border border-red-200 rounded space-y-1">
                <input
                  type="text"
                  value={retractReason}
                  onChange={(e) => setRetractReason(e.target.value)}
                  placeholder={t('resources.retract.reason')}
                  className="w-full border border-red-300 rounded px-2 py-1 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!retractReason.trim()}
                    onClick={() => void doRetract()}
                    className="text-xs bg-red-700 text-white rounded px-2 py-0.5 disabled:opacity-50"
                    data-testid={`resource-retract-confirm-${resource.entityId}`}
                  >
                    {t('resources.retract.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetractOpen(false)}
                    className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-0.5"
                  >
                    {t('resources.retract.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

interface CreateResourceFormProps {
  onCreated: (draft: ResourceDraft) => Promise<void>;
}

function CreateResourceForm({ onCreated }: CreateResourceFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [type, setType] = useState<ResourcePayload['type']>(ResourceType.other);
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState<ResourcePayload['status']>(ResourceStatus.available);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: ReactFormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr(t('resources.form.required'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await onCreated({
        name: name.trim(),
        type,
        quantity,
        unit: unit.trim() || undefined,
        location: location.trim() || undefined,
        status,
        notes: notes.trim() || undefined,
      });
      setName('');
      setQuantity(1);
      setUnit('');
      setLocation('');
      setStatus(ResourceStatus.available);
      setNotes('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-slate-200 rounded-lg shadow-sm p-4"
    >
      <h3 className="text-lg font-semibold text-slate-900 mb-2">
        {t('resources.create')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
        <input
          type="text"
          data-testid="resource-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('resources.form.name')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <select
          data-testid="resource-type"
          value={type}
          onChange={(e) => setType(e.target.value as ResourcePayload['type'])}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          {RESOURCE_TYPE_ORDER.map((ty) => (
            <option key={ty} value={ty}>
              {t(`resources.type.${ty}`)}
            </option>
          ))}
        </select>
        <input
          type="number"
          data-testid="resource-quantity"
          value={quantity}
          onChange={(e) => setQuantity(Math.max(0, parseInt(e.target.value, 10) || 0))}
          placeholder={t('resources.form.quantity')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <input
          type="text"
          data-testid="resource-unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder={t('resources.form.unit')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <input
          type="text"
          data-testid="resource-location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t('resources.form.location')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <select
          data-testid="resource-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ResourcePayload['status'])}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          {RESOURCE_STATUS_ORDER.map((st) => (
            <option key={st} value={st}>
              {t(`resources.status.${st}`)}
            </option>
          ))}
        </select>
        <input
          type="text"
          data-testid="resource-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('resources.form.notes')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
      </div>
      {err && <div className="text-sm text-red-700 mt-1">{err}</div>}
      <div className="mt-2">
        <button
          type="submit"
          disabled={busy}
          className="text-sm bg-emerald-700 text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? t('resources.form.saving') : t('resources.form.save')}
        </button>
      </div>
    </form>
  );
}
