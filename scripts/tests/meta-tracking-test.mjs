import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { execSync } from 'node:child_process';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');
const compiledPath = resolve(__dirname, 'meta-tracking.compiled.mjs');

const sha256 = (s) => createHash('sha256').update(s, 'utf-8').digest('hex');

function normalizeName(value) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '234' + digits.slice(1);
  if (digits.startsWith('234')) return digits;
  return '234' + digits;
}

let compiledFetch = null;
let compiledFbqCalls = [];
let originalFetch = globalThis.fetch;
let originalConsole = {};

function setupMocks() {
  // Console noise suppression
  for (const key of ['log', 'warn', 'error']) {
    originalConsole[key] = console[key];
    console[key] = () => {};
  }

  const storage = {};
  globalThis.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  };
  globalThis.localStorage.setItem('fhg_external_id', 'cust-123');

  globalThis.document = { cookie: '' };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (test)' }, configurable: true, writable: true });
  globalThis.location = { search: '', origin: 'https://fulanihairsecrets.com', pathname: '/thank-you' };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
  globalThis.window = globalThis;
  globalThis.__metaPixelsInitialized = true;

  globalThis.fbq = (...args) => { compiledFbqCalls.push(args); };
  globalThis.fbq.callMethod = () => {};

  compiledFetch = { url: null, body: null };
  globalThis.fetch = async (url, options) => {
    compiledFetch.url = url;
    compiledFetch.body = options.body ? JSON.parse(options.body) : null;
    return { ok: true, status: 200, headers: new Map(), text: async () => '{}', json: async () => ({}) };
  };
}

function restoreMocks() {
  for (const key of ['log', 'warn', 'error']) {
    console[key] = originalConsole[key];
  }
  globalThis.fetch = originalFetch;
  compiledFbqCalls = [];
}

async function compile() {
  if (existsSync(compiledPath)) rmSync(compiledPath);
  await build({
    entryPoints: [resolve(repoRoot, 'src/utils/metaTracking.ts')],
    outfile: compiledPath,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    tsconfig: resolve(repoRoot, 'tsconfig.json'),
  });
  return await import(pathToFileURL(compiledPath).href);
}

