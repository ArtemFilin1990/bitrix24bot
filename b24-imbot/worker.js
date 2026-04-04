// b24-imbot/worker.js
// Внутренний ИИ-бот для Bitrix24 (im.bot) на Cloudflare Workers + Gemini 2.5 Flash
// Менеджер пишет боту в личный чат → бот отвечает с данными из CRM

const SYSTEM_PROMPT = `Ты — Алексей, инженер-консультант по подшипникам компании Эверест (Вологда, оптовые поставки подшипников и приводных компонентов). Работаешь внутри Bitrix24 как бот в личном чате менеджеров.

## Твоя экспертиза

Ты знаешь всё о подшипниках качения: шариковые (радиальные, радиально-упорные, упорные, самоустанавливающиеся), роликовые (цилиндрические, конические, сферические, игольчатые), корпусные узлы, линейные направляющие, приводные ремни и цепи.

Ты отлично разбираешься в:
- **Системах обозначений**: ГОСТ (советская/российская), ISO, DIN, JIS — читаешь любое обозначение и объясняешь каждый знак
- **Производителях**: SKF, FAG/Schaeffler, NSK, NTN, KOYO/JTEKT, TIMKEN, INA, SNR/NTN, ZKL, CRAFT, ISB, ГПЗ-1/2/3/4/11/23, BBC-R, АПП, ЕПК, МПЗ и сотни других
- **Аналогах**: ГОСТ ↔ ISO ↔ бренды — моментально ищешь замены
- **Подборе**: по нагрузке, скорости, температуре, условиям смазки, посадке на вал
- **Дефектах**: знаешь по каким симптомам определить причину выхода подшипника из строя
- **Стандартах**: ГОСТ 520, ГОСТ 3478, ISO 15, ISO 281, ISO 492 и другие

## База знаний — как её использовать

У тебя есть четыре инструмента поиска по базе данных. Используй их проактивно — НЕ ЖДИ когда пользователь попросит, сам ищи нужные данные.

**search_catalog** — главный инструмент. Используй ВСЕГДА при:
- Любом вопросе о конкретном подшипнике (6205, NU220, 32210, 7310...)
- Вопросах о цене, наличии, остатке, весе, размерах (d/D/B)
- Подборе по размерам ("подшипник 25×62×17")
- Вопросе есть ли что-то на складе
Ищи точно (артикул) и широко (первые цифры + маска). Если каталог пуст — честно скажи.

**search_analogs** — при любом вопросе о замене или аналоге:
- "Чем заменить 180205?" → search_analogs("180205")
- "Аналог SKF 6205?" → search_analogs("6205")
- "Отечественный аналог 6308-2RS" → search_analogs("6308")
- "Что такое N205 в ГОСТе?" → search_analogs("N205")
Если нашёл несколько — покажи все варианты с брендами.

**search_knowledge** — для технических вопросов, справки, стандартов:
- Расшифровка обозначений ("что значит C3 в подшипнике")
- Типы подшипников ("в чём разница NU и NJ")
- Стандарты и нормы ("ГОСТ 520 классы точности")
- Производители ("расскажи про CRAFT")
- Монтаж и обслуживание ("как правильно запрессовать подшипник")
- Дефекты ("почему шумит подшипник")
Используй конкретные термины в запросе: "классы точности подшипников ГОСТ", "монтаж конических роликовых подшипников".

**search_brand** — при вопросах о производителе:
- "Что за завод ЕПК?"
- "Где делают подшипники SKF?"
- "FLT — польский или нет?"

## Стратегия ответа

**При вопросе об артикуле** (например "6205"):
1. search_catalog("6205") → цена, наличие, размеры
2. search_analogs("6205") → аналоги ГОСТ/ISO
3. Ответь: есть ли в наличии, цена, размеры d×D×B, аналоги

**При вопросе об аналоге** (например "чем заменить 180205"):
1. search_analogs("180205") → найди все аналоги
2. search_catalog для каждого найденного аналога → проверь наличие
3. Ответь: аналоги с наличием и ценой

**При техническом вопросе** (типы, стандарты, монтаж):
1. search_knowledge(конкретный запрос) → найди статью
2. Дополни своими знаниями
3. Ответь структурированно

**При вопросе о производителе**:
1. search_brand(название) → история, страна, специализация
2. search_analogs для типичных артикулов этого бренда если нужно

## Расшифровка обозначений — правила

**ISO обозначение** (пример: 6205-2RS1/C3):
- Тип: 6 = шариковый радиальный однорядный
- Серия ширин: 0 (опущена) = нормальная
- Серия диаметров: 2 = лёгкая
- Код отверстия: 05 → d = 05×5 = 25мм (правило: для кодов 04-96 умножить на 5)
  Исключения: 00=10мм, 01=12мм, 02=15мм, 03=17мм
- Суффикс 2RS1: два контактных уплотнения
- Суффикс C3: увеличенный радиальный зазор

**Код типа подшипника по ISO:**
1 = самоустанавливающийся шариковый, 2 = сферический роликовый,
3 = конический роликовый, 4 = двухрядный радиальный шариковый,
5 = упорный шариковый, 6 = радиальный шариковый однорядный,
7 = радиально-упорный шариковый, N = цилиндрический роликовый (NU, NJ, NUP, N)

**ГОСТ обозначение** (пример: 180205):
- Последние 2 цифры (05): код отверстия (те же правила)
- Предпоследние 1-2 цифры: серия диаметров
- Цифры перед ними: конструктивная разновидность
  1 = с уплотнениями, 6 = с канавкой под стопорное кольцо

ВАЖНО: при расшифровке ВСЕГДА проверяй через search_catalog или search_analogs. Не полагайся только на вычисления — в каталоге могут быть нестандартные размеры.

## Формат ответов для Bitrix24

Используй BB-коды: [B]жирный[/B], [I]курсив[/I], [U]подчёркнутый[/U]
Для чисел и артикулов — всегда [B]жирный[/B].
Для таблиц и списков — используй ASCII или символы • — │

Пример хорошего ответа на "6205 есть?":
[B]6205[/B] — шариковый радиальный, серия 62
• d=25мм, D=52мм, B=15мм
• Цена: [B]185 руб[/B] • Остаток: [B]47 шт[/B]
Аналоги: 180205 (ГОСТ), 6205-2RS (с уплотнениями)

## Правила

- Отвечай как живой инженер, не как справочник. Можешь добавить краткий совет из практики.
- Если спрашивают о нестандартном размере — предложи ближайший стандартный.
- Суммы всегда в рублях, массы в кг или г, размеры в мм.
- Если в базе нет данных — скажи честно и предложи как найти (у менеджера, в каталоге производителя).
- Для Bitrix24 CRM используй инструменты get_deal, search_deals, get_company, get_deal_products, get_my_deals.
- Никогда не выдумывай артикулы, цены или наличие — только то что нашёл в базе.
- При вопросе об артикуле с суффиксом (6205-2RS, 6205/C3, 30210 M) — ищи и с суффиксом, и без суффикса. Суффикс описывает исполнение, базовый номер (6205, 30210) — тип подшипника.
- search_analogs возвращает поле match_type: "exact" (точное совпадение обозначения) или "partial" (частичное LIKE-совпадение). PARTIAL — не является подтверждённым аналогом: сообщай пользователю что совпадение требует технической проверки (d, D, B, тип нагрузки должны совпадать).
- Если база вернула found:0 — не выдумывай данные. Говори прямо: "в каталоге Эверест не найдено, рекомендую уточнить у менеджера или в каталоге производителя".
- Аналог подтверждён только при точном совпадении всех габаритных размеров (d, D, B) и типа подшипника. Совпадение только номера без габаритов — указывай как ПРЕДПОЛАГАЕМЫЙ аналог.`;

// ── Tools ─────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_deal",
    description: "Получить данные сделки по ID",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string", description: "ID сделки" },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "search_deals",
    description: "Найти сделки по названию, компании или стадии",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Поисковый запрос" },
        stage_id: {
          type: "string",
          description:
            "Стадия: NEW/PROPOSAL/NEGOTIATION/INVOICE/PAYMENT/WON/LOSE",
        },
        limit: {
          type: "integer",
          description: "Кол-во результатов (по умолчанию 5)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_company",
    description: "Получить данные компании по ID",
    input_schema: {
      type: "object",
      properties: {
        company_id: { type: "string", description: "ID компании" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "get_deal_products",
    description: "Получить список товаров в сделке",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "string", description: "ID сделки" },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "get_my_deals",
    description: "Получить сделки текущего менеджера (активные)",
    input_schema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "ID пользователя B24" },
        limit: { type: "integer", description: "Кол-во (по умолчанию 10)" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "search_catalog",
    description:
      "Найти подшипник в каталоге Эверест по артикулу, обозначению, ГОСТ или ISO номеру. Возвращает: цена (руб), количество на складе, наличие, производитель, размеры d/D/B (мм), масса (кг), категория. ВСЕГДА использовать при любом вопросе о конкретном подшипнике: есть ли на складе, сколько стоит, какие размеры, есть ли в наличии. Примеры запросов: '6205', '180205', 'NU220', '32210', '7310'.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Артикул или обозначение подшипника: ISO (6205, NU220, 30210), ГОСТ (180205, 2007110, 32210), с суффиксами (6205-2RS, 6205 ZZ, 6205 C3). Можно искать по первым цифрам серии.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "Поиск по базе знаний: технические статьи, каталоги производителей (SKF, FAG, NTN, NSK, CRAFT, ZKL и др.), стандарты ГОСТ/ISO/DIN, руководства по монтажу и обслуживанию, расшифровка обозначений, классы точности, радиальные зазоры, смазка, типы подшипников. Использовать при: технических вопросах (что значит суффикс C3/2RS/ZZ/N/NR), вопросах о стандартах, типах, устройстве подшипников, причинах неисправностей, выборе смазки, монтаже. Примеры: 'классы точности ГОСТ ISO ABEC', 'конические роликовые подшипники монтаж', 'обозначение подшипников SKF расшифровка'.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Технический запрос на русском языке: название темы, термин, стандарт, производитель или тип подшипника. Используй конкретные термины.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_brand",
    description:
      "Получить справку о производителе подшипников из базы знаний: страна, история, специализация, типы выпускаемых подшипников, ссылки на каталоги. Использовать при вопросах о конкретном заводе или бренде: 'что за завод ЕПК', 'где производят ZKL', 'чем специализируется TIMKEN'.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Название производителя: SKF, FAG, NTN, NSK, KOYO, TIMKEN, INA, SNR, ZKL, CRAFT, ISB, BBC-R, ГПЗ-1, ГПЗ-4, ЕПК, МПЗ, АПП, FLT, KINEX, NKE и другие",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "search_analogs",
    description:
      "Найти аналоги и взаимозаменяемые подшипники по обозначению. База содержит 37 000+ соответствий: ГОСТ ↔ ISO, отечественные ↔ импортные, кросс-референсы по брендам (SKF, FAG, NTN, NSK, KOYO, BBC, ГПЗ, ISB и др.). ВСЕГДА использовать при: 'чем заменить X', 'аналог X', 'импортный аналог для X', 'отечественный вариант X', 'что такое X в системе ГОСТ'. Примеры: search_analogs('6205') — найдёт 180205 (ГОСТ) и аналоги других брендов; search_analogs('2007110') — найдёт ISO аналог 30210.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Обозначение подшипника для поиска аналогов: ISO (6205, NU306), ГОСТ (180205, 2007110, 32210), с суффиксами. Ищет точное совпадение и по маске.",
        },
      },
      required: ["query"],
    },
  },
];

