/**
 * Tests for b24-imbot/worker.js
 *
 * Covers:
 *  - CORS preflight
 *  - Default / unknown routes
 *  - IMPORT_SECRET guards on all admin endpoints
 *  - /reset endpoint (sanitizeUserId validation + KV deletion)
 *  - /imbot routing: early-exit conditions
 *  - Group chat keyword filtering (no-match silent return vs. keyword match)
 *  - Bot @-mention in group chat
 *  - Built-in commands (/start, /сброс) in a personal chat
 */
import { describe, expect, it, vi } from 'vitest';
import worker from './worker.js';

// ── Mock factory helpers ──────────────────────────────────────────────────────

/**
 * Create a minimal mock D1 database.
 * By default every .all() returns { results: [] }.
 */
function makeMockDb(results = []) {
  const stmt = {
    bind: () => stmt,
    all:  async () => ({ results }),
    run:  async () => ({}),
  };
  const db = {
    prepare: () => stmt,
    withSession: () => db,
    getBookmark: () => null,
  };
  return db;
}

/**
 * Create an in-memory mock for a Cloudflare KV namespace.
 */
function makeMockKV() {
  const store = new Map();
  return {
    get:    async (key) => store.get(key) ?? null,
    put:    async (key, value) => { store.set(key, value); },
    delete: async (key) => { store.delete(key); },
  };
}

/**
 * Build a complete mock env with sensible defaults.
 * Pass overrides to replace individual bindings/vars.
 */
function makeEnv(overrides = {}) {
  return {
    CATALOG:            makeMockDb(),
    CHAT_HISTORY:       makeMockKV(),
    GEMINI_API_KEY:     'test-gemini-key',
    IMPORT_SECRET:      'test-secret',
    BOT_ID:             '999',
    CLIENT_ID:          'test-client-id',
    WORKER_HOST:        'test.example.com',
    BITRIX_WEBHOOK_URL: 'https://b24.example.com/rest/1/token/',
    ...overrides,
  };
}

/**
 * Create a mock Cloudflare Workers execution context.
 * waitUntil collects promises so tests can flush them with _flush().
 */
function makeCtx() {
  const promises = [];
  return {
    waitUntil: (promise) => { promises.push(Promise.resolve(promise)); },
    passThroughOnException: () => {},
    /** Await all background tasks enqueued via waitUntil. */
    _flush: () => Promise.allSettled(promises),
  };
}

/** Shortcut for building a Request to the worker. */
function makeRequest(path, options = {}) {
  return new Request(`https://bot.example.com${path}`, options);
}

/** Build a POST /imbot request with URL-encoded form data. */
function makeImbotRequest(params) {
  return makeRequest('/imbot', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams(params).toString(),
  });
}

/**
 * Create a fetch mock that handles Gemini API and Bitrix24 API calls.
 * Returns a plain text response from Gemini (no function calls)
 * and a successful result for all B24 REST calls.
 */
function makeApiFetchMock(geminiText = 'Ответ бота') {
  return vi.fn(async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: geminiText }] } }],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    // All Bitrix24 REST calls (im.dialog.writing, im.message.add, …)
    return new Response(
      JSON.stringify({ result: 1 }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  });
}

// ── CORS preflight ────────────────────────────────────────────────────────────

