# 🔐 Руководство по регистрации бота в Bitrix24

## Обзор

Регистрация бота — это **одноразовая операция**, которая выполняется после первоначального развертывания Worker в Cloudflare. Этот процесс регистрирует бота в системе Bitrix24 и возвращает `BOT_ID`, который необходимо сохранить в конфигурации.

---

## Предварительные требования

Перед регистрацией убедитесь, что:

1. ✅ **Worker развернут** в Cloudflare Workers
2. ✅ **Все секреты установлены** через `wrangler secret put`:
   - `GEMINI_API_KEY` - ключ Google Gemini API
   - `B24_PORTAL` - домен портала Bitrix24 (например, `ewerest.bitrix24.ru`)
   - `B24_USER_ID` - ID пользователя для REST API
   - `B24_TOKEN` - токен REST API
   - `WORKER_HOST` - домен Worker (например, `bitrix24bot.vza3555.workers.dev`)
   - `IMPORT_SECRET` - секретная строка для защиты административных эндпоинтов
   - `B24_APP_TOKEN` (опционально) - токен приложения для валидации вебхуков

3. ✅ **CLIENT_ID установлен** в `wrangler.toml` (vars)

---

## Процесс регистрации

### Шаг 1: Подготовка секретного ключа

Секрет `IMPORT_SECRET` защищает административные эндпоинты, включая `/register`.

**Установите секрет** (если еще не установлен):

```bash
wrangler secret put IMPORT_SECRET
# Введите случайную строку (рекомендуется 32+ символа)
# Например: a7f9d2e8c4b1f6a3e9d5c2b8f4a1e7d3
```

**Запомните или сохраните** этот секрет — он понадобится для вызова `/register`.

### Шаг 2: Вызов эндпоинта регистрации

**Формат URL:**

```
GET https://<your-worker-domain>/register?secret=<IMPORT_SECRET>
```

**Пример с curl:**

```bash
# Замените значения на ваши:
WORKER_URL="https://bitrix24bot.vza3555.workers.dev"
SECRET="12345678"  # Замените на ваш IMPORT_SECRET

curl "${WORKER_URL}/register?secret=${SECRET}"
```

**Пример с браузером:**

Откройте в браузере:
```
https://bitrix24bot.vza3555.workers.dev/register?secret=12345678
```

*(Замените `bitrix24bot.vza3555.workers.dev` на ваш домен Worker и `12345678` на ваш IMPORT_SECRET)*

### Шаг 3: Обработка ответа

#### Успешная регистрация

Если регистрация прошла успешно, вы получите ответ:

```json
{
  "ok": true,
  "bot_id": 1267,
  "note": "Сохрани BOT_ID в secrets: wrangler secret put BOT_ID"
}
```

**Важно:** Сохраните значение `bot_id` — это идентификатор вашего бота в Bitrix24.

#### Возможные ошибки

**1. Неверный секрет (403 Forbidden):**

```json
{
  "error": "Forbidden"
}
```

**Решение:** Проверьте, что вы используете правильное значение `IMPORT_SECRET`.

**2. Отсутствует конфигурация (500 Internal Server Error):**

```json
{
  "error": "Missing required configuration: WORKER_HOST"
}
```

**Решение:** Убедитесь, что все необходимые секреты установлены (см. Предварительные требования).

**3. Ошибка API Bitrix24 (500 Internal Server Error):**

```json
{
  "error": "B24 imbot.register: invalid_grant — The user credentials were incorrect"
}
```

**Решение:** Проверьте правильность `B24_PORTAL`, `B24_USER_ID` и `B24_TOKEN`.

### Шаг 4: Сохранение BOT_ID

После получения `bot_id`, **обновите конфигурацию Worker**:

**Вариант A: Через wrangler.toml (рекомендуется для production)**

Отредактируйте файл `wrangler.toml`:

```toml
[vars]
BOT_ID    = "1267"  # ← Вставьте полученный bot_id
CLIENT_ID = "tbbsrb7w6k7vvnzegup7z4w7dmgvbqkf"
```

Затем повторно разверните Worker:

```bash
wrangler deploy
```

**Вариант B: Через секрет (альтернативный метод)**

```bash
wrangler secret put BOT_ID
# Введите полученный bot_id
```

---

## Проверка регистрации

После регистрации и обновления конфигурации, проверьте статус бота:

### 1. Проверка через эндпоинт `/status`

```bash
curl "https://bitrix24bot.vza3555.workers.dev/status?secret=<IMPORT_SECRET>"
```

Ответ должен включать:

```json
{
  "ok": true,
  "config": {
    "BOT_ID": "✅",
    "CLIENT_ID": "✅",
    "GEMINI_API_KEY": "✅",
    "B24_PORTAL": "✅",
    "B24_USER_ID": "✅",
    "B24_TOKEN": "✅",
    ...
  }
}
```

### 2. Проверка в Bitrix24

1. Откройте ваш портал Bitrix24
2. Перейдите в **Приложения → Мои приложения**
3. Найдите бота **"ИИ-помощник Эверест"**
4. Убедитесь, что бот активен и доступен

### 3. Тестовое сообщение

Отправьте боту сообщение в личный чат:

```
Привет!
```

Бот должен ответить приветствием и показать доступные команды.

---

## Что делает эндпоинт `/register`

При вызове `/register` выполняются следующие действия:

1. **Валидация секрета** - проверяется, что `secret` совпадает с `IMPORT_SECRET`
2. **Вызов API Bitrix24** - метод `imbot.register` с параметрами:
   - `CODE`: "everest_ai_bot"
   - `TYPE`: "B" (Bot)
   - `EVENT_HANDLER`: URL вебхука (например, `https://bitrix24bot.vza3555.workers.dev/imbot`)
   - `CLIENT_ID`: из конфигурации
   - `PROPERTIES`:
     - `NAME`: "ИИ-помощник Эверест"
     - `COLOR`: "AQUA"
     - `WORK_POSITION`: "AI Assistant"
     - `PERSONAL_WWW`: "https://ewerest.ru"
3. **Возврат результата** - Bitrix24 возвращает `BOT_ID`, который затем нужно сохранить

**Код регистрации** (`b24-imbot/worker.js`, строки 964-979):

```javascript
async function registerBot(env) {
  const workerUrl = `https://${env.WORKER_HOST}`;
  return await b24(env, "imbot.register", {
    CODE: "everest_ai_bot",
    TYPE: "B", // Bot
    EVENT_HANDLER: `${workerUrl}/imbot`,
    OPENLINE: "N",
    CLIENT_ID: env.CLIENT_ID,
    PROPERTIES: {
      NAME: "ИИ-помощник Эверест",
      COLOR: "AQUA",
      WORK_POSITION: "AI Assistant",
      PERSONAL_WWW: "https://ewerest.ru",
    },
  });
}
```

---

## Часто задаваемые вопросы

### Нужно ли регистрировать бота повторно?

**Нет**, регистрация выполняется **только один раз** после первоначального развертывания. После регистрации бот получает постоянный `BOT_ID`, который сохраняется в Bitrix24.

**Исключения** (когда нужна повторная регистрация):

- Вы полностью удалили бота из Bitrix24
- Вы хотите создать нового бота с другим кодом
- Вы переносите бота на другой портал Bitrix24

### Что делать, если бот уже зарегистрирован?

Если вы попытаетесь зарегистрировать бота повторно с тем же `CODE`, Bitrix24 вернет ошибку:

```json
{
  "error": "Bot with this code already exists"
}
```

В этом случае:
1. Используйте существующий `BOT_ID`
2. Или удалите старого бота через Bitrix24 и зарегистрируйте заново

### Можно ли изменить параметры бота после регистрации?

Да, некоторые параметры можно изменить через метод `imbot.update`. Однако проще:
1. Удалить старого бота в Bitrix24
2. Зарегистрировать заново с новыми параметрами

### Как удалить бота?

**В интерфейсе Bitrix24:**
1. Приложения → Мои приложения
2. Найти бота "ИИ-помощник Эверест"
3. Удалить

**Через API:**
```bash
curl "https://<portal>.bitrix24.ru/rest/<user_id>/<token>/imbot.unregister.json?BOT_ID=<bot_id>"
```

---

## Безопасность

### Защита IMPORT_SECRET

- ✅ **Используйте сложный секрет** (32+ символа, случайные символы)
- ✅ **Не публикуйте секрет** в публичных репозиториях
- ✅ **Храните секрет** в безопасном месте (менеджер паролей)
- ✅ **Меняйте секрет** при компрометации

### Рекомендации

Пример генерации безопасного секрета:

```bash
# Linux/Mac
openssl rand -hex 32