// ── B24 helpers ───────────────────────────────────────────
function getB24BaseUrl(env) {
  const rawWebhook = String(env.BITRIX_WEBHOOK_URL || "").trim();
  if (rawWebhook) {
    try {
      const parsed = new URL(rawWebhook);
      if (parsed.protocol !== "https:") throw new Error("Webhook must use https");
      // Формат Bitrix24 incoming webhook: /rest/<user_id>/<token>/
      const isBitrixWebhookPath = /^\/rest\/[^/]+\/[^/]+\/?$/.test(parsed.pathname);
      if (!isBitrixWebhookPath) throw new Error("Webhook path must match /rest/<user>/<token>/");
      const prefix = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
      return `${parsed.origin}${prefix}`;
    } catch (e) {
      console.error("Invalid BITRIX_WEBHOOK_URL, fallback to B24_PORTAL/B24_USER_ID/B24_TOKEN", {
        reason: e?.message || String(e),
      });
    }
  }
  return `https://${env.B24_PORTAL}/rest/${env.B24_USER_ID}/${env.B24_TOKEN}/`;
}

function buildB24MethodUrl(baseUrl, method) {
  const safeMethod = String(method || "").trim();
  if (!/^[a-z0-9._]+$/i.test(safeMethod)) {
    throw new Error(`Invalid B24 method: ${safeMethod}`);
  }
  return `${baseUrl}${safeMethod}.json`;
}

async function b24(env, method, params = {}) {
  const url = buildB24MethodUrl(getB24BaseUrl(env), method);
  console.log(`🔗 B24 API call: ${method}`, { params: JSON.stringify(params).slice(0, 100) });
  const r = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    console.error(`❌ B24 ${method}: HTTP ${r.status}`, { response: text.slice(0, 200) });
    throw new Error(`B24 ${method}: HTTP ${r.status} — ${text.slice(0, 200)}`);
  }
  const d = await r.json();
  if (d.error) {
    console.error(`❌ B24 ${method}: API error`, { error: d.error, description: d.error_description });
    throw new Error(`B24 ${method}: ${d.error} — ${d.error_description || ""}`);
  }
  console.log(`✅ B24 ${method}: success`);
  return d.result;
}

function isPrivateIpAddress(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map((x) => parseInt(x, 10));
  if (parts.some((x) => Number.isNaN(x) || x < 0 || x > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function validateImportUrl(value) {
  if (!value) return { ok: false, error: "url required" };
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "Invalid url" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Only https URLs are allowed" };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || isPrivateIpAddress(host)) {
    return { ok: false, error: "Private or local URLs are forbidden" };
  }
  return { ok: true, url: parsed.toString() };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  if (!options.signal) {
    return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  }
  return fetch(url, options);
}

// Отправить сообщение от бота в чат
async function botReply(env, chatId, text, botId = null) {
  const effectiveBotId = botId || env.BOT_ID;
  console.log(`💬 botReply to ${chatId}:`, { textLength: text.length, textPreview: text.slice(0, 100), effectiveBotId });

  // Валидация параметров
  if (!chatId) {
    console.error("❌ botReply: missing chatId");
    throw new Error("botReply: chatId is required");
  }
  if (!text || typeof text !== 'string') {
    console.error("❌ botReply: invalid text", { text: typeof text });
    throw new Error("botReply: text must be a non-empty string");
  }

  // Основной метод: im.message.add (работает через webhook REST-токен)
  try {
    const result = await b24(env, "im.message.add", {
      DIALOG_ID: chatId,
      MESSAGE: text,
      SYSTEM: "N",
    });
    console.log(`✅ botReply success (im.message.add):`, { chatId, result });
    return result;
  } catch (error) {
    console.warn(`⚠️ im.message.add failed, trying imbot.message.add fallback:`, {
      chatId,
      error: error.message,
    });
    // Fallback: imbot.message.add (требует совпадения app ownership)
    if (effectiveBotId && env.CLIENT_ID) {
      try {
        const fbResult = await b24(env, "imbot.message.add", {
          BOT_ID: effectiveBotId,
          CLIENT_ID: env.CLIENT_ID,
          DIALOG_ID: chatId,
          MESSAGE: text,
        });
        console.log(`✅ botReply fallback success (imbot.message.add):`, { chatId, messageId: fbResult?.message_id || 'unknown' });
        return fbResult;
      } catch (fbErr) {
        console.error(`❌ botReply BOTH methods failed:`, {
          chatId,
          imError: error.message,
          imbotError: fbErr.message,
        });
        throw fbErr;
      }
    }
    throw error;
  }
}

function extractHeadingChunks(markdown) {
  const normalized = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const chunks = [];
  const headings = [];
  let body = [];
  const flush = () => {
    const content = body.join("\n").trim();
    if (!content) return;
    chunks.push({
      heading_path: headings.join(" > ") || null,
      content,
      tokens_est: Math.max(1, Math.ceil(content.length / 4)),
    });
    body = [];
  };
  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      headings.splice(level - 1);
      headings[level - 1] = match[2].trim();
      continue;
    }
    body.push(line);
  }
  flush();
  if (!chunks.length) {
    const plain = normalized.trim();
    if (!plain) return [];
    const chunkSize = 1200;
    for (let i = 0; i < plain.length; i += chunkSize) {
      const content = plain.slice(i, i + chunkSize).trim();
      if (content)
        chunks.push({
          heading_path: null,
          content,
          tokens_est: Math.max(1, Math.ceil(content.length / 4)),
        });
    }
  }
  return chunks;
}

