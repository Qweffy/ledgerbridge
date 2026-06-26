/* LedgerBridge — typed API client (ported from the bundle's client.jsx).
   One switch: NEXT_PUBLIC_API_URL. Unset → MOCK_MODE renders on fixtures; set →
   the real M8 API, validated against the packages/shared DTO schemas. */
import {
  auditEntryDtoSchema,
  conflictDtoSchema,
  conflictDetailDtoSchema,
  eventDtoSchema,
  eventDetailDtoSchema,
  linkDtoSchema,
  linkDetailDtoSchema,
  statusDtoSchema,
  type AuditEntryDto,
  type ConflictDto,
  type DashboardSource,
  type EntityType,
  type EventDto,
  type EventStatus,
  type LinkDto,
  type LinkStatus,
  type StatusDto,
} from "@ledgerbridge/shared";
import {
  fixtures,
  type ConflictDetailExtra,
  type EventDetailExtra,
  type LinkDetailExtra,
} from "./fixtures";

export type LinkDetailView = LinkDto & LinkDetailExtra;
export type ConflictDetailView = ConflictDto & ConflictDetailExtra;
export type EventDetailView = EventDto & EventDetailExtra;

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? null;
export const MOCK_MODE = !API_BASE;
const LATENCY = 420; // simulated network latency in mock mode

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function mock<T>(producer: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(producer());
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, LATENCY);
  });
}

async function real(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch((API_BASE ?? "").replace(/\/$/, "") + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new ApiError(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  return res.json();
}

function byId<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((x) => x.id === id);
}

function qs(obj: Record<string, string | undefined>): string {
  const parts = Object.entries(obj).filter(([, v]) => v != null && v !== "");
  return parts.length ? "?" + parts.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&") : "";
}

export interface LinksFilter {
  status?: LinkStatus;
  entityType?: EntityType;
}
export interface EventsFilter {
  status?: EventStatus;
  source?: DashboardSource;
  entityType?: EntityType;
}

function notFound(what: string, id: string): never {
  throw new ApiError(`${what} not found: ${id}`);
}

export const api = {
  MOCK_MODE,
  API_BASE,

  getStatus: (): Promise<StatusDto> =>
    MOCK_MODE ? mock(() => fixtures.status) : real("/status").then((v) => statusDtoSchema.parse(v)),

  getLinks: (filter: LinksFilter = {}): Promise<LinkDto[]> =>
    MOCK_MODE
      ? mock(() =>
          fixtures.links.filter(
            (l) => (!filter.status || l.status === filter.status) && (!filter.entityType || l.entityType === filter.entityType),
          ),
        )
      : real("/links" + qs(filter as Record<string, string | undefined>)).then((v) => linkDtoSchema.array().parse(v)),

  getLink: (id: string): Promise<LinkDetailView> =>
    MOCK_MODE
      ? mock(() => {
          const l = byId(fixtures.links, id) ?? notFound("Link", id);
          const extra: LinkDetailExtra = fixtures.linkDetail[id] ?? { internalSnapshot: {}, qboSnapshot: {}, timeline: [] };
          return { ...l, ...extra };
        })
      : real("/links/" + id).then((v) => linkDetailDtoSchema.parse(v) as LinkDetailView),

  getConflicts: (): Promise<ConflictDto[]> =>
    MOCK_MODE ? mock(() => fixtures.conflicts) : real("/conflicts").then((v) => conflictDtoSchema.array().parse(v)),

  getConflict: (id: string): Promise<ConflictDetailView> =>
    MOCK_MODE
      ? mock(() => {
          const c = byId(fixtures.conflicts, id) ?? notFound("Conflict", id);
          const extra: ConflictDetailExtra = fixtures.conflictDetail[id] ?? { conflictingFields: c.conflictingFields, before: {}, after: {} };
          return { ...c, ...extra };
        })
      : real("/conflicts/" + id).then((v) => conflictDetailDtoSchema.parse(v) as ConflictDetailView),

  getEvents: (filter: EventsFilter = {}): Promise<EventDto[]> =>
    MOCK_MODE
      ? mock(() =>
          fixtures.events.filter(
            (e) =>
              (!filter.status || e.status === filter.status) &&
              (!filter.source || e.source === filter.source) &&
              (!filter.entityType || e.entityType === filter.entityType),
          ),
        )
      : real("/events" + qs(filter as Record<string, string | undefined>)).then((v) => eventDtoSchema.array().parse(v)),

  getEvent: (id: string): Promise<EventDetailView> =>
    MOCK_MODE
      ? mock(() => {
          const e = byId(fixtures.events, id) ?? notFound("Event", id);
          const extra: EventDetailExtra = fixtures.eventDetail[id] ?? { payload: {}, auditTrail: [] };
          return { ...e, ...extra };
        })
      : real("/events/" + id).then((v) => eventDetailDtoSchema.parse(v) as EventDetailView),

  getAudit: (): Promise<AuditEntryDto[]> =>
    MOCK_MODE ? mock(() => fixtures.audit) : real("/audit").then((v) => auditEntryDtoSchema.array().parse(v)),

  resolveConflict: (id: string, winner: DashboardSource): Promise<{ id: string; resolved: boolean; winner: DashboardSource }> =>
    MOCK_MODE
      ? mock(() => ({ id, resolved: true, winner }))
      : (real(`/conflicts/${id}/resolve`, { method: "POST", body: JSON.stringify({ winner }) }) as Promise<{ id: string; resolved: boolean; winner: DashboardSource }>),

  replayEvent: (id: string): Promise<{ id: string; status: string; replayed: boolean }> =>
    MOCK_MODE
      ? mock(() => ({ id, status: "pending", replayed: true }))
      : (real(`/events/${id}/replay`, { method: "POST" }) as Promise<{ id: string; status: string; replayed: boolean }>),

  demo: {
    createInvoice: () => (MOCK_MODE ? mock(() => ({ ok: true })) : real("/demo/create-invoice", { method: "POST" })),
    editBoth: () => (MOCK_MODE ? mock(() => ({ ok: true })) : real("/demo/edit-both", { method: "POST" })),
    reconcile: () => (MOCK_MODE ? mock(() => ({ ok: true })) : real("/demo/reconcile", { method: "POST" })),
    injectFault: () => (MOCK_MODE ? mock(() => ({ ok: true })) : real("/demo/inject-fault", { method: "POST" })),
  },
};