# Или
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### Ограничения доступа

Эндпоинт `/register` защищен `IMPORT_SECRET`, но также рекомендуется:

- Вызывать регистрацию только из доверенных сетей
- Не выполнять регистрацию через общедоступные URL
- Удалить или заблокировать старые секреты после использования

---

## Troubleshooting

### Ошибка: "WORKER_HOST is not defined"

**Причина:** Не установлен секрет `WORKER_HOST`.

**Решение:**
```bash
wrangler secret put WORKER_HOST
# Введите домен Worker, например: bitrix24bot.vza3555.workers.dev
```

### Ошибка: "CLIENT_ID is not defined"

**Причина:** `CLIENT_ID` не задан в `wrangler.toml`.

**Решение:** Добавьте в `wrangler.toml`:
```toml
[vars]
CLIENT_ID = "tbbsrb7w6k7vvnzegup7z4w7dmgvbqkf"
```

### Ошибка: "The user credentials were incorrect"

**Причина:** Неверные параметры `B24_PORTAL`, `B24_USER_ID` или `B24_TOKEN`.

**Решение:**
1. Проверьте значения в Bitrix24
2. Переустановите секреты:
   ```bash
   wrangler secret put B24_PORTAL
   wrangler secret put B24_USER_ID
   wrangler secret put B24_TOKEN
   ```

### Бот зарегистрирован, но не отвечает на сообщения

**Возможные причины:**

1. **Не установлен `B24_APP_TOKEN`** - вебхуки отклоняются
2. **Неверный `EVENT_HANDLER`** - Bitrix24 не может отправить события
3. **Не установлен `GEMINI_API_KEY`** - бот не может генерировать ответы

**Решение:** Проверьте все секреты через `/status?secret=<IMPORT_SECRET>`.

---

## Дополнительная информация

### Связанная документация

- **BOT_STATUS.md** - Полный отчет о готовности бота
- **BITRIX24_CONFIGURATION.md** - Конфигурация Bitrix24
- **DEPLOYMENT.md** - Руководство по развертыванию
- **TROUBLESHOOTING.md** - Диагностика и решение проблем

### Логи

Все действия регистрации логируются в Cloudflare Workers Logs:

```
🔗 B24 API call: imbot.register
✅ B24 imbot.register: success
```

Просмотр логов:

```bash
wrangler tail
```

---

## Пример полного процесса

```bash
# 1. Установка всех секретов
wrangler secret put GEMINI_API_KEY
wrangler secret put B24_PORTAL
wrangler secret put B24_USER_ID
wrangler secret put B24_TOKEN
wrangler secret put WORKER_HOST
wrangler secret put IMPORT_SECRET
wrangler secret put B24_APP_TOKEN

# 2. Развертывание Worker
wrangler deploy

# 3. Регистрация бота
curl "https://bitrix24bot.vza3555.workers.dev/register?secret=your-import-secret"

# Ответ:
# {"ok":true,"bot_id":1267,"note":"Сохрани BOT_ID в secrets: wrangler secret put BOT_ID"}

# 4. Сохранение BOT_ID в wrangler.toml
# Отредактировать wrangler.toml:
# [vars]
# BOT_ID = "1267"

# 5. Повторное развертывание
wrangler deploy

# 6. Проверка
curl "https://bitrix24bot.vza3555.workers.dev/status?secret=your-import-secret"

# 7. Тестирование
# Отправить сообщение боту в Bitrix24
```

---

_Последнее обновление: 27 марта 2026_
