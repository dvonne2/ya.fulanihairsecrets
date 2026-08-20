import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';
import { createMetaCapi } from 'vitalvida-meta-tracking/server';
import { splitName, normalizePhone } from 'vitalvida-meta-tracking';
function generateServerOrderId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = randomBytes(4).toString('hex').toUpperCase();
  return `FHS-${ts}-${rnd}`;
}

function getSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) return null;
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SHEET_RANGE = `'YA Orders'!A:O`;

const pixelId = process.env.META_PIXEL_ID;
const accessToken = process.env.META_ACCESS_TOKEN;
const apiVersion = process.env.META_API_VERSION;

const configured = Boolean(pixelId && accessToken && apiVersion);

let capi: ReturnType<typeof createMetaCapi> | null = null;
if (configured) {
  capi = createMetaCapi({
    pixelId: pixelId as string,
    accessToken: accessToken as string,
    apiVersion: apiVersion as string,
    testEventCode: process.env.META_TEST_EVENT_CODE,
    allowedOrigins: ['https://ya.fulanihairsecrets.com'],
    allowedSourceHosts: ['ya.fulanihairsecrets.com'],
  });
}

function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// In-memory idempotency cache for the lifetime of this serverless container.
// It prevents the same checkout attempt from being written twice if the
// browser sends rapid duplicate requests before the redirect unloads the page.
const recentOrderIds = new Map<string, string>();
const MAX_RECENT_CACHE = 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = (req.body as Record<string, any>) || {};
  const required = ['name', 'phone', 'package', 'state', 'address', 'amount'];
  const productAmount = Number(body.productAmount) || 0;
  const deliveryFee = Number(body.deliveryFee) || 0;
  const quantity = Number(body.quantity) || 1;
  const sku = String(body.sku || '');
  const missing = required.filter((k) => !body[k]);
  if (missing.length) {
    return res.status(400).json({ ok: false, error: `Missing: ${missing.join(', ')}` });
  }

  const orderId = generateServerOrderId();
  const checkoutAttemptId =
    typeof body.checkoutAttemptId === 'string' ? body.checkoutAttemptId : '';

  // If this exact checkout attempt was already processed in this container,
  // return the original order ID instead of creating a duplicate.
  if (checkoutAttemptId && recentOrderIds.has(checkoutAttemptId)) {
    const existingOrderId = recentOrderIds.get(checkoutAttemptId) as string;
    console.log('[Sheets] Duplicate checkout attempt detected:', checkoutAttemptId);
    return res.status(200).json({ ok: true, orderId: existingOrderId });
  }

  const sheets = getSheets();
  if (!sheets) {
    return res.status(500).json({ ok: false, error: 'Google Sheets not configured' });
  }
  const spreadsheetId = process.env.SHEET_ID;
  if (!spreadsheetId) {
    return res.status(500).json({ ok: false, error: 'SHEET_ID not set' });
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: SHEET_RANGE,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Lagos' }),
          orderId,
          body.name,
          body.phone,
          body.email || '',
          body.address,
          body.state,
          body.package,
          Number(body.amount),
          body.deliveryDate || '',
          'website',
          productAmount,
          deliveryFee,
          quantity,
          sku,
        ]],
      },
    });
    if (checkoutAttemptId) {
      recentOrderIds.set(checkoutAttemptId, orderId);
      if (recentOrderIds.size > MAX_RECENT_CACHE) {
        const first = recentOrderIds.keys().next().value;
        if (first !== undefined) recentOrderIds.delete(first);
      }
    }
    const { firstName, surname } = splitName(body.name) || { firstName: body.name.trim().toLowerCase() };
    const referer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
    const purchasePayload = {
      event_name: 'Purchase' as const,
      event_id: orderId,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: referer || 'https://ya.fulanihairsecrets.com/',
      user_data: {
        external_id: body.externalId || orderId,
        phone: normalizePhone(body.phone) || body.phone,
        name: body.name.trim().toLowerCase(),
        first_name: firstName,
        surname,
        email: body.email ? body.email.trim().toLowerCase() : undefined,
        state: body.state,
        city: body.lga || undefined,
        country: 'ng',
        fbp: getCookieValue(req.headers.cookie, '_fbp'),
        fbc: getCookieValue(req.headers.cookie, '_fbc'),
      },
      custom_data: {
        value: Number(body.amount),
        currency: 'NGN',
        order_id: orderId,
        num_items: Number(body.quantity) || 1,
        content_ids: [body.package],
      },
    };

    const purchaseResult = capi
      ? await capi.sendPurchase({
          body: purchasePayload,
          headers: req.headers,
          remoteAddress: req.socket?.remoteAddress,
        }).catch((err: any) => {
          console.error('[Meta] Purchase CAPI error:', err?.message || err);
          return { ok: false, eventName: 'Purchase', eventId: orderId, messages: [String(err?.message || err)] };
        })
      : { ok: false, eventName: 'Purchase', eventId: orderId, reason: 'Meta CAPI not configured' };

    return res.status(200).json({ ok: true, orderId, meta: purchaseResult });
  } catch (e: any) {
    const cause = e.cause ? ` (${e.cause.message || e.cause})` : '';
    const msg = String(e.message || 'unknown error') + cause;
    console.error('[Sheets]', msg, e);
    return res.status(502).json({ ok: false, orderId, error: 'Could not record order', diagnostic: msg });
  }
}
