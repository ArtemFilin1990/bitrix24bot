# Gemini Database Integration Documentation

## Статус: ✅ Полностью Подключено

Gemini 2.5 Flash уже **полностью интегрирован** с базой данных Cloudflare D1 через механизм function calling.

## Архитектура Интеграции

```
Пользователь (Bitrix24)
    ↓
Webhook /imbot
    ↓
askGemini(env, history, userText)
    ↓
Gemini API + TOOLS (9 функций)
    ↓
executeTool(env, name, args)
    ↓
env.CATALOG.prepare().bind().all()  ← D1 Database
    ↓
JSON результат → Gemini
    ↓
Финальный ответ → Bitrix24
```

## 9 Подключенных Инструментов

### Инструменты для работы с базой данных подшипников

#### 1. `search_catalog` - Поиск в каталоге
**Таблицы**: `catalog`, `bearings`
**Функционал**:
- Поиск по артикулу (6205, 180205, NU220)
- Поиск по ГОСТ/ISO обозначениям
- Поиск по размерам (d×D×B в мм)
- Возвращает: цена₽, количество, наличие, производитель, размеры, масса

**SQL запросы**:
```sql
-- Поиск по размерам
SELECT * FROM catalog WHERE d_mm=? AND big_d_mm=? AND b_mm=?

-- Поиск по обозначению
SELECT * FROM catalog
WHERE item_id = ? OR designation LIKE ? OR name_ru LIKE ?
   OR gost_ref LIKE ? OR iso_ref LIKE ?
ORDER BY stock_flag DESC, qty DESC

-- Запасной вариант
SELECT * FROM bearings
WHERE article = ? OR name LIKE ? OR article LIKE ?
```

**Код**: `worker.js:552-642`

#### 2. `search_knowledge` - Поиск в базе знаний
**Таблицы**: `kb_chunks_fts`, `kb_documents`, `kb_chunks`, `kb_tags`, `kb_document_tags`
**Функционал**:
- FTS5 полнотекстовый поиск по документам
- Поиск по ГОСТ, ISO стандартам, техническим спецификациям
- Возвращает: заголовок, путь, фрагмент с подсветкой, теги

**SQL запросы**:
```sql
-- FTS5 поиск
SELECT d.title, d.source_path, c.heading_path,
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
LIMIT 5

-- Fallback LIKE поиск
SELECT title, source_path, LEFT(content, 300) AS snippet
FROM kb_documents
WHERE title LIKE ? OR plain_text LIKE ?

-- Legacy таблица
SELECT title, content FROM knowledge WHERE title LIKE ? OR content LIKE ?
```

**Код**: `worker.js:643-714`

#### 3. `search_analogs` - Поиск аналогов
**Таблицы**: `analogs`
**Функционал**:
- Поиск взаимозаменяемых подшипников
- Кросс-референс ГОСТ ↔ ISO ↔ бренды (SKF, FAG, NSK, NTN, KOYO)
- Возвращает: обозначение, аналог, бренд аналога, завод-изготовитель

**SQL запросы**:
```sql
SELECT brand, designation, analog_designation, analog_brand, factory
FROM analogs
WHERE designation LIKE ? OR analog_designation LIKE ?
LIMIT 20
```

**Код**: `worker.js:733-757`

#### 4. `search_brand` - Информация о производителях
**Таблицы**: `brands`
**Функционал**:
- Поиск производителей подшипников
- Возвращает: название, описание (до 2000 символов), логотип, ссылка на поиск

**SQL запросы**:
```sql
SELECT name, description, logo_url, search_url
FROM brands
WHERE name LIKE ? OR description LIKE ?
LIMIT 5
```

**Код**: `worker.js:715-732`

### Инструменты для работы с Bitrix24 CRM (REST API)

#### 5. `get_deal` - Данные сделки
**API**: `crm.deal.get`
**Возвращает**: ID, название, стадия, сумма, валюта, ответственный, комментарий, ИНН, бренды, позиции, доставка

#### 6. `search_deals` - Поиск сделок
**API**: `crm.deal.list`
**Фильтры**: название, стадия (NEW/PROPOSAL/NEGOTIATION/INVOICE/PAYMENT/WON/LOSE)

#### 7. `get_company` - Данные компании
**API**: `crm.company.get`
**Возвращает**: название, телефон, email, ИНН, адрес, сайт, тип, комментарии

