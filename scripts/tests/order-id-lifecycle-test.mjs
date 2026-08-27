import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');
const clientOrderIdPath = resolve(__dirname, 'order-id-client.compiled.mjs');
const serverOrderIdPath = resolve(__dirname, 'order-id-server.compiled.mjs');
const metaTrackingPath = resolve(__dirname, 'order-id-meta.compiled.mjs');
const orderHandlerPath = resolve(__dirname, 'order-id-handler.compiled.mjs');
const idempotencyPath = resolve(__dirname, 'order-id-idempotency.compiled.mjs');

const sha256 = (s) => createHash('sha256').update(s, 'utf-8').digest('hex');

let originalFetch;
let compiledFbqCalls = [];
let compiledFetch = { url: null, body: null };

function setupMocks() {
  const storage = {};
  globalThis.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  };
  globalThis.sessionStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  };
  globalThis.document = { cookie: '' };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (test)' }, configurable: true, writable: true });
  globalThis.location = { search: '', origin: 'https://fulanihairsecrets.com', pathname: '/thank-you' };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
  globalThis.window = globalThis;
  globalThis.__metaPixelsInitialized = true;
  globalThis.fbq = (...args) => { compiledFbqCalls.push(args); };
  globalThis.fbq.callMethod = () => {};

  compiledFbqCalls = [];
  compiledFetch = { url: null, body: null };
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    compiledFetch.url = url;
    compiledFetch.body = options.body ? JSON.parse(options.body) : null;
    return { ok: true, status: 200, headers: new Map(), text: async () => '{}', json: async () => ({}) };
  };
}

function restoreMocks() {
  globalThis.fetch = originalFetch;
  compiledFbqCalls = [];
}

async function compileClientOrderId() {
  if (existsSync(clientOrderIdPath)) rmSync(clientOrderIdPath);
  await build({
    entryPoints: [resolve(repoRoot, 'src/utils/orderId.ts')],
    outfile: clientOrderIdPath,
    bundle: true,
    platform: 'browser',
    format: 'esm',
  });
  return await import(pathToFileURL(clientOrderIdPath).href);
}

async function compileServerOrderId() {
  if (existsSync(serverOrderIdPath)) rmSync(serverOrderIdPath);
  await build({
    entryPoints: [resolve(repoRoot, 'src/utils/serverOrderId.ts')],
    outfile: serverOrderIdPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
  });
  return await import(pathToFileURL(serverOrderIdPath).href);
}

async function compileMetaTracking() {
  if (existsSync(metaTrackingPath)) rmSync(metaTrackingPath);
  await build({
    entryPoints: [resolve(repoRoot, 'src/utils/metaTracking.ts')],
    outfile: metaTrackingPath,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    tsconfig: resolve(repoRoot, 'tsconfig.json'),
  });
  return await import(pathToFileURL(metaTrackingPath).href);
}

async function compileIdempotency() {
  if (existsSync(idempotencyPath)) rmSync(idempotencyPath);
  await build({
    entryPoints: [resolve(repoRoot, 'api/lib/idempotency.ts')],
    outfile: idempotencyPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
  });
  return await import(pathToFileURL(idempotencyPath).href);
}

async function compileOrderHandler() {
  if (existsSync(orderHandlerPath)) rmSync(orderHandlerPath);
  await build({
    entryPoints: [resolve(repoRoot, 'api/lib/orderHandler.ts')],
    outfile: orderHandlerPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
  });
  return await import(pathToFileURL(orderHandlerPath).href);
}

function makeRes() {
  return {
    statusCode: null,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.jsonBody = obj; return this; },
  };
}

function makeSheets() {
  const orders = [];
  const originalAppend = async ({ range, requestBody }) => {
    if (range.startsWith('Orders')) {
      orders.push(requestBody.values[0]);
    }
    return { data: { updates: {} } };
  };
  return {
    rows: { orders },
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [] } }),
        append: originalAppend,
        update: async () => ({ data: { updatedCells: 2 } }),
      },
    },
  };
}

