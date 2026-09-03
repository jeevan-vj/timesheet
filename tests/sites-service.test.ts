import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Column, Param, SQL, getTableColumns, getTableName, is } from "drizzle-orm";
import { assignments, contractors, sites, timeEntries } from "../src/db/schema";

vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));
vi.mock("@/db/client", () => ({ db: {} }));

import { archiveSite, createSite, getSite, listSites, restoreSite, updateSite } from "../src/services/sites";
import { createAssignment, createContractor, createTimeEntry, getDashboard } from "../src/services/timesheet";

const ownerA = "owner-a";
const ownerB = "owner-b";

type Row = Record<string, unknown>;
type TableName = "site" | "assignment" | "contractor" | "time_entry" | "week_approval" | "assignment_schedule_version";
type Store = Record<TableName, Row[]>;
type ColRef = { tableName: string; key: string };
type Token = { kind: "col"; tableName: string; key: string } | { kind: "val"; value: unknown } | { kind: "op"; op: string };

const uniqueKeys: Record<TableName, string[]> = {
  site: ["ownerUserId", "name"],
  assignment: ["ownerUserId", "contractorId", "siteId"],
  time_entry: ["ownerUserId", "contractorId", "siteId", "workDate"],
  contractor: ["ownerUserId", "name"],
  week_approval: ["ownerUserId", "weekStart"],
  assignment_schedule_version: ["id"],
};

function columnRef(column: Column): ColRef {
  const tableName = getTableName(column.table);
  const key = Object.entries(getTableColumns(column.table)).find(([, col]) => col === column)?.[0];
  if (!key) throw new Error(`unknown column ${column.name}`);
  return { tableName, key };
}

function flatten(node: unknown): Token[] {
  if (node == null) return [];
  if (is(node, Column)) return [{ kind: "col", ...columnRef(node) }];
  if (is(node, Param)) return [{ kind: "val", value: node.value }];
  if (is(node, SQL)) return node.queryChunks.flatMap(flatten);
  if (typeof node === "object" && node !== null && "queryChunks" in node) {
    return (node as SQL).queryChunks.flatMap(flatten);
  }
  if (typeof node === "object" && node !== null && "value" in node && Array.isArray((node as { value: unknown }).value)) {
    const op = (node as { value: string[] }).value.join("").trim();
    return op ? [{ kind: "op", op }] : [];
  }
  return [{ kind: "val", value: node }];
}

function readSide(token: Token, bundle: Record<string, Row>) {
  if (token.kind === "val") return token.value;
  if (token.kind === "col") return bundle[token.tableName]?.[token.key];
  return undefined;
}

function matches(bundle: Record<string, Row>, sql: unknown) {
  if (!sql) return true;
  const tokens = flatten(sql).filter((token) => token.kind !== "op" || (token.op !== "(" && token.op !== ")"));
  for (let i = 0; i < tokens.length;) {
    const separator = tokens[i];
    if (separator?.kind === "op" && separator.op === "and") {
      i += 1;
      continue;
    }
    const left = tokens[i];
    const operator = tokens[i + 1];
    const right = tokens[i + 2];
    if (!left || operator?.kind !== "op" || !right) throw new Error("malformed predicate");
    const l = readSide(left, bundle);
    const r = readSide(right, bundle);
    if (operator.op === "=" && l !== r) return false;
    if (operator.op === ">=" && !((l as string | number) >= (r as string | number))) return false;
    if (operator.op === "<=" && !((l as string | number) <= (r as string | number))) return false;
    if (operator.op !== "=" && operator.op !== ">=" && operator.op !== "<=") throw new Error(`unsupported op ${operator.op}`);
    i += 3;
  }
  return true;
}

function thenable<T>(run: () => T) {
  const execute = () => run();
  return {
    execute,
    then(onFulfilled?: (value: T) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => execute()).then(onFulfilled, onRejected);
    },
  };
}

