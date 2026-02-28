import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fetch Response-like object.
 * `jsonFn` is a vi.fn() so each test can control what res.json() returns/throws.
 */
function mockRes({ ok, status, jsonFn }) {
  return { ok, status, json: jsonFn };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('api service — request normalization', () => {
  let api;

  beforeEach(async () => {
    // Reset module registry so each test gets a fresh BASE evaluation.
    vi.resetModules();
    global.fetch = vi.fn();
    ({ api } = await import('./api.js'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Case 1 ────────────────────────────────────────────────────────────────
  it('successful fetch returns { ok: true, data }', async () => {
    const data = { status: 'ok' };
    global.fetch.mockResolvedValue(
      mockRes({ ok: true, status: 200, jsonFn: vi.fn().mockResolvedValue(data) })
    );

    const result = await api.health();

    expect(result).toEqual({ ok: true, data });
  });

  // ── Case 2a ───────────────────────────────────────────────────────────────
  it('404 response with JSON error field returns { ok: false, error, status: 404 }', async () => {
    global.fetch.mockResolvedValue(
      mockRes({
        ok: false,
        status: 404,
        jsonFn: vi.fn().mockResolvedValue({ error: 'Listing not found' }),
      })
    );

    const result = await api.getListings();

    expect(result).toEqual({ ok: false, error: 'Listing not found', status: 404 });
  });

  // ── Case 2b ───────────────────────────────────────────────────────────────
  it('500 response with no error field falls back to "HTTP 500"', async () => {
    global.fetch.mockResolvedValue(
      mockRes({
        ok: false,
        status: 500,
        jsonFn: vi.fn().mockResolvedValue({}), // body has neither error nor message
      })
    );

    const result = await api.health();

    expect(result).toEqual({ ok: false, error: 'HTTP 500', status: 500 });
  });

  // ── Case 2c ───────────────────────────────────────────────────────────────
  it('non-2xx with non-JSON body falls back to "HTTP <status>"', async () => {
    global.fetch.mockResolvedValue(
      mockRes({
        ok: false,
        status: 503,
        jsonFn: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      })
    );

    const result = await api.health();

    expect(result).toEqual({ ok: false, error: 'HTTP 503', status: 503 });
  });

  // ── Case 3 ────────────────────────────────────────────────────────────────
  it('network failure (fetch throws) returns { ok: false, error, status: 0 }', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await api.health();

    expect(result).toEqual({ ok: false, error: 'Failed to fetch', status: 0 });
  });

  // ── Case 4 ────────────────────────────────────────────────────────────────
  it('200 OK with non-JSON body returns { ok: false, error: "Invalid JSON in response", status: 200 }', async () => {
    global.fetch.mockResolvedValue(
      mockRes({
        ok: true,
        status: 200,
        jsonFn: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON')),
      })
    );

    const result = await api.health();

    expect(result).toEqual({ ok: false, error: 'Invalid JSON in response', status: 200 });
  });

  // ── Case 5 ────────────────────────────────────────────────────────────────
  it('BASE URL is read from VITE_API_BASE_URL env variable', async () => {
    // Stub the env var BEFORE re-importing so BASE is evaluated with the new value.
    vi.stubEnv('VITE_API_BASE_URL', 'http://custom-server/api');
    vi.resetModules();

    global.fetch = vi.fn().mockResolvedValue(
      mockRes({ ok: true, status: 200, jsonFn: vi.fn().mockResolvedValue({}) })
    );

    const { api: freshApi } = await import('./api.js');
    await freshApi.health();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://custom-server/api/health',
      expect.any(Object)
    );
  });

  // ── Case 5b ───────────────────────────────────────────────────────────────
  it('BASE URL falls back to localhost:5000 when VITE_API_BASE_URL is not set', async () => {
    // No vi.stubEnv — env var is absent.
    global.fetch.mockResolvedValue(
      mockRes({ ok: true, status: 200, jsonFn: vi.fn().mockResolvedValue({}) })
    );

    await api.health();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5000/api/health',
      expect.any(Object)
    );
  });
});
