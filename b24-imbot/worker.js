// b24-imbot/worker.js
// Внутренний ИИ-бот для Bitrix24 (im.bot) на Cloudflare Workers + Gemini 2.0 Flash
// Менеджер пишет боту в личный чат → бот отвечает с данными из CRM

const SYSTEM_PROMPT = `Ты — внутренний ИИ-помощник менеджера компании Эверест (оптовая поставка подшипников, Вологда).
Работаешь внутри Bitrix24 как бот в личном чате.

Умеешь:
- Искать и анализировать сделки из CRM
- Показывать данные компаний клиентов
- Искать подшипники в каталоге: цена, остаток на складе, размеры, масса
- Находить аналоги подшипников (ГОСТ ↔ ISO, импорт ↔ отечественные)
- Рассказывать о производителях подшипников
- Помогать с текстами: КП, письма, описания

Правила:
- Отвечай кратко и по делу
- Используй инструменты когда нужны данные из CRM или каталога
- При вопросе о подшипнике — всегда проверяй наличие и цену через search_catalog
- При вопросе об аналоге — используй search_analogs, затем при необходимости search_knowledge
- Суммы в рублях, артикулы точно
- Форматируй ответы для Bitrix24 чата (поддерживает [B]жирный[/B], [I]курсив[/I], [URL=link]текст[/URL])
- Если данных нет — скажи честно, не выдумывай`;

// ── Tools ─────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_deal",
    description: "Получить данные сделки по ID",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string", description: "ID сделки" }
      },
      required: ["deal_id"]
    }
  },
  {
    name: "search_deals",
    description: "Найти сделки по названию, компании или стадии",
    input_schema: {
      type: "object",
      properties: {
        query:    { type: "string",  description: "Поисковый запрос" },
        stage_id: { type: "string",  description: "Стадия: NEW/PROPOSAL/NEGOTIATION/INVOICE/PAYMENT/WON/LOSE" },
        limit:    { type: "integer", description: "Кол-во результатов (по умолчанию 5)" }
      },
      required: []
    }
  },
  {
    name: "get_company",
    description: "Получить данные компании по ID",
    input_schema: {
      type: "object",
      properties: {
        company_id: { type: "string", description: "ID компании" }
      },
      required: ["company_id"]
    }
  },
  {
    name: "get_deal_products",
    description: "Получить список товаров в сделке",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string", description: "ID сделки" }
      },
      required: ["deal_id"]
    }
  },
  {
    name: "get_my_deals",
    description: "Получить сделки текущего менеджера (активные)",
    input_schema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "ID пользователя B24" },
        limit:   { type: "integer", description: "Кол-во (по умолчанию 10)" }
      },
      required: ["user_id"]
    }
  },
  {
    name: "search_catalog",
    description: "Найти подшипник в каталоге по артикулу, обозначению, ГОСТ или ISO номеру. Возвращает: производитель, обозначение, размеры (d/D/B мм), масса, цена (руб), остаток на складе, наличие. Использовать при вопросах об артикулах, цене, наличии, весе, размерах подшипников.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Артикул, обозначение, ГОСТ или ISO номер подшипника (например: 6205, 6205-2RS, NU 220, 180205)" }
      },
      required: ["query"]
    }
  },
  {
    name: "search_knowledge",
    description: "Найти информацию в базе знаний: технические каталоги, статьи о производстве, ГОСТ/ISO таблицы, аналоги. Использовать при вопросах о размерах, типах подшипников, стандартах.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос (например: ГОСТ 7242 таблица, конический подшипник размеры)" }
      },
      required: ["query"]
    }
  },
  {
    name: "search_brand",
    description: "Получить информацию о производителе подшипников: история, специализация, страна. Использовать при вопросах о конкретном бренде/заводе.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Название бренда/производителя (например: SKF, FAG, ZKL, ГПЗ)" }
      },
      required: ["name"]
    }
  },
  {
    name: "search_analogs",
    description: "Найти аналоги подшипника по обозначению или бренду. Использовать при вопросах о взаимозаменяемости, аналогах ГОСТ/ISO, заменах импортных на отечественные.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Обозначение или артикул подшипника (например: 6205, 6205-2RS, 180205)" }
      },
      required: ["query"]
    }
  }
];