function stripMarkdown(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~\-]{1,3}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function upsertKnowledgeDocument(
  env,
  {
    title,
    content,
    tags = "",
    sourcePath = null,
    sourceType = "manual",
    lang = "ru",
    isCanonical = 0,
  },
) {
  await env.CATALOG.prepare("DELETE FROM knowledge WHERE title = ?")
    .bind(title)
    .run();
  await env.CATALOG.prepare(
    "INSERT INTO knowledge (title, content, tags) VALUES (?,?,?)",
  )
    .bind(title, content, tags)
    .run();

  const normalizedSourcePath =
    sourcePath ||
    `manual/${title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-")}`;
  const slug =
    normalizedSourcePath.split("/").filter(Boolean).pop() ||
    title.toLowerCase();
  const plainText = stripMarkdown(content);
  const contentHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  const hashHex = [...new Uint8Array(contentHash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const frontmatter = JSON.stringify({ imported_via: "worker" });

  await env.CATALOG.prepare(
    `INSERT INTO kb_documents (
      source_repo, source_path, source_type, lang, slug, title, section_path,
      frontmatter_json, raw_markdown, plain_text, content_hash, is_canonical
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_path) DO UPDATE SET
      source_type=excluded.source_type,
      lang=excluded.lang,
      slug=excluded.slug,
      title=excluded.title,
      section_path=excluded.section_path,
      frontmatter_json=excluded.frontmatter_json,
      raw_markdown=excluded.raw_markdown,
      plain_text=excluded.plain_text,
      content_hash=excluded.content_hash,
      is_canonical=excluded.is_canonical,
      updated_at=CURRENT_TIMESTAMP`,
  )
    .bind(
      "bitrix24bot/manual",
      normalizedSourcePath,
      sourceType,
      lang,
      slug,
      title,
      normalizedSourcePath.split("/").slice(0, -1).join("/"),
      frontmatter,
      content,
      plainText,
      hashHex,
      isCanonical ? 1 : 0,
    )
    .run();

  const docRow = await env.CATALOG.prepare(
    "SELECT id FROM kb_documents WHERE source_path = ?",
  )
    .bind(normalizedSourcePath)
    .first();
  if (!docRow?.id) return;

  await env.CATALOG.prepare(
    "DELETE FROM kb_document_tags WHERE document_id = ?",
  )
    .bind(docRow.id)
    .run();
  await env.CATALOG.prepare("DELETE FROM kb_links WHERE document_id = ?")
    .bind(docRow.id)
    .run();
  await env.CATALOG.prepare("DELETE FROM kb_chunks WHERE document_id = ?")
    .bind(docRow.id)
    .run();

  const normalizedTags = [
    ...new Set(
      String(tags)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  for (const tag of normalizedTags) {
    await env.CATALOG.prepare(
      "INSERT INTO kb_tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
    )
      .bind(tag)
      .run();
    const tagRow = await env.CATALOG.prepare(
      "SELECT id FROM kb_tags WHERE name = ?",
    )
      .bind(tag)
      .first();
    if (tagRow?.id) {
      await env.CATALOG.prepare(
        "INSERT OR IGNORE INTO kb_document_tags (document_id, tag_id) VALUES (?, ?)",
      )
        .bind(docRow.id, tagRow.id)
        .run();
    }
  }

  const chunks = extractHeadingChunks(content);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    await env.CATALOG.prepare(
      "INSERT INTO kb_chunks (document_id, chunk_no, heading_path, content, tokens_est) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(docRow.id, i, chunk.heading_path, chunk.content, chunk.tokens_est)
      .run();
  }

  const linkRegex = /\[([^\]]+)\]\((?!https?:|mailto:|#)([^)]+)\)/g;
  for (const match of content.matchAll(linkRegex)) {
    await env.CATALOG.prepare(
      "INSERT INTO kb_links (document_id, target_path, anchor_text, link_type) VALUES (?, ?, ?, 'internal')",
    )
      .bind(docRow.id, match[2], match[1])
      .run();
  }
}

// ── Tool executor ─────────────────────────────────────────
async function executeTool(env, name, args) {
  try {
    switch (name) {
      case "get_deal": {
        const d = await b24(env, "crm.deal.get", { id: args.deal_id });
        return JSON.stringify({
          id: d.ID,
          title: d.TITLE,
          stage: d.STAGE_ID,
          amount: d.OPPORTUNITY,
          currency: d.CURRENCY_ID,
          company_id: d.COMPANY_ID,
          responsible: d.ASSIGNED_BY_ID,
          modified: d.DATE_MODIFY,
          comment: d.COMMENTS,
          inn: d.UF_INN,
          brands: d.UF_BEARING_BRANDS,
          positions: d.UF_POSITIONS_COUNT,
          delivery: d.UF_DELIVERY_TYPE,
        });
      }
      case "search_deals": {
        const filter = {};
        if (args.stage_id) filter.STAGE_ID = args.stage_id;
        if (args.query) filter["%TITLE"] = args.query;
        const deals = await b24(env, "crm.deal.list", {
          filter,
          select: [
            "ID",
            "TITLE",
            "STAGE_ID",
            "OPPORTUNITY",
            "COMPANY_ID",
            "DATE_MODIFY",
            "ASSIGNED_BY_ID",
          ],
          order: { DATE_MODIFY: "DESC" },
          start: 0,
        });
        return JSON.stringify(
          (deals || []).slice(0, args.limit || 5).map((d) => ({
            id: d.ID,
            title: d.TITLE,
            stage: d.STAGE_ID,
            amount: d.OPPORTUNITY,
            modified: d.DATE_MODIFY,
          })),
        );
      }
      case "get_company": {
        const c = await b24(env, "crm.company.get", { id: args.company_id });
        return JSON.stringify({
          id: c.ID,
          title: c.TITLE,
          inn: c.UF_INN,
          kpp: c.UF_KPP,
          ogrn: c.UF_OGRN,
          region: c.UF_REGION,
          verified: c.UF_VERIFIED,
          phone: c.PHONE?.[0]?.VALUE,
          email: c.EMAIL?.[0]?.VALUE,
        });
      }
      case "get_deal_products": {
        const rows = await b24(env, "crm.deal.productrows.get", {
          id: args.deal_id,
        });
        return JSON.stringify(
          (rows || []).map((p) => ({
            name: p.PRODUCT_NAME,
            qty: p.QUANTITY,
            price: p.PRICE,
            total: +(p.PRICE * p.QUANTITY).toFixed(2),
          })),
        );
      }
      case "get_my_deals": {
        const deals = await b24(env, "crm.deal.list", {
          filter: {
            ASSIGNED_BY_ID: args.user_id,
            "!STAGE_ID": ["WON", "LOSE"],
          },
          select: ["ID", "TITLE", "STAGE_ID", "OPPORTUNITY", "DATE_MODIFY"],
          order: { DATE_MODIFY: "DESC" },
          start: 0,
        });
        return JSON.stringify(
          (deals || []).slice(0, args.limit || 10).map((d) => ({
            id: d.ID,
            title: d.TITLE,
            stage: d.STAGE_ID,
            amount: d.OPPORTUNITY,
            modified: d.DATE_MODIFY,
          })),
        );
      }
      case "search_catalog": {
        const raw = args.query.trim();
        const q = `%${raw}%`;

        // Strip trailing bearing suffixes to find base designation:
        // "6205-2RS" → "6205", "30210 M" → "30210", "6205/C3" → "6205"
        // Снимаем суффиксы в цикле (до 3 итераций для цепочек типа 6205-2RS1/C3)
        const SUFFIX_RE = /[-/\s]*(2RS[12]?|2RZ|2Z|ZZ|ZE|2ZE|RS|RZ|NR|NR1|N|M|MA|MB|E|J|K|K30|VA|VV|LLU|LLB|DDU|PP|TNH|EC|ECP|ECJ|ECM|P6|P5|P4|P2|C2|C3|C4|C5|CM|TN9|TN|W|W33|W6|W3|Y)\s*$/i;
        let baseDesig = raw;
        for (let s = 0; s < 3 && SUFFIX_RE.test(baseDesig); s++) {
          baseDesig = baseDesig.replace(SUFFIX_RE, "").trim();
        }
        const searchBase = baseDesig.length >= 3 && baseDesig !== raw;

        // Попытка распарсить запрос по размерам: "25 52 15" или "25x52x15" или "25×52×15"
        const dimMatch = raw
          .replace(/[×xXхХ]/g, " ")
          .split(/\s+/)
          .map(Number)
          .filter((n) => n > 0 && n < 1000);

        let catRows = [];

        if (dimMatch.length >= 2) {
          // Поиск по d×D или d×D×B в таблице catalog (ISO размеры)
          const [d, D, B] = dimMatch;
          const dimSql = B
            ? `SELECT designation, category_ru, series_ru, d_mm, big_d_mm, b_mm, mass_kg, brand_display as manufacturer,
                      NULL as name_ru, NULL as price_rub, NULL as qty, NULL as stock_flag,
                      gost_ref, iso_ref, NULL as suffix_desc
               FROM catalog WHERE d_mm=? AND big_d_mm=? AND b_mm=? LIMIT 10`
            : `SELECT designation, category_ru, series_ru, d_mm, big_d_mm, b_mm, mass_kg, brand_display as manufacturer,
                      NULL as name_ru, NULL as price_rub, NULL as qty, NULL as stock_flag,
                      gost_ref, iso_ref, NULL as suffix_desc
               FROM catalog WHERE d_mm=? AND big_d_mm=? LIMIT 10`;
          const dimRes = B
            ? await env.CATALOG.prepare(dimSql).bind(d, D, B).all()
            : await env.CATALOG.prepare(dimSql).bind(d, D).all();
          catRows = dimRes.results || [];
        }

        // Обычный текстовый поиск в CRM каталоге (с ценами)
        if (!catRows.length) {
          const res = await env.CATALOG.prepare(
            `SELECT manufacturer, designation, name_ru, category_ru, subcategory_ru,
                    d_mm, big_d_mm, b_mm, mass_kg, price_rub, qty, stock_flag,
                    gost_ref, iso_ref, brand_display, suffix_desc
             FROM catalog
             WHERE item_id = ? OR designation LIKE ? OR name_ru LIKE ? OR gost_ref LIKE ? OR iso_ref LIKE ?
             ORDER BY
               CASE WHEN item_id = ? THEN 0 WHEN designation = ? THEN 1 ELSE 2 END,
               stock_flag DESC, qty DESC
             LIMIT 10`,
          )
            .bind(raw, q, q, q, q, raw, raw)
            .all();
          catRows = res.results || [];
        }

        // Fallback: search by base designation (without suffix) if stripping changed the query
        if (!catRows.length && searchBase) {
          const qBase = `%${baseDesig}%`;
          const res2 = await env.CATALOG.prepare(
            `SELECT manufacturer, designation, name_ru, category_ru, subcategory_ru,
                    d_mm, big_d_mm, b_mm, mass_kg, price_rub, qty, stock_flag,
                    gost_ref, iso_ref, brand_display, suffix_desc
             FROM catalog
             WHERE designation LIKE ? OR name_ru LIKE ? OR gost_ref LIKE ? OR iso_ref LIKE ?
             ORDER BY CASE WHEN designation = ? THEN 0 ELSE 1 END,
               stock_flag DESC, qty DESC
             LIMIT 10`,
          )
            .bind(qBase, qBase, qBase, qBase, baseDesig)
            .all();
          catRows = res2.results || [];
        }

        if (catRows.length) {
          return JSON.stringify({
            found: catRows.length,
            source: "Каталог Эверест",
            note: "Показаны ВСЕ найденные позиции. Если нужного варианта нет в списке — его нет в каталоге.",
            results: catRows.map((r) => ({
              производитель: r.manufacturer || r.brand_display,
              обозначение: r.designation,
              наименование: r.name_ru || r.category_ru,
              серия: r.series_ru,
              d_мм: r.d_mm,
              D_мм: r.big_d_mm,
              B_мм: r.b_mm,
              масса_кг: r.mass_kg,
              цена_руб: r.price_rub,
              кол_во: r.qty,
              в_наличии: r.stock_flag ? "да" : "нет",
              гост: r.gost_ref,
              iso: r.iso_ref,
              суффикс: r.suffix_desc,
            })),
          });
        }

        // Запасной вариант — таблица bearings (из CRM Bitrix24)
        const { results } = await env.CATALOG.prepare(
          `SELECT name, article, brand, weight FROM bearings
           WHERE article = ? OR name LIKE ? OR article LIKE ?
           ORDER BY CASE WHEN article = ? THEN 0 ELSE 1 END
           LIMIT 10`,
        )
          .bind(raw, q, q, raw)
          .all();
        if (!results.length)
          return JSON.stringify({
            found: 0,
            message: "Подшипник не найден в каталоге Эверест",
            STRICT_RULE: "НЕ ВЫДУМЫВАЙ цену, наличие, количество или размеры. Скажи пользователю: в каталоге Эверест не найдено, рекомендую уточнить у менеджера или в каталоге производителя.",
          });
        return JSON.stringify({
          found: results.length,
          source: "Каталог Эверест",
          note: "Показаны ВСЕ найденные позиции. Если нужного варианта нет в списке — его нет в каталоге.",
          results: results.map((r) => ({
            наименование: r.name,
            артикул: r.article,
            завод: r.brand,
            вес_кг: r.weight,
          })),
        });
      }
      case "search_knowledge": {
        // Sanitize for FTS5: remove special chars that cause parse errors
        // Keeps alphanumeric, Cyrillic, spaces; заменяем дефисы на пробелы (- = NOT в FTS5)
        const ftsClean = args.query.trim()
          .replace(/['"*^():\-\/]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        // Phrase match (в кавычках) для точного поиска обозначений
        const ftsQuery = ftsClean ? `"${ftsClean}"` : "";
        let results = [];
        if (ftsQuery) {
          try {
            const fts = await env.CATALOG.prepare(
              `SELECT d.title, d.source_path, c.heading_path,
                      snippet(kb_chunks_fts, 2, '[B]', '[/B]', ' … ', 18) AS snippet,
                      COALESCE(group_concat(DISTINCT t.name), '') AS tags,
                      bm25(kb_chunks_fts) AS score
               FROM kb_chunks_fts
               JOIN kb_chunks c ON c.id = kb_chunks_fts.rowid
               JOIN kb_documents d ON d.id = c.document_id
               LEFT JOIN kb_document_tags dt ON dt.document_id = d.id
               LEFT JOIN kb_tags t ON t.id = dt.tag_id
               WHERE kb_chunks_fts MATCH ?
               GROUP BY c.id
               ORDER BY score
               LIMIT 5`,
            )
              .bind(ftsQuery)
              .all();
            results = fts.results || [];
          } catch (e) {
            console.error("FTS search_knowledge phrase error:", e);
          }
          // Fallback: FTS без кавычек (OR/AND по словам) если phrase match пуст
          if (!results.length && ftsClean.includes(" ")) {
            try {
              const fts2 = await env.CATALOG.prepare(
                `SELECT d.title, d.source_path, c.heading_path,
                        snippet(kb_chunks_fts, 2, '[B]', '[/B]', ' … ', 18) AS snippet,
                        COALESCE(group_concat(DISTINCT t.name), '') AS tags,
                        bm25(kb_chunks_fts) AS score
                 FROM kb_chunks_fts
                 JOIN kb_chunks c ON c.id = kb_chunks_fts.rowid
                 JOIN kb_documents d ON d.id = c.document_id
                 LEFT JOIN kb_document_tags dt ON dt.document_id = d.id
                 LEFT JOIN kb_tags t ON t.id = dt.tag_id
                 WHERE kb_chunks_fts MATCH ?
                 GROUP BY c.id
                 ORDER BY score
                 LIMIT 5`,
              )
                .bind(ftsClean)
                .all();
              results = fts2.results || [];
            } catch (e) {
              console.error("FTS search_knowledge words error:", e);
            }
          }
        }
        if (!results.length) {
          const q = `%${args.query}%`;
          const like = await env.CATALOG.prepare(
            `SELECT d.title, d.source_path, c.heading_path,
                    substr(c.content, 1, 400) AS snippet,
                    COALESCE(group_concat(DISTINCT t.name), '') AS tags,
                    NULL AS score
             FROM kb_documents d
             JOIN kb_chunks c ON c.document_id = d.id
             LEFT JOIN kb_document_tags dt ON dt.document_id = d.id
             LEFT JOIN kb_tags t ON t.id = dt.tag_id
             WHERE d.title LIKE ? OR c.content LIKE ? OR t.name LIKE ?
             GROUP BY c.id
             LIMIT 5`,
          )
            .bind(q, q, q)
            .all();
          results = like.results || [];
        }
        if (!results.length) {
          const q = `%${args.query}%`;
          const fallback = await env.CATALOG.prepare(
            `SELECT title, NULL AS source_path, NULL AS heading_path, substr(content,1,400) AS snippet, tags, NULL AS score
             FROM knowledge WHERE title LIKE ? OR tags LIKE ? LIMIT 3`,
          )
            .bind(q, q)
            .all();
          results = fallback.results || [];
        }
        if (!results.length)
          return JSON.stringify({
            found: 0,
            message: "Информация не найдена в базе знаний",
            STRICT_RULE: "НЕ ВЫДУМЫВАЙ содержание статей или стандартов. Скажи: в базе знаний Эверест информация не найдена. Ответь на основе своих общих знаний, но укажи что это НЕ из базы Эверест.",
          });
        return JSON.stringify(
          results.map((r) => ({
            заголовок: r.title,
            путь: r.source_path,
            секция: r.heading_path,
            сниппет: r.snippet,
            теги: r.tags,
            score: r.score,
          })),
        );
      }
      case "search_brand": {
        const q = `%${args.name}%`;
        const { results } = await env.CATALOG.prepare(
          `SELECT name, substr(description,1,2000) as description FROM brands
           WHERE name LIKE ? OR description LIKE ?
           LIMIT 3`,
        )
          .bind(q, q)
          .all();
        if (!results.length)
          return JSON.stringify({
            found: 0,
            message: "Производитель не найден в базе Эверест",
            STRICT_RULE: "НЕ ВЫДУМЫВАЙ данные о производителе. Скажи: в справочнике Эверест информация не найдена.",
          });
        return JSON.stringify(
          results.map((r) => ({ бренд: r.name, описание: r.description })),
        );
      }
      case "search_analogs": {
        const rawQuery = args.query.trim();

        // Step 1: exact match by designation (highest confidence)
        const exactRes = await env.CATALOG.prepare(
          `SELECT brand, designation, analog_designation, analog_brand, factory
           FROM analogs
           WHERE designation = ? OR analog_designation = ?
           LIMIT 30`,
        )
          .bind(rawQuery, rawQuery)
          .all();
        const exactResults = exactRes.results || [];

        // Step 2: partial LIKE match only if no exact results found
        let likeResults = [];
        if (!exactResults.length) {
          const q = `%${rawQuery}%`;
          const likeRes = await env.CATALOG.prepare(
            `SELECT brand, designation, analog_designation, analog_brand, factory
             FROM analogs
             WHERE designation LIKE ? OR analog_designation LIKE ?
             LIMIT 20`,
          )
            .bind(q, q)
            .all();
          likeResults = likeRes.results || [];
        }

        const results = exactResults.length ? exactResults : likeResults;
        const matchType = exactResults.length ? "exact" : "partial";

        if (!results.length)
          return JSON.stringify({
            found: 0,
            message: "Аналоги не найдены в базе Эверест",
            STRICT_RULE: "НЕ ВЫДУМЫВАЙ аналоги из своих знаний. Скажи: в базе аналогов Эверест совпадений нет. Рекомендую проверить по каталогу производителя или уточнить у инженера.",
          });

        // Дедупликация двунаправленных пар
        const seen = new Set();
        const deduped = results.filter((r) => {
          const pair = [r.designation, r.analog_designation].sort().join("|") + `|${r.brand}|${r.analog_brand}`;
          if (seen.has(pair)) return false;
          seen.add(pair);
          return true;
        });

        return JSON.stringify({
          found: deduped.length,
          match_type: matchType,
          note: matchType === "partial"
            ? "ЧАСТИЧНОЕ СОВПАДЕНИЕ — НЕ является подтверждённым аналогом. Обязательна проверка: d, D, B, тип нагрузки, грузоподъёмность (Cr, C0r)."
            : "ТОЧНОЕ СОВПАДЕНИЕ по обозначению в базе аналогов. Показаны первые совпадения — могут быть и другие варианты.",
          substitution_warning: matchType === "exact"
            ? "Перед заменой проверьте: класс точности, радиальный зазор (C2/CN/C3/C4), тип смазки, материал сепаратора, допустимую температуру."
            : "ЧАСТИЧНОЕ СОВПАДЕНИЕ. Перед заменой ОБЯЗАТЕЛЬНО сверьте габариты (d, D, B) и тип подшипника.",
          results: deduped.map((r) => ({
            бренд: r.brand,
            обозначение: r.designation,
            аналог: r.analog_designation,
            бренд_аналога: r.analog_brand,
            завод: r.factory,
          })),
        });
      }
      default:
        return JSON.stringify({ error: "Unknown tool: " + name });
    }
  } catch (e) {
    console.error(`executeTool ${name} error:`, e);
    return JSON.stringify({ error: `${name}: ${e.message}` });
  }
}

// ── Gemini 2.5 Flash с function calling ──────────────────
const GEMINI_TOOLS = [
  {
    functionDeclarations: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })),
  },
];

const MAX_USER_MESSAGE_CHARS = 3500;
const EVIDENCE_TOOLS = new Set([
  "search_catalog",
  "search_analogs",
  "search_knowledge",
  "search_brand",
]);

function isBearingFactQuestion(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return false;
  const withoutContext = normalized.replace(/^\[контекст:[\s\S]*?\]\s*/i, "");
  return (
    /\b\d{4,6}(?:[-/](?:2rs|2rz|2z|zz|c3|c4))?\b/i.test(withoutContext) ||
    /(подшип|аналог|размер|маркиров|обознач|гост|iso|наличи|склад|цена|остат)/i.test(withoutContext)
  );
}

function enforceEvidencePolicy(responseText, userText, usedToolNames) {
  const text = String(responseText || "").trim() || "—";
  if (!isBearingFactQuestion(userText)) return text;
  const hasEvidence = [...usedToolNames].some((name) => EVIDENCE_TOOLS.has(name));
  if (hasEvidence) return text;
  return `${text}\n\n[I]⚠️ Ответ без подтверждения из базы. Для точного подбора укажите артикул или размеры d×D×B — проверю по каталогу и аналогам.[/I]`;
}

async function askGemini(env, history, userText) {
  const MODEL = env.GEMINI_MODEL || "gemini-2.5-flash";
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  console.log(`🤖 askGemini: model=${MODEL}, historyLength=${history.length}`);

  const contents = [...history, { role: "user", parts: [{ text: userText }] }];
  const currentTurnStart = contents.length; // индекс начала записей текущего хода
  const usedToolNames = new Set();

  for (let i = 0; i < 8; i++) {
    console.log(`🔄 Gemini iteration ${i + 1}/8`);
    const geminiBody = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: GEMINI_TOOLS,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 2048 },
      },
    });
    let r = await fetchWithTimeout(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: geminiBody,
    }, 30000);

    // Retry один раз при транзиентных ошибках (429/503)
    if (r.status === 429 || r.status === 503) {
      console.warn(`⚠️ Gemini: retrying after HTTP ${r.status}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      r = await fetchWithTimeout(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: geminiBody,
      }, 30000);
    }

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error(`❌ Gemini: HTTP ${r.status}`, { response: text.slice(0, 300) });
      throw new Error(`Gemini: HTTP ${r.status} — ${text.slice(0, 200)}`);
    }
    const data = await r.json();
    if (data.error) {
      console.error("❌ Gemini: API error", data.error);
      throw new Error(`Gemini: ${data.error.message}`);
    }

    // Обработка заблокированных ответов (safety filters)
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      const blockReason =
        candidate?.finishReason ||
        data.promptFeedback?.blockReason ||
        "UNKNOWN";
      console.error("⚠️ Gemini: empty response, reason:", blockReason);
      return {
        text: "Не удалось получить ответ от ИИ. Попробуйте переформулировать вопрос.",
        history: contents.slice(-20),
      };
    }

    const parts = candidate.content.parts;
    contents.push({ role: "model", parts });

    const fnCalls = parts.filter((p) => p.functionCall);
    if (!fnCalls.length) {
      let responseText = parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("") || "—";
      // Проверка причины завершения
      const finishReason = candidate.finishReason;
      if (finishReason === "MAX_TOKENS") {
        console.warn("⚠️ Gemini: response truncated (MAX_TOKENS)");
        responseText += "\n\n[I]...ответ сокращён. Задайте уточняющий вопрос для продолжения.[/I]";
      }
      // Пост-обработка: детект потенциальных галлюцинаций
      // Ищем ТОЛЬКО в текущем ходе (не в истории) результаты инструментов с found:0
      const toolResults = contents
        .slice(currentTurnStart)
        .filter((c) => c.role === "function")
        .flatMap((c) => c.parts || []);
      for (const tr of toolResults) {
        try {
          const res = tr.functionResponse;
          if (!res) continue;
          const parsed = typeof res.response?.result === "string"
            ? JSON.parse(res.response.result) : null;
          if (!parsed || parsed.found !== 0) continue;

          if (res.name === "search_catalog" && /\d+\s*(руб|₽|шт)/i.test(responseText)) {
            responseText += "\n\n[I]⚠️ Внимание: данные о цене/наличии не подтверждены каталогом Эверест. Уточните у менеджера.[/I]";
            break;
          }
          if (res.name === "search_analogs" && /аналог/i.test(responseText) && /\d{3,}/i.test(responseText)) {
            responseText += "\n\n[I]⚠️ Указанные аналоги не подтверждены базой Эверест. Требуется проверка по габаритам (d, D, B).[/I]";
            break;
          }
        } catch { /* skip parse errors */ }
      }
      // Политика доказательств: предупреждение если не были вызваны инструменты
      responseText = enforceEvidencePolicy(responseText, userText, usedToolNames);

      console.log(`✅ Gemini: final response (${responseText.length} chars, finishReason=${finishReason})`);
      return {
        text: responseText,
        history: contents.slice(-20),
      };
    }

    // Выполнить tool calls
    console.log(`🔧 Gemini: executing ${fnCalls.length} tool calls:`, fnCalls.map(fc => fc.functionCall.name));
    const fnResults = await Promise.all(
      fnCalls.map(async (p) => {
        let resultStr;
        try {
          console.log(`  🔨 Tool: ${p.functionCall.name}`, p.functionCall.args);
          usedToolNames.add(p.functionCall.name);
          resultStr = await executeTool(
            env,
            p.functionCall.name,
            p.functionCall.args,
          );
          console.log(`  ✅ Tool result: ${resultStr.slice(0, 200)}...`);
        } catch (err) {
          console.error(`  ❌ Tool error: ${p.functionCall.name}`, err);
          resultStr = JSON.stringify({ error: err?.message || String(err) });
        }
        const fnResp = {
          functionResponse: {
            name: p.functionCall.name,
            response: { result: resultStr },
          },
        };
        // Gemini 2.5+ использует id для связи вызова и результата
        if (p.functionCall.id) {
          fnResp.functionResponse.id = p.functionCall.id;
        }
        return fnResp;
      }),
    );
    contents.push({ role: "function", parts: fnResults });
  }

  console.error("⚠️ Gemini: iteration limit exceeded");
  return { text: "Превышен лимит итераций.", history: contents.slice(-20) };
}

// ── KV: история диалогов ─────────────────────────────────
// Использует Cloudflare KV для хранения истории по userId + dialogId
// Привязать KV namespace "CHAT_HISTORY" в wrangler.toml

// Bitrix24 user IDs and dialog IDs are always positive integers or "chatXXX"
function sanitizeId(id) {
  if (!id) return null;
  const str = String(id);
  // Разрешаем числа или "chat123"
  if (/^(\d+|chat\d+)$/.test(str)) return str;
  return null;
}

async function getHistory(env, userId, dialogId) {
  try {
    const safeUser = sanitizeId(userId);
    const safeDialog = sanitizeId(dialogId);
    if (!safeUser || !safeDialog) return [];
    const key = `history:${safeUser}:${safeDialog}`;
    const raw = await env.CHAT_HISTORY.get(key);
    if (!raw) return [];
    const history = JSON.parse(raw);
    // Миграция: заменяем role:"user" на role:"function" для functionResponse
    for (const entry of history) {
      if (
        entry.role === "user" &&
        entry.parts?.length &&
        entry.parts.every((p) => p.functionResponse)
      ) {
        entry.role = "function";
      }
    }
    return history;
  } catch (e) {
    console.error("getHistory error:", e);
    return [];
  }
}

async function saveHistory(env, userId, dialogId, history) {
  try {
    const safeUser = sanitizeId(userId);
    const safeDialog = sanitizeId(dialogId);
    if (!safeUser || !safeDialog) return;
    const key = `history:${safeUser}:${safeDialog}`;
    await env.CHAT_HISTORY.put(key, JSON.stringify(history), {
      expirationTtl: 60 * 60 * 24, // 24 часа
    });
  } catch (e) {
    console.error("saveHistory error:", e);
  }
}

// ── Регистрация бота ─────────────────────────────────────
// Вызвать один раз: GET /register
async function registerBot(env) {
  if (!env.B24_APP_TOKEN) {
    throw new Error("B24_APP_TOKEN is required for imbot.v2.Bot.register. Set it via Cloudflare Dashboard Secrets.");
  }
  const workerUrl = `https://${env.WORKER_HOST}`;
  // Используем imbot.v2.Bot.register (актуальный API)
  const result = await b24(env, "imbot.v2.Bot.register", {
    fields: {
      code: "everest_imbot_v2",
      botToken: env.B24_APP_TOKEN,
      properties: {
        name: "ИИ-помощник Эверест",
        workPosition: "AI Assistant",
        personalWww: "https://ewerest.ru",
        color: "AQUA",
      },
      type: "supervisor", // Supervisor — получает все сообщения из групповых чатов
      eventMode: "webhook",
      webhookUrl: `${workerUrl}/imbot`,
    },
  });
  // v2 возвращает { bot: { id, ... }, users: [...] }
  return result?.bot?.id ?? result;
}

// Регистрация слэш-команд бота (вызывается после registerBot)
// botId — ID только что созданного бота (из результата imbot.v2.Bot.register)
async function registerBotCommands(env, botId) {
  const effectiveBotId = parseInt(botId || env.BOT_ID);
  const commands = [
    {
      command: "подшипник",
      title: { ru: "Найти подшипник по артикулу" },
      params: { ru: "Артикул (например: 6205-2RS)" },
    },
    {
      command: "аналог",
      title: { ru: "Найти аналог подшипника" },
      params: { ru: "Артикул (например: 180205)" },
    },
    {
      command: "статус",
      title: { ru: "Статус бота" },
      params: { ru: "" },
    },
  ];
  return Promise.all(
    commands.map((cmd) =>
      b24(env, "imbot.v2.Command.register", {
        botId: effectiveBotId,
        botToken: env.B24_APP_TOKEN,
        ...cmd,
      }).catch((e) => ({ error: e.message, command: cmd.command }))
    )
  );
}

// ── Main handler ──────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: CORS });

    // D1 Sessions API — sequential consistency + read replica support
    // https://developers.cloudflare.com/d1/worker-api/d1-database/#withsession
    if (env.CATALOG?.withSession) {
      env = { ...env, CATALOG: env.CATALOG.withSession("first-unconstrained") };
    }

    const url = new URL(request.url);

    // Регистрация бота (вызвать один раз вручную)
    // GET /register?secret=<IMPORT_SECRET>
    if (url.pathname === "/register" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      try {
        // Удаляем старого бота через старый API (imbot.unregister знает CLIENT_ID)
        if (env.BOT_ID) {
          await b24(env, "imbot.unregister", {
            BOT_ID: parseInt(env.BOT_ID),
            CLIENT_ID: env.CLIENT_ID,
          }).catch(() => {});
        }
        const result = await registerBot(env);
        const commands = await registerBotCommands(env, result);
        return json({
          ok: true,
          bot_id: result,
          commands,
          note: "Сохрани BOT_ID в Dashboard Cloudflare: Variables → BOT_ID",
        });
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
      const fileId = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      if (!fileId && !directUrl)
        return json({ error: "file_id or url required" }, 400);
      try {
        if (directUrl) {
          const validated = validateImportUrl(directUrl);
          if (!validated.ok) return json({ error: validated.error }, 400);
        }
        // Получаем download URL: напрямую или через Bitrix24 API
        const downloadUrl =
          directUrl ||
          (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const csvResp = await fetchWithTimeout(downloadUrl);
        if (!csvResp.ok) throw new Error(`Failed to download file: HTTP ${csvResp.status}`);
        const csvText = await csvResp.text();

        // Парсим CSV (разделитель ;, UTF-8 BOM)
        const lines = csvText
          .replace(/^\uFEFF/, "")
          .split("\n")
          .filter((l) => l.trim());
        const header = lines[0].split(";").map((h) => h.trim());
        const iName = header.indexOf("Наименование");
        const iArt = header.indexOf("Артикул");
        const iBrand = header.indexOf("Завод");
        const iWeight = header.findIndex((h) => h.startsWith("Вес"));

        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(";");
          const name = (cols[iName] || "").trim();
          const article = (cols[iArt] || "").trim();
          const brand = (cols[iBrand] || "").trim();
          const wRaw = (cols[iWeight] || "").trim().replace(",", ".");
          const weight = parseFloat(wRaw) || null;
          if (name && article) rows.push({ name, article, brand, weight });
        }

        // Очищаем и вставляем батчами по 100
        if (!rows.length) return json({ error: "No valid rows parsed from CSV" }, 400);
        await env.CATALOG.prepare("DELETE FROM bearings").run();
        let inserted = 0;
        const BATCH = 20;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const placeholders = batch.map(() => "(?,?,?,?)").join(",");
          const values = batch.flatMap((r) => [
            r.name,
            r.article,
            r.brand,
            r.weight,
          ]);
          await env.CATALOG.prepare(
            `INSERT INTO bearings (name,article,brand,weight) VALUES ${placeholders}`,
          )
            .bind(...values)
            .run();
          inserted += batch.length;
        }
        return json({ ok: true, inserted, total: rows.length });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Bulk-импорт документов: POST /import-doc-bulk {secret, docs:[{title,content,tags}]}
    if (url.pathname === "/import-doc-bulk" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: "Invalid JSON body" }, 400);
      }
      if (body.secret !== env.IMPORT_SECRET)
        return json({ error: "Forbidden" }, 403);
      const docs = body.docs || [];
      let inserted = 0;
      const errors = [];
      for (const doc of docs) {
        const { title, content, tags = "" } = doc;
        if (!title || !content) continue;
        try {
          await upsertKnowledgeDocument(env, {
            title,
            content,
            tags,
            sourceType: "manual_bulk",
          });
          inserted++;
        } catch (e) {
          console.error(`import-doc-bulk item error (${title}):`, e);
          errors.push({ title, error: e.message });
        }
      }
      return json({ ok: true, inserted, errors });
    }

    // Bulk-импорт брендов: POST /import-brands-bulk {secret, brands:[{name,description,logo_url,search_url}]}
    if (url.pathname === "/import-brands-bulk" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: "Invalid JSON body" }, 400);
      }
      if (body.secret !== env.IMPORT_SECRET)
        return json({ error: "Forbidden" }, 403);
      let inserted = 0;
      const errors = [];
      for (const b of body.brands || []) {
        const { name, description = "", logo_url = "", search_url = "" } = b;
        if (!name) continue;
        try {
          await env.CATALOG.prepare(
            `INSERT INTO brands (name,description,logo_url,search_url) VALUES (?,?,?,?)
             ON CONFLICT(name) DO UPDATE SET description=excluded.description,
             logo_url=excluded.logo_url, search_url=excluded.search_url`,
          )
            .bind(name, description, logo_url, search_url)
            .run();
          inserted++;
        } catch (e) {
          console.error(`import-brands-bulk item error (${name}):`, e);
          errors.push({ name, error: e.message });
        }
      }
      return json({ ok: true, inserted, errors });
    }

    // Импорт MD-документа в базу знаний из Bitrix24 Disk
    // GET /import-doc?file_id=<id>&secret=<IMPORT_SECRET>&tags=tag1,tag2
    if (url.pathname === "/import-doc" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const fileId = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      const tags = url.searchParams.get("tags") || "";
      if (!fileId && !directUrl)
        return json({ error: "file_id or url required" }, 400);
      try {
        if (directUrl) {
          const validated = validateImportUrl(directUrl);
          if (!validated.ok) return json({ error: validated.error }, 400);
        }
        const meta = fileId
          ? await b24(env, "disk.file.get", { id: fileId })
          : null;
        const downloadUrl = directUrl || meta.DOWNLOAD_URL;
        const title =
          url.searchParams.get("title") ||
          (meta
            ? meta.NAME.replace(/_/g, " ").replace(/\.md$/i, "")
            : "Документ");
        const resp = await fetchWithTimeout(downloadUrl);
        if (!resp.ok) throw new Error(`Failed to download file: HTTP ${resp.status}`);
        const content = await resp.text();
        await upsertKnowledgeDocument(env, {
          title,
          content,
          tags,
          sourcePath: fileId ? `bitrix24/disk/${fileId}` : directUrl,
          sourceType: "manual_import",
        });
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
      const fileId = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      if (!fileId && !directUrl)
        return json({ error: "file_id or url required" }, 400);
      const sep = url.searchParams.get("sep") || ";";
      try {
        if (directUrl) {
          const validated = validateImportUrl(directUrl);
          if (!validated.ok) return json({ error: validated.error }, 400);
        }
        const downloadUrl =
          directUrl ||
          (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const csvResp2 = await fetchWithTimeout(downloadUrl);
        if (!csvResp2.ok) throw new Error(`Failed to download file: HTTP ${csvResp2.status}`);
        const text = await csvResp2.text();
        const lines = text
          .replace(/^\uFEFF/, "")
          .split("\n")
          .filter((l) => l.trim());
        const header = lines[0].split(sep).map((h) => h.trim());
        const hi = (h) => header.findIndex((c) => c.toLowerCase().includes(h));
        // Case-sensitive поиск нужен для d/D (внутр/наружный диаметр)
        const hiCS = (h) => header.findIndex((c) => c.includes(h));

        const cols = {
          item_id:
            url.searchParams.get("c_item_id") ??
            String(hi("id") >= 0 ? hi("id") : 0),
          manufacturer:
            url.searchParams.get("c_manuf") ??
            String(hi("произв") >= 0 ? hi("произв") : hi("завод")),
          category_ru:
            url.searchParams.get("c_cat") ??
            String(hi("раздел1") >= 0 ? hi("раздел1") : hi("категор")),
          subcategory_ru:
            url.searchParams.get("c_subcat") ??
            String(hi("раздел2") >= 0 ? hi("раздел2") : hi("подкатег")),
          series_ru:
            url.searchParams.get("c_series") ??
            String(hi("серия") >= 0 ? hi("серия") : hi("раздел3")),
          name_ru: url.searchParams.get("c_name") ?? String(hi("наимен")),
          designation:
            url.searchParams.get("c_desig") ??
            String(hi("обознач") >= 0 ? hi("обознач") : hi("артикул")),
          iso_ref: url.searchParams.get("c_iso") ?? String(hi("iso")),
          gost_ref: url.searchParams.get("c_gost") ?? String(hi("гост")),
          section:
            url.searchParams.get("c_section") ??
            String(hi("секция") >= 0 ? hi("секция") : hi("тип")),
          d_mm:
            url.searchParams.get("c_d") ??
            String(hiCS(" d ") >= 0 ? hiCS(" d ") : hi("внутр")),
          big_d_mm:
            url.searchParams.get("c_D") ??
            String(hiCS(" D ") >= 0 ? hiCS(" D ") : hi("наруж")),
          b_mm:
            url.searchParams.get("c_b") ??
            String(hiCS(" b ") >= 0 ? hiCS(" b ") : hi("шири")),
          t_mm: url.searchParams.get("c_t") ?? String(hi(" t ")),
          mass_kg:
            url.searchParams.get("c_mass") ??
            String(hi("масс") >= 0 ? hi("масс") : hi("вес")),
          analog_ref: url.searchParams.get("c_analog") ?? String(hi("аналог")),
          price_rub: url.searchParams.get("c_price") ?? String(hi("цен")),
          qty:
            url.searchParams.get("c_qty") ??
            String(hi("кол") >= 0 ? hi("кол") : hi("остат")),
          stock_flag: url.searchParams.get("c_stock") ?? String(hi("налич")),
          bitrix_section_1:
            url.searchParams.get("c_s1") ??
            String(hi("раздел_1") >= 0 ? hi("раздел_1") : -1),
          bitrix_section_2:
            url.searchParams.get("c_s2") ??
            String(hi("раздел_2") >= 0 ? hi("раздел_2") : -1),
          bitrix_section_3:
            url.searchParams.get("c_s3") ??
            String(hi("раздел_3") >= 0 ? hi("раздел_3") : -1),
          brand_display: url.searchParams.get("c_brand") ?? String(hi("бренд")),
          suffix_desc:
            url.searchParams.get("c_suffix") ??
            String(hi("суффикс") >= 0 ? hi("суффикс") : hi("модиф")),
        };

        if (url.searchParams.get("dry_run") === "1") {
          return json({
            header,
            cols,
            sample: lines.slice(1, 4).map((l) => l.split(sep)),
          });
        }

        const get = (cols, idx, row) => {
          const i = parseInt(idx);
          return i >= 0 ? (row[i] || "").trim() : "";
        };
        const getNum = (cols, idx, row) =>
          parseFloat(get(cols, idx, row).replace(",", ".")) || null;

        if (lines.length <= 1) return json({ error: "No data rows found in CSV" }, 400);
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
              get(cols, cols.stock_flag, row) === "1" ||
              get(cols, cols.stock_flag, row).toLowerCase() === "да"
                ? 1
                : 0,
              get(cols, cols.bitrix_section_1, row),
              get(cols, cols.bitrix_section_2, row),
              get(cols, cols.bitrix_section_3, row),
              get(cols, cols.gost_ref, row),
              get(cols, cols.brand_display, row),
              get(cols, cols.suffix_desc, row),
            ]);
          }
          if (!batch.length) continue;
          const ph = batch
            .map(() => "(" + Array(24).fill("?").join(",") + ")")
            .join(",");
          await env.CATALOG.prepare(
            `INSERT OR REPLACE INTO catalog
             (item_id,manufacturer,category_ru,subcategory_ru,series_ru,name_ru,designation,
              iso_ref,section,d_mm,big_d_mm,b_mm,t_mm,mass_kg,analog_ref,price_rub,qty,stock_flag,
              bitrix_section_1,bitrix_section_2,bitrix_section_3,gost_ref,brand_display,suffix_desc)
             VALUES ${ph}`,
          )
            .bind(...batch.flat())
            .run();
          inserted += batch.length;
        }
        return json({ ok: true, inserted, cols });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Импорт каталога из Bitrix24
    // Без iblock_id → crm.product.list (CRM каталог, всегда доступен)
    // С iblock_id → catalog.product.list (торговый каталог, нужен scope:catalog)
    // GET /import-catalog-crm?secret=<S>[&iblock_id=23&section_id=<id>&limit=2000&dry_run=1]
    if (url.pathname === "/import-catalog-crm" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const iblockId = url.searchParams.get("iblock_id")
        ? parseInt(url.searchParams.get("iblock_id"))
        : null;
      const sectionId = url.searchParams.get("section_id") || null;
      const maxItems = parseInt(url.searchParams.get("limit") || "2000");
      const truncate = url.searchParams.get("truncate") !== "0";
      const dryRun = url.searchParams.get("dry_run") === "1";
      try {
        if (truncate && !dryRun)
          await env.CATALOG.prepare("DELETE FROM catalog").run();

        let start = 0,
          inserted = 0,
          hasMore = true;

        while (hasMore && inserted < maxItems) {
          let endpoint, body;
          if (iblockId) {
            // catalog.product.list требует iblockId в filter и select
            endpoint = "catalog.product.list";
            body = {
              filter: {
                iblockId,
                ...(sectionId ? { iblockSectionId: sectionId } : {}),
              },
              select: [
                "id",
                "iblockId",
                "name",
                "iblockSectionId",
                "quantity",
                "available",
                "weight",
                "purchasingPrice",
              ],
              start,
            };
          } else {
            // crm.product.list — CRM каталог, поля UPPERCASE, свойства PROPERTY_CODE
            endpoint = "crm.product.list";
            body = {
              filter: sectionId ? { SECTION_ID: sectionId } : {},
              select: [
                "ID",
                "NAME",
                "PRICE",
                "CURRENCY_ID",
                "SECTION_ID",
                "PROPERTY_MANUFACTURER",
                "PROPERTY_DESIGNATION",
                "PROPERTY_GOST",
                "PROPERTY_ISO",
                "PROPERTY_D",
                "PROPERTY_BIG_D",
                "PROPERTY_B",
                "PROPERTY_T",
                "PROPERTY_MASS",
                "PROPERTY_ANALOG",
                "PROPERTY_SUFFIX",
              ],
              start,
            };
          }

          const apiUrl = buildB24MethodUrl(getB24BaseUrl(env), endpoint);
          const resp = await fetchWithTimeout(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            throw new Error(`${endpoint}: HTTP ${resp.status} — ${errText.slice(0, 200)}`);
          }
          const data = await resp.json();
          if (data.error)
            throw new Error(
              `${endpoint}: ${data.error} (hint: для catalog.product.list нужен iblock_id)`,
            );

          const items = data.result?.products ?? data.result ?? [];
          if (!items.length) break;

          if (dryRun)
            return json({ dry_run: true, endpoint, sample: items.slice(0, 2) });

          const BATCH = 10;
          for (let i = 0; i < items.length; i += BATCH) {
            const batch = items.slice(i, i + BATCH);
            const ph = batch
              .map(() => "(" + Array(24).fill("?").join(",") + ")")
              .join(",");
            const vals = batch.flatMap((p) => {
              if (iblockId) {
                // catalog.product.list → camelCase, свойства через propertyXxx
                const v = (n) => {
                  const x = p[n];
                  return Array.isArray(x)
                    ? (x[0]?.value ?? null)
                    : (x?.value ?? x ?? null);
                };
                const n = (k) =>
                  parseFloat(String(v(k) || "").replace(",", ".")) || null;
                return [
                  String(p.id || ""),
                  String(v("propertyManufacturer") || ""),
                  "",
                  "",
                  "",
                  String(p.name || ""),
                  String(v("propertyDesignation") || p.name || ""),
                  String(v("propertyIso") || ""),
                  "",
                  n("propertyD"),
                  n("propertyBigD"),
                  n("propertyB"),
                  n("propertyT"),
                  parseFloat(String(p.weight || "").replace(",", ".")) || null,
                  String(v("propertyAnalog") || ""),
                  parseFloat(
                    String(p.purchasingPrice || "").replace(",", "."),
                  ) || null,
                  parseInt(p.quantity) || null,
                  p.available === "Y" ? 1 : 0,
                  String(p.iblockSectionId || ""),
                  "",
                  "",
                  String(v("propertyGost") || ""),
                  "",
                  String(v("propertySuffix") || ""),
                ];
              } else {
                // crm.product.list → UPPERCASE, PROPERTY_CODE_VALUE или PROPERTY_CODE
                const v = (c) => {
                  const x = p[c + "_VALUE"] ?? p[c];
                  return Array.isArray(x) ? (x[0]?.value ?? x[0]) : (x ?? null);
                };
                const n = (c) =>
                  parseFloat(String(v(c) || "").replace(",", ".")) || null;
                return [
                  String(p.ID || ""),
                  String(v("PROPERTY_MANUFACTURER") || ""),
                  "",
                  "",
                  "",
                  String(p.NAME || ""),
                  String(v("PROPERTY_DESIGNATION") || p.NAME || ""),
                  String(v("PROPERTY_ISO") || ""),
                  "",
                  n("PROPERTY_D"),
                  n("PROPERTY_BIG_D"),
                  n("PROPERTY_B"),
                  n("PROPERTY_T"),
                  n("PROPERTY_MASS"),
                  String(v("PROPERTY_ANALOG") || ""),
                  parseFloat(String(p.PRICE || "").replace(",", ".")) || null,
                  null,
                  null, // qty/stock недоступны в crm.product.list
                  String(p.SECTION_ID || ""),
                  "",
                  "",
                  String(v("PROPERTY_GOST") || ""),
                  "",
                  String(v("PROPERTY_SUFFIX") || ""),
                ];
              }
            });
            await env.CATALOG.prepare(
              `INSERT OR REPLACE INTO catalog
               (item_id,manufacturer,category_ru,subcategory_ru,series_ru,name_ru,designation,
                iso_ref,section,d_mm,big_d_mm,b_mm,t_mm,mass_kg,analog_ref,price_rub,qty,stock_flag,
                bitrix_section_1,bitrix_section_2,bitrix_section_3,gost_ref,brand_display,suffix_desc)
               VALUES ${ph}`,
            )
              .bind(...vals)
              .run();
          }
          inserted += items.length;
          hasMore = data.next != null;
          start = data.next ?? start + items.length;
        }
        return json({
          ok: true,
          endpoint: iblockId ? "catalog.product.list" : "crm.product.list",
          inserted,
        });
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
      const fileId = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      const n = Math.max(1, Math.min(1000, parseInt(url.searchParams.get("lines")) || 10));
      if (!fileId && !directUrl)
        return json({ error: "file_id or url required" }, 400);
      try {
        if (directUrl) {
          const validated = validateImportUrl(directUrl);
          if (!validated.ok) return json({ error: validated.error }, 400);
        }
        const downloadUrl =
          directUrl ||
          (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const previewResp = await fetchWithTimeout(downloadUrl);
        if (!previewResp.ok) throw new Error(`Failed to download file: HTTP ${previewResp.status}`);
        const text = await previewResp.text();
        const lines = text
          .replace(/^\uFEFF/, "")
          .split("\n")
          .slice(0, n);
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
      const fileId = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      if (!fileId && !directUrl)
        return json({ error: "file_id or url required" }, 400);
      const sep = url.searchParams.get("sep") || ";";
      try {
        if (directUrl) {
          const validated = validateImportUrl(directUrl);
          if (!validated.ok) return json({ error: validated.error }, 400);
        }
        const downloadUrl =
          directUrl ||
          (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const analogsResp = await fetchWithTimeout(downloadUrl);
        if (!analogsResp.ok) throw new Error(`Failed to download file: HTTP ${analogsResp.status}`);
        const text = await analogsResp.text();
        const lines = text
          .replace(/^\uFEFF/, "")
          .split("\n")
          .filter((l) => l.trim());
        const header = lines[0].split(sep).map((h) => h.trim().toLowerCase());

        // Автодетект колонок по ключевым словам
        const find = (...kws) =>
          header.findIndex((h) => kws.some((kw) => h.includes(kw)));
        const iBrand = url.searchParams.has("col_brand")
          ? +url.searchParams.get("col_brand")
          : find("бренд", "марка", "brand");
        const iDesig = url.searchParams.has("col_desig")
          ? +url.searchParams.get("col_desig")
          : find("обозначен", "артикул", "designation", "номер");
        const iADesig = url.searchParams.has("col_adesig")
          ? +url.searchParams.get("col_adesig")
          : find("аналог", "analog");
        const iABrand = url.searchParams.has("col_abrand")
          ? +url.searchParams.get("col_abrand")
          : find("произв", "завод", "factory", "manufacturer");
        const iFactory = url.searchParams.has("col_factory")
          ? +url.searchParams.get("col_factory")
          : -1;

        const detected = { header, iBrand, iDesig, iADesig, iABrand, iFactory };
        if (url.searchParams.get("dry_run") === "1") {
          return json({
            detected,
            sample: lines.slice(1, 4).map((l) => l.split(sep)),
          });
        }

        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(sep);
          const brand = (cols[iBrand] || "").trim();
          const desig = (cols[iDesig] || "").trim();
          const aDesig = (cols[iADesig] || "").trim();
          const aBrand = (cols[iABrand] || "").trim();
          const factory = iFactory >= 0 ? (cols[iFactory] || "").trim() : "";
          if (desig || aDesig)
            rows.push({ brand, desig, aDesig, aBrand, factory });
        }

        if (!rows.length) return json({ error: "No valid rows parsed from CSV" }, 400);
        await env.CATALOG.prepare("DELETE FROM analogs").run();
        const BATCH = 20;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const ph = batch.map(() => "(?,?,?,?,?)").join(",");
          const vals = batch.flatMap((r) => [
            r.brand,
            r.desig,
            r.aDesig,
            r.aBrand,
            r.factory,
          ]);
          await env.CATALOG.prepare(
            `INSERT INTO analogs (brand,designation,analog_designation,analog_brand,factory) VALUES ${ph}`,
          )
            .bind(...vals)
            .run();
          inserted += batch.length;
        }
        return json({ ok: true, inserted, total: rows.length, detected });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Поиск iblock_id и catalog_id для import-catalog-crm
    // GET /discover-catalog?secret=<IMPORT_SECRET>
    if (url.pathname === "/discover-catalog" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      try {
        // crm.catalog.list — список CRM каталогов
        const crmCatalogs = await b24(env, "crm.catalog.list", {
          select: ["ID", "NAME", "IBLOCK_ID"],
        });
        // catalog.catalog.list — список торговых каталогов (для catalog.product.list)
        let tradeCatalogs = [];
        try {
          const tc = await b24(env, "catalog.catalog.list", {
            select: ["id", "iblockId", "name", "siteId"],
          });
          tradeCatalogs = tc?.catalogs ?? tc ?? [];
        } catch (e) {
          console.error("discover-catalog trade catalogs error:", e);
        }
        return json({
          crm_catalogs: crmCatalogs,
          trade_catalogs: tradeCatalogs,
          hint: "crm_catalogs → используй /import-catalog-crm без iblock_id; trade_catalogs → добавь &iblock_id=<iblockId>",
        });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Сброс истории диалога
    if (url.pathname === "/reset" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: "Invalid JSON body" }, 400);
      }
      const safeUser = sanitizeId(body.user_id);
      const safeDialog = sanitizeId(body.dialog_id);
      if (!safeUser) return json({ error: "Invalid user_id" }, 400);

      // Если не указан dialog_id, удалить все истории пользователя (опасно, не рекомендуется)
      if (safeDialog) {
        await env.CHAT_HISTORY.delete(`history:${safeUser}:${safeDialog}`);
      } else {
        // Fallback для обратной совместимости — но это НЕ удалит все диалоги
        // В KV нет wildcard delete, нужен list+delete
        return json({ error: "dialog_id required for safety" }, 400);
      }
      return json({ ok: true });
    }

    // Диагностика конфигурации (не раскрывает значения секретов)
    if (url.pathname === "/status" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const check = (v) => (v ? "✅" : "❌ missing");
      const hasGemini = !!env.GEMINI_API_KEY;
      const hasBitrix = !!(env.B24_PORTAL && env.B24_TOKEN);
      const hasDb = !!env.CATALOG;
      const hasKv = !!env.CHAT_HISTORY;
      return json({
        status: (hasGemini && hasBitrix && hasDb && hasKv) ? "ok" : "degraded",
        bot_id: env.BOT_ID || null,
        worker: "bitrix24bot",
        database: hasDb ? "bound" : "missing",
        kv: hasKv ? "bound" : "missing",
        gemini: hasGemini ? "configured" : "missing",
        bitrix24: hasBitrix ? "configured" : "missing",
        version: "2026-04-04-v3",
        config: {
          BOT_ID: check(env.BOT_ID),
          CLIENT_ID: check(env.CLIENT_ID),
          GEMINI_API_KEY: check(env.GEMINI_API_KEY),
          GEMINI_MODEL: env.GEMINI_MODEL || "gemini-2.5-flash (default)",
          BITRIX_WEBHOOK_URL: check(env.BITRIX_WEBHOOK_URL),
          B24_PORTAL: check(env.B24_PORTAL),
          B24_USER_ID: check(env.B24_USER_ID),
          B24_TOKEN: check(env.B24_TOKEN),
          B24_APP_TOKEN: check(env.B24_APP_TOKEN),
          WORKER_HOST: check(env.WORKER_HOST),
          IMPORT_SECRET: check(env.IMPORT_SECRET),
          CHAT_HISTORY_KV: check(env.CHAT_HISTORY),
          CATALOG_D1: check(env.CATALOG),
        },
      });
    }

    // Дистанционное управление: отправить сообщение в любой чат Bitrix24
    // POST /send  { "secret": "<IMPORT_SECRET>", "chat_id": "...", "text": "..." }
    if (url.pathname === "/send" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: "Invalid JSON body" }, 400);
      }
      if (body.secret !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const chatId = sanitizeId(body.chat_id);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!chatId) return json({ error: "chat_id required" }, 400);
      if (!text) return json({ error: "text required" }, 400);
      try {
        await botReply(env, chatId, text);
        return json({ ok: true });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Диагностика: показать что видит воркер при входящем вебхуке (ВРЕМЕННО)
    if (url.pathname === "/debug-webhook" && request.method === "POST") {
      const body = await request.text();
      const data = Object.fromEntries(new URLSearchParams(body));
      return json({
        event: data["event"],
        appToken: data["auth[application_token]"]?.slice(0, 15) + "...",
        userId: data["data[USER][ID]"],
        chatId: data["data[PARAMS][DIALOG_ID]"],
        message: data["data[PARAMS][MESSAGE]"]?.slice(0, 50),
        botId: data["data[BOT_ID]"],
        allKeys: Object.keys(data).slice(0, 20),
      });
    }

    // ДИАГНОСТИКА: полная проверка и починка бота
    if (url.pathname === "/diagnose" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      const diag = {};
      // Используем переданный токен или env
      const token = url.searchParams.get("token") || env.B24_TOKEN;
      const portal = env.B24_PORTAL;
      const userId = env.B24_USER_ID || "1";
      const apiCall = async (method, params = {}) => {
        const r = await fetch(`https://${portal}/rest/${userId}/${token}/${method}.json`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        return r.json();
      };
      // 1. Список ботов
      try {
        diag.bots = await apiCall("imbot.bot.list");
      } catch (e) { diag.bots = { error: e.message }; }
      // 2. Проверяем env
      diag.env = {
        BOT_ID: env.BOT_ID,
        CLIENT_ID: env.CLIENT_ID?.slice(0, 10) + "...",
        B24_PORTAL: portal,
        B24_TOKEN_first5: token?.slice(0, 5) + "...",
        B24_APP_TOKEN_first5: env.B24_APP_TOKEN?.slice(0, 5) + "...",
        GEMINI_KEY_first5: env.GEMINI_API_KEY?.slice(0, 5) + "...",
        WORKER_HOST: env.WORKER_HOST,
      };
      // 3. Тестовая отправка — пробуем разные варианты
      // Вариант A: imbot.message.add с CLIENT_ID
      try {
        diag.sendA = await apiCall("imbot.message.add", {
          BOT_ID: env.BOT_ID,
          CLIENT_ID: env.CLIENT_ID,
          DIALOG_ID: userId,
          MESSAGE: "🔧 Тест A: с CLIENT_ID",
        });
      } catch (e) { diag.sendA = { error: e.message }; }
      // Вариант B: imbot.message.add без CLIENT_ID
      try {
        diag.sendB = await apiCall("imbot.message.add", {
          BOT_ID: env.BOT_ID,
          DIALOG_ID: userId,
          MESSAGE: "🔧 Тест B: без CLIENT_ID",
        });
      } catch (e) { diag.sendB = { error: e.message }; }
      // Вариант C: im.message.add (от имени пользователя)
      try {
        diag.sendC = await apiCall("im.message.add", {
          DIALOG_ID: userId,
          MESSAGE: "🔧 Тест C: im.message.add",
        });
      } catch (e) { diag.sendC = { error: e.message }; }
      return json(diag);
    }

    // ВРЕМЕННО: перерегистрация бота с новым кодом
    if (url.pathname === "/fix-bot" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      try {
        const workerUrl = `https://${env.WORKER_HOST}`;
        const result = await b24(env, "imbot.v2.Bot.register", {
          fields: {
            code: "everest_v4",
            botToken: env.B24_APP_TOKEN,
            properties: {
              name: "ИИ-эксперт Эверест",
              workPosition: "AI Assistant",
              personalWww: "https://ewerest.ru",
              color: "AQUA",
            },
            type: "supervisor",
            eventMode: "webhook",
            webhookUrl: `${workerUrl}/imbot`,
          },
        });
        const newBotId = result;
        let commands = [];
        try { commands = await registerBotCommands(env, newBotId); } catch (e) { commands = [{ error: e.message }]; }
        return json({
          ok: true,
          new_bot_id: newBotId,
          handler_url: `${workerUrl}/imbot`,
          commands,
          action: `Обновите BOT_ID на ${newBotId}`,
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // ВРЕМЕННО: обновить URL обработчика бота через REST API
    if (url.pathname === "/fix-bot-url" && request.method === "GET") {
      if (url.searchParams.get("secret") !== env.IMPORT_SECRET) {
        return json({ error: "Forbidden" }, 403);
      }
      try {
        const workerUrl = `https://${env.WORKER_HOST}`;
        const handlerUrl = `${workerUrl}/imbot`;
        const result = await b24(env, "imbot.update", {
          BOT_ID: env.BOT_ID,
          CLIENT_ID: env.CLIENT_ID,
          FIELDS: {
            EVENT_HANDLER: handlerUrl,
          },
        });
        return json({ ok: true, handler_url: handlerUrl, result });
      } catch (e) {
        // Попробуем v2 API
        try {
          const workerUrl = `https://${env.WORKER_HOST}`;
          const handlerUrl = `${workerUrl}/imbot`;
          const result2 = await b24(env, "imbot.v2.Bot.update", {
            botId: parseInt(env.BOT_ID),
            botToken: env.B24_APP_TOKEN,
            fields: {
              eventHandlerUrl: handlerUrl,
            },
          });
          return json({ ok: true, handler_url: handlerUrl, result: result2, api: "v2" });
        } catch (e2) {
          return json({ error: e.message, error_v2: e2.message }, 500);
        }
      }
    }

    // Основной обработчик событий от Bitrix24
    if (url.pathname === "/imbot" && request.method === "POST") {
      const body = await request.text();
      const data = Object.fromEntries(new URLSearchParams(body));

      // Валидация токена приложения (ВРЕМЕННО: мягкий режим — логирование без блокировки)
      const appToken = data["auth[application_token]"];
      if (env.B24_APP_TOKEN && appToken !== env.B24_APP_TOKEN) {
        console.error("⚠️ B24_APP_TOKEN MISMATCH (пропускаем для диагностики)", {
          received: appToken ? appToken.slice(0, 15) + "..." : "(пусто)",
          expected: env.B24_APP_TOKEN ? env.B24_APP_TOKEN.slice(0, 15) + "..." : "(не задан)",
        });
        // ВРЕМЕННО: не блокируем, чтобы диагностировать проблему
      }

      const event = data["event"];
      const userId = data["data[USER][ID]"];
      const chatId =
        data["data[PARAMS][DIALOG_ID]"] || data["data[PARAMS][FROM_USER_ID]"];
      const rawMessage = data["data[PARAMS][MESSAGE]"];
      const message = rawMessage?.trim();

      // BOT_ID из вебхука — используем его при ответе, чтобы отвечать именно тем ботом,
      // которому адресовано сообщение (ID в чате может отличаться от env.BOT_ID)
      const webhookBotId = data["data[BOT_ID]"] || env.BOT_ID;

      // Логирование входящего вебхука
      console.log("📨 Webhook received:", {
        event,
        userId,
        chatId,
        webhookBotId,
        envBotId: env.BOT_ID,
        messageLength: message?.length || 0,
        messagePreview: message?.slice(0, 50)
      });

      // Обработка слэш-команд (/подшипник, /аналог)
      if (event === "ONIMCOMMANDADD") {
        // Bitrix24 sends command data under an indexed key:
        // data[COMMAND][<id>][COMMAND], data[COMMAND][<id>][COMMAND_PARAMS], etc.
        let commandName = null;
        let commandParams = "";
        let cmdChatId = data["data[PARAMS][DIALOG_ID]"];
        const cmdUserId = data["data[USER][ID]"];

        // Find the indexed command entry: data[COMMAND][<id>][COMMAND]
        const cmdKey = Object.keys(data).find((k) => /^data\[COMMAND\]\[\d+\]\[COMMAND\]$/.test(k));
        if (cmdKey) {
          const cmdIdMatch = cmdKey.match(/^data\[COMMAND\]\[(\d+)\]\[COMMAND\]$/);
          if (cmdIdMatch) {
            const cmdId = cmdIdMatch[1];
            commandName = data[`data[COMMAND][${cmdId}][COMMAND]`] || null;
            commandParams = (data[`data[COMMAND][${cmdId}][COMMAND_PARAMS]`] || "").trim();
            cmdChatId = data[`data[COMMAND][${cmdId}][DIALOG_ID]`] || cmdChatId;
          }
        }
        const safeCmdChatId = sanitizeId(cmdChatId);
        const safeCmdUserId = sanitizeId(cmdUserId);

        console.log("⌨️ Slash command received:", {
          commandName,
          commandParams,
          cmdChatId: safeCmdChatId,
          cmdUserId: safeCmdUserId,
        });
        if (commandName && safeCmdChatId && safeCmdUserId) {
          ctx.waitUntil((async () => {
            try {
              await b24(env, "imbot.sendtyping", {
                BOT_ID: webhookBotId,
                CLIENT_ID: env.CLIENT_ID,
                DIALOG_ID: safeCmdChatId,
              }).catch((e) => console.error("imbot.sendtyping error:", e));
              // Команда /статус — прямой ответ без Gemini
              if (commandName === "статус") {
                const check = (v) => (v ? "✅" : "❌");
                await botReply(env, safeCmdChatId,
                  `[B]Статус бота Алексей (Эверест)[/B]\n\n` +
                  `• Gemini API: ${check(env.GEMINI_API_KEY)}\n` +
                  `• Bitrix24: ${check(env.B24_PORTAL)}\n` +
                  `• База данных: ${check(env.CATALOG)}\n` +
                  `• История чатов: ${check(env.CHAT_HISTORY)}\n` +
                  `• BOT_ID: ${env.BOT_ID || "❌"}\n\n` +
                  `[I]Модель: ${env.GEMINI_MODEL || "gemini-2.5-flash"}[/I]`
                );
                return;
              }

              const promptTemplates = {
                "подшипник": `Найди подшипник по артикулу: ${commandParams}`,
                "аналог": `Найди аналоги подшипника: ${commandParams}`,
              };
              const prompt = promptTemplates[commandName] || commandParams;
              const history = await getHistory(env, safeCmdUserId, safeCmdChatId);
              const { text, history: newHistory } = await askGemini(env, history, prompt);
              await saveHistory(env, safeCmdUserId, safeCmdChatId, newHistory);
              await botReply(env, safeCmdChatId, text, webhookBotId);
            } catch (e) {
              console.error("❌ Error in slash command handler:", { error: e.message, commandName, safeCmdChatId });
              await botReply(env, safeCmdChatId, "⚠️ Временная ошибка при выполнении команды. Попробуйте через минуту.", webhookBotId).catch(() => {});
            }
          })());
        }
        return json({ ok: true });
      }

      // Приветственное сообщение при первом открытии чата с ботом
      if (event === "ONIMBOTJOINCHAT") {
        console.log("👋 ONIMBOTJOINCHAT:", { userId, chatId });
        if (chatId) {
          ctx.waitUntil(
            botReply(
              env,
              chatId,
              "Здравствуйте! Я [B]ИИ-помощник Эверест[/B] — консультант по подшипникам.\n\n" +
              "Помогу подобрать подшипники, найти аналоги, проверить наличие и цены в каталоге.\n\n" +
              "Просто напишите артикул (например, [B]6205[/B]) или опишите задачу.\n\n" +
              "Доступные команды:\n" +
              "• [B]/подшипник[/B] [артикул] — поиск по каталогу\n" +
              "• [B]/аналог[/B] [артикул] — поиск аналогов\n" +
              "• [B]/статус[/B] — проверка работоспособности\n" +
              "• [B]/помощь[/B] — справка",
              webhookBotId,
            ).catch((e) => console.error("❌ ONIMBOTJOINCHAT reply error:", e)),
          );
        }
        return json({ ok: true });
      }

      // Обработать только входящие сообщения боту
      if (event !== "ONIMBOTMESSAGEADD" || !message || message === "undefined" || message === "null" || !userId || !chatId) {
        console.log("⏭️ Webhook skipped:", { event, hasMessage: !!message, userId, chatId });
        return json({ ok: true });
      }
      if (rawMessage && rawMessage.length > MAX_USER_MESSAGE_CHARS) {
        ctx.waitUntil(
          botReply(
            env,
            chatId,
            `⚠️ Сообщение слишком длинное (${rawMessage.length} символов). Отправьте вопрос частями до ${MAX_USER_MESSAGE_CHARS} символов.`,
            webhookBotId,
          ).catch(() => {}),
        );
        return json({ ok: true });
      }

      // Определить контекст: групповой чат или личный диалог
      // В Bitrix24 DIALOG_ID группового чата начинается с "chat"
      const isGroupChat = chatId && String(chatId).startsWith("chat");

      // ── Ключевые слова для мониторинга групповых чатов ──────
      // В групповом чате бот молчит, пока не встретит одно из слов
      const KEYWORDS = [
        "подшипник",
        "подшипники",
        "артикул",
        "сделка",
        "сделки",
        "клиент",
        "цена",
        "стоимость",
        "скидка",
        "кп",
        "коммерческ",
        "заказ",
        "поставка",
        "наличие",
        "срок",
        "каталог",
        "аналог",
      ];

      if (isGroupChat) {
        const lower = message.toLowerCase();
        const hit = KEYWORDS.find((kw) => lower.includes(kw));
        // также реагируем если бот @-упомянут (Bitrix24 кодирует как [USER=<id>])
        const botMentioned =
          env.BOT_ID && message.includes(`[USER=${env.BOT_ID}]`);

        console.log("👥 Group chat message:", {
          chatId,
          userId,
          keywordHit: hit || null,
          botMentioned,
          willRespond: !!(hit || botMentioned),
          messagePreview: message.slice(0, 100)
        });

        if (!hit && !botMentioned) {
          console.log("🔇 Silent mode: no keywords or mention in group chat", {
            chatId,
            userId,
            keywords: KEYWORDS,
            messageLength: message.length
          });
          return json({ ok: true }); // не реагировать
        }
      } else {
        console.log("💬 Personal chat: will respond", { chatId, userId });
      }

      // Команды (работают и в личном чате, и в групповом)
      if (
        message === "/start" ||
        message === "/помощь" ||
        message === "помощь"
      ) {
        console.log("📖 Command: /помощь");
        await botReply(
          env,
          chatId,
          `[B]ИИ-помощник Эверест[/B]\n\n` +
            `Что умею:\n` +
            `• Искать и анализировать сделки\n` +
            `• Показывать данные клиентов\n` +
            `• Отвечать по каталогу подшипников\n` +
            `• Помогать с текстами (КП, письма)\n\n` +
            (isGroupChat
              ? `[I]В групповом чате реагирую на слова: подшипник, сделка, КП, цена, скидка, заказ, поставка, наличие, артикул...[/I]\n\n`
              : `Примеры:\n— Мои активные сделки\n— Найди сделку по ООО Ромашка\n— Данные сделки 123\n— Аналог подшипника 6205-2RS\n\n`)
        );
        return json({ ok: true });
      }

      if (message === "/сброс" || message === "/reset") {
        console.log("🔄 Command: /сброс");
        const safeUser = sanitizeId(userId);
        const safeDialog = sanitizeId(chatId);
        if (safeUser && safeDialog) {
          await env.CHAT_HISTORY.delete(`history:${safeUser}:${safeDialog}`);
        }
        ctx.waitUntil(botReply(env, chatId, "История диалога очищена ✅", webhookBotId));
        return json({ ok: true });
      }

      // Защита от слишком длинных сообщений
      const MAX_MSG_LENGTH = 4000;
      const processMessage = message.length > MAX_MSG_LENGTH
        ? message.slice(0, MAX_MSG_LENGTH) + `\n\n[сообщение сокращено, было ${message.length} символов]`
        : message;

      console.log("🤖 Starting AI processing...", { chatId, userId, messageLength: processMessage.length });

      // Тяжёлая AI-логика выполняется в фоне — воркер сразу возвращает 200 OK Bitrix24,
      // исключая таймаут вебхука (ошибка 1102 Cloudflare)
      let timedOut = false;
      ctx.waitUntil(
        Promise.race([
        (async () => {
          let responseAttempted = false;
          try {
            console.log("⌨️ Showing typing indicator...", { chatId });
            // Показать "печатает..." (imbot.sendtyping — официальный метод для ботов)
            await b24(env, "imbot.sendtyping", {
              BOT_ID: webhookBotId,
              CLIENT_ID: env.CLIENT_ID,
              DIALOG_ID: chatId,
            }).catch((e) => console.error("imbot.sendtyping error:", e));

            console.log("📚 Loading conversation history...", { userId, chatId });
            const history = await getHistory(env, userId, chatId);
            console.log("📚 History loaded:", { turns: history.length, chatId });

            // Добавить контекст в первый запрос сессии
            const contextMsg =
              history.length === 0
                ? `[Контекст: пользователь B24 ID=${userId}, диалог=${chatId}${isGroupChat ? ", групповой чат" : ""}]\n\n${processMessage}`
                : processMessage;

            console.log("🧠 Calling Gemini...", { historyLength: history.length, contextLength: contextMsg.length });
            const { text, history: newHistory } = await askGemini(
              env,
              history,
              contextMsg,
            );
            console.log("✅ Gemini response received:", {
              textLength: text.length,
              chatId,
              hasContent: text && text.trim().length > 0
            });

            // Если таймаут уже сработал — не отправлять дубль
            if (timedOut) {
              console.warn("⏱️ Skipping reply — timeout already fired", { chatId });
              return;
            }

            // Проверка что Gemini вернул осмысленный ответ
            if (!text || text.trim().length === 0) {
              console.error("⚠️ Gemini returned empty response, using fallback", { chatId });
              const fallbackText = "Извините, не удалось сформировать ответ. Попробуйте переформулировать вопрос.";
              responseAttempted = true;
              await botReply(env, chatId, fallbackText, webhookBotId);
              console.log("✅ Fallback reply sent successfully", { chatId });
              return;
            }

            console.log("💾 Saving conversation history...", { chatId, newHistoryLength: newHistory.length });
            await saveHistory(env, userId, chatId, newHistory);
            console.log("💾 History saved", { chatId });

            console.log("📤 Sending bot reply...", { chatId, textLength: text.length });
            responseAttempted = true;
            await botReply(env, chatId, text, webhookBotId);
            console.log("✅ Bot reply sent successfully", { chatId, userId });
          } catch (e) {
            // Не показывать сырые внутренние ошибки пользователю
            console.error("❌ Error in bot logic:", {
              error: e.message,
              stack: e.stack,
              chatId,
              userId,
              responseAttempted
            });

            const errMsg = e?.message || String(e);
            const safeMessage =
              errMsg.includes("Gemini") || errMsg.includes("B24")
                ? "⚠️ Временная ошибка связи с сервисом. Попробуйте через минуту."
                : "⚠️ Произошла ошибка при обработке запроса. Обратитесь к администратору.";

            try {
              if (timedOut) {
                console.warn("⏱️ Skipping error reply — timeout already fired", { chatId });
              } else {
              console.log("📤 Attempting to send error message to user...", { chatId });
              await botReply(env, chatId, safeMessage, webhookBotId);
              console.log("✅ Error message sent to user", { chatId });
              }
            } catch (replyErr) {
              console.error("❌ CRITICAL: Failed to send error reply:", {
                chatId,
                userId,
                error: replyErr.message,
                stack: replyErr.stack,
                originalError: e.message
              });
            }
          }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("TOTAL_TIMEOUT")), 55000)),
        ]).catch(async (e) => {
          if (e.message === "TOTAL_TIMEOUT") {
            timedOut = true;
            console.error("⏱️ Total processing timeout exceeded (55s)", { chatId, userId });
            await botReply(env, chatId, "⚠️ Обработка заняла слишком много времени. Попробуйте упростить вопрос.", webhookBotId).catch((err) => {
              console.error("❌ Failed to send timeout message:", { chatId, error: err.message });
            });
          }
        }),
      );

      return json({ ok: true });
    }

    return new Response("b24-imbot worker", { headers: CORS });
  },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
