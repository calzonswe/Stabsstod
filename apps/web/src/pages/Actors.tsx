// Actors — plan.md §5 / M26
//
// "Stab" tab, part 3: actor analysis (aktörsanalys).
//
// - List + filter: text search over name/type/role, status filter
//   (involved / should be involved / informed).
// - Directed relations between actors with free-form relation text.
//   Adding or removing a relation writes a NEW VERSION of the actor
//   (append-only); adding a relation to an already related target updates
//   its text (upsert). Status changes are version writes too.
// - Simple node-link SVG view (no graph library, force-free: static circle
//   layout). Nodes = ALL non-retracted actors, so every relation edge
//   resolves; the relation text is drawn at the line midpoint.
//
// Permissions (can()): the record's functionId is the author's own function
// (chief/deputy → null). Members of that function edit, chief/deputy any,
// observers see only; retract = author or chief/deputy.

import { useMemo, useState } from 'react';
import type { FormEvent as ReactFormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActorStatus,
  can,
  type Actor,
  type ActorPayload,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { useActors, type ActorDraft, type ActorView } from '../hooks/useActors.js';

export interface ActorsProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
}

const STATUS_ORDER: ActorPayload['status'][] = [
  ActorStatus.involved,
  ActorStatus.shouldBeInvolved,
  ActorStatus.informed,
];

// Node fill by status (graph and list marker).
const STATUS_FILL: Record<ActorPayload['status'], string> = {
  involved: '#10b981', // emerald
  should_be_involved: '#f59e0b', // amber
  informed: '#38bdf8', // sky
};

const GRAPH = { w: 800, h: 500, radius: 170, nodeRadius: 28 } as const;

interface LiveActor {
  view: ActorView;
  payload: ActorPayload;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export default function Actors({
  store,
  incidentId,
  authorId,
  actor,
}: ActorsProps) {
  const { t } = useTranslation();
  const {
    actors,
    loading,
    error,
    createActor,
    addRelation,
    removeRelation,
    setStatus,
    retractActor,
  } = useActors(store, incidentId, authorId);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // The record's functionId is the author's own function (chief/deputy →
  // null); that is what can() gates on below.
  const myFunctionId = actor?.functionIds[0] ?? null;
  const canCreate = actor
    ? can(
        actor,
        'write',
        { entityType: 'actor', incidentId, functionId: myFunctionId },
        {},
      )
    : false;

  const live = useMemo(
    () =>
      actors
        .filter((a) => !a.retracted && a.current)
        .map((a) => ({
          view: a,
          payload: a.current!.payload as ActorPayload,
        })),
    [actors],
  );

  const nameOf = (entityId: string): string =>
    live.find((a) => a.view.entityId === entityId)?.payload.name ??
    t('actors.unknown');

  const filtered = live.filter(({ payload }) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      q === '' ||
      payload.name.toLowerCase().includes(q) ||
      payload.type.toLowerCase().includes(q) ||
      payload.role.toLowerCase().includes(q);
    const matchesStatus = statusFilter === '' || payload.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="text-center py-6 text-slate-500">{t('actors.loading')}</div>
    );
  }