function makeBaseBody(attemptId) {
  return {
    checkoutAttemptId: attemptId,
    name: 'Amina B.',
    phone: '08012345678',
    whatsapp: '08012345678',
    email: 'amina@example.com',
    address: '12 Lagos St',
    state: 'Lagos',
    package: 'Self Love Plus',
    amount: 32750,
    deliveryDate: '2026-08-03',
  };
}

async function testClientOrderId() {
  const orderIdMod = await compileClientOrderId();
  setupMocks();

  const first = orderIdMod.getCheckoutAttemptId();
  assert(first && first.length > 0, 'First checkout should receive a checkout attempt ID');
  assert.equal(globalThis.localStorage.getItem('fhg_checkout_attempt_id'), first, 'Checkout attempt ID should be stored');

  const retry = orderIdMod.getCheckoutAttemptId();
  assert.equal(retry, first, 'Failed retry should reuse the same checkout attempt ID');

  orderIdMod.clearCheckoutAttemptId();
  assert.equal(globalThis.localStorage.getItem('fhg_checkout_attempt_id'), null, 'Checkout attempt ID should be cleared after success');
  assert.equal(globalThis.localStorage.getItem('fhg_persistent_order_id'), null, 'Legacy permanent ID should be cleared too');

  const next = orderIdMod.getCheckoutAttemptId();
  assert.notEqual(next, first, 'Next checkout should get a different checkout attempt ID');
  restoreMocks();
}

async function testServerOrderIdUniqueness() {
  const { generateServerOrderId } = await compileServerOrderId();
  const ids = new Set();
  for (let i = 0; i < 10; i++) {
    const id = generateServerOrderId();
    assert(id && id.startsWith('FHS-'), 'Server order ID should use the FHS- prefix');
    assert(!ids.has(id), `Duplicate server order ID generated: ${id}`);
    ids.add(id);
  }
  assert.equal(ids.size, 10, '10 sequential successful orders should produce 10 unique server order IDs');
}

async function testPurchaseEventIdUniqueness() {
  const { generateServerOrderId } = await compileServerOrderId();
  const ids = new Set();
  for (let i = 0; i < 10; i++) {
    const orderId = generateServerOrderId();
    const eventId = sha256(`Purchase_${orderId}`).slice(0, 16);
    assert(!ids.has(eventId), `Duplicate Purchase event_id generated for order ${orderId}`);
    ids.add(eventId);
  }
  assert.equal(ids.size, 10, '10 unique orders should produce 10 unique Purchase event IDs');
}

async function testMetaPurchaseEventIdsMatch() {
  const metaTracking = await compileMetaTracking();
  setupMocks();

  const order = {
    orderId: 'FHS-ABC123-XYZ',
    email: 'test@fulanihairsecrets.com',
    phone: '08012345678',
    fullName: 'Test User',
    totalAmount: 32750,
    packageAmount: 32750,
    paymentType: 'PBD',
    packageName: 'Self Love Plus',
    state: 'Lagos',
    lga: 'Eti-Osa',
    numItems: 1,
  };

  await metaTracking.fireThankYouEvents(order);

  const purchaseFbq = compiledFbqCalls.find((args) => args[0] === 'trackSingle' && args[2] === 'Purchase');
  assert(purchaseFbq, 'Browser Purchase fbq call should exist');
  const browserEventId = purchaseFbq[4]?.eventID;
  assert(browserEventId, 'Browser Purchase should include eventID');

  assert.equal(compiledFetch.url, '/api/meta-capi', 'CAPI should POST to /api/meta-capi');
  const capiEvent = compiledFetch.body;
  assert(capiEvent, 'CAPI body should be captured');
  assert.equal(capiEvent.event_name, 'Purchase', 'CAPI event_name should be Purchase');
  assert.equal(capiEvent.event_id, browserEventId, 'Browser and CAPI Purchase must share the same event_id');
  assert.equal(capiEvent.custom_data.currency, 'NGN', 'CAPI currency should remain NGN');
  assert.equal(capiEvent.custom_data.value, 32750, 'CAPI value should match order totalAmount');

  restoreMocks();
}

