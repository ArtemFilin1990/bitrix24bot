// b24-imbot/worker.js
// Внутренний ИИ-бот для Bitrix24 (im.bot) на Cloudflare Workers + Gemini 2.0 Flash
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
- Никогда не выдумывай артикулы, цены или наличие — только то что нашёл в базе.`;

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
async function b24(env, method, params = {}) {
  const url = `https://${env.B24_PORTAL}/rest/${env.B24_USER_ID}/${env.B24_TOKEN}/${method}.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const d = await r.json();
  if (d.error)
    throw new Error(`B24 ${method}: ${d.error} — ${d.error_description || ""}`);
  return d.result;
}

// Отправить сообщение от бота в чат
async function botReply(env, chatId, text) {
  await b24(env, "imbot.message.add", {
    BOT_ID: env.BOT_ID,
    CLIENT_ID: env.CLIENT_ID,
    DIALOG_ID: chatId,
    MESSAGE: text,
  });
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
            ? `SELECT item_id as designation, category_ru, series_ru, d_mm, big_d_mm, b_mm, mass_kg, brand_display as manufacturer,
                      NULL as name_ru, NULL as price_rub, NULL as qty, NULL as stock_flag,
                      NULL as gost_ref, NULL as iso_ref, NULL as suffix_desc
               FROM catalog WHERE d_mm=? AND big_d_mm=? AND b_mm=? LIMIT 10`
            : `SELECT item_id as designation, category_ru, series_ru, d_mm, big_d_mm, b_mm, mass_kg, brand_display as manufacturer,
                      NULL as name_ru, NULL as price_rub, NULL as qty, NULL as stock_flag,
                      NULL as gost_ref, NULL as iso_ref, NULL as suffix_desc
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
             ORDER BY stock_flag DESC, qty DESC
             LIMIT 10`,
          )
            .bind(raw, q, q, q, q)
            .all();
          catRows = res.results || [];
        }

        if (catRows.length) {
          return JSON.stringify(
            catRows.map((r) => ({
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
          );
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
            message: "Подшипник не найден в каталоге",
          });
        return JSON.stringify(
          results.map((r) => ({
            наименование: r.name,
            артикул: r.article,
            завод: r.brand,
            вес_кг: r.weight,
          })),
        );
      }
      case "search_knowledge": {
        const ftsQuery = args.query.trim().replace(/['"*]/g, " ").trim();
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
          } catch {}
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
            message: "Производитель не найден",
          });
        return JSON.stringify(
          results.map((r) => ({ бренд: r.name, описание: r.description })),
        );
      }
      case "search_analogs": {
        const q = `%${args.query}%`;
        const { results } = await env.CATALOG.prepare(
          `SELECT brand, designation, analog_designation, analog_brand, factory
           FROM analogs
           WHERE designation LIKE ? OR analog_designation LIKE ?
           LIMIT 20`,
        )
          .bind(q, q)
          .all();
        if (!results.length)
          return JSON.stringify({
            found: 0,
            message: "Аналоги не найдены в базе",
          });
        return JSON.stringify(
          results.map((r) => ({
            бренд: r.brand,
            обозначение: r.designation,
            аналог: r.analog_designation,
            бренд_аналога: r.analog_brand,
            завод: r.factory,
          })),
        );
      }
      default:
        return JSON.stringify({ error: "Unknown tool: " + name });
    }
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

// ── Gemini 2.0 Flash с function calling ──────────────────
const GEMINI_TOOLS = [
  {
    functionDeclarations: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })),
  },
];