#### 8. `get_deal_products` - Товары в сделке
**API**: `crm.deal.productrows.get`
**Возвращает**: ID товара, название, количество, цена, скидка, налог, итого

#### 9. `get_my_deals` - Сделки менеджера
**API**: `crm.deal.list` с фильтром по пользователю
**Возвращает**: активные сделки текущего менеджера

## Конфигурация База Данных

### Cloudflare D1 Binding (wrangler.toml)

```toml
[[d1_databases]]
binding = "CATALOG"
database_name = "bearings-catalog"
database_id = "0b5b8131-d96b-4478-a63e-edc7c787b654"
```

### KV для истории диалогов (wrangler.toml)

```toml
[[kv_namespaces]]
binding = "CHAT_HISTORY"
id = "f7257a53733146b6926eb20321ab4896"
```

## Схема Базы Данных

**Файл**: `schema.sql` (238 строк)

### Таблицы подшипников:
- `bearings` - базовая таблица (article, name, brand, weight)
- `catalog` - расширенная таблица (24 колонки: размеры, цены, наличие, ГОСТ/ISO)
- `analogs` - таблица аналогов (37,000+ записей кросс-референсов)
- `brands` - производители (name, description, logo_url, search_url)

### Таблицы базы знаний:
- `kb_documents` - документы (source_path UNIQUE, type, lang, title, markdown, hash)
- `kb_chunks` - чанки документов (heading-aware, chunk_no ordering)
- `kb_chunks_fts` - FTS5 виртуальная таблица (auto-synced через триггеры)
- `kb_tags` - теги (name UNIQUE)
- `kb_document_tags` - связь many-to-many
- `kb_links` - внутренние ссылки markdown
- `knowledge` - legacy таблица (backwards compatibility, auto-synced)

### Таблицы аудита:
- `bearing_ingest_runs` - лог импорта подшипников
- `kb_ingest_runs` - лог импорта базы знаний

## Механизм Function Calling

### 1. Определение инструментов (worker.js:94-224)

```javascript
const TOOLS = [
  {
    name: "search_catalog",
    description: "Найти подшипник в каталоге...",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Артикул..." }
      },
      required: ["query"]
    }
  },
  // ... остальные 8 инструментов
];
```

### 2. Преобразование для Gemini (worker.js:768-776)

```javascript
const GEMINI_TOOLS = [
  {
    functionDeclarations: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })),
  },
];
```

### 3. Цикл вызова функций (worker.js:778-875)

```javascript
async function askGemini(env, history, userText) {
  const contents = [...history, { role: "user", parts: [{ text: userText }] }];

  for (let i = 0; i < 5; i++) {
    // POST к Gemini API с tools + system_instruction
    const r = await fetch(GEMINI_URL, {
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: GEMINI_TOOLS,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
      })
    });

    // Обработать function calls
    const fnCalls = candidate.content.parts.filter(p => p.functionCall);
    if (!fnCalls.length) {
      return { text: responseText, history: contents.slice(-20) };
    }

    // Выполнить каждый tool call
    const fnResults = await Promise.all(
      fnCalls.map(async (p) => {
        const resultStr = await executeTool(
          env,
          p.functionCall.name,
          p.functionCall.args
        );
        return {
          functionResponse: {
            name: p.functionCall.name,
            response: { result: resultStr },
            id: p.functionCall.id // Gemini 2.5+
          }
        };
      })
    );

    // Добавить результаты в контекст с role: "function"
    contents.push({ role: "function", parts: fnResults });
  }
}
```

### 4. Диспетчер инструментов (worker.js:456-765)

```javascript
async function executeTool(env, name, args) {
  try {
    switch (name) {
      case "search_catalog":
        // D1 prepared statement
        const res = await env.CATALOG.prepare(
          `SELECT ... FROM catalog WHERE ...`
        ).bind(args.query).all();
        return JSON.stringify(res.results);

      case "search_knowledge":
        // FTS5 query
        const fts = await env.CATALOG.prepare(
          `SELECT ... FROM kb_chunks_fts WHERE kb_chunks_fts MATCH ?`
        ).bind(args.query).all();
        return JSON.stringify(fts.results);

      case "get_deal":
        // Bitrix24 REST API
        const deal = await b24(env, "crm.deal.get", { id: args.deal_id });
        return JSON.stringify(deal);

      // ... остальные cases
    }
  } catch (e) {
    console.error(`executeTool ${name} error:`, e);
    return JSON.stringify({ error: `${name}: ${e.message}` });
  }
}
```

## System Prompt Стратегия

