import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'crypto';
import { sendMetaPurchase } from './metaPurchase';

function generateServerOrderId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = randomBytes(4).toString('hex').toUpperCase();
  return `FHS-${ts}-${rnd}`;
}

function getSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  console.log('[Sheets Debug] Email present:', !!email);
  console.log('[Sheets Debug] Key present:', !!key);
  console.log('[Sheets Debug] Key length:', key?.length);
  if (!email || !key) return null;
  try {
    const auth = new google.auth.JWT({
      email,
      key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
  } catch (e: any) {
    console.error('[Sheets Debug] Auth creation error:', e.message);
    return null;
  }
}

const SHEET_RANGE = `'YA Orders'!A:O`;

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
    sendMetaPurchase(req, body, orderId, Number(body.amount)).catch((err: any) => console.error('[Meta CAPI]', err));
    return res.status(200).json({ ok: true, orderId });
  } catch (e: any) {
    const cause = e.cause ? ` (${e.cause.message || e.cause})` : '';
    const msg = String(e.message || 'unknown error') + cause;
    console.error('[Sheets]', msg, e);
    return res.status(502).json({ ok: false, orderId, error: 'Could not record order', diagnostic: msg });
  }
}