  if (error) {
    return <div className="text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      {canCreate && actor && (
        <CreateActorForm onCreated={(draft) => createActor(draft, myFunctionId)} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          data-testid="actor-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('actors.filter.search')}
          className="flex-1 min-w-40 border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <select
          data-testid="actor-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          <option value="">{t('actors.filter.all')}</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {t(`actors.status.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-sm text-slate-500">{t('actors.empty')}</div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(({ view, payload }) => (
            <ActorCard
              key={view.entityId}
              view={view}
              payload={payload}
              canMaintain={
                actor
                  ? can(
                      actor,
                      'write',
                      {
                        entityType: 'actor',
                        incidentId,
                        functionId: view.functionId,
                      },
                      {},
                    )
                  : false
              }
              canRetract={
                actor
                  ? can(
                      actor,
                      'retract',
                      {
                        entityType: 'actor',
                        incidentId,
                        functionId: view.functionId,
                        authorId: view.current!.authorId,
                      },
                      {},
                    )
                  : false
              }
              others={live.filter((a) => a.view.entityId !== view.entityId)}
              nameOf={nameOf}
              onSetStatus={(s) => setStatus(view.entityId, s)}
              onAddRelation={(target, rel) => addRelation(view.entityId, target, rel)}
              onRemoveRelation={(target) => removeRelation(view.entityId, target)}
              onRetract={(reason) => retractActor(view.entityId, reason)}
            />
          ))}
        </ul>
      )}

      {/* Node-link graph (static circle layout, no graph library) */}
      <section className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">
          {t('actors.graph')}
        </h3>
        {live.length === 0 ? (
          <div className="text-sm text-slate-500">{t('actors.graph.empty')}</div>
        ) : (
          <ActorGraph actors={live} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form (one actor = one entity)
// ---------------------------------------------------------------------------

interface CreateActorFormProps {
  onCreated: (draft: ActorDraft) => Promise<void>;
}

function CreateActorForm({ onCreated }: CreateActorFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [role, setRole] = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus] = useState<ActorPayload['status']>(
    ActorStatus.involved,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: ReactFormEvent) => {
    e.preventDefault();
    if (!name.trim() || !type.trim() || !role.trim()) {
      setErr(t('actors.form.required'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      await onCreated({
        name: name.trim(),
        type: type.trim(),
        role: role.trim(),
        contact: contact.trim() || undefined,
        status,
        relations: [],
      });
      setName('');
      setType('');
      setRole('');
      setContact('');
      setStatus(ActorStatus.involved);
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
        {t('actors.create')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
        <input
          type="text"
          data-testid="actor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('actors.form.name')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <input
          type="text"
          data-testid="actor-type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder={t('actors.form.type')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <input
          type="text"
          data-testid="actor-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder={t('actors.form.role')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <input
          type="text"
          data-testid="actor-contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder={t('actors.form.contact')}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        />
        <select
          data-testid="actor-status"
          value={status}
          onChange={(e) =>
            setStatus(e.target.value as ActorPayload['status'])
          }
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {t(`actors.status.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {err && <div className="text-sm text-red-700 mt-1">{err}</div>}
      <div className="mt-2">
        <button
          type="submit"
          disabled={busy}
          className="text-sm bg-emerald-700 text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? t('actors.form.saving') : t('actors.form.save')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One card per actor: identity, status, relations, retract
// ---------------------------------------------------------------------------

interface ActorCardProps {
  view: ActorView;
  payload: ActorPayload;
  canMaintain: boolean;
  canRetract: boolean;
  others: LiveActor[];
  nameOf: (entityId: string) => string;
  onSetStatus: (status: ActorPayload['status']) => Promise<void>;
  onAddRelation: (targetActorId: string, relation: string) => Promise<void>;
  onRemoveRelation: (targetActorId: string) => Promise<void>;
  onRetract: (reason: string) => Promise<void>;
}

function ActorCard({
  view,
  payload,
  canMaintain,
  canRetract,
  others,
  nameOf,
  onSetStatus,
  onAddRelation,
  onRemoveRelation,
  onRetract,
}: ActorCardProps) {
  const { t } = useTranslation();
  const [retractOpen, setRetractOpen] = useState(false);
  const [retractReason, setRetractReason] = useState('');
  const [targetActorId, setTargetActorId] = useState(
    others[0]?.view.entityId ?? '',
  );
  const [relationText, setRelationText] = useState('');

  const addRelationSubmit = async (e: ReactFormEvent) => {
    e.preventDefault();
    if (!targetActorId || !relationText.trim()) return;
    await onAddRelation(targetActorId, relationText.trim());
    setRelationText('');
  };

  const doRetract = async () => {
    if (!retractReason.trim()) return;
    await onRetract(retractReason.trim());
  };

  return (
    <li
      data-testid={`actor-card-${view.entityId}`}
      className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900 flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: STATUS_FILL[payload.status] }}
            />
            {payload.name}
          </div>
          <div className="text-sm text-slate-600">
            {payload.type} · {payload.role}
          </div>
          {payload.contact && (
            <div className="text-sm text-slate-500">
              {t('actors.form.contact')}: {payload.contact}
            </div>
          )}
        </div>
        {canMaintain ? (
          <select
            data-testid={`actor-status-${view.entityId}`}
            value={payload.status}
            onChange={(e) =>
              void onSetStatus(e.target.value as ActorPayload['status'])
            }
            className="border border-slate-300 rounded px-2 py-1 text-sm"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t(`actors.status.${s}`)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-slate-600">
            {t(`actors.status.${payload.status}`)}
          </span>
        )}
      </div>

      {/* Relations (directed, free-form) */}
      <div>
        <div className="text-xs font-semibold text-slate-500 uppercase mb-1">
          {t('actors.relations')}
        </div>
        {payload.relations.length === 0 ? (
          <div className="text-sm text-slate-500">
            {t('actors.relationsEmpty')}
          </div>
        ) : (
          <ul className="space-y-1">
            {payload.relations.map((rel) => (
              <li
                key={rel.actorId}
                className="text-sm text-slate-700 flex items-center gap-2"
              >
                <span>
                  → <span>{nameOf(rel.actorId)}</span>{' '}
                  <span className="text-slate-500">({rel.relation})</span>
                </span>
                {canMaintain && (
                  <button
                    type="button"
                    data-testid={`actor-relation-remove-${rel.actorId}`}
                    onClick={() => void onRemoveRelation(rel.actorId)}
                    className="ml-auto text-xs text-red-700 border border-red-300 rounded px-2 py-0.5"
                  >
                    {t('actors.remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canMaintain && others.length > 0 && (
        <form
          onSubmit={addRelationSubmit}
          className="flex flex-wrap items-center gap-1"
        >
          <select
            data-testid={`actor-relation-target-${view.entityId}`}
            value={targetActorId}
            onChange={(e) => setTargetActorId(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-sm"
          >
            {others.map((o) => (
              <option key={o.view.entityId} value={o.view.entityId}>
                {o.payload.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            data-testid={`actor-relation-text-${view.entityId}`}
            value={relationText}
            onChange={(e) => setRelationText(e.target.value)}
            placeholder={t('actors.relation.text')}
            className="flex-1 min-w-24 border border-slate-300 rounded px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={!relationText.trim()}
            className="text-xs bg-slate-700 text-white rounded px-2 py-1 disabled:opacity-50"
          >
            {t('actors.relation.add')}
          </button>
        </form>
      )}

      {canRetract && (
        <div className="space-y-1 pt-1">
          <button
            type="button"
            onClick={() => setRetractOpen((v) => !v)}
            className="text-xs text-red-700 border border-red-300 rounded px-2 py-0.5"
          >
            {t('actors.remove')}
          </button>
          {retractOpen && (
            <div className="p-2 bg-red-50 border border-red-200 rounded space-y-1">
              <input
                type="text"
                value={retractReason}
                onChange={(e) => setRetractReason(e.target.value)}
                placeholder={t('actors.retract.reason')}
                className="w-full border border-red-300 rounded px-2 py-1 text-xs"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!retractReason.trim()}
                  onClick={() => void doRetract()}
                  className="text-xs bg-red-700 text-white rounded px-2 py-0.5 disabled:opacity-50"
                >
                  {t('actors.retract.confirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setRetractOpen(false)}
                  className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-0.5"
                >
                  {t('actors.retract.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Node-link SVG view — static circle layout (no graph library, force-free)
// ---------------------------------------------------------------------------

interface ActorGraphProps {
  actors: LiveActor[];
}

function ActorGraph({ actors }: ActorGraphProps) {
  const cx = GRAPH.w / 2;
  const cy = GRAPH.h / 2;

  // Circle layout: 1 node centered, 2 side by side, n ≥ 3 evenly on a circle
  // (first node at the top). Deterministic — no simulation.
  const points = actors.map((_, i) => {
    if (actors.length === 1) return { x: cx, y: cy };
    if (actors.length === 2) {
      return i === 0 ? { x: cx - 90, y: cy } : { x: cx + 90, y: cy };
    }
    const angle = (2 * Math.PI * i) / actors.length - Math.PI / 2;
    return {
      x: cx + GRAPH.radius * Math.cos(angle),
      y: cy + GRAPH.radius * Math.sin(angle),
    };
  });
  const posOf = new Map(actors.map((a, i) => [a.view.entityId, points[i]]));

  // Edges: one per relation, drawn before the nodes so the node circles
  // cover the line ends. Relations to unknown/retracted actors are skipped.
  const edges = actors.flatMap(({ view, payload }) =>
    payload.relations.map((rel) => ({
      key: `${view.entityId}:${rel.actorId}`,
      from: posOf.get(view.entityId),
      to: posOf.get(rel.actorId),
      label: rel.relation,
    })),
  );

  return (
    <svg
      data-testid="actor-graph"
      viewBox={`0 0 ${GRAPH.w} ${GRAPH.h}`}
      className="w-full h-auto border border-slate-200 rounded bg-slate-50"
    >
      {edges.map((e) => {
        if (!e.from || !e.to) return null;
        const mid = { x: (e.from.x + e.to.x) / 2, y: (e.from.y + e.to.y) / 2 };
        return (
          <g key={e.key}>
            <line
              data-testid={`actor-edge-${e.key}`}
              x1={e.from.x}
              y1={e.from.y}
              x2={e.to.x}
              y2={e.to.y}
              stroke="#94a3b8"
              strokeWidth={1.5}
            />
            <text
              x={mid.x}
              y={mid.y - 4}
              textAnchor="middle"
              fill="#475569"
              fontSize={11}
              stroke="white"
              strokeWidth={4}
              paintOrder="stroke"
            >
              {e.label}
            </text>
          </g>
        );
      })}
      {actors.map((a, i) => (
        <g key={a.view.entityId} data-testid={`actor-node-${a.view.entityId}`}>
          <circle
            cx={points[i].x}
            cy={points[i].y}
            r={GRAPH.nodeRadius}
            fill={STATUS_FILL[a.payload.status]}
            stroke="white"
            strokeWidth={2}
          />
          <text
            x={points[i].x}
            y={points[i].y + GRAPH.nodeRadius + 16}
            textAnchor="middle"
            fill="#334155"
            fontSize={12}
          >
            {truncate(a.payload.name, 18)}
          </text>
        </g>
      ))}
    </svg>
  );
}
