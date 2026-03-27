# Конфигурация Bitrix24 бота

## Обзор

Этот документ содержит информацию о конфигурации ИИ-помощника Эверест в Bitrix24.

## Параметры бота

### Основные настройки

| Параметр | Значение | Описание |
|----------|----------|----------|
| **Название бота** | ИИ-помощник Эверест | Отображаемое имя бота в чатах |
| **URL обработчика** | https://bitrix24bot.vza3555.workers.dev/imbot | Cloudflare Worker endpoint |
| **Код бота** | 6k0exwyimz06si3h | Внутренний код в Bitrix24 |
| **CLIENT_ID** | tbbsrb7w6k7vvnzegup7z4w7dmgvbqkf | ID клиентского приложения |
| **BOT_ID** | 1267 | ID бота в системе |
| **Тип бота** | Чат-бот, ответы поступают сразу | Синхронный режим работы |

### REST API вебхук

| Параметр | Значение |
|----------|----------|
| **Portal** | ewerest.bitrix24.ru |
| **Webhook URL** | https://ewerest.bitrix24.ru/rest/1/p7mpsrj88h2ustgk/ |
| **Application Token** | z9rxpcoeaslfm10j04vybah79h2jumma |

## События (Webhooks)

Бот подписан на следующие события:

- ✅ **ONIMBOTMESSAGEADD** - Новое сообщение боту (основное событие)
- ✅ **ONIMBOTMESSAGEUPDATE** - Обновление сообщения чат-ботом
- ✅ **ONIMBOTMESSAGEDELETE** - Удаление сообщения чат-ботом
- ✅ **ONIMBOTJOINCHAT** - Включение бота в чат
- ✅ **ONIMBOTDELETE** - Удаление бота
- ✅ **ONIMCOMMANDADD** - Команда боту
- ✅ **ONCRMINVOICEDELETE** - Удаление счета
- ✅ **ONCRMLEADADD** - Создание лида
- ✅ **ONCRMCOMPANYUPDATE** - Обновление компании
- ✅ **ONCRMCOMPANYADD** - Создание компании

## Права доступа

Боту предоставлены следующие права:

- ✅ **CRM (crm)** - Доступ к CRM данным
- ✅ **Задачи (task)** - Работа с задачами
- ✅ **Создание и управление Чат-ботами (imbot)** - Управление ботом
- ✅ **Чат и уведомления (im)** - Отправка сообщений

## Настройка Cloudflare Worker

### Переменные окружения (wrangler.toml)

```toml
[vars]
BOT_ID    = "1267"
CLIENT_ID = "tbbsrb7w6k7vvnzegup7z4w7dmgvbqkf"
```

### Секреты (устанавливаются через wrangler secret put)

Следующие значения должны быть установлены как секреты Cloudflare Worker:

```bash
# Bitrix24 REST API
wrangler secret put B24_PORTAL          # ewerest.bitrix24.ru
wrangler secret put B24_USER_ID         # 1
wrangler secret put B24_TOKEN           # p7mpsrj88h2ustgk

# Безопасность
wrangler secret put B24_APP_TOKEN       # z9rxpcoeaslfm10j04vybah79h2jumma

# AI и другие сервисы
wrangler secret put GEMINI_API_KEY      # Ключ Google Gemini API
wrangler secret put WORKER_HOST         # bitrix24bot.vza3555.workers.dev
wrangler secret put IMPORT_SECRET       # Случайная строка для защиты импорта
```

## Функциональность

### Обработка сообщений из чатов

Бот настроен на получение сообщений из чатов с использованием следующей логики:

1. **Личные чаты**: Бот отвечает на все сообщения
2. **Групповые чаты**: Бот отвечает только если:
   - Сообщение содержит ключевые слова: подшипник, сделка, клиент, цена, стоимость, скидка, КП, коммерческ, заказ, поставка, наличие, срок, каталог, аналог
   - ИЛИ бот упомянут через @-mention

### Команды

- `/помощь` или `/start` - Показать справку
- `/сброс` или `/reset` - Очистить историю диалога

### Безопасность

- ✅ Валидация application token для всех входящих вебхуков
- ✅ Проверка подписи запросов от Bitrix24
- ✅ Защита эндпоинтов импорта через IMPORT_SECRET

## Диагностика

### Проверка конфигурации

```bash
curl "https://bitrix24bot.vza3555.workers.dev/status?secret=<IMPORT_SECRET>"
```

Ответ покажет статус всех необходимых переменных окружения.

### Логирование

Все события логируются в Cloudflare Workers Logs с подробной информацией:
- 📨 Входящие webhook события
- 👥 Обработка групповых чатов (с ключевыми словами)
- 💬 Личные сообщения
- 🧠 Вызовы Gemini API
- 📤 Отправка ответов
- ❌ Ошибки с полным stack trace

## Регистрация бота

Для регистрации бота в Bitrix24 после деплоя:

```bash
curl "https://bitrix24bot.vza3555.workers.dev/register?secret=<IMPORT_SECRET>"
```

Эта команда должна быть выполнена один раз после начального развертывания.

## Проверка работоспособности

1. Отправьте боту сообщение в личный чат
2. Или упомяните бота в групповом чате: `@ИИ-помощник Эверест привет`
3. Или напишите в групповом чате сообщение с ключевым словом: "Какой подшипник выбрать?"

Бот должен ответить в течение нескольких секунд.

## Troubleshooting

См. [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) для подробной информации о диагностике проблем.