async function testHandleOrderIdempotency() {
  const { handleOrder } = await compileOrderHandler();
  const { MemoryIdempotencyStore } = await compileIdempotency();

  process.env.SHEET_ID = 'test-sheet';
  process.env.ERPNEXT_INGEST_URL = 'https://erpnext.test/webhook';
  process.env.ERPNEXT_WEBHOOK_SECRET = 'secret';

  // 1. Twenty concurrent /api/order requests with one attempt ID produce one order.
  {
    const store = new MemoryIdempotencyStore();
    const sheets = makeSheets();
    const fetchCalls = [];
    const fetchFn = async (url) => {
      fetchCalls.push(url);
      return { ok: true, status: 200, text: async () => 'ok', json: async () => ({ ok: true }) };
    };
    const attemptId = 'attempt-concurrent-20';
    const body = makeBaseBody(attemptId);
    const resps = await Promise.all(
      Array.from({ length: 20 }).map(() => {
        const res = makeRes();
        return handleOrder({ method: 'POST', body }, res, sheets, fetchFn, store).then(() => res);
      }),
    );
    const orderIds = new Set(resps.map((r) => r.jsonBody.orderId));
    const final = await store.get(attemptId);
    assert.equal(orderIds.size, 1, 'Concurrent requests must resolve to a single order ID');
    assert(final && final.erpnextOk && final.sheetOk, 'Concurrent attempt must end fully recorded');
    assert.equal(fetchCalls.length, 1, 'Only one initial ERPNext order may be created');
    assert.equal(sheets.rows.orders.length, 1, 'Only one initial Google Sheet row may be created');
  }

  // 2. Lost HTTP response then retry returns the same order ID.
  {
    const store = new MemoryIdempotencyStore();
    const sheets = makeSheets();
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => 'ok', json: async () => ({ ok: true }) });
    const attemptId = 'attempt-lost-response';
    const body = makeBaseBody(attemptId);
    const res1 = makeRes();
    await handleOrder({ method: 'POST', body }, res1, sheets, fetchFn, store);
    assert(res1.jsonBody.ok, 'First request should complete');
    const firstOrderId = res1.jsonBody.orderId;

    const res2 = makeRes();
    await handleOrder({ method: 'POST', body }, res2, sheets, fetchFn, store);
    assert.equal(res2.jsonBody.orderId, firstOrderId, 'Retry must return the original order ID');
    assert.equal(res2.jsonBody.ok, true, 'Retry of completed order must report success');
    assert.equal(sheets.rows.orders.length, 1, 'Retry must not create a new Sheet row');
  }

  // 3. Sheet success + ERPNext failure retries ERPNext only.
  {
    const store = new MemoryIdempotencyStore();
    const sheets = makeSheets();
    let fail = true;
    const fetchCalls = [];
    const fetchFn = async (url) => {
      fetchCalls.push(url);
      if (fail) {
        return { ok: false, status: 500, text: async () => 'erp-error', json: async () => ({ ok: false }) };
      }
      return { ok: true, status: 200, text: async () => 'ok', json: async () => ({ ok: true }) };
    };
    const attemptId = 'attempt-sheet-ok-erp-fail';
    const body = makeBaseBody(attemptId);

    const res1 = makeRes();
    await handleOrder({ method: 'POST', body }, res1, sheets, fetchFn, store);
    assert.equal(res1.jsonBody.ok, true, 'Partial success should still return ok');
    assert.equal(res1.jsonBody.partial, true, 'Partial success must be flagged');
    assert.equal(res1.jsonBody.erpnext, false, 'ERPNext must be reported as failed');
    assert.equal(res1.jsonBody.sheet, true, 'Sheet must be reported as successful');
    assert.equal(sheets.rows.orders.length, 1, 'First attempt should create one Sheet row');
    assert.equal(fetchCalls.length, 1, 'First attempt should call ERPNext once');

    fail = false;
    const res2 = makeRes();
    await handleOrder({ method: 'POST', body }, res2, sheets, fetchFn, store);
    assert.equal(res2.jsonBody.ok, true, 'Retry must complete the order');
    assert.equal(res2.jsonBody.partial, false, 'Retry must complete fully');
    assert.equal(res2.jsonBody.orderId, res1.jsonBody.orderId, 'Retry must return the same order ID');
    assert.equal(res2.jsonBody.erpnext, true, 'Retry must complete ERPNext');
    assert.equal(res2.jsonBody.sheet, true, 'Retry must keep Sheet');
    assert.equal(fetchCalls.length, 2, 'Retry must attempt ERPNext exactly once');
    assert.equal(sheets.rows.orders.length, 1, 'Retry must not create another Sheet row');
  }

  // 4. ERPNext success + Sheet failure retries Sheet only.
  {
    const store = new MemoryIdempotencyStore();
    const sheets = makeSheets();
    let fail = true;
    const fetchCalls = [];
    const fetchFn = async (url) => {
      fetchCalls.push(url);
      return { ok: true, status: 200, text: async () => 'ok', json: async () => ({ ok: true }) };
    };
    const originalAppend = sheets.spreadsheets.values.append;
    sheets.spreadsheets.values.append = async ({ range, requestBody }) => {
      if (range.startsWith('Orders') && fail) {
        throw new Error('Sheets unavailable');
      }
      return originalAppend({ range, requestBody });
    };
    const attemptId = 'attempt-erp-ok-sheet-fail';
    const body = makeBaseBody(attemptId);

    const res1 = makeRes();
    await handleOrder({ method: 'POST', body }, res1, sheets, fetchFn, store);
    assert.equal(res1.jsonBody.ok, true, 'Partial success should still return ok');
    assert.equal(res1.jsonBody.partial, true, 'Partial success must be flagged');
    assert.equal(res1.jsonBody.erpnext, true, 'ERPNext must be reported as successful');
    assert.equal(res1.jsonBody.sheet, false, 'Sheet must be reported as failed');
    assert.equal(fetchCalls.length, 1, 'First attempt should call ERPNext once');
    assert.equal(sheets.rows.orders.length, 0, 'First attempt should not append a Sheet row');

    fail = false;
    const res2 = makeRes();
    await handleOrder({ method: 'POST', body }, res2, sheets, fetchFn, store);
    assert.equal(res2.jsonBody.ok, true, 'Retry must complete the order');
    assert.equal(res2.jsonBody.partial, false, 'Retry must complete fully');
    assert.equal(res2.jsonBody.orderId, res1.jsonBody.orderId, 'Retry must return the same order ID');
    assert.equal(res2.jsonBody.erpnext, true, 'Retry must keep ERPNext');
    assert.equal(res2.jsonBody.sheet, true, 'Retry must complete Sheet');
    assert.equal(fetchCalls.length, 1, 'Retry must not call ERPNext again');
    assert.equal(sheets.rows.orders.length, 1, 'Retry must append the missing Sheet row');
  }

  // 5. Two distinct attempt IDs produce two distinct orders.
  {
    const store = new MemoryIdempotencyStore();
    const sheets = makeSheets();
    const fetchFn = async () => ({ ok: true, status: 200, text: async () => 'ok', json: async () => ({ ok: true }) });
    const resA = makeRes();
    const resB = makeRes();
    await handleOrder({ method: 'POST', body: makeBaseBody('attempt-A') }, resA, sheets, fetchFn, store);
    await handleOrder({ method: 'POST', body: makeBaseBody('attempt-B') }, resB, sheets, fetchFn, store);
    assert.notEqual(resA.jsonBody.orderId, resB.jsonBody.orderId, 'Different attempts must produce different order IDs');
    assert.equal(sheets.rows.orders.length, 2, 'Different attempts must create two Sheet rows');
  }

  // 6. Ten successful distinct checkouts produce ten unique order IDs.
  {
    const store = new MemoryIdempotencyStore();
    const sheets = makeSheets();
    const fetchCalls = [];
    const fetchFn = async (url) => {
      fetchCalls.push(url);
      return { ok: true, status: 200, text: async () => 'ok', json: async () => ({ ok: true }) };
    };
    const ids = new Set();
    for (let i = 0; i < 10; i++) {
      const res = makeRes();
      await handleOrder({ method: 'POST', body: makeBaseBody(`attempt-${i}`) }, res, sheets, fetchFn, store);
      assert(res.jsonBody.ok, `Checkout ${i} should succeed`);
      assert(!ids.has(res.jsonBody.orderId), `Duplicate order ID: ${res.jsonBody.orderId}`);
      ids.add(res.jsonBody.orderId);
    }
    assert.equal(ids.size, 10, 'Ten distinct attempts should produce ten unique order IDs');
    assert.equal(sheets.rows.orders.length, 10, 'Ten distinct attempts should create ten Sheet rows');
    assert.equal(fetchCalls.length, 10, 'Ten distinct attempts should create ten ERPNext orders');
  }

  // 7. Payload persists and a background retry can complete the missing side.
  {
    const store = new MemoryIdempotencyStore();
    const sheets = makeSheets();
    let fail = true;
    const fetchFn = async () => {
      if (fail) throw new Error('ERPNext down');
      return { ok: true, status: 200, text: async () => 'ok', json: async () => ({ ok: true }) };
    };
    const attemptId = 'attempt-payload-recovery';
    const body = makeBaseBody(attemptId);
    const res1 = makeRes();
    await handleOrder({ method: 'POST', body }, res1, sheets, fetchFn, store);
    assert.equal(res1.jsonBody.ok, true, 'Initial partial should return ok');
    assert.equal(res1.jsonBody.partial, true, 'Initial partial should be flagged');
    const stored = await store.get(attemptId);
    assert.equal(stored.payload.name, body.name, 'Payload name must be stored');
    assert.equal(stored.payload.phone, body.phone, 'Payload phone must be stored');
    assert.equal(stored.payload.package, body.package, 'Payload package must be stored');

    fail = false;
    const res2 = makeRes();
    await handleOrder({ method: 'POST', body: { checkoutAttemptId: attemptId } }, res2, sheets, fetchFn, store);
    assert.equal(res2.jsonBody.ok, true, 'Background retry should succeed');
    assert.equal(res2.jsonBody.partial, false, 'Background retry should complete');
    assert.equal(res2.jsonBody.orderId, res1.jsonBody.orderId, 'Background retry must keep the same order ID');
    assert.equal(sheets.rows.orders.length, 1, 'Background retry should create one Sheet row');
  }
}

