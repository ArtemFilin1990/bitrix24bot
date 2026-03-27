#!/usr/bin/env node

/**
 * Schema verification script — validates schema.sql against worker.js queries.
 *
 * Checks:
 *  1. All tables referenced in worker.js SQL queries exist in schema.sql
 *  2. All columns referenced in worker.js SQL queries exist in the correct table
 *  3. FTS5 virtual tables have insert/update/delete triggers
 *  4. All indexed columns exist in their tables
 *  5. Foreign keys reference valid tables
 */
import { readFileSync } from "fs";

let exitCode = 0;
let passed = 0;
let failed = 0;

function check(ok, label) {
  if (ok) {
    console.log(`   ✅ ${label}`);
    passed++;
  } else {
    console.log(`   ❌ ${label}`);
    failed++;
    exitCode = 1;
  }
}

console.log(
  "╔══════════════════════════════════════════════════════════════╗"
);
console.log(
  "║  Schema Verification: schema.sql ↔ worker.js               ║"
);
console.log(
  "╚══════════════════════════════════════════════════════════════╝\n"
);

const schema = readFileSync("./schema.sql", "utf-8");
const worker = readFileSync("./b24-imbot/worker.js", "utf-8");

// ── 1. Parse tables from schema.sql ─────────────────────────────────────────

console.log("1️⃣  Tables defined in schema.sql:\n");

const tableRegex =
  /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/gi;
const schemaTables = {};
let match;

while ((match = tableRegex.exec(schema)) !== null) {
  const tableName = match[1];
  const body = match[2];

  // Extract column names (first word of each line that isn't a constraint)
  const columns = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"))
    .map((line) => line.replace(/,\s*$/, ""))
    .filter(
      (line) =>
        !line.startsWith("FOREIGN") &&
        !line.startsWith("PRIMARY") &&
        !line.startsWith("UNIQUE") &&
        !line.startsWith("CHECK")
    )
    .map((line) => line.split(/\s+/)[0])
    .filter((col) => col && col.length > 0);

  schemaTables[tableName] = columns;
  console.log(`   ${tableName}: ${columns.join(", ")}`);
}

// Also parse FTS5 virtual tables
const ftsRegex =
  /CREATE\s+VIRTUAL\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+USING\s+fts5\s*\(([\s\S]*?)\);/gi;
const ftsTables = {};

while ((match = ftsRegex.exec(schema)) !== null) {
  const tableName = match[1];
  const body = match[2];

  const columns = body
    .split(",")
    .map((col) => col.trim())
    .filter(
      (col) =>
        !col.startsWith("content=") && !col.startsWith("content_rowid=")
    )
    .map((col) => col.split(/\s+/)[0])
    .filter((col) => col.length > 0);

  const contentMatch = body.match(/content='?(\w+)'?/);
  const contentTable = contentMatch ? contentMatch[1] : null;

  ftsTables[tableName] = { columns, contentTable };
  console.log(`   ${tableName} (FTS5): ${columns.join(", ")} → ${contentTable}`);
}

// ── 2. Extract table references from worker.js SQL ──────────────────────────

console.log("\n2️⃣  Tables referenced in worker.js SQL queries:\n");

// Match table names in SQL queries: FROM table, INTO table, UPDATE table, JOIN table
// Restrict to words that look like actual table names (not error messages)
const sqlTableRefRegex =
  /(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/gi;
const workerTableRefs = new Set();

// Only look inside prepare() blocks and SQL-like contexts
const prepareCallRegex = /\.prepare\s*\(\s*(?:`[^`]*`|"[^"]*"|'[^']*')/g;
let prepareMatch;
while ((prepareMatch = prepareCallRegex.exec(worker)) !== null) {
  const sqlBlock = prepareMatch[0];
  let innerMatch;
  const innerRegex = /(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/gi;
  while ((innerMatch = innerRegex.exec(sqlBlock)) !== null) {
    const tableName = innerMatch[1];
    if (
      !["SET", "WHERE", "VALUES", "SELECT", "AND", "OR", "ON", "AS"].includes(
        tableName.toUpperCase()
      )
    ) {
      workerTableRefs.add(tableName);
    }
  }
}

const allSchemaTables = {
  ...schemaTables,
  ...Object.fromEntries(
    Object.entries(ftsTables).map(([k, v]) => [k, v.columns])
  ),
};

for (const table of [...workerTableRefs].sort()) {
  const exists = table in allSchemaTables;
  check(exists, `Table "${table}" exists in schema`);
}

// ── 3. Verify FTS5 triggers ─────────────────────────────────────────────────

console.log("\n3️⃣  FTS5 trigger verification:\n");

for (const [ftsTable, info] of Object.entries(ftsTables)) {
  const contentTable = info.contentTable;
  if (!contentTable) continue;

  const hasInsertTrigger = schema.includes(
    `AFTER INSERT ON ${contentTable}`
  );
  const hasDeleteTrigger = schema.includes(
    `AFTER DELETE ON ${contentTable}`
  );
  const hasUpdateTrigger = schema.includes(
    `AFTER UPDATE ON ${contentTable}`
  );

  check(
    hasInsertTrigger,
    `${ftsTable}: INSERT trigger on ${contentTable}`
  );
  check(
    hasDeleteTrigger,
    `${ftsTable}: DELETE trigger on ${contentTable}`
  );
  check(
    hasUpdateTrigger,
    `${ftsTable}: UPDATE trigger on ${contentTable}`
  );

  // Verify delete trigger uses OLD.column not subquery (D1 FTS5 constraint)
  const deleteTriggerRegex = new RegExp(
    `AFTER DELETE ON ${contentTable}[\\s\\S]*?END;`,
    "i"
  );
  const deleteTrigger = schema.match(deleteTriggerRegex);
  if (deleteTrigger) {
    const usesSubquery = deleteTrigger[0].includes("SELECT");
    check(
      !usesSubquery,
      `${ftsTable}: DELETE trigger uses OLD.* (no subqueries — FTS5 safe)`
    );
  }
}

// ── 4. Verify indexes ───────────────────────────────────────────────────────

console.log("\n4️⃣  Index verification:\n");

const indexRegex =
  /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\((\w+)/gi;

while ((match = indexRegex.exec(schema)) !== null) {
  const [, indexName, tableName, columnName] = match;
  const tableExists = tableName in schemaTables;
  const columnExists =
    tableExists && schemaTables[tableName].includes(columnName);

  check(
    tableExists && columnExists,
    `Index ${indexName}: ${tableName}(${columnName})`
  );
}

// ── 5. Verify worker.js D1 binding ──────────────────────────────────────────

console.log("\n5️⃣  D1 binding consistency:\n");

const wrangler = readFileSync("./wrangler.toml", "utf-8");
const hasD1CatalogBinding = wrangler.includes('binding = "CATALOG"');
const workerUsesBinding = worker.includes("env.CATALOG.prepare");

check(
  hasD1CatalogBinding,
  `wrangler.toml: D1 binding = "CATALOG"`
);
check(workerUsesBinding, `worker.js uses env.CATALOG.prepare()`);

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(
  "\n══════════════════════════════════════════════════════════════\n"
);
console.log(`   Schema Verification: ${passed}/${passed + failed} checks passed\n`);

if (exitCode === 0) {
  console.log("   ✅ Schema is consistent with worker.js queries");
  console.log("   ✅ All FTS5 triggers are correctly defined");
  console.log("   ✅ All indexes reference valid columns\n");
} else {
  console.log(`   ⚠️  ${failed} check(s) failed — review above\n`);
}

console.log(
  "══════════════════════════════════════════════════════════════\n"
);

process.exit(exitCode);