function createMemoryDb() {
  const store: Store = { site: [], assignment: [], contractor: [], time_entry: [], week_approval: [], assignment_schedule_version: [] };

  function cloneStore(): Store {
    return structuredClone(store);
  }

  function restoreStore(snapshot: Store) {
    (Object.keys(store) as TableName[]).forEach((table) => {
      store[table].length = 0;
      store[table].push(...snapshot[table]);
    });
  }

  function assertUnique(table: TableName) {
    const keys = uniqueKeys[table];
    const seen = new Set<string>();
    for (const row of store[table]) {
      const stamp = keys.map((key) => JSON.stringify(row[key])).join("\0");
      if (seen.has(stamp)) throw new Error(`UNIQUE constraint failed: ${table}.${keys.join(", ")}`);
      seen.add(stamp);
    }
  }

  function select(fields?: Record<string, Column>) {
    const state: { from?: unknown; joins: { table: unknown; on: unknown }[]; where?: unknown; orderBy: unknown[]; limit: number } = {
      joins: [],
      orderBy: [],
      limit: Number.POSITIVE_INFINITY,
    };
    const api = {
      from(table: unknown) {
        state.from = table;
        return api;
      },
      innerJoin(table: unknown, on: unknown) {
        state.joins.push({ table, on });
        return api;
      },
      where(condition: unknown) {
        state.where = condition;
        return api;
      },
      orderBy(...columns: unknown[]) {
        state.orderBy = columns;
        return api;
      },
      limit(count: number) {
        state.limit = count;
        return api;
      },
      execute() {
        const fromName = getTableName(state.from as typeof sites) as TableName;
        let rows = store[fromName].map((row) => ({ [fromName]: row }));
        for (const join of state.joins) {
          const joinName = getTableName(join.table as typeof sites) as TableName;
          const next: Record<string, Row>[] = [];
          for (const bundle of rows) {
            for (const right of store[joinName]) {
              const candidate = { ...bundle, [joinName]: right };
              if (matches(candidate, join.on)) next.push(candidate);
            }
          }
          rows = next;
        }
        rows = rows.filter((bundle) => matches(bundle, state.where));
        if (state.orderBy.length > 0) {
          rows.sort((a, b) => {
            for (const expr of state.orderBy) {
              const col = flatten(expr).find((token): token is Extract<Token, { kind: "col" }> => token.kind === "col");
              if (!col) continue;
              const left = a[col.tableName]?.[col.key];
              const right = b[col.tableName]?.[col.key];
              if (left === right) continue;
              if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
              if (typeof left === "number" && typeof right === "number") return left - right;
              return String(left).localeCompare(String(right));
            }
            return 0;
          });
        }
        return rows.slice(0, state.limit).map((bundle) => {
          if (!fields || Object.keys(fields).length === 0) {
            return { ...(bundle[fromName] ?? {}) };
          }
          const projected: Row = {};
          for (const [alias, column] of Object.entries(fields)) {
            const ref = columnRef(column);
            projected[alias] = bundle[ref.tableName]?.[ref.key];
          }
          return projected;
        });
      },
      then(onFulfilled?: (value: Row[]) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve().then(() => api.execute()).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  function insert(table: unknown) {
    return {
      values(row: Row) {
        return thenable(() => {
          const snapshot = cloneStore();
          try {
            const tableName = getTableName(table as typeof sites) as TableName;
            store[tableName].push({ ...row });
            assertUnique(tableName);
          } catch (error) {
            restoreStore(snapshot);
            throw error;
          }
        });
      },
    };
  }

  function update(table: unknown) {
    return {
      set(values: Row) {
        const state = { where: undefined as unknown };
        const api = {
          where(condition: unknown) {
            state.where = condition;
            return api;
          },
          execute() {
            const snapshot = cloneStore();
            try {
              const tableName = getTableName(table as typeof sites) as TableName;
              for (const row of store[tableName]) {
                if (matches({ [tableName]: row }, state.where)) Object.assign(row, values);
              }
              assertUnique(tableName);
            } catch (error) {
              restoreStore(snapshot);
              throw error;
            }
          },
          then(onFulfilled?: (value: void) => unknown, onRejected?: (reason: unknown) => unknown) {
            return Promise.resolve().then(() => api.execute()).then(onFulfilled, onRejected);
          },
        };
        return api;
      },
    };
  }

  function del(table: unknown) {
    return {
      where(condition: unknown) {
        return thenable(() => {
          const tableName = getTableName(table as typeof sites) as TableName;
          const kept: Row[] = [];
          const removed: Row[] = [];
          for (const row of store[tableName]) {
            if (matches({ [tableName]: row }, condition)) removed.push(row);
            else kept.push(row);
          }
          store[tableName].length = 0;
          store[tableName].push(...kept);
          return removed;
        });
      },
    };
  }

  async function batch(queries: { execute: () => unknown }[]) {
    const snapshot = cloneStore();
    try {
      const results = [];
      for (const query of queries) results.push(query.execute());
      return results;
    } catch (error) {
      restoreStore(snapshot);
      throw error;
    }
  }

  return { store, select, insert, update, delete: del, batch };
}

type MemoryDb = ReturnType<typeof createMemoryDb>;

function asDb(database: MemoryDb) {
  return database as never;
}

async function waitForClock() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("site service", () => {
  let memory: MemoryDb;

  beforeEach(() => {
    memory = createMemoryDb();
  });

  it("creates, lists, gets, updates, archives, and restores a site", async () => {
    const created = await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "1 Quay St" });
    expect(created).toMatchObject({ name: "Harbour Offices", address: "1 Quay St", active: true, ownerUserId: ownerA });
    expect(created.id).toBeTruthy();

    await createSite(asDb(memory), ownerA, { name: "Quay Shed", address: "" });
    const listed = await listSites(asDb(memory), ownerA);
    expect(listed.map((site) => site.name)).toEqual(["Harbour Offices", "Quay Shed"]);
    expect(listed[0]).toEqual(expect.objectContaining({
      id: created.id,
      name: "Harbour Offices",
      address: "1 Quay St",
      active: true,
    }));
    expect(listed[0]?.updatedAt).toBeInstanceOf(Date);

    const detail = await getSite(asDb(memory), ownerA, created.id);
    expect(detail).toEqual(expect.objectContaining({ id: created.id, name: "Harbour Offices", active: true }));

    await waitForClock();
    const patched = await updateSite(asDb(memory), ownerA, created.id, { name: "Harbour Tower", address: "2 Quay St" });
    expect(patched).toEqual(expect.objectContaining({ id: created.id, name: "Harbour Tower", address: "2 Quay St", active: true }));
    expect(patched.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());

    const archived = await archiveSite(asDb(memory), ownerA, created.id);
    expect(archived.active).toBe(false);
    expect(await getSite(asDb(memory), ownerA, created.id)).toEqual(expect.objectContaining({ id: created.id, name: "Harbour Tower", active: false }));

    const restored = await restoreSite(asDb(memory), ownerA, created.id);
    expect(restored.active).toBe(true);
    expect(memory.store.site.filter((row) => row.id === created.id)).toHaveLength(1);
  });

  it("lists active sites by default and includes archived only when requested", async () => {
    const harbour = await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "" });
    await createSite(asDb(memory), ownerA, { name: "Quay Shed", address: "" });
    await archiveSite(asDb(memory), ownerA, harbour.id);

    expect((await listSites(asDb(memory), ownerA)).map((site) => site.name)).toEqual(["Quay Shed"]);
    expect((await listSites(asDb(memory), ownerA, false)).map((site) => site.name)).toEqual(["Quay Shed"]);
    const withArchived = await listSites(asDb(memory), ownerA, true);
    expect(withArchived.map((site) => ({ name: site.name, active: site.active }))).toEqual([
      { name: "Harbour Offices", active: false },
      { name: "Quay Shed", active: true },
    ]);
  });

  it("archives a site and only that site's owner-scoped active assignments in one batch", async () => {
    const harbour = await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "" });
    const quay = await createSite(asDb(memory), ownerA, { name: "Quay Shed", address: "" });
    const other = await createSite(asDb(memory), ownerB, { name: "Harbour Offices", address: "" });
    const aroha = await createContractor(asDb(memory), ownerA, { name: "Aroha", email: "", phone: "", defaultRateCents: 3200 });
    const moana = await createContractor(asDb(memory), ownerA, { name: "Moana", email: "", phone: "", defaultRateCents: 3100 });
    const pat = await createContractor(asDb(memory), ownerB, { name: "Pat", email: "", phone: "", defaultRateCents: 3300 });

    const harbourActive = await createAssignment(asDb(memory), ownerA, { contractorId: aroha.id, siteId: harbour.id, rateCents: 3500 });
    const harbourInactive = { id: "assign-inactive", ownerUserId: ownerA, contractorId: moana.id, siteId: harbour.id, rateCents: 3400, active: false, createdAt: new Date(), updatedAt: new Date() };
    memory.store.assignment.push(harbourInactive);
    const quayActive = await createAssignment(asDb(memory), ownerA, { contractorId: aroha.id, siteId: quay.id, rateCents: null });
    const otherActive = await createAssignment(asDb(memory), ownerB, { contractorId: pat.id, siteId: other.id, rateCents: 3600 });

    await archiveSite(asDb(memory), ownerA, harbour.id);

    expect(memory.store.site.find((row) => row.id === harbour.id)?.active).toBe(false);
    expect(memory.store.assignment.find((row) => row.id === harbourActive.id)?.active).toBe(false);
    expect(memory.store.assignment.find((row) => row.id === harbourInactive.id)?.active).toBe(false);
    expect(memory.store.assignment.find((row) => row.id === quayActive.id)?.active).toBe(true);
    expect(memory.store.assignment.find((row) => row.id === otherActive.id)?.active).toBe(true);
    expect(memory.store.site.find((row) => row.id === other.id)?.active).toBe(true);
    expect(memory.store.site.find((row) => row.id === quay.id)?.active).toBe(true);
  });

  it("restores the same site row and reactivates that site's inactive assignments", async () => {
    const harbour = await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "" });
    const aroha = await createContractor(asDb(memory), ownerA, { name: "Aroha", email: "", phone: "", defaultRateCents: 3200 });
    const assignment = await createAssignment(asDb(memory), ownerA, { contractorId: aroha.id, siteId: harbour.id, rateCents: 3500 });
    await createTimeEntry(asDb(memory), ownerA, {
      entryMode: "paid_hours",
      contractorId: aroha.id,
      siteId: harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "weekly clean",
    });
    await archiveSite(asDb(memory), ownerA, harbour.id);
    const siteCount = memory.store.site.length;
    const entriesBefore = structuredClone(memory.store.time_entry);

    const restored = await restoreSite(asDb(memory), ownerA, harbour.id);

    expect(restored.id).toBe(harbour.id);
    expect(restored.active).toBe(true);
    expect(memory.store.site).toHaveLength(siteCount);
    expect(memory.store.site.filter((row) => row.id === harbour.id)).toHaveLength(1);
    expect(memory.store.assignment.find((row) => row.id === assignment.id)?.active).toBe(true);
    expect(memory.store.time_entry).toEqual(entriesBefore);
  });

  it("throws duplicate_site when the owner already has that name", async () => {
    await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "" });
    await createSite(asDb(memory), ownerB, { name: "Harbour Offices", address: "" });
    await expect(createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "2 Quay" })).rejects.toThrow("duplicate_site");
    expect(memory.store.site).toHaveLength(2);

    const quay = await createSite(asDb(memory), ownerA, { name: "Quay Shed", address: "" });
    await expect(updateSite(asDb(memory), ownerA, quay.id, { name: "Harbour Offices", address: "" })).rejects.toThrow("duplicate_site");
    expect(memory.store.site.find((row) => row.id === quay.id)?.name).toBe("Quay Shed");
  });

  it("throws duplicate_site on restore name clash and writes nothing", async () => {
    const harbour = await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "" });
    const quay = await createSite(asDb(memory), ownerA, { name: "Quay Shed", address: "" });
    const aroha = await createContractor(asDb(memory), ownerA, { name: "Aroha", email: "", phone: "", defaultRateCents: 3200 });
    const assignment = await createAssignment(asDb(memory), ownerA, { contractorId: aroha.id, siteId: harbour.id, rateCents: 3500 });
    await archiveSite(asDb(memory), ownerA, harbour.id);
    const clash = memory.store.site.find((row) => row.id === quay.id);
    if (clash) clash.name = "Harbour Offices";
    const before = structuredClone(memory.store);

    await expect(restoreSite(asDb(memory), ownerA, harbour.id)).rejects.toThrow("duplicate_site");
    expect(memory.store).toEqual(before);
    expect(memory.store.site.find((row) => row.id === harbour.id)?.active).toBe(false);
    expect(memory.store.assignment.find((row) => row.id === assignment.id)?.active).toBe(false);
  });

  it("rejects cross-owner get, update, archive, and restore without writing", async () => {
    const harbour = await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "1 Quay St" });
    const before = structuredClone(memory.store);

    await expect(getSite(asDb(memory), ownerB, harbour.id)).rejects.toThrow("not_found");
    await expect(updateSite(asDb(memory), ownerB, harbour.id, { name: "Stolen", address: "" })).rejects.toThrow("not_found");
    await expect(archiveSite(asDb(memory), ownerB, harbour.id)).rejects.toThrow("not_found");
    await expect(restoreSite(asDb(memory), ownerB, harbour.id)).rejects.toThrow("not_found");
    expect((await listSites(asDb(memory), ownerB)).map((site) => site.id)).not.toContain(harbour.id);
    expect((await listSites(asDb(memory), ownerB, true)).map((site) => site.id)).not.toContain(harbour.id);
    expect(memory.store).toEqual(before);
  });

  it("preserves historical time entries when a site is archived", async () => {
    const harbour = await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "" });
    const aroha = await createContractor(asDb(memory), ownerA, { name: "Aroha", email: "", phone: "", defaultRateCents: 3200 });
    await createAssignment(asDb(memory), ownerA, { contractorId: aroha.id, siteId: harbour.id, rateCents: 3500 });
    const entry = await createTimeEntry(asDb(memory), ownerA, {
      entryMode: "paid_hours",
      contractorId: aroha.id,
      siteId: harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "weekly clean",
    });
    const entriesBefore = structuredClone(memory.store.time_entry);

    await archiveSite(asDb(memory), ownerA, harbour.id);

    expect(memory.store.time_entry).toEqual(entriesBefore);
    const archived = await getSite(asDb(memory), ownerA, harbour.id);
    expect(archived).toEqual(expect.objectContaining({ id: harbour.id, name: "Harbour Offices", active: false }));

    const dashboard = await getDashboard(asDb(memory), ownerA, "2026-08-31");
    expect(dashboard.sites.map((site) => site.id)).not.toContain(harbour.id);
    expect(dashboard.entries).toEqual([expect.objectContaining({
      id: entry.id,
      siteId: harbour.id,
      siteName: "Harbour Offices",
      rateCents: 3500,
      paidMinutes: 480,
    })]);

    await expect(createAssignment(asDb(memory), ownerA, { contractorId: aroha.id, siteId: harbour.id, rateCents: null })).rejects.toThrow("not_found");
    await expect(createTimeEntry(asDb(memory), ownerA, {
      entryMode: "paid_hours",
      contractorId: aroha.id,
      siteId: harbour.id,
      workDate: "2026-09-01",
      paidMinutes: 60,
      notes: "",
    })).rejects.toThrow("not_found");
    expect(memory.store.time_entry).toHaveLength(1);
  });

  it("dashboard weekly join does not require sites.active", () => {
    const source = fs.readFileSync(new URL("../src/services/timesheet.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function getDashboard");
    const next = source.indexOf("\nexport async function", start + 1);
    const fn = source.slice(start, next === -1 ? undefined : next);
    expect(fn).toContain("eq(sites.active, true)");
    expect(fn).toContain("eq(assignments.active, true)");
    expect(fn).toMatch(/innerJoin\(sites, and\(eq\(sites\.id, timeEntries\.siteId\), eq\(sites\.ownerUserId, ownerUserId\)\)\)/);
  });

  it("rejects already-archived delete and already-active restore without writing", async () => {
    const harbour = await createSite(asDb(memory), ownerA, { name: "Harbour Offices", address: "" });
    const aroha = await createContractor(asDb(memory), ownerA, { name: "Aroha", email: "", phone: "", defaultRateCents: 3200 });
    await createAssignment(asDb(memory), ownerA, { contractorId: aroha.id, siteId: harbour.id, rateCents: null });

    const activeSnapshot = structuredClone(memory.store);
    await expect(restoreSite(asDb(memory), ownerA, harbour.id)).rejects.toThrow("not_found");
    expect(memory.store).toEqual(activeSnapshot);

    await archiveSite(asDb(memory), ownerA, harbour.id);
    const archivedSnapshot = structuredClone(memory.store);
    await expect(archiveSite(asDb(memory), ownerA, harbour.id)).rejects.toThrow("not_found");
    expect(memory.store).toEqual(archivedSnapshot);
  });
});
