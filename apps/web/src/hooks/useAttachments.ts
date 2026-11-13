// useAttachments — plan.md §5.6 / M28
//
// Attachments: files attached to any entity. The client computes sha256
// (crypto.subtle), queues the bytes in Dexie `blobs`, and creates a normal
// synced `attachment` record. Bytes are uploaded to POST /api/attachments
// when the connection is available; the UI shows "waiting to upload" until
// the upload succeeds.
//
// Writes go to local Dexie first, then sync (append-only record model).

import { useCallback, useEffect, useState } from 'react';
import {
  newRecord,
  type RecordEnvelope,
  type AttachmentPayload,
} from '@stabsstod/shared';
import type { LocalStore } from '../localStore.js';
import { getDeviceId, loadHlcState, saveHlcState } from '../hlcStore.js';

export interface AttachmentView {
  entityId: string;
  functionId: string | null;
  current: RecordEnvelope | null;
  retracted: boolean;
}

export interface UploadStatus {
  hash: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
}

export interface UseAttachmentsResult {
  attachments: AttachmentView[];
  uploads: Map<string, UploadStatus>;
  loading: boolean;
  error: string;
  addAttachment: (
    file: File,
    linkedEntityIds: string[],
    functionId: string | null,
  ) => Promise<string | null>; // returns the attachment hash
  getAttachmentBytes: (hash: string) => Promise<ArrayBuffer | undefined>;
  uploadPending: () => Promise<void>;
  retractAttachment: (entityId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// sha256 via Web Crypto API (available in browsers and Node 22+).
async function sha256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function useAttachments(
  store: LocalStore | null,
  incidentId: string,
  authorId: string,
): UseAttachmentsResult {
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [uploads, setUploads] = useState<Map<string, UploadStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const deviceId = getDeviceId();

  const refresh = useCallback(async () => {
    if (!store) return;
    try {
      const records = await store.getRecordsByIncident(incidentId);
      const byEntity = new Map<string, RecordEnvelope[]>();
      for (const r of records) {
        if (r.entityType !== 'attachment') continue;
        const list = byEntity.get(r.entityId) ?? [];
        list.push(r);
        byEntity.set(r.entityId, list);
      }
      const views: AttachmentView[] = [];
      for (const [entityId, entityRecords] of byEntity) {
        const recordsCopy = [...entityRecords];
        recordsCopy.sort(
          (a, b) =>
            (a.createdAtClient ?? '').localeCompare(b.createdAtClient ?? ''),
        );
        const current = recordsCopy[recordsCopy.length - 1];
        views.push({
          entityId,
          current,
          functionId: current?.functionId ?? null,
          retracted: current?.kind === 'retract',
        });
      }
      views.sort(
        (a, b) =>
          ((a.current?.payload as AttachmentPayload | undefined)?.filename ?? '').localeCompare(
            (b.current?.payload as AttachmentPayload | undefined)?.filename ?? '',
          ),
      );
      setAttachments(views);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load attachments');
    } finally {
      setLoading(false);
    }
  }, [store, incidentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ---------------------------------------------------------------------------
  // Upload pending blobs to the server (defined before addAttachment so it
  // can be referenced from addAttachment's callback deps).
  // ---------------------------------------------------------------------------

  const uploadPending = useCallback(async (): Promise<void> => {
    if (!store) return;
    try {
      const pendingEntries = [...uploads.entries()].filter(
        ([, s]) => s.status === 'pending' || s.status === 'failed',
      );
      for (const [hash] of pendingEntries) {
        const status = uploads.get(hash);
        if (!status || status.status === 'uploading') continue;

        const data = await store.getBlob(hash);
        if (!data) continue;

        setUploads((m) => {
          const next = new Map(m);
          next.set(hash, { hash, status: 'uploading' });
          return next;
        });

        try {
          const formData = new FormData();
          const blob = new Blob([data], {
            type: 'application/octet-stream',
          });
          formData.append('file', blob, 'attachment');
          formData.append('hash', hash);

          const res = await globalThis.fetch('/api/attachments', {
            method: 'POST',
            credentials: 'include',
            body: formData,
          });

          if (!res.ok) {
            throw new Error(`upload failed: HTTP ${res.status}`);
          }

          setUploads((m) => {
            const next = new Map(m);
            next.set(hash, { hash, status: 'uploaded' });
            return next;
          });
          await store.removeBlob(hash);
        } catch (err) {
          setUploads((m) => {
            const next = new Map(m);
            next.set(hash, {
              hash,
              status: 'failed',
              error: err instanceof Error ? err.message : 'upload failed',
            });
            return next;
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    }
  }, [store, uploads]);

  // ---------------------------------------------------------------------------
  // Add attachment: compute hash, queue bytes, create record
  // ---------------------------------------------------------------------------

  const addAttachment = useCallback(
    async (
      file: File,
      linkedEntityIds: string[],
      functionId: string | null,
    ): Promise<string | null> => {
      if (!store) return null;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const hash = await sha256(arrayBuffer);

        // Queue the bytes in Dexie blobs.
        await store.addBlob(hash, arrayBuffer);

        // Track upload as pending.
        setUploads((m) => {
          const next = new Map(m);
          next.set(hash, { hash, status: 'pending' });
          return next;
        });

        // Create the attachment record (goes to local store + outbox).
        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId: `attach-${crypto.randomUUID()}`,
          entityType: 'attachment',
          incidentId,
          parentIds: [],
          functionId,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: {
            filename: file.name,
            mime: file.type || 'application/octet-stream',
            size: arrayBuffer.byteLength,
            hash,
            linkedEntityIds,
          },
          createdAtClient: new Date().toISOString(),
          kind: 'put',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);

        await refresh();
        return hash;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to add attachment');
        return null;
      }
    },
    [store, incidentId, authorId, deviceId, sha256, refresh, uploadPending],
  );

  // ---------------------------------------------------------------------------
  // Get attachment bytes (for preview/download from local Dexie)
  // ---------------------------------------------------------------------------

  const getAttachmentBytes = useCallback(
    async (hash: string): Promise<ArrayBuffer | undefined> => {
      if (!store) return undefined;
      return store.getBlob(hash);
    },
    [store],
  );

  // ---------------------------------------------------------------------------
  // Retract attachment
  // ---------------------------------------------------------------------------

  const retractAttachment = useCallback(
    async (entityId: string, reason: string): Promise<void> => {
      if (!store) return;
      try {
        const records = await store.getRecordsByEntity(entityId);
        const current = records
          .filter((r) => r.kind === 'put')
          .sort(
            (a, b) =>
              (a.createdAtClient ?? '').localeCompare(b.createdAtClient ?? ''),
          )
          .pop();
        if (!current) return;

        const state = loadHlcState();
        const { record, state: nextState } = newRecord({
          entityId,
          entityType: 'attachment',
          incidentId,
          parentIds: [current.id],
          functionId: current.functionId,
          authorId,
          deviceId,
          schemaVersion: 1,
          payload: { reason },
          createdAtClient: new Date().toISOString(),
          kind: 'retract',
          state,
        });
        saveHlcState(nextState, deviceId);
        await store.addLocalRecord(record);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to retract attachment');
      }
    },
    [store, incidentId, authorId, deviceId, refresh],
  );

  return {
    attachments,
    uploads,
    loading,
    error,
    addAttachment,
    getAttachmentBytes,
    uploadPending,
    retractAttachment,
    refresh,
  };
}