Gemini получает детальные инструкции (worker.js:5-91):

```
ПРОАКТИВНОЕ ИСПОЛЬЗОВАНИЕ ИНСТРУМЕНТОВ:

При вопросе о подшипнике:
1. ВСЕГДА вызови search_catalog("6205") → получить цену, наличие, размеры
2. Затем search_analogs("6205") → найти аналоги ГОСТ/ISO
3. Ответь: есть/нет на складе, цена₽, размеры d×D×B мм, список аналогов

При вопросе о стандарте/ГОСТе:
1. search_knowledge("ГОСТ 520-2002") → найти документацию
2. Извлеки ключевую информацию
3. Ответь кратко с примерами

При вопросе о сделке:
1. search_deals(query="Ромашка") → найти сделку
2. get_deal(deal_id="123") → получить детали
3. get_company(company_id="456") → данные клиента
4. Ответь: статус, сумма, контакты

ПРИОРИТЕТЫ ПОИСКА:
- Exact match → Fuzzy LIKE → Dimensions → Legacy table
```

## История Диалога

**Хранение**: Cloudflare KV namespace `CHAT_HISTORY`
**Ключ**: `history:{userId}:{dialogId}`
**TTL**: 24 часа
**Лимит**: последние 20 turns (40 сообщений)

```javascript
async function getHistory(env, userId, dialogId) {
  const key = `history:${safeUser}:${safeDialog}`;
  const raw = await env.CHAT_HISTORY.get(key);
  return JSON.parse(raw) || [];
}

async function saveHistory(env, userId, dialogId, history) {
  const key = `history:${safeUser}:${safeDialog}`;
  await env.CHAT_HISTORY.put(key, JSON.stringify(history), {
    expirationTtl: 60 * 60 * 24 // 24 часа
  });
}
```

## Обработка Ошибок

### Database Errors
```javascript
catch (e) {
  console.error(`executeTool ${name} error:`, e);
  return JSON.stringify({ error: `${name}: ${e.message}` });
}
```

Gemini получает JSON с ошибкой и может:
- Переформулировать запрос
- Попробовать другой инструмент
- Сообщить пользователю на русском

### Gemini API Errors
```javascript
if (!r.ok) {
  console.error(`❌ Gemini: HTTP ${r.status}`, response);
  throw new Error(`Gemini: HTTP ${r.status}`);
}
```

Пользователь получит:
> ⚠️ Временная ошибка связи с сервисом. Попробуйте через минуту.

### Bitrix24 API Errors
```javascript
if (d.error) {
  console.error(`❌ B24 ${method}: API error`, d.error);
  throw new Error(`B24 ${method}: ${d.error}`);
}
```

## Логирование

Комплексное логирование с эмодзи-тегами (добавлено в последнем коммите):

```
📨 Webhook received: { event, userId, chatId }
🤖 Starting AI processing...
🧠 Calling Gemini...
🔄 Gemini iteration 1/5
🔧 Gemini: executing 2 tool calls: ["search_catalog", "search_analogs"]
  🔨 Tool: search_catalog { query: "6205" }
  ✅ Tool result: [{"обозначение":"6205",...}]
✅ Gemini: final response (245 chars)
💾 History saved
📤 Sending bot reply...
🔗 B24 API call: imbot.message.add
✅ B24 imbot.message.add: success
✅ Bot reply sent successfully
```

## Примеры Использования

### Пример 1: Поиск подшипника

**Пользователь**: "Есть ли 6205 на складе?"

**Gemini вызывает**:
1. `search_catalog("6205")`
   ```json
   {
     "производитель": "SKF",
     "обозначение": "6205",
     "d_мм": 25,
     "D_мм": 52,
     "B_мм": 15,
     "цена_руб": 450.00,
     "кол_во": 120,
     "в_наличии": "да"
   }
   ```

2. `search_analogs("6205")`
   ```json
   [
     { "обозначение": "6205", "аналог": "180205", "бренд_аналога": "ГОСТ" },
     { "обозначение": "6205", "аналог": "205", "бренд_аналога": "ISO" }
   ]
   ```

**Ответ бота**:
> Да, подшипник 6205 есть на складе.
> Производитель: SKF
> Цена: 450₽
> Количество: 120 шт
> Размеры: 25×52×15 мм
> Аналоги ГОСТ: 180205

### Пример 2: Поиск по размерам

**Пользователь**: "Подшипник 25x52x15"

