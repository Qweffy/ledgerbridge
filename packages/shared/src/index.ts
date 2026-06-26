import { z } from 'zod';

// The status vocabulary the UI renders (StatusBadge). Fixed and non-negotiable —
// see the design system DESIGN-SYSTEM.md.
export const syncStatusSchema = z.enum([
  'synced',
  'inflight',
  'queued',
  'conflict',
  'failed',
  'deadletter',
  'replayed',
  'idle',
  'skipped',
]);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const SYNC_STATUS_LABEL: Readonly<Record<SyncStatus, string>> = Object.freeze({
  synced: 'Synced',
  inflight: 'In flight',
  queued: 'Queued',
  conflict: 'Conflict',
  failed: 'Failed',
  deadletter: 'Dead-letter',
  replayed: 'Replayed',
  idle: 'Idle',
  skipped: 'Skipped',
});

// The data-model vocabularies the API emits.
export const eventStatusSchema = z.enum(['pending', 'processing', 'done', 'dead']);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const linkStatusSchema = z.enum(['linked', 'conflict', 'error', 'skip']);
export type LinkStatus = z.infer<typeof linkStatusSchema>;

export const auditActionSchema = z.enum([
  'create',
  'update',
  'void',
  'delete',
  'skip',
  'conflict',
  'conflict_resolved',
  'error',
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const systemIdSchema = z.enum(['internal', 'quickbooks']);
export type SystemId = z.infer<typeof systemIdSchema>;

export function eventStatusToSyncStatus(status: EventStatus): SyncStatus {
  switch (status) {
    case 'pending':
      return 'queued';
    case 'processing':
      return 'inflight';
    case 'done':
      return 'synced';
    case 'dead':
      return 'deadletter';
  }
}

export function linkStatusToSyncStatus(status: LinkStatus): SyncStatus {
  switch (status) {
    case 'linked':
      return 'synced';
    case 'conflict':
      return 'conflict';
    case 'error':
      return 'failed';
    case 'skip':
      return 'skipped';
  }
}
