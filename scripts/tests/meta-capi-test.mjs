import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');
const compiledPath = resolve(__dirname, 'meta-capi.compiled.mjs');

const allowedOrigin = 'https://fulanihairsecrets.com';
const allowedSource = 'https://fulanihairsecrets.com/?fbclid=abc123';
const disallowedOrigin = 'https://evil.com';
const now = () => Math.floor(Date.now() / 1000);

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  expected: ${expected}\n  actual: ${actual}`);
  }
}

function createRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(obj) { this.body = obj; return this; },
    send(text) { this.body = text; return this; },
    end() { this.ended = true; return this; },
  };
}

function baseBody(overrides = {}) {
  return {
    event_name: 'Purchase',
    event_id: 'purchase-abc-123',
    event_time: now(),
    event_source_url: allowedSource,
    action_source: 'website',
    user_data: {
      em: ['hashedemail'],
      ph: ['hashedphone'],
      fn: ['hashedfirstname'],
      ln: ['hashedlastname'],
      st: ['lagos'],
      ct: ['lekki'],
      country: ['ng'],
      external_id: ['cust-123'],
      fbp: 'fb.1.1690000000.abc',
      fbc: 'fb.1.1690000001.def',
      client_ip_address: '203.0.113.5',
      client_user_agent: 'Mozilla/5.0 (test)',
    },
    custom_data: { value: 12000, currency: 'NGN' },
    ...overrides,
  };
}

function req(body, method = 'POST', headers = {}) {
  return { method, headers, body };
}

async function compileHandler() {
  await build({
    entryPoints: [resolve(repoRoot, 'api/meta-capi.ts')],
    outfile: compiledPath,
    bundle: false,
    platform: 'node',
    format: 'esm',
    target: 'node20',
  });
  const mod = await import(pathToFileURL(compiledPath).href);
  return mod.default;
}

let captured = {};
let originalFetch = globalThis.fetch;
let originalEnv = {};

function installMockFetch({ ok = true, status = 200, body, text } = {}) {
  captured = {};
  globalThis.fetch = async (url, options) => {
    captured.url = url;
    captured.body = options.body ? JSON.parse(options.body) : null;
    const responseText = text ?? (body !== undefined ? JSON.stringify(body) : JSON.stringify({ events_received: 1, messages: [] }));
    return {
      ok,
      status,
      headers: new Map(),
      text: async () => responseText,
      json: async () => JSON.parse(responseText),
    };
  };
}

function setEnv() {
  originalEnv = {
    META_PIXEL_ID: process.env.META_PIXEL_ID,
    META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN,
    META_API_VERSION: process.env.META_API_VERSION,
    META_CAPI_ALLOWED_ORIGINS: process.env.META_CAPI_ALLOWED_ORIGINS,
    META_CAPI_ALLOWED_SOURCE_HOSTS: process.env.META_CAPI_ALLOWED_SOURCE_HOSTS,
  };
  process.env.META_PIXEL_ID = '220381209723501';
  process.env.META_ACCESS_TOKEN = 'TEST_TOKEN';
  process.env.META_API_VERSION = 'v26.0';
  process.env.META_CAPI_ALLOWED_ORIGINS = `${allowedOrigin},https://www.fulanihairsecrets.com`;
  process.env.META_CAPI_ALLOWED_SOURCE_HOSTS = 'fulanihairsecrets.com,www.fulanihairsecrets.com';
}

function restoreEnv() {
  process.env.META_PIXEL_ID = originalEnv.META_PIXEL_ID;
  process.env.META_ACCESS_TOKEN = originalEnv.META_ACCESS_TOKEN;
  process.env.META_API_VERSION = originalEnv.META_API_VERSION;
  process.env.META_CAPI_ALLOWED_ORIGINS = originalEnv.META_CAPI_ALLOWED_ORIGINS;
  process.env.META_CAPI_ALLOWED_SOURCE_HOSTS = originalEnv.META_CAPI_ALLOWED_SOURCE_HOSTS;
}

function setMissingConfig() {
  process.env.META_PIXEL_ID = '';
  process.env.META_ACCESS_TOKEN = '';
  process.env.META_API_VERSION = '';
}

function setMissingApiVersion() {
  process.env.META_PIXEL_ID = '220381209723501';
  process.env.META_ACCESS_TOKEN = 'TEST_TOKEN';
  process.env.META_API_VERSION = '';
}

