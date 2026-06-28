import { describe, expect, it } from "vitest";
import type { LinkDto } from "@ledgerbridge/shared";
import { linksToCsv } from "./csv";

function link(over: Partial<LinkDto> = {}): LinkDto {
  return {
    id: "1",
    entityType: "invoice",
    internalId: "INV-1",
    qboId: "150",
    status: "linked",
    lastSyncedAt: "2026-06-27T00:00:00Z",
    drift: false,
    ...over,
  };
}

describe("linksToCsv", () => {
  it("emits a header row and one line per link", () => {
    const csv = linksToCsv([link(), link({ id: "2", internalId: "INV-2", qboId: null })]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("entity,internal_id,qbo_id,status,last_synced_at,drift");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("invoice,INV-1,150,linked,2026-06-27T00:00:00Z,false");
    expect(lines[2]).toBe("invoice,INV-2,,linked,2026-06-27T00:00:00Z,false"); // null qboId → empty cell
  });

  it("escapes cells containing a comma or quote (RFC-4180)", () => {
    const csv = linksToCsv([link({ internalId: 'A,B"C' })]);
    expect(csv).toContain('"A,B""C"');
  });
});