async function testMetaTrackingRetryAndDeduplication() {
  const metaTracking = await compileMetaTracking();

  // Failed CAPI attempt must remain retryable (not mark dedup key).
  setupMocks();
  let fetchCount = 0;
  globalThis.fetch = async (url, options) => {
    fetchCount++;
    return { ok: false, status: 500, headers: new Map(), text: async () => 'Server error', json: async () => ({}) };
  };
  const order = {
    orderId: 'FHS-RETRY-TEST',
    email: 'test@fulanihairsecrets.com',
    phone: '08012345678',
    fullName: 'Test User',
    totalAmount: 32750,
    packageAmount: 32750,
    paymentType: 'PBD',
    packageName: 'Self Love Plus',
    state: 'Lagos',
    lga: 'Eti-Osa',
    numItems: 1,
  };
  const ok1 = await metaTracking.fireThankYouEvents(order);
  assert.equal(ok1, false, 'Failed tracking should return false');
  const ok2 = await metaTracking.fireThankYouEvents(order);
  assert.equal(ok2, false, 'Failed tracking should still return false on retry');
  assert.equal(fetchCount, 2, 'Failed CAPI attempt must be retryable (two fetch calls)');
  restoreMocks();

  // Successful CAPI must be deduplicated.
  setupMocks();
  fetchCount = 0;
  globalThis.fetch = async (url, options) => {
    fetchCount++;
    compiledFetch.url = url;
    compiledFetch.body = options.body ? JSON.parse(options.body) : null;
    return { ok: true, status: 200, headers: new Map(), text: async () => '{}', json: async () => ({}) };
  };
  const ok3 = await metaTracking.fireThankYouEvents(order);
  assert.equal(ok3, true, 'Successful tracking should return true');
  const ok4 = await metaTracking.fireThankYouEvents(order);
  assert.equal(ok4, true, 'Successful tracking should return true on second call');
  assert.equal(fetchCount, 1, 'Successful CAPI must be deduplicated (only one fetch call)');
  restoreMocks();
}

