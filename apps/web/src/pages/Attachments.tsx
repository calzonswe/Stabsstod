// Attachments — plan.md §5.6 / M28
//
// Upload files (any type) to the incident. Files are hashed client-side
// (sha256 via crypto.subtle), queued in Dexie `blobs` while offline, and
// uploaded to POST /api/attachments when connected. Each attachment is a
// versioned record that can be linked to entities via linkedEntityIds.
//
// Permissions (can()): the record's functionId is the author's own function
// (chief/deputy → null). Members of that function upload, chief/deputy any,
// observers see only; retract = author or chief/deputy.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, type Actor, type AttachmentPayload } from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { useAttachments, type AttachmentView } from '../hooks/useAttachments.js';
import { Dialog } from '../components/Dialog.js';
import { ErrorNotice } from '../components/ErrorNotice.js';

export interface AttachmentsProps {
  store: LocalStore | null;
  incidentId: string;
  authorId: string;
  actor: Actor | null;
}

const MAX_PREVIEW = 10 * 1024 * 1024; // 10 MB preview limit

function mimeIsImage(mime: string): boolean {
  return mime.startsWith('image/');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Attachments({
  store,
  incidentId,
  authorId,
  actor,
}: AttachmentsProps) {
  const { t } = useTranslation();
  const {
    attachments,
    uploads,
    loading,
    error,
    addAttachment,
    getAttachmentBytes,
    uploadPending,
    retractAttachment,
    refresh,
  } = useAttachments(store, incidentId, authorId);

  const [file, setFile] = useState<File | null>(null);
  const [retractFor, setRetractFor] = useState<string | null>(null);
  const [retractReason, setRetractReason] = useState('');
  const [linkedEntityIds, setLinkedEntityIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // The record's functionId is the author's own function (chief/deputy → null).
  const myFunctionId = actor?.functionIds[0] ?? null;
  const canUpload = actor
    ? can(
        actor,
        'write',
        { entityType: 'attachment', incidentId, functionId: myFunctionId },
        {},
      )
    : false;

  const live = useMemo(
    () => attachments.filter((a) => !a.retracted),
    [attachments],
  );

  const canRetract = (view: AttachmentView): boolean =>
    actor
      ? can(
          actor,
          'retract',
          {
            entityType: 'attachment',
            incidentId,
            functionId: view.functionId,
            authorId: view.current!.authorId,
          },
          {},
        )
      : false;

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0] ?? null;
      setFile(f);
      setErr('');
      if (f) {
        // Revoke previous preview URL.
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
        setPreviewUrl(null);
        if (mimeIsImage(f.type) && f.size <= MAX_PREVIEW) {
          const url = URL.createObjectURL(f);
          previewUrlRef.current = url;
          setPreviewUrl(url);
        }
      }
    },
    [],
  );

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const hash = await addAttachment(file, linkedEntityIds, myFunctionId);
      if (hash) {
        setFile(null);
        setLinkedEntityIds([]);
        setPreviewUrl(null);
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
        }
      }
    } finally {
      setBusy(false);
    }
  }, [file, linkedEntityIds, myFunctionId, addAttachment]);

  const handleDownload = useCallback(
    async (hash: string) => {
      const bytes = await getAttachmentBytes(hash);
      if (!bytes) return;
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'attachment';
      a.click();
      URL.revokeObjectURL(url);
    },
    [getAttachmentBytes],
  );

  const handleRetract = useCallback(async () => {
    if (!retractFor || !retractReason.trim()) return;
    await retractAttachment(retractFor, retractReason.trim());
    setRetractFor(null);
    setRetractReason('');
  }, [retractAttachment, retractFor, retractReason]);

  if (loading) {
    return <div className="text-center py-6 text-slate-500">{t('attachments.loading')}</div>;
  }

  if (error) {
    return <ErrorNotice message={error} onRetry={() => void refresh()} />;
  }

  return (
    <div className="space-y-4">
      {/* Upload form */}
      {canUpload && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleUpload();
          }}
          className="bg-white border border-slate-200 rounded-lg shadow-sm p-4"
        >
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            {t('attachments.create')}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-slate-700">
                {t('attachments.file')}
              </span>
              <input
                type="file"
                accept="image/*,.pdf,.doc,.docx,.txt"
                onChange={handleFileChange}
                disabled={busy}
                className="border border-slate-300 rounded px-2 py-1 text-sm"
              />
              {file && (
                <div className="text-xs text-slate-500 mt-1">
                  {file.name} · {formatSize(file.size)}
                </div>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-slate-700">
                {t('attachments.linkedEntities')}
              </span>
              <input
                type="text"
                placeholder={t('attachments.linkedEntitiesPlaceholder')}
                value={linkedEntityIds.join(',')}
                onChange={(e) =>
                  setLinkedEntityIds(
                    e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0),
                  )
                }
                className="border border-slate-300 rounded px-2 py-1 text-sm"
              />
            </label>
          </div>
          {previewUrl && (
            <div className="mt-2">
              <img
                src={previewUrl}
                alt="preview"
                className="max-h-48 max-w-auto rounded border border-slate-200"
              />
            </div>
          )}
          {err && <div className="text-sm text-red-700 mt-1">{err}</div>}
          <div className="mt-2">
            <button
              type="submit"
              disabled={busy || !file}
              className="text-sm bg-emerald-700 text-white rounded px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? t('attachments.form.saving') : t('attachments.form.save')}
            </button>
          </div>
        </form>
      )}

      {/* Attachment list */}
      {live.length === 0 ? (
        <div className="text-sm text-slate-500">{t('attachments.empty')}</div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-slate-200">
              <th scope="col" className="text-left pb-2">{t('attachments.col.name')}</th>
              <th scope="col" className="text-left pb-2">{t('attachments.col.mime')}</th>
              <th scope="col" className="text-left pb-2">{t('attachments.col.size')}</th>
              <th scope="col" className="text-left pb-2">{t('attachments.col.status')}</th>
              <th scope="col" className="text-left pb-2">{t('attachments.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {live.map((view) => {
              const payload = view.current!.payload as AttachmentPayload;
              const hash = payload.hash;
              const upload = uploads.get(hash);
              const uploadStatus = upload?.status ?? 'uploaded';
              const retractable = canRetract(view);

              return (
                <tr
                  key={view.entityId}
                  className="border-b border-slate-100"
                >
                  <td className="py-2 text-slate-800">{payload.filename}</td>
                  <td className="py-2 text-slate-700">{payload.mime}</td>
                  <td className="py-2 text-slate-700">
                    {formatSize(payload.size)}
                  </td>
                  <td className="py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        uploadStatus === 'pending'
                          ? 'bg-amber-100 text-amber-700'
                          : uploadStatus === 'uploading'
                            ? 'bg-blue-100 text-blue-700'
                            : uploadStatus === 'uploaded'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {t(`attachments.status.${uploadStatus}`)}
                    </span>
                    {upload?.error && (
                      <div className="text-xs text-red-600 mt-1">
                        {upload.error}
                      </div>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void handleDownload(hash)}
                        data-testid={`attachment-download-${hash}`}
                        className="text-xs bg-slate-700 text-white rounded px-2 py-0.5"
                      >
                        {t('attachments.download')}
                      </button>
                      {mimeIsImage(payload.mime) && payload.size <= MAX_PREVIEW && (
                        <button
                          type="button"
                          onClick={() => {
                            void getAttachmentBytes(hash).then((bytes) => {
                              if (!bytes) return;
                              const blob = new Blob([bytes]);
                              const url = URL.createObjectURL(blob);
                              window.open(url, '_blank');
                            });
                          }}
                          data-testid={`attachment-preview-${hash}`}
                          className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-0.5"
                        >
                          {t('attachments.preview')}
                        </button>
                      )}
                      {retractable && (
                        <button
                          type="button"
                          onClick={() => {
                            setRetractFor(view.entityId);
                            setRetractReason('');
                          }}
                          data-testid={`attachment-retract-${view.entityId}`}
                          className="text-xs text-red-700 border border-red-300 rounded px-2 py-0.5"
                        >
                          {t('attachments.remove')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Retry upload button */}
      {uploads.size > 0 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void uploadPending()}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            {t('attachments.retry')}
          </button>
        </div>
      )}

      {/* Retract dialog */}
      {retractFor && (
        <Dialog title={t('attachments.retract.title')} onClose={() => setRetractFor(null)}>
          <div className="space-y-3">
            <input
              type="text"
              value={retractReason}
              onChange={(e) => setRetractReason(e.target.value)}
              placeholder={t('attachments.retract.reason')}
              aria-label={t('attachments.retract.reason')}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRetractFor(null)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                {t('attachments.retract.cancel')}
              </button>
              <button
                onClick={() => void handleRetract()}
                disabled={!retractReason.trim()}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {t('attachments.retract.confirm')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