**Gemini вызывает**:
```sql
SELECT * FROM catalog WHERE d_mm=25 AND big_d_mm=52 AND b_mm=15
```

**Результат**: Все подшипники с этими размерами (6205, 180205, и т.д.)

### Пример 3: Поиск стандарта

**Пользователь**: "Что такое ГОСТ 520-2002?"

**Gemini вызывает**:
```sql
SELECT ... FROM kb_chunks_fts WHERE kb_chunks_fts MATCH 'ГОСТ 520-2002'
```

**Результат**: Документация из базы знаний с фрагментами и подсветкой

## Верификация Работы

### Проверка через Cloudflare Dashboard

1. Перейти: Workers → bitrix24bot → Logs
2. Отправить сообщение в Bitrix24: "подшипник 6205"
3. Проверить логи:
   - `🔧 Gemini: executing tool calls` — инструменты вызваны
   - `🔨 Tool: search_catalog` — запрос к БД выполнен
   - `✅ Tool result: [...]` — результат получен

### Проверка через wrangler CLI

```bash
# Просмотр логов в реальном времени
wrangler tail --format pretty

# В другом терминале отправить тестовое сообщение в Bitrix24
# Наблюдать полный flow: webhook → Gemini → tool calls → response
```

### Тестовые запросы

| Запрос | Инструмент | Ожидаемый результат |
|--------|-----------|---------------------|
| "подшипник 6205" | `search_catalog` | Цена, наличие, размеры |
| "аналог 6205" | `search_analogs` | Список аналогов ГОСТ/ISO |
| "размеры 25x52x15" | `search_catalog` | Все подшипники этого размера |
| "ГОСТ 520" | `search_knowledge` | Документация стандарта |
| "производитель SKF" | `search_brand` | Информация о SKF |
| "мои сделки" | `get_my_deals` | Активные сделки пользователя |

## Troubleshooting

### Проблема: Gemini не вызывает инструменты

**Диагностика**:
```bash
wrangler tail | grep "🔧 Gemini: executing"
```

**Возможные причины**:
- System prompt не загружен
- GEMINI_TOOLS не передан в API call
- Модель не поддерживает function calling (должна быть gemini-2.5-flash)

**Решение**:
```javascript
// Проверить в worker.js:782-796
body: JSON.stringify({
  system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }, // ✓
  contents,
  tools: GEMINI_TOOLS, // ✓
  generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }
})
```

### Проблема: Database query fails

**Диагностика**:
```bash
wrangler tail | grep "❌"
```

**Возможные причины**:
- Таблица не существует (нужен seed)
- D1 binding не настроен
- SQL syntax error

**Решение**:
```bash
# Применить schema
wrangler d1 execute bearings-catalog --file schema.sql

# Заполнить данными
# 1. Запустить GitHub Action: seed-database.yml
# 2. Или вручную:
python scripts/build_bearings_seed.py --source-dir ../BearingsInfo --output /tmp/bearings.sql
wrangler d1 execute bearings-catalog --file /tmp/bearings.sql
```

### Проблема: Function response role error

**Ошибка**: `400 Invalid role for function response`

**Причина**: Неправильный role в functionResponse (должен быть `"function"`, не `"user"`)

**Решение**: Уже исправлено в worker.js:852
```javascript
contents.push({ role: "function", parts: fnResults }); // ✓ Правильно
```

## Файлы

| Файл | Строки | Описание |
|------|--------|----------|
| `b24-imbot/worker.js` | 1,240 | Основной файл бота с integration logic |
| `schema.sql` | 238 | D1 database schema |
| `wrangler.toml` | 23 | Worker config + D1/KV bindings |
| `TROUBLESHOOTING.md` | 300+ | Руководство по диагностике |
| `CLAUDE.md` | 400+ | Инструкции для AI ассистентов |

## Заключение

**Gemini уже полностью подключен к базе данных** через:
- ✅ 9 working tools (4 database + 5 CRM)
- ✅ Function calling loop (max 5 iterations)
- ✅ Prepared statements (SQL injection safe)
- ✅ Error handling with user-friendly messages
- ✅ Conversation history (24h TTL in KV)
- ✅ Comprehensive logging

**Не требуется никаких изменений** — система работает в production.

Для проверки работы отправьте в Bitrix24 чат:
- "подшипник 6205" → увидите цену и наличие из БД
- "аналог 6205" → увидите список аналогов из таблицы analogs
- "ГОСТ 520" → увидите документацию из базы знаний