async function run() {
  setEnv();
  const handler = await compileHandler();

  // 1. GET rejected
  installMockFetch();
  {
    const res = createRes();
    await handler({ method: 'GET', headers: {}, body: {} }, res);
    assertEqual(res.statusCode, 405, 'GET should be 405');
    assertEqual(res.body.ok, false, 'GET ok=false');
  }

  // 2. Unsupported methods rejected
  installMockFetch();
  {
    const res = createRes();
    await handler({ method: 'PUT', headers: {}, body: {} }, res);
    assertEqual(res.statusCode, 405, 'PUT should be 405');
  }

  // 3. Valid OPTIONS returns 204
  installMockFetch();
  {
    const res = createRes();
    await handler({ method: 'OPTIONS', headers: { origin: allowedOrigin }, body: {} }, res);
    assertEqual(res.statusCode, 204, 'OPTIONS allowed origin should be 204');
    assertEqual(res.ended, true, 'OPTIONS should end');
    assertEqual(res.headers['Access-Control-Allow-Origin'], allowedOrigin, 'OPTIONS CORS origin set');
    assertEqual(res.headers['Vary'], 'Origin', 'Vary set');
  }

  // 4. Disallowed Origin returns 403
  installMockFetch();
  {
    const res = createRes();
    await handler({ method: 'POST', headers: { origin: disallowedOrigin }, body: baseBody() }, res);
    assertEqual(res.statusCode, 403, 'Disallowed origin should be 403');
  }
  {
    const res = createRes();
    await handler({ method: 'OPTIONS', headers: { origin: disallowedOrigin }, body: {} }, res);
    assertEqual(res.statusCode, 403, 'OPTIONS disallowed origin should be 403');
  }

  // 5. Allowed Origin echoed in CORS headers
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody(), 'POST', { origin: allowedOrigin }), res);
    assertEqual(res.headers['Access-Control-Allow-Origin'], allowedOrigin, 'CORS origin echoed');
    assertEqual(res.headers['Vary'], 'Origin', 'Vary set');
    assertEqual(res.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS', 'CORS methods set');
    assertEqual(res.headers['Access-Control-Allow-Headers'], 'Content-Type', 'CORS headers set');
  }

  // 6. Access-Control-Allow-Origin is never *
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody(), 'POST', { origin: allowedOrigin }), res);
    assert(res.headers['Access-Control-Allow-Origin'] !== '*', 'CORS origin must not be wildcard');
  }

  // 7. Missing configuration returns 500
  setMissingConfig();
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assertEqual(res.statusCode, 500, 'Missing config should be 500');
    assertEqual(res.body.error, 'CAPI not configured', 'CAPI not configured');
  }
  setEnv();

  // 8. Missing META_API_VERSION returns 500
  setMissingApiVersion();
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assertEqual(res.statusCode, 500, 'Missing API version should be 500');
    assertEqual(res.body.error, 'CAPI not configured', 'CAPI not configured for missing API version');
  }
  setEnv();

  // 9. Oversized body returns 413
  installMockFetch();
  {
    const res = createRes();
    const huge = { ...baseBody(), huge: 'x'.repeat(80 * 1024) };
    await handler(req(huge), res);
    assertEqual(res.statusCode, 413, 'Oversized body should be 413');
    assertEqual(res.body.error, 'Payload too large', 'Payload too large');
  }

  // 10. Missing event_name returns 400
  installMockFetch();
  {
    const res = createRes();
    await handler(req({ ...baseBody(), event_name: undefined }), res);
    assertEqual(res.statusCode, 400, 'Missing event_name should be 400');
  }

  // 11. Unsupported event name rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_name: 'Subscribe' })), res);
    assertEqual(res.statusCode, 400, 'Unsupported event_name should be 400');
    assertEqual(res.body.error, 'Unsupported event_name', 'Unsupported event_name');
  }

  // 12. AddToCart rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_name: 'AddToCart' })), res);
    assertEqual(res.statusCode, 400, 'AddToCart should be 400');
    assertEqual(res.body.error, 'Unsupported event_name', 'AddToCart rejected');
  }

  // 13. Missing event_id returns 400
  installMockFetch();
  {
    const res = createRes();
    await handler(req({ ...baseBody(), event_id: undefined }), res);
    assertEqual(res.statusCode, 400, 'Missing event_id should be 400');
  }

  // 14. event_id shorter than 8 rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_id: 'short' })), res);
    assertEqual(res.statusCode, 400, 'Short event_id should be 400');
  }

  // 15. event_id longer than 128 rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_id: 'a'.repeat(129) })), res);
    assertEqual(res.statusCode, 400, 'Long event_id should be 400');
  }

  // 16. Missing or invalid event_time returns 400
  installMockFetch();
  {
    const res = createRes();
    await handler(req({ ...baseBody(), event_time: undefined }), res);
    assertEqual(res.statusCode, 400, 'Missing event_time should be 400');
  }
  {
    const res = createRes();
    await handler(req(baseBody({ event_time: 'now' })), res);
    assertEqual(res.statusCode, 400, 'String event_time should be 400');
  }

  // 17. Millisecond timestamps rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_time: Date.now() })), res);
    assertEqual(res.statusCode, 400, 'Millisecond event_time should be 400');
  }

  // 18. Timestamps more than 7 days old rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_time: now() - 8 * 24 * 60 * 60 })), res);
    assertEqual(res.statusCode, 400, 'Old event_time should be 400');
  }

  // 19. Timestamps more than 5 minutes in the future rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_time: now() + 10 * 60 })), res);
    assertEqual(res.statusCode, 400, 'Future event_time should be 400');
  }

  // 20. Invalid action_source rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ action_source: 'mobile_app' })), res);
    assertEqual(res.statusCode, 400, 'Invalid action_source should be 400');
  }

  // 21. HTTP event_source_url rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_source_url: 'http://fulanihairsecrets.com/' })), res);
    assertEqual(res.statusCode, 400, 'HTTP event_source_url should be 400');
  }

  // 22. Unapproved source hostname rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ event_source_url: 'https://evil.com/' })), res);
    assertEqual(res.statusCode, 400, 'Unapproved event_source_url should be 400');
  }

  // 23. Invalid user_data rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ user_data: null })), res);
    assertEqual(res.statusCode, 400, 'Invalid user_data should be 400');
  }
  {
    const res = createRes();
    await handler(req(baseBody({ user_data: [] })), res);
    assertEqual(res.statusCode, 400, 'Array user_data should be 400');
  }

  // 24. Invalid custom_data rejected
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ custom_data: 'string' })), res);
    assertEqual(res.statusCode, 400, 'Invalid custom_data should be 400');
  }

  // 25. Existing client_ip_address preserved
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ user_data: { ...baseBody().user_data, client_ip_address: '192.0.2.55' } })), res);
    const event = captured.body.data[0];
    assertEqual(event.user_data.client_ip_address, '192.0.2.55', 'client_ip_address preserved');
  }

  // 26. Existing client_user_agent preserved
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody({ user_data: { ...baseBody().user_data, client_user_agent: 'CustomAgent/1.0' } })), res);
    const event = captured.body.data[0];
    assertEqual(event.user_data.client_user_agent, 'CustomAgent/1.0', 'client_user_agent preserved');
  }

  // 27. x-vercel-forwarded-for first fallback
  installMockFetch();
  {
    const res = createRes();
    const b = baseBody();
    delete b.user_data.client_ip_address;
    await handler(req(b, 'POST', {
      'x-vercel-forwarded-for': '203.0.113.100, 198.51.100.50',
      'x-real-ip': '203.0.113.200',
      'x-forwarded-for': '203.0.113.300',
      'user-agent': 'Mozilla/5.0',
    }), res);
    const event = captured.body.data[0];
    assertEqual(event.user_data.client_ip_address, '203.0.113.100', 'x-vercel-forwarded-for first');
  }

  // 28. x-real-ip second fallback
  installMockFetch();
  {
    const res = createRes();
    const b = baseBody();
    delete b.user_data.client_ip_address;
    await handler(req(b, 'POST', {
      'x-real-ip': '203.0.113.200',
      'x-forwarded-for': '203.0.113.300',
      'user-agent': 'Mozilla/5.0',
    }), res);
    const event = captured.body.data[0];
    assertEqual(event.user_data.client_ip_address, '203.0.113.200', 'x-real-ip second');
  }

  // 29. x-forwarded-for third fallback
  installMockFetch();
  {
    const res = createRes();
    const b = baseBody();
    delete b.user_data.client_ip_address;
    await handler(req(b, 'POST', {
      'x-forwarded-for': '203.0.113.300, 198.51.100.1',
      'user-agent': 'Mozilla/5.0',
    }), res);
    const event = captured.body.data[0];
    assertEqual(event.user_data.client_ip_address, '203.0.113.300', 'x-forwarded-for third');
  }

  // 30. remoteAddress final fallback
  installMockFetch();
  {
    const res = createRes();
    const b = baseBody();
    delete b.user_data.client_ip_address;
    await handler({ method: 'POST', headers: {}, body: b, socket: { remoteAddress: '203.0.113.77' } }, res);
    const event = captured.body.data[0];
    assertEqual(event.user_data.client_ip_address, '203.0.113.77', 'remoteAddress final');
  }

  // 31. Valid fbp forwarded unchanged
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    const event = captured.body.data[0];
    assertEqual(event.user_data.fbp, 'fb.1.1690000000.abc', 'fbp forwarded');
  }

  // 32. Valid fbc forwarded unchanged
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    const event = captured.body.data[0];
    assertEqual(event.user_data.fbc, 'fb.1.1690000001.def', 'fbc forwarded');
  }

  // 33. external_id forwarded unchanged
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    const event = captured.body.data[0];
    assert.deepStrictEqual(event.user_data.external_id, ['cust-123'], 'external_id forwarded');
  }

  // 34. Hashed identity values forwarded unchanged
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    const event = captured.body.data[0];
    assert.deepStrictEqual(event.user_data.em, ['hashedemail'], 'em forwarded');
    assert.deepStrictEqual(event.user_data.ph, ['hashedphone'], 'ph forwarded');
    assert.deepStrictEqual(event.user_data.country, ['ng'], 'country forwarded');
  }

  // 35. Purchase event_id forwarded unchanged
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    const event = captured.body.data[0];
    assertEqual(event.event_id, 'purchase-abc-123', 'Purchase event_id forwarded');
  }

  // 36. Access token comes from environment
  // 37. Access token attached as query parameter
  installMockFetch();
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assert(captured.url, 'Meta API should have been called');
    const parsedUrl = new URL(captured.url);
    assert(parsedUrl.origin + parsedUrl.pathname === 'https://graph.facebook.com/v26.0/220381209723501/events', 'URL should use v26.0 and pixel ID from env');
    assert(parsedUrl.searchParams.get('access_token') === 'TEST_TOKEN', 'URL should contain access token as query param');
    assert(!('access_token' in captured.body), 'token must not be in JSON event body');
  }

  // The complete Meta URL is never logged (no console.log/error in api/meta-capi.ts)
  {
    const source = readFileSync(resolve(repoRoot, 'api/meta-capi.ts'), 'utf-8');
    assert(!source.includes('console.log'), 'api/meta-capi.ts should not contain console.log');
    assert(!source.includes('console.error'), 'api/meta-capi.ts should not contain console.error');
  }

  installMockFetch({ body: { events_received: 1, messages: [], access_token: 'TEST_TOKEN' } });
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assert(!JSON.stringify(res.body).includes('TEST_TOKEN'), 'Token must not leak in success response');
  }

  // 38. Token not in response
  installMockFetch({ body: { events_received: 1, messages: [], access_token: 'TEST_TOKEN' } });
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assert(!JSON.stringify(res.body).includes('TEST_TOKEN'), 'Token must not leak in success response');
  }

  // 39. Token not in error responses
  installMockFetch({ ok: false, status: 400, text: JSON.stringify({ error: { message: 'Invalid', access_token: 'TEST_TOKEN' } }) });
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assert(!JSON.stringify(res.body).includes('TEST_TOKEN'), 'Token must not leak in error response');
  }

  // 40. Meta success responses sanitized
  installMockFetch({ body: { events_received: 1, messages: ['ok'], raw: 'extra' } });
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assertEqual(res.body.ok, true, 'success ok=true');
    assertEqual(res.body.events_received, 1, 'events_received included');
    assert.deepStrictEqual(res.body.messages, ['ok'], 'messages included');
    assert(!('raw' in res.body), 'extra fields omitted');
    assert(!('details' in res.body), 'details not in success');
  }

  // 41. Meta JSON errors sanitized
  installMockFetch({ ok: false, status: 400, text: JSON.stringify({ error: { code: 100, error_subcode: 33, message: 'Invalid parameter', type: 'OAuthException', access_token: 'TEST_TOKEN' } }) });
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assertEqual(res.statusCode, 400, 'error status pass-through');
    assertEqual(res.body.ok, false, 'error ok=false');
    assertEqual(res.body.meta_code, 100, 'meta_code included');
    assertEqual(res.body.meta_subcode, 33, 'meta_subcode included');
    assertEqual(res.body.message, 'Invalid parameter', 'message sanitized');
    assert(!('details' in res.body), 'details not in error');
    assert(!JSON.stringify(res.body).includes('TEST_TOKEN'), 'token not in error body');
  }

  // 42. Meta non-JSON errors sanitized
  installMockFetch({ ok: false, status: 500, text: 'Internal Server Error' });
  {
    const res = createRes();
    await handler(req(baseBody()), res);
    assertEqual(res.statusCode, 500, 'non-JSON error status');
    assertEqual(res.body.ok, false, 'non-JSON ok=false');
    assertEqual(res.body.error, 'Meta CAPI request failed', 'generic error only');
    assert(!('details' in res.body), 'details not in non-JSON error');
  }

  // 43. No production code references meta-capi.php
  {
    let out = '';
    try { out = execSync('grep -R -n "meta-capi.php" api/ src/ public/ index.html vercel.json package.json --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" --include="*.html" --include="*.json" 2>/dev/null', { cwd: repoRoot }).toString(); } catch {}
    if (out.trim()) throw new Error(`meta-capi.php references in active code:\n${out}`);
  }

  // 44. google-apps-script folder removed
  assert(!existsSync(resolve(repoRoot, 'google-apps-script')), 'google-apps-script folder must be removed');

  // 45. No active AddToCart, fireAddToCart or fireTikTokAddToCart
  {
    let out = '';
    try { out = execSync('grep -R -n "AddToCart" api/ src/ public/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.html" 2>/dev/null', { cwd: repoRoot }).toString(); } catch {}
    if (out.trim()) throw new Error(`AddToCart references:\n${out}`);
    out = '';
    try { out = execSync('grep -R -n "fireAddToCart\\|fireTikTokAddToCart" api/ src/ public/ --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null', { cwd: repoRoot }).toString(); } catch {}
    if (out.trim()) throw new Error(`fireAddToCart references:\n${out}`);
  }

  // 46. api/order.ts unchanged; 47. OrderFormEmbed.tsx may be modified to fix InitiateCheckout trigger
  {
    const unchanged = ['api/order.ts'];
    for (const file of unchanged) {
      try {
        execSync(`git diff --quiet -- ${file}`, { cwd: repoRoot });
      } catch {
        throw new Error(`${file} has been modified`);
      }
    }

    const orderForm = readFileSync(resolve(repoRoot, 'src/components/OrderFormEmbed.tsx'), 'utf-8');
    if (orderForm.includes('onInput={handleInitiateCheckout}')) throw new Error('OrderFormEmbed should not trigger InitiateCheckout on parent onInput');
    if (orderForm.includes('onChange={handleInitiateCheckout}')) throw new Error('OrderFormEmbed should not trigger InitiateCheckout on parent onChange');
    if (orderForm.includes('onBlur={handleInitiateCheckout}')) throw new Error('OrderFormEmbed should not trigger InitiateCheckout on name blur');
    if (!orderForm.includes('handleInitiateCheckout();')) throw new Error('OrderFormEmbed useEffect should call handleInitiateCheckout()');
    if (!orderForm.includes('await Promise.race([')) throw new Error('Submit should await InitiateCheckout fallback with Promise.race timeout');
  }

  // Current Google Sheet recording intact
  {
    const orderFile = readFileSync(resolve(repoRoot, 'api/order.ts'), 'utf-8');
    assert(orderFile.includes('sheetsWrite'), 'api/order.ts must still contain sheetsWrite');
    assert(orderFile.includes('spreadsheets.values.append'), 'api/order.ts must still append to Google Sheet');
    assert(orderFile.includes('process.env.SHEET_ID'), 'api/order.ts must still use SHEET_ID');
  }

  console.log('All meta-capi and repo sanity tests passed.');
}

try {
  await run();
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv();
  try { rmSync(compiledPath); } catch {}
}