describe('CORS preflight', () => {
  it('OPTIONS request returns 200 with CORS headers', async () => {
    const res = await worker.fetch(makeRequest('/imbot', { method: 'OPTIONS' }), makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

// ── Default / unknown routes ──────────────────────────────────────────────────

describe('Default route', () => {
  it('GET / returns worker identification string', async () => {
    const res = await worker.fetch(makeRequest('/'), makeEnv());
    const text = await res.text();
    expect(text).toContain('b24-imbot');
  });

  it('GET /unknown-path returns the default response', async () => {
    const res = await worker.fetch(makeRequest('/unknown-path'), makeEnv());
    // Must not 404 — worker returns a default 200 with its name
    expect(res.status).toBe(200);
  });
});

// ── IMPORT_SECRET guards ──────────────────────────────────────────────────────

describe('IMPORT_SECRET guards', () => {
  const secretEndpoints = [
    '/import-catalog',
    '/import-catalog-csv',
    '/discover-catalog',
    '/preview-file',
  ];

  for (const path of secretEndpoints) {
    it(`GET ${path} with wrong secret → 403 Forbidden`, async () => {
      const res = await worker.fetch(
        makeRequest(`${path}?secret=wrong`),
        makeEnv(),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Forbidden');
    });
  }

  it('GET /import-catalog without secret param → 403', async () => {
    const res = await worker.fetch(makeRequest('/import-catalog'), makeEnv());
    expect(res.status).toBe(403);
  });

  it.each([
    '/import-catalog',
    '/import-catalog-csv',
    '/import-doc',
    '/preview-file',
    '/import-analogs',
  ])('GET %s rejects non-https direct url', async (path) => {
    const res = await worker.fetch(
      makeRequest(`${path}?secret=test-secret&url=http://127.0.0.1/test.csv`),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('https');
  });
});

// ── /reset endpoint ───────────────────────────────────────────────────────────

describe('/reset endpoint', () => {
  const postReset = (user_id, dialog_id, env) =>
    worker.fetch(
      makeRequest('/reset', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id, dialog_id }),
      }),
      env ?? makeEnv(),
    );

  it('returns 400 for a non-numeric user_id string', async () => {
    const res = await postReset('invalid', '100');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid user_id');
  });

  it('returns 400 for null user_id', async () => {
    const res = await postReset(null, '100');
    expect(res.status).toBe(400);
  });

  it('returns 400 for alphanumeric user_id', async () => {
    const res = await postReset('123abc', '100');
    expect(res.status).toBe(400);
  });

  it('returns 400 when dialog_id is missing', async () => {
    const res = await postReset('42', undefined);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('dialog_id required for safety');
  });

  it('returns 200 and deletes KV key for valid user_id and dialog_id', async () => {
    const kv = makeMockKV();
    await kv.put('history:42:100', JSON.stringify([{ role: 'user', parts: [] }]));

    const res = await postReset('42', '100', makeEnv({ CHAT_HISTORY: kv }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // KV entry must have been deleted
    expect(await kv.get('history:42:100')).toBeNull();
  });

  it('returns 200 even when the key did not exist in KV', async () => {
    const res = await postReset('99', '200');
    expect(res.status).toBe(200);
  });
});

// ── /imbot routing ────────────────────────────────────────────────────────────

describe('/imbot event routing', () => {
  it('logs warning but continues with mismatched B24 app token (soft mode)', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      const res = await worker.fetch(
        makeImbotRequest({
          event: 'ONIMBOTMESSAGEADD',
          'auth[application_token]': 'invalid-token',
          'data[USER][ID]': '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]': 'Привет',
        }),
        makeEnv({ B24_APP_TOKEN: 'expected-token' }),
        ctx,
      );
      await ctx._flush();
      // Soft mode: request is NOT rejected, bot processes the message
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('non-ONIMBOTMESSAGEADD event returns {ok:true} immediately', async () => {
    const res = await worker.fetch(
      makeImbotRequest({ event: 'ONIMBOTDELETE' }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('ONIMBOTMESSAGEADD without user_id returns {ok:true}', async () => {
    const res = await worker.fetch(
      makeImbotRequest({
        event:                       'ONIMBOTMESSAGEADD',
        'data[PARAMS][MESSAGE]':     'Привет',
        'data[PARAMS][DIALOG_ID]':   '42',
        // no data[USER][ID]
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('ONIMBOTMESSAGEADD without a message returns {ok:true}', async () => {
    const res = await worker.fetch(
      makeImbotRequest({
        event:                     'ONIMBOTMESSAGEADD',
        'data[USER][ID]':          '42',
        'data[PARAMS][DIALOG_ID]': '42',
        // no data[PARAMS][MESSAGE]
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// ── Group chat keyword filtering ──────────────────────────────────────────────

describe('Group chat keyword filtering', () => {
  it('silently ignores a message with no keywords in a group chat', async () => {
    const res = await worker.fetch(
      makeImbotRequest({
        event:                     'ONIMBOTMESSAGEADD',
        'data[USER][ID]':          '42',
        'data[PARAMS][DIALOG_ID]': 'chat123',   // "chat…" → group chat
        'data[PARAMS][MESSAGE]':   'Привет как дела!',
      }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // No external calls should have been made
  });

  it.each([
    ['подшипник', 'Есть подшипник 6205?'],
    ['сделка',    'Открой сделка 123'],       // exact keyword substring
    ['каталог',   'Проверь каталог SKF'],
    ['аналог',    'Нужен аналог для 6205'],
    ['цена',      'Какая цена?'],
    ['артикул',   'Артикул 6205'],
    ['наличие',   'Проверь наличие'],
    ['заказ',     'Оформи заказ'],
  ])('triggers Gemini when keyword "%s" is in a group chat message', async (keyword, message) => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': 'chat123',
          'data[PARAMS][MESSAGE]':   message,
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();
      expect(res.status).toBe(200);
      // At least one call to the Gemini API must have been made
      const geminiCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('generativelanguage.googleapis.com'),
      );
      expect(geminiCalls.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('triggers Gemini when bot is @-mentioned in a group chat', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': 'chat123',
          'data[PARAMS][MESSAGE]':   '[USER=999] как дела?',  // BOT_ID = 999
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();
      expect(res.status).toBe(200);
      const geminiCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('generativelanguage.googleapis.com'),
      );
      expect(geminiCalls.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── Built-in commands ─────────────────────────────────────────────────────────

describe('Built-in commands in personal chat', () => {
  it('/start returns {ok:true} and sends a reply via botReply', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]':   '/start',
        }),
        makeEnv(),
        makeCtx(),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      // The worker must have made at least one outbound API call (to Bitrix24)
      // to deliver the /start reply via botReply → b24 → fetch.
      expect(mockFetch.mock.calls.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('/сброс resets KV history and returns {ok:true}', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const kv = makeMockKV();
      await kv.put('history:42:42', JSON.stringify([{ role: 'user', parts: [] }]));

      const ctx = makeCtx();
      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]':   '/сброс',
        }),
        makeEnv({ CHAT_HISTORY: kv }),
        ctx,
      );
      await ctx._flush();
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      // History key must have been deleted (format: history:{userId}:{dialogId})
      expect(await kv.get('history:42:42')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Reliability and anti-hallucination guards', () => {
  it('adds evidence warning when Gemini answers bearing question without tool calls', async () => {
    const mockFetch = makeApiFetchMock('Да, подходит.');
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]':   'Подойдет ли подшипник 6205?',
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();

      const messageAddCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageAddCall).toBeTruthy();
      expect(String(messageAddCall[1].body)).toContain('Ответ без подтверждения из базы');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects too long user message with explicit limit response', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);
    const longMessage = 'а'.repeat(3600);

    try {
      const ctx = makeCtx();
      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]':   longMessage,
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();
      expect(res.status).toBe(200);

      const geminiCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('generativelanguage.googleapis.com'),
      );
      expect(geminiCalls.length).toBe(0);

      const messageAddCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageAddCall).toBeTruthy();
      expect(String(messageAddCall[1].body)).toContain('Сообщение слишком длинное');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not add evidence warning for non-bearing message containing small numeric ids', async () => {
    const mockFetch = makeApiFetchMock('Ок, посмотрел сделку.');
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': 'chat123',
          'data[PARAMS][MESSAGE]':   'Проверь сделка 123',
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();

      const messageAddCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageAddCall).toBeTruthy();
      expect(String(messageAddCall[1].body)).not.toContain('Ответ без подтверждения из базы');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Bitrix24 webhook base URL selection', () => {
  it('uses BITRIX_WEBHOOK_URL for REST calls when provided', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ result: 1 }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    try {
      const res = await worker.fetch(
        makeRequest('/send', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            secret:  'test-secret',
            chat_id: '42',
            text:    'Проверка вебхука',
          }),
        }),
        makeEnv({
          BITRIX_WEBHOOK_URL: 'https://ewerest.bitrix24.ru/rest/1/4qp82wemchowt0f0/',
        }),
      );

      expect(res.status).toBe(200);
      const messageAddCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageAddCall).toBeTruthy();
      expect(String(messageAddCall[0])).toContain(
        'https://ewerest.bitrix24.ru/rest/1/4qp82wemchowt0f0/',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to B24_PORTAL/B24_USER_ID/B24_TOKEN for invalid BITRIX_WEBHOOK_URL', async () => {
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ result: 1 }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    try {
      const res = await worker.fetch(
        makeRequest('/send', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            secret:  'test-secret',
            chat_id: '42',
            text:    'Проверка fallback',
          }),
        }),
        makeEnv({
          B24_PORTAL:          'portal.example.com',
          B24_USER_ID:         '77',
          B24_TOKEN:           'fallback-token',
          BITRIX_WEBHOOK_URL:  'https://portal.example.com/not-a-webhook',
        }),
      );

      expect(res.status).toBe(200);
      const messageAddCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageAddCall).toBeTruthy();
      expect(String(messageAddCall[0])).toContain(
        'https://portal.example.com/rest/77/fallback-token/',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── ONIMCOMMANDADD slash-command handling ─────────────────────────────────────

describe('ONIMCOMMANDADD slash-command handling', () => {
  // Helper: build the real Bitrix24 indexed ONIMCOMMANDADD payload
  // data[COMMAND][<id>][COMMAND], data[COMMAND][<id>][COMMAND_PARAMS], etc.
  function makeCommandRequest(command, params = '', dialogId = '42', cmdId = '1') {
    return makeImbotRequest({
      event:                                      'ONIMCOMMANDADD',
      'data[USER][ID]':                           '42',
      'data[PARAMS][DIALOG_ID]':                  dialogId,
      [`data[COMMAND][${cmdId}][COMMAND]`]:        command,
      [`data[COMMAND][${cmdId}][COMMAND_PARAMS]`]: params,
      [`data[COMMAND][${cmdId}][DIALOG_ID]`]:      dialogId,
    });
  }

  it('returns {ok:true} immediately and enqueues background work', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      const res = await worker.fetch(
        makeCommandRequest('подшипник', '6205-2RS'),
        makeEnv(),
        ctx,
      );
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      await ctx._flush();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('calls typing indicator and sends message for /подшипник command', async () => {
    const mockFetch = makeApiFetchMock('Подшипник 6205-2RS найден');
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      await worker.fetch(makeCommandRequest('подшипник', '6205-2RS'), makeEnv(), ctx);
      await ctx._flush();

      const b24Calls = mockFetch.mock.calls
        .map(([url]) => String(url))
        .filter((url) => !url.includes('generativelanguage'));

      // v2 API: imbot.v2.Chat.InputAction.notify for typing, imbot.v2.Chat.Message.send for message
      // With fallback to v1: imbot.sendtyping / imbot.message.add / im.message.add
      const hasTyping = b24Calls.some((url) => url.includes('InputAction.notify') || url.includes('imbot.sendtyping'));
      const hasMessage = b24Calls.some((url) => url.includes('Message.send') || url.includes('imbot.message.add') || url.includes('im.message.add'));
      expect(hasTyping).toBe(true);
      expect(hasMessage).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('calls Gemini API with the correct prompt for /аналог command', async () => {
    const mockFetch = makeApiFetchMock('Аналог найден');
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      await worker.fetch(makeCommandRequest('аналог', '180205'), makeEnv(), ctx);
      await ctx._flush();

      const geminiCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('generativelanguage.googleapis.com'),
      );
      expect(geminiCalls.length).toBeGreaterThan(0);
      const promptText = JSON.stringify(JSON.parse(geminiCalls[0][1].body));
      expect(promptText).toContain('180205');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores ONIMCOMMANDADD with no indexed command key (empty payload)', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      const res = await worker.fetch(
        makeImbotRequest({
          event:             'ONIMCOMMANDADD',
          'data[USER][ID]':  '42',
          // no data[COMMAND][<id>][COMMAND] key at all
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      expect(mockFetch.mock.calls.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── sanitizeUserId (tested indirectly via /reset) ─────────────────────────────

describe('sanitizeUserId behaviour', () => {
  const cases = [
    ['42',    true,  'plain number string'],
    ['0',     true,  'zero string (digits only)'],
    ['',      false, 'empty string'],
    ['abc',   false, 'non-numeric string'],
    ['1 2',   false, 'number with space'],
    [' 42',   false, 'leading space'],
    ['42 ',   false, 'trailing space'],
    ['12.3',  false, 'decimal number'],
    ['-1',    false, 'negative number'],
  ];

  for (const [userId, shouldSucceed, label] of cases) {
    it(`"${userId}" (${label}) → ${shouldSucceed ? '200' : '400'}`, async () => {
      const res = await worker.fetch(
        makeRequest('/reset', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ user_id: userId, dialog_id: '100' }),
        }),
        makeEnv(),
      );
      expect(res.status).toBe(shouldSucceed ? 200 : 400);
    });
  }
});

// ── ONIMBOTJOINCHAT welcome message ──────────────────────────────────────────

describe('ONIMBOTJOINCHAT welcome message', () => {
  it('sends greeting with commands when bot joins chat', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTJOINCHAT',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[USER][ID]':          '42',
          'data[BOT_ID]':            '999',
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const messageCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageCall).toBeTruthy();
      expect(String(messageCall[1].body)).toContain('ИИ-помощник Эверест');
      expect(String(messageCall[1].body)).toContain('/подшипник');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not call Gemini for ONIMBOTJOINCHAT event', async () => {
    const mockFetch = makeApiFetchMock();
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTJOINCHAT',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[USER][ID]':          '42',
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();

      const geminiCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('generativelanguage.googleapis.com'),
      );
      expect(geminiCalls.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── MAX_TOKENS handling ──────────────────────────────────────────────────────

describe('MAX_TOKENS truncation handling', () => {
  it('appends continuation prompt when Gemini response is truncated', async () => {
    const mockFetch = vi.fn(async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: 'Частичный ответ о подшипниках' }] },
              finishReason: 'MAX_TOKENS',
            }],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ result: 1 }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      const ctx = makeCtx();
      await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]':   'Расскажи про подшипники',
        }),
        makeEnv(),
        ctx,
      );
      await ctx._flush();

      const messageCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageCall).toBeTruthy();
      expect(String(messageCall[1].body)).toContain('ответ сокращён');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── Hallucination detection ──────────────────────────────────────────────────

describe('Hallucination detection post-processing', () => {
  it('adds price warning when search_catalog returns found:0 but response mentions price', async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        callCount++;
        if (callCount === 1) {
          // First call: Gemini requests search_catalog tool
          return new Response(
            JSON.stringify({
              candidates: [{
                content: {
                  parts: [{
                    functionCall: {
                      name: 'search_catalog',
                      args: { query: '6205' },
                    },
                  }],
                },
              }],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        }
        // Second call: Gemini returns text with price (hallucination)
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: 'Подшипник 6205 стоит 500 руб' }] },
            }],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ result: 1 }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    // Mock DB returns found: 0 for search_catalog
    const mockDb = makeMockDb([]);

    try {
      const ctx = makeCtx();
      await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]':   'Сколько стоит подшипник 6205?',
        }),
        makeEnv({ CATALOG: mockDb }),
        ctx,
      );
      await ctx._flush();

      const messageCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageCall).toBeTruthy();
      expect(String(messageCall[1].body)).toContain('не подтверждены каталогом');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adds analog warning when search_analogs returns found:0 but response mentions analogs', async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              candidates: [{
                content: {
                  parts: [{
                    functionCall: {
                      name: 'search_analogs',
                      args: { query: '6205' },
                    },
                  }],
                },
              }],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{
              content: { parts: [{ text: 'Аналог подшипника 6205 — это 180205' }] },
            }],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ result: 1 }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', mockFetch);

    const mockDb = makeMockDb([]);

    try {
      const ctx = makeCtx();
      await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]':   'Найди аналог 6205',
        }),
        makeEnv({ CATALOG: mockDb }),
        ctx,
      );
      await ctx._flush();

      const messageCall = mockFetch.mock.calls.find(([url]) =>
        String(url).includes('im.message.add') || String(url).includes('imbot.message.add'),
      );
      expect(messageCall).toBeTruthy();
      expect(String(messageCall[1].body)).toContain('не подтверждены базой');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