function readSource(file) {
  return readFileSync(resolve(repoRoot, file), 'utf-8');
}

function testSourceConstraints() {
  const orderForm = readSource('src/components/OrderFormEmbed.tsx');
  const apiOrder = readSource('api/order.ts');
  const orderHandler = readSource('api/lib/orderHandler.ts');
  const idempotency = readSource('api/lib/idempotency.ts');
  const thankYou = readSource('src/pages/ThankYou.tsx');
  const meta = readSource('src/utils/metaTracking.ts');

  assert(!orderForm.includes('fhg_persistent_order_id'), 'OrderFormEmbed should not reference fhg_persistent_order_id');
  assert(!orderForm.includes('getOrCreateOrderId'), 'OrderFormEmbed should not use getOrCreateOrderId');
  assert(!orderForm.includes('getOrderIdFromURL'), 'OrderFormEmbed should not use getOrderIdFromURL');
  assert(orderForm.includes('fireInitiateCheckout'), 'InitiateCheckout trigger must remain');
  assert(orderForm.includes('AddToCart') === false, 'OrderFormEmbed must not introduce AddToCart');
  assert(orderForm.includes('getCheckoutAttemptId'), 'OrderFormEmbed should call getCheckoutAttemptId');
  assert(orderForm.includes('clearCheckoutAttemptId'), 'OrderFormEmbed should call clearCheckoutAttemptId');
  assert(orderForm.includes('checkoutAttemptId'), 'OrderFormEmbed should send checkoutAttemptId');

  assert(apiOrder.includes('handleOrder'), 'api/order.ts must use handleOrder');
  assert(apiOrder.includes('RedisIdempotencyStore'), 'api/order.ts must create a Redis idempotency store');
  assert(orderHandler.includes('checkoutAttemptId'), 'orderHandler must require checkoutAttemptId');
  assert(orderHandler.includes('claim('), 'orderHandler must atomically claim attempts');
  assert(orderHandler.includes('complete('), 'orderHandler must mark individual sides complete');
  assert(orderHandler.includes('acquireSideLock'), 'orderHandler must lock each side during partial retries');
  assert(orderHandler.includes('payload'), 'orderHandler must store the validated payload for background retry');
  assert(idempotency.includes('RedisIdempotencyStore'), 'idempotency must provide a Redis implementation');
  assert(idempotency.includes('HSETNX') && idempotency.includes('HSET'), 'Redis claim and updates must use Redis Hash (HSET/HSETNX) for atomicity');

  assert(thankYou.includes('fhg_purchase_in_flight_'), 'ThankYou must use in_flight guard');
  assert(thankYou.includes('fhg_purchase_completed_'), 'ThankYou must use completed guard');
  assert(!thankYou.includes("sessionStorage.setItem(firedKey, '1')"), 'ThankYou must not mark fired before events run');

  assert(meta.includes("'Purchase'"), 'metaTracking must still include Purchase');
  assert(!meta.includes('AddToCart'), 'metaTracking must not introduce AddToCart');
  assert(meta.includes('Promise<boolean>'), 'fireCAPIEvent and fireThankYouEvents should expose success boolean');
}

async function run() {
  await testClientOrderId();
  await testServerOrderIdUniqueness();
  await testPurchaseEventIdUniqueness();
  await testMetaPurchaseEventIdsMatch();
  await testHandleOrderIdempotency();
  await testMetaTrackingRetryAndDeduplication();
  testSourceConstraints();

  // Clean up compiled artifacts
  [clientOrderIdPath, serverOrderIdPath, metaTrackingPath, orderHandlerPath, idempotencyPath].forEach((p) => {
    if (existsSync(p)) rmSync(p);
  });

  console.log('order-id-lifecycle-test: all assertions passed');
}

run().catch((err) => {
  console.error('order-id-lifecycle-test failed:', err);
  process.exit(1);
});
