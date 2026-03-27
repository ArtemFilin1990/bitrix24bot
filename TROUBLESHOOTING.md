# Troubleshooting Guide: Bot Not Responding in Bitrix24 Chat

## Overview

This guide helps diagnose and fix issues when the Bitrix24 IM bot stops responding to messages. The bot has comprehensive logging that can help identify the root cause.

## Quick Diagnostic Checklist

### 1. Check Cloudflare Worker Logs

View logs in Cloudflare Dashboard → Workers → bitrix24bot → Logs

Look for these log patterns:

#### ✅ Normal Operation (Bot should respond)
```
📨 Webhook received: { event: 'ONIMBOTMESSAGEADD', userId: '42', chatId: '42', ... }
💬 Personal chat: will respond
🤖 Starting AI processing...
⌨️ Showing typing indicator...
📚 History loaded: { turns: 0 }
🧠 Calling Gemini...
🤖 askGemini: model=gemini-2.5-flash, historyLength=0
🔄 Gemini iteration 1/5
✅ Gemini: final response (123 chars)
💾 History saved
📤 Sending bot reply...
🔗 B24 API call: imbot.message.add ...
✅ B24 imbot.message.add: success
✅ Bot reply sent successfully
```

#### ⚠️ Silent Mode (Expected behavior in group chats)
```
📨 Webhook received: { event: 'ONIMBOTMESSAGEADD', userId: '42', chatId: 'chat12345', ... }
👥 Group chat message: { keywordHit: null, botMentioned: false, willRespond: false }
🔇 Silent mode: no keywords or mention in group chat
```

#### ❌ Errors to Watch For

**Token Rejection:**
```
❌ Webhook rejected: invalid app token { appToken: 'abc123...', expected: 'xyz789...' }
```
→ Fix: Update `B24_APP_TOKEN` secret via `wrangler secret put B24_APP_TOKEN`

**Bitrix24 API Errors:**
```
❌ B24 imbot.message.add: API error { error: 'WRONG_AUTH_TYPE', description: '...' }
```
→ Fix: Verify `B24_PORTAL`, `B24_USER_ID`, `B24_TOKEN`, `BOT_ID`, `CLIENT_ID`

**Gemini API Errors:**
```
❌ Gemini: HTTP 400 { response: '{"error":{"message":"API key not valid"}}' }
```
→ Fix: Update `GEMINI_API_KEY` secret

**Database Errors:**
```
❌ Error in bot logic: D1_ERROR: no such table: catalog
```
→ Fix: Run database seeding workflow

### 2. Common Issues and Solutions

#### Issue: Bot silent in group chats

**Symptoms:**
- Bot works in personal chats (1-on-1 DM)
- Bot doesn't respond in group chats

**Root Cause:** Group chat filtering is working as designed. Bot only responds if:
1. Message contains one of the keywords: `подшипник`, `подшипники`, `артикул`, `сделка`, `сделки`, `клиент`, `цена`, `стоимость`, `скидка`, `кп`, `коммерческ`, `заказ`, `поставка`, `наличие`, `срок`, `каталог`, `аналог`
2. OR bot is @-mentioned with `[USER=<BOT_ID>]` tag

**Solution:**
- Use keywords in messages: "Нужен подшипник 6205"
- Mention the bot: @ИИ-помощник Эверест
- Check logs for: `👥 Group chat message: { keywordHit: null, botMentioned: false }`

#### Issue: Bot doesn't respond anywhere

**Symptoms:**
- Bot silent in both personal and group chats
- No typing indicator appears

**Diagnostic Steps:**

1. **Verify bot registration:**
   ```bash
   # Check BOT_ID in wrangler.toml
   cat wrangler.toml | grep BOT_ID
   ```

2. **Test with command:**
   Send `/start` or `/помощь` in chat
   - If no response → registration or webhook issue
   - If responds → Gemini or database issue

3. **Check environment variables:**
   ```bash
   # List secrets (won't show values)
   wrangler secret list

   # Required secrets:
   # - GEMINI_API_KEY
   # - B24_PORTAL
   # - B24_USER_ID
   # - B24_TOKEN
   # - B24_APP_TOKEN (optional but recommended)
   # - WORKER_HOST
   # - IMPORT_SECRET
   ```

4. **Check webhook URL:**
   In Bitrix24, verify webhook points to:
   `https://<WORKER_HOST>/imbot`

#### Issue: Bot shows typing indicator but never responds

**Symptoms:**
- "печатает..." appears
- No message ever comes
- Logs show error after "Starting AI processing"

**Root Causes:**

1. **Gemini API failure:**
   ```
   ❌ Gemini: HTTP 429 { response: 'Resource exhausted' }
   ```
   → Wait and retry, or check API quotas

2. **Database query failure:**
   ```
   ❌ Error in bot logic: D1_ERROR: ...
   ```
   → Run `seed-database.yml` workflow

