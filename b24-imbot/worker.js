// b24-imbot/worker.js
// Внутренний ИИ-бот для Bitrix24 (im.bot) на Cloudflare Workers + Gemini 2.0 Flash
// Менеджер пишет боту в личный чат → бот отвечает с данными из CRM

const SYSTEM_PROMPT = `Ты — внутренний ИИ-помощник менеджера компании Эверест (оптовая поставка подшипников, Вологда).
Работаешь внутри Bitrix24 как бот в личном чате.

Умеешь:
- Искать и анализировать сделки из CRM
- Показывать данные компаний клиентов
- Отвечать на вопросы по каталогу подшипников (артикулы, аналоги ГОСТ/ISO, бренды)
- Помогать с текстами: КП, письма, описания

Правила:
- Отвечай кратко и по делу
- Используй инструменты когда нужны данные из CRM
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
    description: "Найти подшипник в каталоге по артикулу или наименованию. Использовать при вопросах об артикулах, наличии, брендах, весе подшипников.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Артикул или наименование подшипника (например: 6205, 6205-2RS, NU 220)" }
      },
      required: ["query"]
    }
  },
  {
    name: "search_knowledge",
    description: "Найти информацию в базе знаний: статьи о заводах, брендах, производстве, технических характеристиках. Использовать при вопросах о производителях, истории, качестве продукции.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос (например: FKL завод, производство, качество)" }
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
        const q = `%${args.query}%`;
        const { results } = await env.CATALOG.prepare(
          `SELECT title, content, tags FROM knowledge
           WHERE title LIKE ? OR content LIKE ? OR tags LIKE ?
           LIMIT 3`
        ).bind(q, q, q).all();
        if (!results.length) return JSON.stringify({ found: 0, message: "Информация не найдена в базе знаний" });
        return JSON.stringify(results.map(r => ({ заголовок: r.title, содержание: r.content, теги: r.tags })));
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
