# bitrix24bot — ИИ-консультант по подшипникам для Bitrix24

Внутренний Bitrix24 бот «Алексей» от компании «Эверест» (Вологда) — ИИ-консультант по подшипникам и приводным компонентам с интеграцией Gemini 2.0 Flash и CRM.

## 🚀 Возможности

- **ИИ-консультант**: Gemini 2.0 Flash с function calling для ответов на технические вопросы
- **Каталог подшипников**: Поиск по артикулу, размерам (d×D×B), ГОСТ/ISO обозначениям
- **Поиск аналогов**: 37,000+ кросс-референсов между ГОСТ, ISO и брендами (SKF, FAG, NSK, NTN, KOYO и др.)
- **База знаний**: 120+ технических статей с полнотекстовым поиском (FTS5)
- **CRM интеграция**: Работа со сделками, компаниями, товарами через Bitrix24 REST API
- **История диалогов**: 24-часовое хранение контекста разговоров в Cloudflare KV

## 🏗️ Архитектура

| Компонент | Технология |
|-----------|------------|
| Runtime | Cloudflare Workers (ES modules) |
| AI | Google Gemini 2.0 Flash + Function Calling |
| Database | Cloudflare D1 (SQLite + FTS5) |
| Cache | Cloudflare KV |
| CRM | Bitrix24 REST API |

## 📁 Структура проекта

```
bitrix24bot/
├── b24-imbot/
│   └── worker.js          # Основной Worker — вся логика бота
├── scripts/
│   ├── build_bearings_seed.py  # Генерация SQL из CSV каталогов
│   ├── build_kb_seed.py        # Генерация SQL из базы знаний
│   └── process_inbox.py        # Обработка inbox/ файлов
├── inbox/                 # Папка для импорта данных (CSV, Markdown)
├── schema.sql             # Схема D1 базы данных
├── wrangler.toml          # Конфигурация Cloudflare Workers
└── tests/                 # Python и JavaScript тесты
```

## 🚀 Быстрый старт

См. [QUICKSTART.md](./QUICKSTART.md) для пошаговой инструкции по деплою.

```bash
# 1. Установите секреты (минимальный набор для работы бота)
wrangler secret put GEMINI_API_KEY
wrangler secret put B24_PORTAL
wrangler secret put B24_USER_ID
wrangler secret put B24_TOKEN

# Дополнительные секреты (для импорта данных и регистрации)
wrangler secret put IMPORT_SECRET
wrangler secret put WORKER_HOST

# 2. Деплой
wrangler deploy

# 3. Загрузка данных
wrangler d1 execute bearings-catalog --file schema.sql --remote
```

## 📖 Документация

| Документ | Описание |
|----------|----------|
| [QUICKSTART.md](./QUICKSTART.md) | Быстрый старт и деплой |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Полная документация по настройке |
| [CLAUDE.md](./CLAUDE.md) | Архитектура и конвенции кода |
| [SITEMAP.md](./SITEMAP.md) | Карта репозитория |

## 📚 Справочная информация

Репозиторий содержит 120+ технических статей по подшипникам в формате Markdown:

- **Типы подшипников** — классификация и характеристики
- **Системы обозначений** — ГОСТ, ISO, DIN, JIS
- **Производители** — SKF, FAG, NSK, NTN, KOYO, TIMKEN, ГПЗ и др.
- **Стандарты** — ГОСТ 520, ISO 15, ISO 281 и др.
- **Эксплуатация** — монтаж, смазка, дефекты

## 🧪 Тестирование

```bash
# Python тесты (seed scripts)
python3 -m unittest discover tests/ -v

# JavaScript тесты (worker)
npm test
```

## 📝 Лицензия

Проприетарное ПО компании «Эверест».