async function askGemini(env, history, userText) {
  const MODEL = env.GEMINI_MODEL || "gemini-2.5-flash";
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  const contents = [...history, { role: "user", parts: [{ text: userText }] }];

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

    const fnCalls = parts.filter((p) => p.functionCall);
    if (!fnCalls.length) {
      return {
        text:
          parts
            .filter((p) => p.text)
            .map((p) => p.text)
            .join("") || "—",
        history: contents.slice(-20), // хранить последние 20 turns
      };
    }

    // Выполнить tool calls
    const fnResults = await Promise.all(
      fnCalls.map(async (p) => {
        let resultStr;
        try {
          resultStr = await executeTool(
            env,
            p.functionCall.name,
            p.functionCall.args,
          );
        } catch (err) {
          resultStr = JSON.stringify({ error: err.message });
        }
        return {
          functionResponse: {
            name: p.functionCall.name,
            response: { result: resultStr },
          },
        };
      }),
    );
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
  } catch {
    return [];
  }
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
    CODE: "everest_ai_bot",
    TYPE: "B", // Bot
    EVENT_HANDLER: `${workerUrl}/imbot`,
    OPENLINE: "N",
    CLIENT_ID: "everest_ai_bot",
    PROPERTIES: {
      NAME: "ИИ-помощник Эверест",
      COLOR: "AQUA",
      WORK_POSITION: "AI Assistant",
      PERSONAL_WWW: "https://ewerest.ru",
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
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    // Регистрация бота (вызвать один раз вручную)
    if (url.pathname === "/register" && request.method === "GET") {
      try {
        const result = await registerBot(env);
        return json({
          ok: true,
          bot_id: result,
          note: "Сохрани BOT_ID в secrets: wrangler secret put BOT_ID",
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
        // Получаем download URL: напрямую или через Bitrix24 API
        const downloadUrl =
          directUrl ||
          (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const csvResp = await fetch(downloadUrl);
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
          const name = (cols[iName] || "").trim().replace(/'/g, "''");
          const article = (cols[iArt] || "").trim().replace(/'/g, "''");
          const brand = (cols[iBrand] || "").trim().replace(/'/g, "''");
          const wRaw = (cols[iWeight] || "").trim().replace(",", ".");
          const weight = parseFloat(wRaw) || null;
          if (name && article) rows.push({ name, article, brand, weight });
        }

        // Очищаем и вставляем батчами по 100
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
      const body = await request.json();
      if (body.secret !== env.IMPORT_SECRET)
        return json({ error: "Forbidden" }, 403);
      const docs = body.docs || [];
      let inserted = 0;
      for (const doc of docs) {
        const { title, content, tags = "" } = doc;
        if (!title || !content) continue;
        await upsertKnowledgeDocument(env, {
          title,
          content,
          tags,
          sourceType: "manual_bulk",
        });
        inserted++;
      }
      return json({ ok: true, inserted });
    }

    // Bulk-импорт брендов: POST /import-brands-bulk {secret, brands:[{name,description,logo_url,search_url}]}
    if (url.pathname === "/import-brands-bulk" && request.method === "POST") {
      const body = await request.json();
      if (body.secret !== env.IMPORT_SECRET)
        return json({ error: "Forbidden" }, 403);
      let inserted = 0;
      for (const b of body.brands || []) {
        const { name, description = "", logo_url = "", search_url = "" } = b;
        if (!name) continue;
        await env.CATALOG.prepare(
          `INSERT INTO brands (name,description,logo_url,search_url) VALUES (?,?,?,?)
           ON CONFLICT(name) DO UPDATE SET description=excluded.description,
           logo_url=excluded.logo_url, search_url=excluded.search_url`,
        )
          .bind(name, description, logo_url, search_url)
          .run();
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
      const fileId = url.searchParams.get("file_id");
      const directUrl = url.searchParams.get("url");
      const tags = url.searchParams.get("tags") || "";
      if (!fileId && !directUrl)
        return json({ error: "file_id or url required" }, 400);
      try {
        const meta = fileId
          ? await b24(env, "disk.file.get", { id: fileId })
          : null;
        const downloadUrl = directUrl || meta.DOWNLOAD_URL;
        const title =
          url.searchParams.get("title") ||
          (meta
            ? meta.NAME.replace(/_/g, " ").replace(/\.md$/i, "")
            : "Документ");
        const content = await (await fetch(downloadUrl)).text();
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
        const downloadUrl =
          directUrl ||
          (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const text = await (await fetch(downloadUrl)).text();
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

          const apiUrl = `https://${env.B24_PORTAL}/rest/${env.B24_USER_ID}/${env.B24_TOKEN}/${endpoint}.json`;
          const resp = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
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
      const n = parseInt(url.searchParams.get("lines") || "10");
      if (!fileId && !directUrl)
        return json({ error: "file_id or url required" }, 400);
      try {
        const downloadUrl =
          directUrl ||
          (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const text = await (await fetch(downloadUrl)).text();
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
        const downloadUrl =
          directUrl ||
          (await b24(env, "disk.file.get", { id: fileId })).DOWNLOAD_URL;
        const text = await (await fetch(downloadUrl)).text();
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
        } catch {}
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

      // Валидация токена приложения (защита от неавторизованных запросов)
      const appToken = data["auth[application_token]"];
      if (env.B24_APP_TOKEN && appToken !== env.B24_APP_TOKEN) {
        return json({ error: "Forbidden: Invalid application token" }, 403);
      }

      const event = data["event"];
      const userId = data["data[USER][ID]"];
      const chatId =
        data["data[PARAMS][DIALOG_ID]"] || data["data[PARAMS][FROM_USER_ID]"];
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
        if (!hit && !botMentioned) return json({ ok: true }); // не реагировать
      }

      // Команды (работают и в личном чате, и в групповом)
      if (
        message === "/start" ||
        message === "/помощь" ||
        message === "помощь"
      ) {
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
              : `Примеры:\n— Мои активные сделки\n— Найди сделку по ООО Ромашка\n— Данные сделки 123\n— Аналог подшипника 6205-2RS\n\n`) +
            `/сброс — очистить историю диалога`,
        );
        return json({ ok: true });
      }

      if (message === "/сброс" || message === "/reset") {
        const safe = sanitizeUserId(userId);
        if (safe) await env.CHAT_HISTORY.delete(`history:${safe}`);
        ctx.waitUntil(botReply(env, chatId, "История диалога очищена ✅"));
        return json({ ok: true });
      }

      // Тяжёлая AI-логика выполняется в фоне — воркер сразу возвращает 200 OK Bitrix24,
      // исключая таймаут вебхука (ошибка 1102 Cloudflare)
      ctx.waitUntil(
        (async () => {
          try {
            // Показать "печатает..."
            await b24(env, "im.dialog.writing", { DIALOG_ID: chatId }).catch(
              () => {},
            );

            const history = await getHistory(env, userId);

            // Добавить контекст в первый запрос сессии
            const contextMsg =
              history.length === 0
                ? `[Контекст: пользователь B24 ID=${userId}${isGroupChat ? ", групповой чат" : ""}]\n\n${message}`
                : message;

            const { text, history: newHistory } = await askGemini(
              env,
              history,
              contextMsg,
            );
            await saveHistory(env, userId, newHistory);
            await botReply(env, chatId, text);
          } catch (e) {
            await botReply(env, chatId, `⚠️ Ошибка: ${e.message}`);
          }
        })(),
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