async function run() {
  await setupMocks();

  const metaTracking = await compile();

  const order = {
    orderId: '2608011200',
    email: '  Test@Example.com ',
    phone: '08012345678',
    fullName: '  AMINA!   Queen-B  ',
    totalAmount: 32750,
    packageAmount: 32750,
    paymentType: 'PBD',
    packageName: 'Self Love Plus',
    state: 'Lagos',
    lga: 'Eti-Osa',
    numItems: 1,
  };

  await metaTracking.fireThankYouEvents(order);

  // Find the fbq('init', ...) call for Advanced Matching
  const initCall = compiledFbqCalls.find((args) => args[0] === 'init');
  assert(initCall, 'fbq init call should be present');
  assert.equal(initCall[1], '220381209723501', 'Pixel ID for init should be 220381209723501');
  const browserUserData = initCall[2];

  // Verify browser Advanced Matching hashes and country
  assert.equal(browserUserData.country, 'ng', 'Browser country should be plain "ng"');
  assert.equal(browserUserData.em, sha256('test@example.com'), 'Browser em should be sha256 of lowercased trimmed email');
  assert.equal(browserUserData.ph, sha256('2348012345678'), 'Browser ph should be sha256 of normalized phone');
  assert.equal(browserUserData.fn, sha256('amina'), 'Browser fn should be sha256 of normalized first name (exclamation removed)');
  assert.equal(browserUserData.ln, sha256('queenb'), 'Browser ln should be sha256 of normalized last name (hyphen removed, no space)');
  assert.equal(browserUserData.st, sha256('lagos'), 'Browser st should be sha256 of lowercased state');
  assert.equal(browserUserData.ct, sha256('eti-osa'), 'Browser ct should be sha256 of lowercased city/LGA');
  assert.ok(typeof browserUserData.external_id === 'string' && browserUserData.external_id.length > 0, 'Browser external_id should be present');

  // Verify the exact fbq('init', ...) payload structure
  assert.deepEqual(Object.keys(browserUserData).sort(),
    ['country', 'ct', 'em', 'external_id', 'fn', 'ln', 'ph', 'st'],
    'Browser init user_data keys should match expected fields (no fbp/fbc without cookies/fbclid)');

  // Verify CAPI payload
  assert(compiledFetch.body, 'CAPI request body should be captured');
  const capiUserData = compiledFetch.body.user_data;
  assert(Array.isArray(capiUserData.country), 'CAPI country should be an array');
  assert.equal(capiUserData.country[0], sha256('ng'), 'CAPI country should be [sha256("ng")]');
  assert.equal(capiUserData.em[0], sha256('test@example.com'), 'CAPI em should be [sha256(email)]');
  assert.equal(capiUserData.ph[0], sha256('2348012345678'), 'CAPI ph should be [sha256(normalized phone)]');
  assert.equal(capiUserData.fn[0], sha256('amina'), 'CAPI fn should be [sha256(normalized first name)]');
  assert.equal(capiUserData.ln[0], sha256('queenb'), 'CAPI ln should be [sha256(normalized last name, hyphen removed)]');
  assert.equal(capiUserData.st[0], sha256('lagos'), 'CAPI st should be [sha256(state)]');
  assert.equal(capiUserData.ct[0], sha256('eti-osa'), 'CAPI ct should be [sha256(city/LGA)]');
  assert.equal(capiUserData.client_user_agent, 'Mozilla/5.0 (test)', 'CAPI client_user_agent should come from navigator.userAgent');
  assert(!('client_ip_address' in capiUserData), 'CAPI client_ip_address should not be set by browser; server adds it from headers');

  // Verify custom_data unchanged
  assert.equal(compiledFetch.body.custom_data.value, 32750, 'CAPI value should match order totalAmount');
  assert.equal(compiledFetch.body.custom_data.currency, 'NGN', 'CAPI currency should be NGN');
  assert.equal(compiledFetch.body.event_name, 'Purchase', 'CAPI event_name should be Purchase');
  assert.ok(compiledFetch.body.event_id, 'CAPI event_id should be present');

  // Empty / punctuation-only names should not be hashed or sent
  compiledFbqCalls = [];
  await metaTracking.reinitPixelWithUserData({
    email: 'test@example.com',
    phone: '08012345678',
    firstName: '   ',
    lastName: '!!!',
    state: 'Lagos',
  });
  const emptyInitCall = compiledFbqCalls.find((args) => args[0] === 'init');
  assert(emptyInitCall, 'Second init call should be present');
  assert(!('fn' in emptyInitCall[2]), 'Empty firstName should not produce fn');
  assert(!('ln' in emptyInitCall[2]), 'Punctuation-only lastName should not produce ln');
  assert(!('ct' in emptyInitCall[2]), 'Missing city should not produce ct');

  // Unicode support
  compiledFbqCalls = [];
  await metaTracking.reinitPixelWithUserData({
    firstName: 'ÁMINA',
    lastName: 'Østergaard',
  });
  const unicodeInitCall = compiledFbqCalls.find((args) => args[0] === 'init');
  assert.equal(unicodeInitCall[2].fn, sha256(normalizeName('ÁMINA')), 'Unicode firstName should normalize correctly');
  assert.equal(unicodeInitCall[2].ln, sha256(normalizeName('Østergaard')), 'Unicode lastName should normalize correctly');

  // Phone normalization variants
  assert.equal(normalizePhone('08012345678'), '2348012345678', 'Phone 080... normalizes to 234...');
  assert.equal(normalizePhone('2348012345678'), '2348012345678', 'Phone 234... stays as is');
  assert.equal(normalizePhone('+234 801 234 5678'), '2348012345678', 'Phone with +/spaces normalizes to 234...');

  // Verify api/order.ts was not modified by these changes
  try {
    execSync('git diff --quiet -- api/order.ts', { cwd: repoRoot });
  } catch {
    throw new Error('api/order.ts should not be modified');
  }

  // fireInitiateCheckout produces one browser + CAPI event with shared event_id
  {
    compiledFbqCalls = [];
    compiledFetch.body = null;
    await metaTracking.fireInitiateCheckout({
      packageName: 'Self Love Plus',
      amount: 32750,
      email: 'test@example.com',
      phone: '08012345678',
      firstName: 'Amina',
      lastName: 'Queen B',
    });
    const trackCall = compiledFbqCalls.find((args) => args[0] === 'trackSingle' && args[2] === 'InitiateCheckout');
    assert(trackCall, 'Browser InitiateCheckout trackSingle should fire');
    assert.equal(trackCall[1], '220381209723501', 'InitiateCheckout should route to Pixel 1 only');
    assert.equal(trackCall[3].value, 32750, 'Browser InitiateCheckout should carry package value');
    assert.equal(trackCall[3].currency, 'NGN', 'Browser InitiateCheckout should use NGN');
    assert.ok(trackCall[4] && trackCall[4].eventID, 'Browser InitiateCheckout should have eventID');
    assert(compiledFetch.body, 'CAPI InitiateCheckout request should be sent');
    assert.equal(compiledFetch.body.event_name, 'InitiateCheckout', 'CAPI event_name should be InitiateCheckout');
    assert.equal(compiledFetch.body.custom_data.value, 32750, 'CAPI value should match package amount');
    assert.equal(compiledFetch.body.custom_data.currency, 'NGN', 'CAPI currency should be NGN');
    assert.equal(trackCall[4].eventID, compiledFetch.body.event_id, 'Browser and CAPI should share the same event_id');

    // Second call with the same data must be deduplicated by persistent 24h key
    compiledFbqCalls = [];
    compiledFetch.body = null;
    await metaTracking.fireInitiateCheckout({
      packageName: 'Self Love Plus',
      amount: 32750,
      email: 'test@example.com',
      phone: '08012345678',
      firstName: 'Amina',
      lastName: 'Queen B',
    });
    const secondTrack = compiledFbqCalls.find((args) => args[0] === 'trackSingle' && args[2] === 'InitiateCheckout');
    assert(!secondTrack, 'Second InitiateCheckout should be deduplicated at browser layer');
    assert(!compiledFetch.body, 'Second InitiateCheckout should not send CAPI again');
  }

  process.stdout.write('All meta-tracking tests passed.\n');
}

try {
  await run();
} finally {
  restoreMocks();
  try { rmSync(compiledPath); } catch {}
}
