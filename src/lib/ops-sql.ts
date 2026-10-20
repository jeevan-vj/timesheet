export const OPS_SELECT_ROW_CAP = 100;
export const OPS_SAMPLE_ROWS = 5;
export const OPS_CONFIRM_TTL_MS = 5 * 60 * 1000;

export type SqlValue = string | number | null;
export type OpsRow = Record<string, SqlValue>;

export type OpsSqlRunner = {
  all(sql: string, params: SqlValue[]): Promise<OpsRow[]>;
  batch(statements: Array<{ sql: string; params: SqlValue[] }>): Promise<void>;
};

type Token = {
  type: "word" | "punct" | "param" | "string" | "number";
  text: string;
  start: number;
  end: number;
};

type ValueNode = { param: true } | { param: false; value: SqlValue };

export type OpsSqlPlan =
  | { kind: "select"; sql: string }
  | { kind: "insert_values"; sql: string; rowCount: number; sample: OpsRow[] }
  | { kind: "insert_select"; sql: string; countSql: string; sampleSql: string }
  | { kind: "update"; sql: string; countSql: string; sampleSql: string; whereParamOffset: number };

const FORBIDDEN_WORDS = new Set([
  "DROP", "ALTER", "CREATE", "PRAGMA", "ATTACH", "DETACH", "DELETE", "REPLACE",
  "VACUUM", "REINDEX", "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "TRIGGER",
  "ANALYZE", "GRANT", "REVOKE", "LOAD",
]);

const UPDATE_BANNED_AT_ROOT = new Set([
  "FROM", "RETURNING", "ORDER", "LIMIT", "GROUP", "HAVING", "WINDOW",
  "UNION", "EXCEPT", "INTERSECT", "CONFLICT",
]);

export function planOpsSql(
  rawSql: string,
  params: readonly SqlValue[],
): { ok: true; plan: OpsSqlPlan } | { ok: false; error: "invalid_sql" | "forbidden_sql" } {
  if (!params.every(isSqlValue)) return { ok: false, error: "invalid_sql" };
  const source = rawSql.trim();
  const scanned = tokenize(source);
  if (!scanned.ok) return scanned;
  const semiIndexes = scanned.tokens.flatMap((token, index) => (
    token.type === "punct" && token.text === ";" ? [index] : []
  ));
  if (semiIndexes.length > 1) return { ok: false, error: "forbidden_sql" };
  if (semiIndexes.length === 1 && semiIndexes[0] !== scanned.tokens.length - 1) {
    return { ok: false, error: "forbidden_sql" };
  }
  const tokens = semiIndexes.length === 1 ? scanned.tokens.slice(0, -1) : scanned.tokens;
  if (tokens.length === 0 || tokens[0]?.type !== "word") return { ok: false, error: "invalid_sql" };
  for (const token of tokens) {
    if (token.type === "word" && FORBIDDEN_WORDS.has(token.text.toUpperCase())) {
      return { ok: false, error: "forbidden_sql" };
    }
  }
  const sql = source.slice(tokens[0].start, tokens[tokens.length - 1]!.end).trim();
  const keyword = tokens[0].text.toUpperCase();
  if (keyword === "SELECT") return planSelect(sql, tokens, params.length);
  if (keyword === "INSERT") return planInsert(sql, tokens, params);
  if (keyword === "UPDATE") return planUpdate(sql, tokens, params.length);
  return { ok: false, error: "forbidden_sql" };
}

export function selectCapSql(sql: string): string {
  return `SELECT * FROM (${sql}) AS ops_select_cap LIMIT ${OPS_SELECT_ROW_CAP + 1}`;
}

export function whereParams(params: readonly SqlValue[], whereParamOffset: number): SqlValue[] {
  return params.slice(whereParamOffset);
}

type ConfirmPayload = {
  exp: number;
  params: SqlValue[];
  rowCount: number;
  sql: string;
};