// ── B24 helpers ───────────────────────────────────────────
async function b24(env, method, params = {}) {
  const url = `https://${env.B24_PORTAL}/rest/${env.B24_USER_ID}/${env.B24_TOKEN}/${method}.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const d = await r.json();
  if (d.error) throw new Error(`B24 ${method}: ${d.error} — ${d.error_description || ""}`);
  return d.result;
}

// Отправить сообщение от бота в чат
async function botReply(env, chatId, text) {
  await b24(env, "imbot.message.add", {
    BOT_ID:    env.BOT_ID,
    CLIENT_ID: env.CLIENT_ID,
    DIALOG_ID: chatId,
    MESSAGE:   text,
  });
}

// ── Tool executor ─────────────────────────────────────────
async function executeTool(env, name, args) {
  try {
    switch (name) {
      case "get_deal": {
        const d = await b24(env, "crm.deal.get", { id: args.deal_id });
        return JSON.stringify({
          id: d.ID, title: d.TITLE, stage: d.STAGE_ID,
          amount: d.OPPORTUNITY, currency: d.CURRENCY_ID,
          company_id: d.COMPANY_ID, responsible: d.ASSIGNED_BY_ID,
          modified: d.DATE_MODIFY, comment: d.COMMENTS,
          inn: d.UF_INN, brands: d.UF_BEARING_BRANDS,
          positions: d.UF_POSITIONS_COUNT, delivery: d.UF_DELIVERY_TYPE,
        });
      }
      case "search_deals": {
        const filter = {};
        if (args.stage_id) filter.STAGE_ID = args.stage_id;
        if (args.query)    filter["%TITLE"] = args.query;
        const deals = await b24(env, "crm.deal.list", {
          filter,
          select: ["ID", "TITLE", "STAGE_ID", "OPPORTUNITY", "COMPANY_ID", "DATE_MODIFY", "ASSIGNED_BY_ID"],
          order: { DATE_MODIFY: "DESC" },
          start: 0,
        });
        return JSON.stringify((deals || []).slice(0, args.limit || 5).map(d => ({
          id: d.ID, title: d.TITLE, stage: d.STAGE_ID,
          amount: d.OPPORTUNITY, modified: d.DATE_MODIFY,
        })));
      }
      case "get_company": {
        const c = await b24(env, "crm.company.get", { id: args.company_id });
        return JSON.stringify({
          id: c.ID, title: c.TITLE,
          inn: c.UF_INN, kpp: c.UF_KPP, ogrn: c.UF_OGRN,
          region: c.UF_REGION, verified: c.UF_VERIFIED,
          phone: c.PHONE?.[0]?.VALUE, email: c.EMAIL?.[0]?.VALUE,
        });
      }
      case "get_deal_products": {
        const rows = await b24(env, "crm.deal.productrows.get", { id: args.deal_id });
        return JSON.stringify((rows || []).map(p => ({
          name: p.PRODUCT_NAME, qty: p.QUANTITY,
          price: p.PRICE, total: +(p.PRICE * p.QUANTITY).toFixed(2),
        })));
      }
      case "get_my_deals": {
        const deals = await b24(env, "crm.deal.list", {
          filter: { ASSIGNED_BY_ID: args.user_id, "!STAGE_ID": ["WON", "LOSE"] },
          select: ["ID", "TITLE", "STAGE_ID", "OPPORTUNITY", "DATE_MODIFY"],
          order: { DATE_MODIFY: "DESC" },
          start: 0,
        });
        return JSON.stringify((deals || []).slice(0, args.limit || 10).map(d => ({
          id: d.ID, title: d.TITLE, stage: d.STAGE_ID,
          amount: d.OPPORTUNITY, modified: d.DATE_MODIFY,
        })));
      }
      case "search_catalog": {
        const q = `%${args.query}%`;
        // Сначала ищем в расширенном каталоге с ценами и остатками
        const { results: catRows } = await env.CATALOG.prepare(
          `SELECT manufacturer, designation, name_ru, category_ru, subcategory_ru,
                  d_mm, big_d_mm, b_mm, mass_kg, price_rub, qty, stock_flag,
                  gost_ref, iso_ref, brand_display, suffix_desc
           FROM catalog
           WHERE designation LIKE ? OR name_ru LIKE ? OR gost_ref LIKE ? OR iso_ref LIKE ?
           ORDER BY stock_flag DESC, qty DESC
           LIMIT 10`
        ).bind(q, q, q, q).all();
        if (catRows.length) {
          return JSON.stringify(catRows.map(r => ({
            производитель: r.manufacturer,
            обозначение: r.designation,
            наименование: r.name_ru,
            категория: [r.category_ru, r.subcategory_ru].filter(Boolean).join(" / "),
            d_мм: r.d_mm, D_мм: r.big_d_mm, B_мм: r.b_mm,
            масса_кг: r.mass_kg,
            цена_руб: r.price_rub,
            кол_во: r.qty,
            в_наличии: r.stock_flag ? "да" : "нет",
            гост: r.gost_ref, iso: r.iso_ref,
            бренд: r.brand_display,
            суффикс: r.suffix_desc,
          })));
        }
        // Запасной вариант — упрощённая таблица bearings
        const { results } = await env.CATALOG.prepare(
          `SELECT name, article, brand, weight
           FROM bearings
           WHERE name LIKE ? OR article LIKE ?
           LIMIT 10`
        ).bind(q, q).all();
        if (!results.length) return JSON.stringify({ found: 0, message: "Подшипник не найден в базе" });
        return JSON.stringify(results.map(r => ({
          наименование: r.name,
          артикул: r.article,
          завод: r.brand,
          вес_кг: r.weight,
        })));
      }
      case "search_knowledge": {
        // Используем FTS5 для полнотекстового поиска (быстро и точно)
        // Fallback на LIKE если FTS не вернул результатов
        const ftsQuery = args.query.trim().replace(/['"*]/g, " ").trim();
        let results = [];
        if (ftsQuery) {
          try {
            const fts = await env.CATALOG.prepare(
              `SELECT k.title, substr(k.content,1,4000) as content, k.tags
               FROM knowledge k JOIN knowledge_fts ON k.id = knowledge_fts.rowid
               WHERE knowledge_fts MATCH ?
               ORDER BY rank LIMIT 3`
            ).bind(ftsQuery).all();
            results = fts.results;
          } catch {}
        }
        if (!results.length) {
          const q = `%${args.query}%`;
          const like = await env.CATALOG.prepare(
            `SELECT title, substr(content,1,4000) as content, tags FROM knowledge
             WHERE title LIKE ? OR tags LIKE ?
             LIMIT 3`
          ).bind(q, q).all();
          results = like.results;
        }
        if (!results.length) return JSON.stringify({ found: 0, message: "Информация не найдена в базе знаний" });
        return JSON.stringify(results.map(r => ({ заголовок: r.title, содержание: r.content, теги: r.tags })));
      }
      case "search_brand": {
        const q = `%${args.name}%`;
        const { results } = await env.CATALOG.prepare(
          `SELECT name, substr(description,1,2000) as description FROM brands
           WHERE name LIKE ? OR description LIKE ?
           LIMIT 3`
        ).bind(q, q).all();
        if (!results.length) return JSON.stringify({ found: 0, message: "Производитель не найден" });
        return JSON.stringify(results.map(r => ({ бренд: r.name, описание: r.description })));
      }
      case "search_analogs": {
        const q = `%${args.query}%`;
        const { results } = await env.CATALOG.prepare(
          `SELECT brand, designation, analog_designation, analog_brand, factory
           FROM analogs
           WHERE designation LIKE ? OR analog_designation LIKE ?
           LIMIT 20`
        ).bind(q, q).all();
        if (!results.length) return JSON.stringify({ found: 0, message: "Аналоги не найдены в базе" });
        return JSON.stringify(results.map(r => ({
          бренд: r.brand,
          обозначение: r.designation,
          аналог: r.analog_designation,
          бренд_аналога: r.analog_brand,
          завод: r.factory,
        })));
      }
      default:
        return JSON.stringify({ error: "Unknown tool: " + name });
    }
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

// ── Gemini 2.0 Flash с function calling ──────────────────
const GEMINI_TOOLS = [{
  functionDeclarations: TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))
}];

async function askGemini(env, history, userText) {
  const MODEL = env.GEMINI_MODEL || "gemini-2.5-flash";
  const URL   = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  const contents = [
    ...history,
    { role: "user", parts: [{ text: userText }] },
  ];

  for (let i = 0; i < 5; i++) {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: GEMINI_TOOLS,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
      }),
    });

    const data = await r.json();
    if (data.error) throw new Error(`Gemini: ${data.error.message}`);

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    contents.push({ role: "model", parts });

    const fnCalls = parts.filter(p => p.functionCall);
    if (!fnCalls.length) {
      return {
        text: parts.filter(p => p.text).map(p => p.text).join("") || "—",
        history: contents.slice(-20), // хранить последние 20 turns
      };
    }

    // Выполнить tool calls
    const fnResults = await Promise.all(fnCalls.map(async p => ({
      functionResponse: {
        name: p.functionCall.name,
        response: { result: await executeTool(env, p.functionCall.name, p.functionCall.args) },
      }
    })));
    contents.push({ role: "user", parts: fnResults });
  }

  return { text: "Превышен лимит итераций.", history: contents.slice(-20) };
}

// ── KV: история диалогов ─────────────────────────────────
// Использует Cloudflare KV для хранения истории по user_id
// Привязать KV namespace "CHAT_HISTORY" в wrangler.toml

// Bitrix24 user IDs are always positive integers
function sanitizeUserId(userId) {
  if (!userId || !/^\d+$/.test(String(userId))) return null;
  return String(userId);
}

async function getHistory(env, userId) {
  try {
    const safe = sanitizeUserId(userId);
    if (!safe) return [];
    const raw = await env.CHAT_HISTORY.get(`history:${safe}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveHistory(env, userId, history) {
  try {
    const safe = sanitizeUserId(userId);
    if (!safe) return;
    await env.CHAT_HISTORY.put(`history:${safe}`, JSON.stringify(history), {
      expirationTtl: 60 * 60 * 24, // 24 часа
    });
  } catch {}
}

// ── Регистрация бота ─────────────────────────────────────
// Вызвать один раз: GET /register
async function registerBot(env) {
  const workerUrl = `https://${env.WORKER_HOST}`;
  return await b24(env, "imbot.register", {
    CODE:        "everest_ai_bot",
    TYPE:        "B",  // Bot
    EVENT_HANDLER: `${workerUrl}/imbot`,
    OPENLINE:    "N",
    CLIENT_ID:   "everest_ai_bot",
    PROPERTIES: {
      NAME:         "ИИ-помощник Эверест",
      COLOR:        "AQUA",
      WORK_POSITION: "AI Assistant",
      PERSONAL_WWW:  "https://ewerest.ru",
    },
  });
}

// ── Main handler ──────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    // Регистрация бота (вызвать один раз вручную)
    if (url.pathname === "/register" && request.method === "GET") {
      try {
        const result = await registerBot(env);
        return json({ ok: true, bot_id: result, note: "Сохрани BOT_ID в secrets: wrangler secret put BOT_ID" });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Импорт каталога из Bitrix24 Disk (разовая операция)
    // GET /import-catalog?file_id=58925&secret=<IMPORT_SECRET>
    if (url.pathname === "/import-catalog" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const fileId   = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      if (!fileId && !directUrl) return json({ error: "file_id or url required" }, 400);
      try {
        // Получаем download URL: напрямую или через Bitrix24 API
        const downloadUrl = directUrl || (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const csvResp = await fetch(downloadUrl);
        const csvText = await csvResp.text();

        // Парсим CSV (разделитель ;, UTF-8 BOM)
        const lines = csvText.replace(/^\uFEFF/, "").split("\n").filter(l => l.trim());
        const header = lines[0].split(";").map(h => h.trim());
        const iName = header.indexOf("Наименование");
        const iArt  = header.indexOf("Артикул");
        const iBrand = header.indexOf("Завод");
        const iWeight = header.findIndex(h => h.startsWith("Вес"));

        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(";");
          const name    = (cols[iName]   || "").trim().replace(/'/g, "''");
          const article = (cols[iArt]    || "").trim().replace(/'/g, "''");
          const brand   = (cols[iBrand]  || "").trim().replace(/'/g, "''");
          const wRaw    = (cols[iWeight] || "").trim().replace(",", ".");
          const weight  = parseFloat(wRaw) || null;
          if (name && article) rows.push({ name, article, brand, weight });
        }

        // Очищаем и вставляем батчами по 100
        await env.CATALOG.prepare("DELETE FROM bearings").run();
        let inserted = 0;
        const BATCH = 20;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const placeholders = batch.map(() => "(?,?,?,?)").join(",");
          const values = batch.flatMap(r => [r.name, r.article, r.brand, r.weight]);
          await env.CATALOG.prepare(
            `INSERT INTO bearings (name,article,brand,weight) VALUES ${placeholders}`
          ).bind(...values).run();
          inserted += batch.length;
        }
        return json({ ok: true, inserted, total: rows.length });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Bulk-импорт документов: POST /import-doc-bulk {secret, docs:[{title,content,tags}]}
    if (url.pathname === "/import-doc-bulk" && request.method === "POST") {
      const body = await request.json();
      if (body.secret !== env.IMPORT_SECRET) return json({ error: "Forbidden" }, 403);
      const docs = body.docs || [];
      let inserted = 0;
      for (const doc of docs) {
        const { title, content, tags = "" } = doc;
        if (!title || !content) continue;
        await env.CATALOG.prepare("DELETE FROM knowledge WHERE title = ?").bind(title).run();
        await env.CATALOG.prepare(
          "INSERT INTO knowledge (title, content, tags) VALUES (?,?,?)"
        ).bind(title, content, tags).run();
        inserted++;
      }
      return json({ ok: true, inserted });
    }

    // Bulk-импорт брендов: POST /import-brands-bulk {secret, brands:[{name,description,logo_url,search_url}]}
    if (url.pathname === "/import-brands-bulk" && request.method === "POST") {
      const body = await request.json();
      if (body.secret !== env.IMPORT_SECRET) return json({ error: "Forbidden" }, 403);
      let inserted = 0;
      for (const b of (body.brands || [])) {
        const { name, description = "", logo_url = "", search_url = "" } = b;
        if (!name) continue;
        await env.CATALOG.prepare(
          `INSERT INTO brands (name,description,logo_url,search_url) VALUES (?,?,?,?)
           ON CONFLICT(name) DO UPDATE SET description=excluded.description,
           logo_url=excluded.logo_url, search_url=excluded.search_url`
        ).bind(name, description, logo_url, search_url).run();
        inserted++;
      }
      return json({ ok: true, inserted });
    }

    // Импорт MD-документа в базу знаний из Bitrix24 Disk
    // GET /import-doc?file_id=<id>&secret=<IMPORT_SECRET>&tags=tag1,tag2
    if (url.pathname === "/import-doc" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const fileId    = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      const tags      = url.searchParams.get("tags") || "";
      if (!fileId && !directUrl) return json({ error: "file_id or url required" }, 400);
      try {
        const meta        = fileId ? await b24(env, "disk.file.get", { id: fileId }) : null;
        const downloadUrl = directUrl || meta.DOWNLOAD_URL;
        const title       = url.searchParams.get("title") ||
                            (meta ? meta.NAME.replace(/_/g, " ").replace(/\.md$/i, "") : "Документ");
        const content     = await (await fetch(downloadUrl)).text();
        // Удаляем старую версию с таким же заголовком (upsert)
        await env.CATALOG.prepare("DELETE FROM knowledge WHERE title = ?").bind(title).run();
        await env.CATALOG.prepare(
          "INSERT INTO knowledge (title, content, tags) VALUES (?,?,?)"
        ).bind(title, content, tags).run();
        return json({ ok: true, title, bytes: content.length });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Импорт расширенного каталога из CSV (Bitrix24 Disk)
    // GET /import-catalog-csv?file_id=<id>&secret=<IMPORT_SECRET>[&dry_run=1&sep=;]
    if (url.pathname === "/import-catalog-csv" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const fileId    = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      if (!fileId && !directUrl) return json({ error: "file_id or url required" }, 400);
      const sep = url.searchParams.get("sep") || ";";
      try {
        const downloadUrl = directUrl || (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const text = await (await fetch(downloadUrl)).text();
        const lines = text.replace(/^\uFEFF/, "").split("\n").filter(l => l.trim());
        const header = lines[0].split(sep).map(h => h.trim());
        const hi = h => header.findIndex(c => c.toLowerCase().includes(h));

        const cols = {
          item_id:         url.searchParams.get("c_item_id")    ?? String(hi("id") >= 0 ? hi("id") : 0),
          manufacturer:    url.searchParams.get("c_manuf")      ?? String(hi("произв") >= 0 ? hi("произв") : hi("завод")),
          category_ru:     url.searchParams.get("c_cat")        ?? String(hi("раздел1") >= 0 ? hi("раздел1") : hi("категор")),
          subcategory_ru:  url.searchParams.get("c_subcat")     ?? String(hi("раздел2") >= 0 ? hi("раздел2") : hi("подкатег")),
          series_ru:       url.searchParams.get("c_series")     ?? String(hi("серия") >= 0 ? hi("серия") : hi("раздел3")),
          name_ru:         url.searchParams.get("c_name")       ?? String(hi("наимен")),
          designation:     url.searchParams.get("c_desig")      ?? String(hi("обознач") >= 0 ? hi("обознач") : hi("артикул")),
          iso_ref:         url.searchParams.get("c_iso")        ?? String(hi("iso")),
          gost_ref:        url.searchParams.get("c_gost")       ?? String(hi("гост")),
          section:         url.searchParams.get("c_section")    ?? String(hi("секция") >= 0 ? hi("секция") : hi("тип")),
          d_mm:            url.searchParams.get("c_d")          ?? String(hi(" d ") >= 0 ? hi(" d ") : hi("внутр")),
          big_d_mm:        url.searchParams.get("c_D")          ?? String(hi(" d ") >= 0 ? hi(" d,") : hi("наруж")),
          b_mm:            url.searchParams.get("c_b")          ?? String(hi(" b ") >= 0 ? hi(" b ") : hi("шири")),
          t_mm:            url.searchParams.get("c_t")          ?? String(hi(" t ")),
          mass_kg:         url.searchParams.get("c_mass")       ?? String(hi("масс") >= 0 ? hi("масс") : hi("вес")),
          analog_ref:      url.searchParams.get("c_analog")     ?? String(hi("аналог")),
          price_rub:       url.searchParams.get("c_price")      ?? String(hi("цен")),
          qty:             url.searchParams.get("c_qty")        ?? String(hi("кол") >= 0 ? hi("кол") : hi("остат")),
          stock_flag:      url.searchParams.get("c_stock")      ?? String(hi("налич")),
          bitrix_section_1:url.searchParams.get("c_s1")         ?? String(hi("раздел_1") >= 0 ? hi("раздел_1") : -1),
          bitrix_section_2:url.searchParams.get("c_s2")         ?? String(hi("раздел_2") >= 0 ? hi("раздел_2") : -1),
          bitrix_section_3:url.searchParams.get("c_s3")         ?? String(hi("раздел_3") >= 0 ? hi("раздел_3") : -1),
          brand_display:   url.searchParams.get("c_brand")      ?? String(hi("бренд")),
          suffix_desc:     url.searchParams.get("c_suffix")     ?? String(hi("суффикс") >= 0 ? hi("суффикс") : hi("модиф")),
        };

        if (url.searchParams.get("dry_run") === "1") {
          return json({ header, cols, sample: lines.slice(1, 4).map(l => l.split(sep)) });
        }

        const get = (cols, idx, row) => {
          const i = parseInt(idx);
          return i >= 0 ? (row[i] || "").trim() : "";
        };
        const getNum = (cols, idx, row) => parseFloat((get(cols, idx, row)).replace(",", ".")) || null;

        await env.CATALOG.prepare("DELETE FROM catalog").run();
        const BATCH = 10;
        let inserted = 0;
        for (let i = 1; i < lines.length; i += BATCH) {
          const batch = [];
          for (let j = i; j < Math.min(i + BATCH, lines.length); j++) {
            const row = lines[j].split(sep);
            const itemId = get(cols, cols.item_id, row) || String(j);
            batch.push([
              itemId,
              get(cols, cols.manufacturer, row),
              get(cols, cols.category_ru, row),
              get(cols, cols.subcategory_ru, row),
              get(cols, cols.series_ru, row),
              get(cols, cols.name_ru, row),
              get(cols, cols.designation, row),
              get(cols, cols.iso_ref, row),
              get(cols, cols.section, row),
              getNum(cols, cols.d_mm, row),
              getNum(cols, cols.big_d_mm, row),
              getNum(cols, cols.b_mm, row),
              getNum(cols, cols.t_mm, row),
              getNum(cols, cols.mass_kg, row),
              get(cols, cols.analog_ref, row),
              getNum(cols, cols.price_rub, row),
              parseInt(get(cols, cols.qty, row)) || null,
              get(cols, cols.stock_flag, row) === "1" || get(cols, cols.stock_flag, row).toLowerCase() === "да" ? 1 : 0,
              get(cols, cols.bitrix_section_1, row),
              get(cols, cols.bitrix_section_2, row),
              get(cols, cols.bitrix_section_3, row),
              get(cols, cols.gost_ref, row),
              get(cols, cols.brand_display, row),
              get(cols, cols.suffix_desc, row),
            ]);
          }
          if (!batch.length) continue;
          const ph = batch.map(() => "("+Array(24).fill("?").join(",")+")").join(",");
          await env.CATALOG.prepare(
            `INSERT OR REPLACE INTO catalog
             (item_id,manufacturer,category_ru,subcategory_ru,series_ru,name_ru,designation,
              iso_ref,section,d_mm,big_d_mm,b_mm,t_mm,mass_kg,analog_ref,price_rub,qty,stock_flag,
              bitrix_section_1,bitrix_section_2,bitrix_section_3,gost_ref,brand_display,suffix_desc)
             VALUES ${ph}`
          ).bind(...batch.flat()).run();
          inserted += batch.length;
        }
        return json({ ok: true, inserted, cols });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Импорт каталога из Bitrix24 CRM (catalog.product.list)
    // GET /import-catalog-crm?secret=<IMPORT_SECRET>[&section_id=<id>&limit=500]
    if (url.pathname === "/import-catalog-crm" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const sectionId = url.searchParams.get("section_id") || null;
      const maxItems  = parseInt(url.searchParams.get("limit") || "2000");
      const truncate  = url.searchParams.get("truncate") !== "0";
      try {
        if (truncate) await env.CATALOG.prepare("DELETE FROM catalog").run();

        const SELECT = [
          "ID","NAME","PROPERTY_MANUFACTURER","PROPERTY_DESIGNATION",
          "PROPERTY_GOST","PROPERTY_ISO","PROPERTY_D","PROPERTY_BIG_D",
          "PROPERTY_B","PROPERTY_T","PROPERTY_MASS","PROPERTY_ANALOG",
          "PROPERTY_SUFFIX","PRICE","CATALOG_QUANTITY","CATALOG_AVAILABLE",
          "IBLOCK_SECTION_ID",
        ];
        let start = 0, inserted = 0, hasMore = true;
        while (hasMore && inserted < maxItems) {
          const filter = sectionId ? { IBLOCK_SECTION_ID: sectionId } : {};
          // b24() returns d.result; for list calls we need raw response for pagination
          const rawUrl = `https://${env.B24_PORTAL}/rest/${env.B24_USER_ID}/${env.B24_TOKEN}/catalog.product.list.json`;
          const rawResp = await fetch(rawUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filter, select: SELECT, start }),
          });
          const rawData = await rawResp.json();
          if (rawData.error) throw new Error(`B24 catalog.product.list: ${rawData.error}`);
          const items = rawData.result?.products ?? rawData.result ?? [];
          if (!items.length) break;

          const BATCH = 10;
          for (let i = 0; i < items.length; i += BATCH) {
            const batch = items.slice(i, i + BATCH);
            const ph = batch.map(() => "("+Array(24).fill("?").join(",")+")").join(",");
            const vals = batch.flatMap(p => {
              const prop = name => p[name]?.[0]?.value ?? p[name] ?? null;
              const num  = name => parseFloat(String(prop(name) || "").replace(",",".")) || null;
              return [
                String(p.ID || p.id || ""),
                String(prop("PROPERTY_MANUFACTURER") || prop("manufacturer") || ""),
                "", "", "",  // category, subcategory, series (заполняются при CSV-импорте)
                String(p.NAME || p.name || ""),
                String(prop("PROPERTY_DESIGNATION") || prop("designation") || p.NAME || ""),
                String(prop("PROPERTY_ISO") || prop("isoRef") || ""),
                "",
                num("PROPERTY_D") ?? num("d"), num("PROPERTY_BIG_D") ?? num("bigD"),
                num("PROPERTY_B") ?? num("b"), num("PROPERTY_T") ?? num("t"),
                num("PROPERTY_MASS") ?? num("mass"),
                String(prop("PROPERTY_ANALOG") || prop("analogRef") || ""),
                num("PRICE") ?? num("price"),
                parseInt(prop("CATALOG_QUANTITY") ?? prop("quantity")) || null,
                (prop("CATALOG_AVAILABLE") ?? prop("available")) === "Y" ? 1 : 0,
                String(p.IBLOCK_SECTION_ID || p.iblockSectionId || ""), "", "",
                String(prop("PROPERTY_GOST") || prop("gostRef") || ""),
                "",
                String(prop("PROPERTY_SUFFIX") || prop("suffixDesc") || ""),
              ];
            });
            await env.CATALOG.prepare(
              `INSERT OR REPLACE INTO catalog
               (item_id,manufacturer,category_ru,subcategory_ru,series_ru,name_ru,designation,
                iso_ref,section,d_mm,big_d_mm,b_mm,t_mm,mass_kg,analog_ref,price_rub,qty,stock_flag,
                bitrix_section_1,bitrix_section_2,bitrix_section_3,gost_ref,brand_display,suffix_desc)
               VALUES ${ph}`
            ).bind(...vals).run();
          }
          inserted += items.length;
          // Пагинация: B24 возвращает next если есть ещё страницы
          hasMore = rawData.next != null;
          start = rawData.next ?? (start + items.length);
        }
        return json({ ok: true, inserted });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Просмотр первых строк файла из Bitrix24 Disk
    // GET /preview-file?file_id=<id>&secret=<IMPORT_SECRET>&lines=10
    if (url.pathname === "/preview-file" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const fileId    = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      const n         = parseInt(url.searchParams.get("lines") || "10");
      if (!fileId && !directUrl) return json({ error: "file_id or url required" }, 400);
      try {
        const downloadUrl = directUrl || (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const text = await (await fetch(downloadUrl)).text();
        const lines = text.replace(/^\uFEFF/, "").split("\n").slice(0, n);
        return json({ lines, total_chars: text.length });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Импорт аналогов из CSV файла Bitrix24 Disk в таблицу analogs
    // GET /import-analogs?file_id=<id>&secret=<IMPORT_SECRET>[&sep=;&col_brand=0&col_desig=1&col_adesig=2&col_abrand=3&col_factory=4]
    if (url.pathname === "/import-analogs" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const fileId    = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      if (!fileId && !directUrl) return json({ error: "file_id or url required" }, 400);
      const sep = url.searchParams.get("sep") || ";";
      try {
        const downloadUrl = directUrl || (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const text = await (await fetch(downloadUrl)).text();
        const lines = text.replace(/^\uFEFF/, "").split("\n").filter(l => l.trim());
        const header = lines[0].split(sep).map(h => h.trim().toLowerCase());

        // Автодетект колонок по ключевым словам
        const find = (...kws) => header.findIndex(h => kws.some(kw => h.includes(kw)));
        const iBrand   = url.searchParams.has("col_brand")   ? +url.searchParams.get("col_brand")   : find("бренд", "марка", "brand");
        const iDesig   = url.searchParams.has("col_desig")   ? +url.searchParams.get("col_desig")   : find("обозначен", "артикул", "designation", "номер");
        const iADesig  = url.searchParams.has("col_adesig")  ? +url.searchParams.get("col_adesig")  : find("аналог", "analog");
        const iABrand  = url.searchParams.has("col_abrand")  ? +url.searchParams.get("col_abrand")  : find("произв", "завод", "factory", "manufacturer");
        const iFactory = url.searchParams.has("col_factory") ? +url.searchParams.get("col_factory") : -1;

        const detected = { header, iBrand, iDesig, iADesig, iABrand, iFactory };
        if (url.searchParams.get("dry_run") === "1") {
          return json({ detected, sample: lines.slice(1, 4).map(l => l.split(sep)) });
        }

        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const cols   = lines[i].split(sep);
          const brand  = (cols[iBrand]   || "").trim();
          const desig  = (cols[iDesig]   || "").trim();
          const aDesig = (cols[iADesig]  || "").trim();
          const aBrand = (cols[iABrand]  || "").trim();
          const factory= iFactory >= 0 ? (cols[iFactory] || "").trim() : "";
          if (desig || aDesig) rows.push({ brand, desig, aDesig, aBrand, factory });
        }

        await env.CATALOG.prepare("DELETE FROM analogs").run();
        const BATCH = 20;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const ph    = batch.map(() => "(?,?,?,?,?)").join(",");
          const vals  = batch.flatMap(r => [r.brand, r.desig, r.aDesig, r.aBrand, r.factory]);
          await env.CATALOG.prepare(
            `INSERT INTO analogs (brand,designation,analog_designation,analog_brand,factory) VALUES ${ph}`
          ).bind(...vals).run();
          inserted += batch.length;
        }
        return json({ ok: true, inserted, total: rows.length, detected });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Сброс истории диалога
    if (url.pathname === "/reset" && request.method === "POST") {
      const body = await request.json();
      const safe = sanitizeUserId(body.user_id);
      if (!safe) return json({ error: "Invalid user_id" }, 400);
      await env.CHAT_HISTORY.delete(`history:${safe}`);
      return json({ ok: true });
    }

    // Основной обработчик событий от Bitrix24
    if (url.pathname === "/imbot" && request.method === "POST") {
      const body = await request.text();
      const data = Object.fromEntries(new URLSearchParams(body));

      const event   = data["event"];
      const userId  = data["data[USER][ID]"];
      const chatId  = data["data[PARAMS][DIALOG_ID]"] || data["data[PARAMS][FROM_USER_ID]"];
      const message = data["data[PARAMS][MESSAGE]"]?.trim();

      // Обработать только входящие сообщения боту
      if (event !== "ONIMBOTMESSAGEADD" || !message || !userId) {
        return json({ ok: true });
      }

      // Определить контекст: групповой чат или личный диалог
      // В Bitrix24 DIALOG_ID группового чата начинается с "chat"
      const isGroupChat = chatId && String(chatId).startsWith("chat");

      // ── Ключевые слова для мониторинга групповых чатов ──────
      // В групповом чате бот молчит, пока не встретит одно из слов
      const KEYWORDS = [
        "подшипник", "подшипники", "артикул",
        "сделка", "сделки", "клиент",
        "цена", "стоимость", "скидка",
        "кп", "коммерческ",
        "заказ", "поставка", "наличие", "срок",
      ];

      if (isGroupChat) {
        const lower = message.toLowerCase();
        const hit = KEYWORDS.find(kw => lower.includes(kw));
        if (!hit) return json({ ok: true }); // не реагировать — ключевых слов нет
      }

      // Команды (работают и в личном чате, и в групповом)
      if (message === "/start" || message === "/помощь" || message === "помощь") {
        await botReply(env, chatId,
          `[B]ИИ-помощник Эверест[/B]\n\n` +
          `Что умею:\n` +
          `• Искать и анализировать сделки\n` +
          `• Показывать данные клиентов\n` +
          `• Отвечать по каталогу подшипников\n` +
          `• Помогать с текстами (КП, письма)\n\n` +
          (isGroupChat
            ? `[I]В групповом чате реагирую на слова: подшипник, сделка, КП, цена, скидка, заказ, поставка, наличие, артикул...[/I]\n\n`
            : `Примеры:\n— Мои активные сделки\n— Найди сделку по ООО Ромашка\n— Данные сделки 123\n— Аналог подшипника 6205-2RS\n\n`) +
          `/сброс — очистить историю диалога`
        );
        return json({ ok: true });
      }

      if (message === "/сброс" || message === "/reset") {
        const safe = sanitizeUserId(userId);
        if (safe) await env.CHAT_HISTORY.delete(`history:${safe}`);
        await botReply(env, chatId, "История диалога очищена ✅");
        return json({ ok: true });
      }

      // Показать "печатает..."
      await b24(env, "im.dialog.writing", { DIALOG_ID: chatId }).catch(() => {});

      // Получить историю, спросить Gemini, сохранить историю
      try {
        const history = await getHistory(env, userId);

        // Добавить контекст в первый запрос сессии
        const contextMsg = history.length === 0
          ? `[Контекст: пользователь B24 ID=${userId}${isGroupChat ? ", групповой чат" : ""}]\n\n${message}`
          : message;

        const { text, history: newHistory } = await askGemini(env, history, contextMsg);
        await saveHistory(env, userId, newHistory);
        await botReply(env, chatId, text);
      } catch (e) {
        await botReply(env, chatId, `⚠️ Ошибка: ${e.message}`);
      }

      return json({ ok: true });
    }

    return new Response("b24-imbot worker", { headers: CORS });
  }
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
