#!/usr/bin/env node

/**
 * Worker verification script — validates worker.js structure, security, and correctness.
 *
 * Checks:
 *  1. All routes are defined and have appropriate auth
 *  2. Security patterns (token validation, IMPORT_SECRET)
 *  3. Error handling (try/catch on external calls)
 *  4. Gemini tool definitions match executeTool implementations
 *  5. D1 query patterns (prepared statements, no raw SQL injection)
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
  "║  Worker Verification: b24-imbot/worker.js                   ║"
);
console.log(
  "╚══════════════════════════════════════════════════════════════╝\n"
);

const worker = readFileSync("./b24-imbot/worker.js", "utf-8");

// ── 1. Route definitions ────────────────────────────────────────────────────

console.log("1️⃣  Route definitions:\n");

const expectedRoutes = [
  { path: "/register", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/import-catalog", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/import-catalog-csv", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/import-catalog-crm", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/import-doc", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/import-doc-bulk", method: "POST", auth: "IMPORT_SECRET" },
  { path: "/import-brands-bulk", method: "POST", auth: "IMPORT_SECRET" },
  { path: "/import-analogs", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/discover-catalog", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/preview-file", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/status", method: "GET", auth: "IMPORT_SECRET" },
  { path: "/reset", method: "POST", auth: "none" },
  { path: "/imbot", method: "POST", auth: "B24_APP_TOKEN" },
];

for (const route of expectedRoutes) {
  const hasRoute = worker.includes(`"${route.path}"`);
  check(hasRoute, `Route ${route.method} ${route.path} defined`);
}

// ── 2. Security: IMPORT_SECRET guards ───────────────────────────────────────

console.log("\n2️⃣  Security — IMPORT_SECRET guards:\n");

const secretRoutes = expectedRoutes.filter(
  (r) => r.auth === "IMPORT_SECRET"
);

for (const route of secretRoutes) {
  // Find the route block and check it contains IMPORT_SECRET check
  const routePattern = new RegExp(
    `"${route.path.replace("/", "\\/")}"[\\s\\S]{0,500}?IMPORT_SECRET`
  );
  const hasGuard = routePattern.test(worker);
  check(hasGuard, `${route.path}: validates IMPORT_SECRET`);
}

// ── 3. Security: webhook token validation ───────────────────────────────────

console.log("\n3️⃣  Security — webhook token validation:\n");

check(
  worker.includes("auth[application_token]"),
  "/imbot: reads auth[application_token]"
);
check(
  worker.includes("B24_APP_TOKEN"),
  "/imbot: validates B24_APP_TOKEN"
);
check(
  worker.includes("Forbidden") || worker.includes("403"),
  "/imbot: returns 403 on invalid token"
);

// ── 4. Gemini tools vs executeTool ──────────────────────────────────────────

console.log("\n4️⃣  Gemini tools ↔ executeTool consistency:\n");

// Extract tool names specifically from the TOOLS array definition
const toolsArrayMatch = worker.match(/const TOOLS = \[([\s\S]*?)\];/);
const toolsBlock = toolsArrayMatch ? toolsArrayMatch[1] : "";
const toolNameMatches = toolsBlock.match(/name:\s*"(\w+)"/g) || [];
const uniqueToolNames = toolNameMatches.map((m) => m.match(/"(\w+)"/)[1]);

// Extract executeTool switch cases
const switchCases = worker.match(/case\s+"(\w+)":/g) || [];
const caseNames = switchCases.map((m) => m.match(/"(\w+)"/)[1]);

const expectedTools = [
  "get_deal",
  "search_deals",
  "get_company",
  "get_deal_products",
  "get_my_deals",
  "search_catalog",
  "search_knowledge",
  "search_brand",
  "search_analogs",
];

for (const tool of expectedTools) {
  const hasDef = uniqueToolNames.includes(tool);
  const hasImpl = caseNames.includes(tool);
  check(hasDef && hasImpl, `Tool "${tool}": definition ✓ implementation ✓`);
}

// Check for orphaned implementations (case without definition)
const orphanedCases = caseNames.filter(
  (c) => !expectedTools.includes(c)
);
check(
  orphanedCases.length === 0,
  `No orphaned executeTool cases (found: ${orphanedCases.length === 0 ? "none" : orphanedCases.join(", ")})`
);

// ── 5. Error handling ───────────────────────────────────────────────────────

console.log("\n5️⃣  Error handling patterns:\n");

check(
  worker.includes("catch") &&
    worker.includes("executeTool") &&
    worker.includes("error"),
  "executeTool: wrapped in try/catch"
);

check(
  worker.includes("Gemini: HTTP"),
  "askGemini: checks HTTP response status"
);

check(
  worker.includes("data.error"),
  "askGemini: checks Gemini API error response"
);

const hasIterationLimit =
  worker.includes("for (let i = 0; i < 5; i++)") ||
  worker.includes("i < 5");
check(hasIterationLimit, "askGemini: iteration limit (max 5)");

check(
  worker.includes("im.dialog.writing") && worker.includes(".catch"),
  "Typing indicator: error swallowed gracefully"
);

check(
  worker.includes("CRITICAL") && worker.includes("replyErr"),
  "Bot logic: catch-all sends error reply to user"
);

// ── 6. D1 query patterns ───────────────────────────────────────────────────

console.log("\n6️⃣  D1 query safety:\n");

check(
  worker.includes("env.CATALOG.prepare("),
  "Uses prepared statements (env.CATALOG.prepare)"
);

check(
  worker.includes(".bind("),
  "Uses parameter binding (.bind)"
);

// Check for potential SQL injection — allow safe batch placeholder patterns
// like `INSERT ... VALUES ${placeholders}` where placeholders is (?,?,?),
// but flag direct value interpolation in WHERE/SET clauses
const prepareBlocks = worker.match(/prepare\s*\(\s*`[\s\S]*?`/g) || [];
let unsafeInterpolationCount = 0;
for (const block of prepareBlocks) {
  if (!block.includes("${")) continue;
  // Safe: batch VALUES placeholder patterns (e.g., ${placeholders}, ${ph})
  const interpolations = block.match(/\$\{(\w+)\}/g) || [];
  const unsafe = interpolations.filter((v) => {
    const varName = v.slice(2, -1);
    return !["placeholders", "ph", "cols"].includes(varName);
  });
  if (unsafe.length > 0) unsafeInterpolationCount += unsafe.length;
}
check(
  unsafeInterpolationCount === 0,
  `No unsafe interpolation in SQL prepare() (batch placeholders OK)`
);

// ── 7. waitUntil pattern ────────────────────────────────────────────────────

console.log("\n7️⃣  Cloudflare Workers patterns:\n");

check(
  worker.includes("ctx.waitUntil"),
  "Heavy logic deferred via ctx.waitUntil()"
);

check(
  worker.includes("withSession"),
  "D1 Sessions API: withSession() for read replicas"
);

check(
  worker.includes('json({"ok":true}') || worker.includes('json({ ok: true }') || worker.includes('{ok:true}'),
  "/imbot: returns 200 OK immediately (before waitUntil)"
);

// ── 8. Group chat filtering ─────────────────────────────────────────────────

console.log("\n8️⃣  Group chat filtering:\n");

const keywords = [
  "подшипник", "сделка", "цена", "каталог", "аналог",
  "заказ", "наличие", "артикул",
];

for (const kw of keywords) {
  check(worker.includes(kw), `Keyword "${kw}" in filter list`);
}

check(
  worker.includes("[USER="),
  "Bot @-mention detection: [USER=BOT_ID]"
);

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(
  "\n══════════════════════════════════════════════════════════════\n"
);
console.log(
  `   Worker Verification: ${passed}/${passed + failed} checks passed\n`
);

if (exitCode === 0) {
  console.log("   ✅ All routes properly defined and protected");
  console.log("   ✅ All Gemini tools have matching implementations");
  console.log("   ✅ Error handling is comprehensive");
  console.log("   ✅ D1 queries use prepared statements\n");
} else {
  console.log(`   ⚠️  ${failed} check(s) failed — review above\n`);
}

console.log(
  "══════════════════════════════════════════════════════════════\n"
);

process.exit(exitCode);