export async function signOpsConfirmToken(
  input: { sql: string; params: readonly SqlValue[]; rowCount: number; nowMs: number },
  secret: string,
): Promise<{ token: string; expiresAt: string }> {
  const exp = input.nowMs + OPS_CONFIRM_TTL_MS;
  const payload = canonicalPayload({ exp, params: [...input.params], rowCount: input.rowCount, sql: input.sql });
  const signature = await hmac(secret, payload);
  return {
    token: `v1.${base64UrlEncode(payload)}.${base64UrlEncodeBytes(signature)}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export async function readOpsConfirmToken(
  token: string,
  secret: string,
  nowMs: number,
): Promise<{ ok: true; payload: ConfirmPayload } | { ok: false; error: "confirm_mismatch" | "confirm_expired" }> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
    return { ok: false, error: "confirm_mismatch" };
  }
  const payloadText = base64UrlDecode(parts[1]);
  const signature = base64UrlDecodeBytes(parts[2]);
  if (payloadText === null || signature === null) return { ok: false, error: "confirm_mismatch" };
  const valid = await verifyHmac(secret, payloadText, signature);
  if (!valid) return { ok: false, error: "confirm_mismatch" };
  const payload = parsePayload(payloadText);
  if (!payload) return { ok: false, error: "confirm_mismatch" };
  if (payload.exp <= nowMs) return { ok: false, error: "confirm_expired" };
  return { ok: true, payload };
}

type SqlJsStatement = {
  bind(params: SqlValue[]): unknown;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
};

export type SqlJsLike = {
  prepare(sql: string): SqlJsStatement;
  run(sql: string, params?: SqlValue[]): void;
};

function cellValue(value: unknown): SqlValue {
  if (typeof value === "string" || value === null) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("invalid_sql");
}

export function sqlJsRunner(sqlite: SqlJsLike): OpsSqlRunner {
  return {
    async all(sql, params) {
      const stmt = sqlite.prepare(sql);
      try {
        if (params.length > 0) stmt.bind(params);
        const rows: OpsRow[] = [];
        while (stmt.step()) {
          const record: OpsRow = {};
          for (const [key, value] of Object.entries(stmt.getAsObject())) record[key] = cellValue(value);
          rows.push(record);
        }
        return rows;
      } finally {
        stmt.free();
      }
    },
    async batch(statements) {
      sqlite.run("BEGIN");
      try {
        for (const statement of statements) {
          if (statement.params.length > 0) sqlite.run(statement.sql, statement.params);
          else sqlite.run(statement.sql);
        }
        sqlite.run("COMMIT");
      } catch (error) {
        try {
          sqlite.run("ROLLBACK");
        } catch {
          // The failed statement already aborted the transaction.
        }
        throw error;
      }
    },
  };
}

export function d1OpsRunner(d1: D1Database): OpsSqlRunner {
  const prepare = (sql: string, params: SqlValue[]) => (
    params.length > 0 ? d1.prepare(sql).bind(...params) : d1.prepare(sql)
  );
  return {
    async all(sql, params) {
      const result = await prepare(sql, params).all<OpsRow>();
      return result.results;
    },
    async batch(statements) {
      await d1.batch(statements.map((statement) => prepare(statement.sql, statement.params)));
    },
  };
}

function planSelect(
  sql: string,
  tokens: Token[],
  paramCount: number,
): { ok: true; plan: OpsSqlPlan } | { ok: false; error: "invalid_sql" } {
  if (countParams(tokens) !== paramCount) return { ok: false, error: "invalid_sql" };
  return { ok: true, plan: { kind: "select", sql } };
}

function planInsert(
  sql: string,
  tokens: Token[],
  params: readonly SqlValue[],
): { ok: true; plan: OpsSqlPlan } | { ok: false; error: "invalid_sql" | "forbidden_sql" } {
  if (tokens[1]?.type !== "word" || tokens[1].text.toUpperCase() !== "INTO") return { ok: false, error: "invalid_sql" };
  const table = identifier(tokens[2]);
  if (!table) return { ok: false, error: "invalid_sql" };
  if (table.toLowerCase() === "ops_audit") return { ok: false, error: "forbidden_sql" };
  let index = 3;
  let columns: string[] | null = null;
  if (tokens[index]?.type === "punct" && tokens[index].text === "(") {
    const parsed = parseColumnList(tokens, index);
    if (!parsed) return { ok: false, error: "invalid_sql" };
    columns = parsed.columns;
    index = parsed.next;
  }
  const next = tokens[index];
  if (next?.type !== "word") return { ok: false, error: "invalid_sql" };
  const verb = next.text.toUpperCase();
  if (verb === "SELECT") {
    if (countParams(tokens.slice(0, index)) !== 0) return { ok: false, error: "invalid_sql" };
    if (countParams(tokens) !== params.length) return { ok: false, error: "invalid_sql" };
    const selectSql = sql.slice(next.start, tokens[tokens.length - 1]!.end).trim();
    return {
      ok: true,
      plan: {
        kind: "insert_select",
        sql,
        countSql: `SELECT COUNT(*) AS ops_row_count FROM (${selectSql}) AS ops_insert_src`,
        sampleSql: `SELECT * FROM (${selectSql}) AS ops_insert_src LIMIT ${OPS_SAMPLE_ROWS}`,
      },
    };
  }
  if (verb !== "VALUES") return { ok: false, error: "invalid_sql" };
  const tuples = parseTuples(tokens, index + 1);
  if (!tuples || tuples.length === 0) return { ok: false, error: "invalid_sql" };
  const width = tuples[0]!.length;
  if (tuples.some((tuple) => tuple.length !== width)) return { ok: false, error: "invalid_sql" };
  if (columns && columns.length !== width) return { ok: false, error: "invalid_sql" };
  const sample: OpsRow[] = [];
  let paramIndex = 0;
  for (const [tupleIndex, tuple] of tuples.entries()) {
    const row: OpsRow = {};
    for (const [columnIndex, node] of tuple.entries()) {
      const key = columns?.[columnIndex] ?? `col_${columnIndex}`;
      if (node.param) {
        const value = params[paramIndex];
        paramIndex += 1;
        if (value === undefined) return { ok: false, error: "invalid_sql" };
        row[key] = value;
      } else {
        row[key] = node.value;
      }
    }
    if (tupleIndex < OPS_SAMPLE_ROWS) sample.push(row);
  }
  if (paramIndex !== params.length) return { ok: false, error: "invalid_sql" };
  return { ok: true, plan: { kind: "insert_values", sql, rowCount: tuples.length, sample } };
}

function planUpdate(
  sql: string,
  tokens: Token[],
  paramCount: number,
): { ok: true; plan: OpsSqlPlan } | { ok: false; error: "invalid_sql" | "forbidden_sql" } {
  const table = identifier(tokens[1]);
  if (!table) return { ok: false, error: "invalid_sql" };
  if (table.toLowerCase() === "ops_audit") return { ok: false, error: "forbidden_sql" };
  if (table.toLowerCase() === "contractor" && assignsContractorActive(tokens)) return { ok: false, error: "forbidden_sql" };
  if (tokens[2]?.type !== "word" || tokens[2].text.toUpperCase() !== "SET") return { ok: false, error: "invalid_sql" };
  if (bannedUpdateClause(tokens)) return { ok: false, error: "invalid_sql" };
  if (rootWord(tokens, "SET") !== 2) return { ok: false, error: "invalid_sql" };
  const whereAt = rootWord(tokens, "WHERE");
  if (whereAt === -2) return { ok: false, error: "invalid_sql" };
  if (whereAt < 0) {
    if (countParams(tokens) !== paramCount) return { ok: false, error: "invalid_sql" };
    return {
      ok: true,
      plan: {
        kind: "update",
        sql,
        countSql: `SELECT COUNT(*) AS ops_row_count FROM ${table}`,
        sampleSql: `SELECT * FROM ${table} LIMIT ${OPS_SAMPLE_ROWS}`,
        whereParamOffset: paramCount,
      },
    };
  }
  if (whereAt === tokens.length - 1) return { ok: false, error: "invalid_sql" };
  const whereParamOffset = countParams(tokens.slice(0, whereAt));
  if (countParams(tokens) !== paramCount) return { ok: false, error: "invalid_sql" };
  const predicate = sql.slice(tokens[whereAt + 1]!.start, tokens[tokens.length - 1]!.end).trim();
  return {
    ok: true,
    plan: {
      kind: "update",
      sql,
      countSql: `SELECT COUNT(*) AS ops_row_count FROM ${table} WHERE ${predicate}`,
      sampleSql: `SELECT * FROM ${table} WHERE ${predicate} LIMIT ${OPS_SAMPLE_ROWS}`,
      whereParamOffset,
    },
  };
}

function assignsContractorActive(tokens: Token[]): boolean {
  let depth = 0;
  let seenSet = false;
  for (const [index, token] of tokens.entries()) {
    if (token.type === "punct" && token.text === "(") depth += 1;
    else if (token.type === "punct" && token.text === ")") depth -= 1;
    else if (depth === 0 && token.type === "word" && token.text.toUpperCase() === "SET") seenSet = true;
    else if (depth === 0 && seenSet && token.type === "word" && token.text.toUpperCase() === "WHERE") return false;
    else if (depth === 0 && seenSet && token.type === "word" && token.text.toLowerCase() === "active") {
      const next = tokens[index + 1];
      if (next?.type === "punct" && next.text === "=") return true;
    }
  }
  return false;
}

function bannedUpdateClause(tokens: Token[]): boolean {
  let depth = 0;
  for (const token of tokens) {
    if (token.type === "punct" && token.text === "(") depth += 1;
    else if (token.type === "punct" && token.text === ")") depth -= 1;
    else if (depth === 0 && token.type === "word" && UPDATE_BANNED_AT_ROOT.has(token.text.toUpperCase())) return true;
    if (depth < 0) return true;
  }
  return depth !== 0;
}

function rootWord(tokens: Token[], word: string): number {
  let depth = 0;
  let found = -1;
  for (const [index, token] of tokens.entries()) {
    if (token.type === "punct" && token.text === "(") depth += 1;
    else if (token.type === "punct" && token.text === ")") depth -= 1;
    else if (depth === 0 && token.type === "word" && token.text.toUpperCase() === word) {
      if (found >= 0) return -2;
      found = index;
    }
  }
  return found;
}

function parseColumnList(tokens: Token[], openIndex: number): { columns: string[]; next: number } | null {
  const columns: string[] = [];
  let index = openIndex + 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.type === "word") {
      if (!isSafeIdent(token.text)) return null;
      columns.push(token.text);
      index += 1;
      const separator = tokens[index];
      if (separator?.type === "punct" && separator.text === ",") {
        index += 1;
        continue;
      }
      if (separator?.type === "punct" && separator.text === ")") return { columns, next: index + 1 };
      return null;
    }
    return null;
  }
  return null;
}

function parseTuples(tokens: Token[], start: number): ValueNode[][] | null {
  const tuples: ValueNode[][] = [];
  let index = start;
  while (index < tokens.length) {
    if (tokens[index]?.type !== "punct" || tokens[index]?.text !== "(") return null;
    index += 1;
    const tuple: ValueNode[] = [];
    if (tokens[index]?.type === "punct" && tokens[index]?.text === ")") return null;
    while (index < tokens.length && !(tokens[index]?.type === "punct" && tokens[index]?.text === ")")) {
      const node = valueNode(tokens[index]);
      if (!node) return null;
      tuple.push(node);
      index += 1;
      if (tokens[index]?.type === "punct" && tokens[index]?.text === ",") {
        index += 1;
        if (tokens[index]?.type === "punct" && tokens[index]?.text === ")") return null;
        continue;
      }
      break;
    }
    if (tokens[index]?.type !== "punct" || tokens[index]?.text !== ")") return null;
    tuples.push(tuple);
    index += 1;
    if (index >= tokens.length) return tuples;
    if (tokens[index]?.type === "punct" && tokens[index]?.text === ",") {
      index += 1;
      continue;
    }
    return null;
  }
  return tuples.length > 0 ? tuples : null;
}

function valueNode(token: Token | undefined): ValueNode | null {
  if (!token) return null;
  if (token.type === "param") return { param: true };
  if (token.type === "number") {
    if (!/^-?\d+$/.test(token.text)) return null;
    return { param: false, value: Number(token.text) };
  }
  if (token.type === "string") return { param: false, value: decodeSqlString(token.text) };
  if (token.type === "word" && token.text.toUpperCase() === "NULL") return { param: false, value: null };
  return null;
}

function identifier(token: Token | undefined): string | null {
  if (!token || token.type !== "word" || !isSafeIdent(token.text)) return null;
  return token.text;
}

function isSafeIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !name.toLowerCase().startsWith("sqlite_");
}

function countParams(tokens: Token[]): number {
  return tokens.filter((token) => token.type === "param").length;
}

function isSqlValue(value: SqlValue): boolean {
  if (value === null) return true;
  if (typeof value === "string") return value.length <= 2_000;
  return Number.isInteger(value) && Math.abs(value) <= 1_000_000_000_000;
}

function decodeSqlString(token: string): string {
  return token.slice(1, -1).replaceAll("''", "'");
}

function tokenize(sql: string): { ok: true; tokens: Token[] } | { ok: false; error: "invalid_sql" } {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    if (char === " " || char === "\n" || char === "\t" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "-" && sql[index + 1] === "-") return { ok: false, error: "invalid_sql" };
    if (char === "/" && sql[index + 1] === "*") return { ok: false, error: "invalid_sql" };
    if (char === "'" ) {
      const end = scanString(sql, index);
      if (end < 0) return { ok: false, error: "invalid_sql" };
      tokens.push({ type: "string", text: sql.slice(index, end), start: index, end });
      index = end;
      continue;
    }
    if (char === "\"") {
      const end = scanQuoted(sql, index);
      if (end < 0) return { ok: false, error: "invalid_sql" };
      const text = sql.slice(index + 1, end - 1).replaceAll("\"\"", "\"");
      if (!isSafeIdent(text)) return { ok: false, error: "invalid_sql" };
      tokens.push({ type: "word", text, start: index, end });
      index = end;
      continue;
    }
    if (char === "?") {
      if (/[0-9]/.test(sql[index + 1] ?? "")) return { ok: false, error: "invalid_sql" };
      tokens.push({ type: "param", text: "?", start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_]/.test(sql[end]!)) end += 1;
      tokens.push({ type: "word", text: sql.slice(index, end), start: index, end });
      index = end;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let end = index + 1;
      while (end < sql.length && /[0-9]/.test(sql[end]!)) end += 1;
      tokens.push({ type: "number", text: sql.slice(index, end), start: index, end });
      index = end;
      continue;
    }
    const two = sql.slice(index, index + 2);
    if (two === "<=" || two === ">=" || two === "<>" || two === "!=" || two === "||") {
      tokens.push({ type: "punct", text: two, start: index, end: index + 2 });
      index += 2;
      continue;
    }
    if ("(),=<>.+-*/%;".includes(char)) {
      tokens.push({ type: "punct", text: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    return { ok: false, error: "invalid_sql" };
  }
  return { ok: true, tokens };
}

function scanString(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "'") {
      if (sql[index + 1] === "'") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return -1;
}

function scanQuoted(sql: string, start: number): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "\"") {
      if (sql[index + 1] === "\"") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return -1;
}

function canonicalPayload(payload: ConfirmPayload): string {
  return JSON.stringify({
    exp: payload.exp,
    params: payload.params,
    rowCount: payload.rowCount,
    sql: payload.sql,
  });
}

function parsePayload(text: string): ConfirmPayload | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (typeof row.sql !== "string" || !Number.isInteger(row.rowCount) || !Number.isInteger(row.exp)) return null;
    if (!Array.isArray(row.params) || !row.params.every((value) => isSqlValue(value as SqlValue))) return null;
    return {
      exp: row.exp as number,
      params: row.params as SqlValue[],
      rowCount: row.rowCount as number,
      sql: row.sql,
    };
  } catch {
    return null;
  }
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecodeBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): string | null {
  const bytes = base64UrlDecodeBytes(value);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return new Uint8Array(signature);
}

async function verifyHmac(secret: string, payload: string, signature: Uint8Array): Promise<boolean> {
  const key = await hmacKey(secret);
  const signatureBytes = new Uint8Array(signature.byteLength);
  signatureBytes.set(signature);
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(payload));
}
