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
  return { prepare: () => stmt };
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
    WORKER_HOST:        'test.example.com',
    BITRIX_WEBHOOK_URL: 'https://b24.example.com/rest/1/token/',
    ...overrides,
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
});

// ── /reset endpoint ───────────────────────────────────────────────────────────

describe('/reset endpoint', () => {
  const postReset = (user_id, env) =>
    worker.fetch(
      makeRequest('/reset', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id }),
      }),
      env ?? makeEnv(),
    );

  it('returns 400 for a non-numeric user_id string', async () => {
    const res = await postReset('invalid');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid user_id');
  });

  it('returns 400 for null user_id', async () => {
    const res = await postReset(null);
    expect(res.status).toBe(400);
  });

  it('returns 400 for alphanumeric user_id', async () => {
    const res = await postReset('123abc');
    expect(res.status).toBe(400);
  });

  it('returns 200 and deletes KV key for a valid numeric user_id', async () => {
    const kv = makeMockKV();
    await kv.put('history:42', JSON.stringify([{ role: 'user', parts: [] }]));

    const res = await postReset('42', makeEnv({ CHAT_HISTORY: kv }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // KV entry must have been deleted
    expect(await kv.get('history:42')).toBeNull();
  });

  it('returns 200 even when the key did not exist in KV', async () => {
    const res = await postReset('99');
    expect(res.status).toBe(200);
  });
});

// ── /imbot routing ────────────────────────────────────────────────────────────

describe('/imbot event routing', () => {
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
      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': 'chat123',
          'data[PARAMS][MESSAGE]':   message,
        }),
        makeEnv(),
      );
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
      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': 'chat123',
          'data[PARAMS][MESSAGE]':   '[USER=999] как дела?',  // BOT_ID = 999
        }),
        makeEnv(),
      );
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
      await kv.put('history:42', JSON.stringify([{ role: 'user', parts: [] }]));

      const res = await worker.fetch(
        makeImbotRequest({
          event:                     'ONIMBOTMESSAGEADD',
          'data[USER][ID]':          '42',
          'data[PARAMS][DIALOG_ID]': '42',
          'data[PARAMS][MESSAGE]':   '/сброс',
        }),
        makeEnv({ CHAT_HISTORY: kv }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      // History key must be deleted
      expect(await kv.get('history:42')).toBeNull();
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
          body:    JSON.stringify({ user_id: userId }),
        }),
        makeEnv(),
      );
      expect(res.status).toBe(shouldSucceed ? 200 : 400);
    });
  }
});