3. **Bitrix24 API failure (sending reply):**
   ```
   ✅ Gemini response received: { textLength: 245 }
   📤 Sending bot reply...
   ❌ B24 imbot.message.add: API error { error: 'WRONG_AUTH_TYPE' }
   ```
   → Verify B24 credentials

#### Issue: Bot responds with error message

**Symptoms:**
- Bot replies: "⚠️ Временная ошибка связи с сервисом. Попробуйте через минуту."
- Or: "⚠️ Произошла ошибка при обработке запроса. Обратитесь к администратору."

**Root Cause:** Exception caught in background processing

**Solution:**
1. Check Cloudflare logs for detailed error stack trace
2. Look for `❌ Error in bot logic:` entries
3. Fix underlying issue based on error message

### 3. Environment Variable Reference

| Variable | Type | Purpose | How to Set |
|---|---|---|---|
| `GEMINI_API_KEY` | Secret | Google Gemini API access | `wrangler secret put GEMINI_API_KEY` |
| `B24_PORTAL` | Secret | Bitrix24 portal domain (e.g., `mycompany.bitrix24.ru`) | `wrangler secret put B24_PORTAL` |
| `B24_USER_ID` | Secret | Bitrix24 REST auth user ID | `wrangler secret put B24_USER_ID` |
| `B24_TOKEN` | Secret | Bitrix24 REST auth token | `wrangler secret put B24_TOKEN` |
| `B24_APP_TOKEN` | Secret | Bitrix24 app token for webhook validation | `wrangler secret put B24_APP_TOKEN` |
| `WORKER_HOST` | Secret | Worker domain (e.g., `bitrix24bot.myname.workers.dev`) | `wrangler secret put WORKER_HOST` |
| `IMPORT_SECRET` | Secret | Protects admin import endpoints | `wrangler secret put IMPORT_SECRET` |
| `BOT_ID` | Var | Bitrix24 bot registration ID (from `/register`) | Edit `wrangler.toml` |
| `CLIENT_ID` | Var | Bitrix24 app client ID | Edit `wrangler.toml` |

### 4. Testing Procedures

#### Test 1: Bot Registration
```bash
curl "https://<WORKER_HOST>/register?secret=<IMPORT_SECRET>"
```

Expected response:
```json
{
  "ok": true,
  "bot_id": "1267",
  "note": "Сохрани BOT_ID в secrets: wrangler secret put BOT_ID"
}
```

#### Test 2: Personal Chat
1. Open 1-on-1 chat with bot in Bitrix24
2. Send: "Привет"
3. Expected: Bot responds (should work even without keywords)

#### Test 3: Group Chat with Keyword
1. Create/open group chat in Bitrix24
2. Send: "Нужен подшипник 6205"
3. Expected: Bot responds (contains keyword "подшипник")

#### Test 4: Group Chat without Keyword
1. In group chat, send: "Привет всем"
2. Expected: Bot stays silent (no keywords, not mentioned)

#### Test 5: Group Chat with Mention
1. In group chat, send: "@ИИ-помощник Эверест привет"
2. Expected: Bot responds (mentioned by name)

### 5. Log Analysis Tips

**Find webhook rejections:**
```bash
wrangler tail --format pretty | grep "Webhook rejected"
```

**Monitor successful responses:**
```bash
wrangler tail --format pretty | grep "Bot reply sent successfully"
```

**Watch for errors:**
```bash
wrangler tail --format pretty | grep "❌"
```

**Full conversation trace:**
```bash
wrangler tail --format pretty
# Then send message in Bitrix24 and watch the full flow
```

### 6. Emergency Fixes

#### Reset Conversation History
If bot is stuck or behaving oddly:

Send in chat: `/сброс` or `/reset`

This clears the 24-hour conversation history from KV.

#### Force Redeploy
```bash
cd /path/to/bitrix24bot
git pull origin main
wrangler deploy
```

#### Re-register Bot
If webhook URL changed or bot disappeared:
```bash
curl "https://<WORKER_HOST>/register?secret=<IMPORT_SECRET>"
# Update BOT_ID in wrangler.toml with returned value
wrangler deploy
```

### 7. Contact Support

If issue persists after checking all above:

1. Collect Cloudflare Worker logs (last 100 lines)
2. Note exact symptoms and when they started
3. Provide sample message that fails
4. Check GitHub Issues: https://github.com/ArtemFilin1990/bitrix24bot/issues

## Changelog

This diagnostic logging was added in response to: "Бот не отвечает в чате битрикса"

**Changes made:**
- Added comprehensive emoji-tagged logging throughout webhook processing
- Added detailed logging in `b24()`, `botReply()`, `askGemini()` functions
- Added error stack traces for debugging background processing failures
- Improved visibility into group chat filtering decisions
