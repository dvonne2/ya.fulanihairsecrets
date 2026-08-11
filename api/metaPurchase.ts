import type { VercelRequest } from '@vercel/node';
import { createHash } from 'crypto';

function hashSha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizeMetaPhone(phone: string): string {
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (!digits) return '';
  let normalized = digits;
  if (normalized.startsWith('0')) normalized = '234' + normalized.slice(1);
  else if (!normalized.startsWith('234')) normalized = '234' + normalized;
  if (normalized.length === 13 && normalized.startsWith('234')) return normalized;
  return '';
}

function getCookieFromHeader(cookieHeader: string | string[] | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const raw = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  const parts = raw.split(';');
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name && rest.length) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function getClientMetaIp(req: VercelRequest): string {
  const xff = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  return raw ? raw.split(',')[0].trim() : req.socket?.remoteAddress || '';
}

function getUserAgent(req: VercelRequest): string {
  const ua = req.headers['user-agent'];
  return Array.isArray(ua) ? ua[0] : ua || '';
}

function extractMetaCity(state: string, address: string): string {
  const stateLower = (state || '').toLowerCase();
  const parts: string[] = [];
  (address || '').split(',').forEach((part) => {
    part.split('\n').forEach((p) => {
      const trimmed = p.trim().toLowerCase();
      if (trimmed) parts.push(trimmed);
    });
  });
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p !== stateLower && p.length > 2) return p;
  }
  return '';
}

function extractMetaName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(' ').filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
}

export interface MetaPurchaseResult {
  sent: boolean;
  status?: number;
  events_received?: number;
  fbtrace_id?: string;
  messages?: any[];
  event_id?: string;
  value?: number;
  currency?: string;
  error?: string;
}

export async function sendMetaPurchase(req: VercelRequest, body: Record<string, any>, orderId: string, totalAmount: number): Promise<MetaPurchaseResult> {
  const FB_PIXEL_ID = process.env.FB_PIXEL_ID || process.env.META_PIXEL_ID || '';
  const FB_CAPI_ACCESS_TOKEN = process.env.FB_CAPI_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || '';
  const FB_CAPI_VERSION = process.env.FB_CAPI_VERSION || process.env.META_API_VERSION || 'v19.0';
  if (!FB_PIXEL_ID || !FB_CAPI_ACCESS_TOKEN) {
    console.warn('[Meta CAPI] Pixel ID or access token not configured; skipping server-side Purchase');
    return { sent: false, error: 'not_configured' };
  }

  const { firstName, lastName } = extractMetaName(String(body.name || ''));
  const email = String(body.email || '').trim().toLowerCase();
  const phone = normalizeMetaPhone(String(body.phone || ''));
  const state = String(body.state || '').trim().toLowerCase();
  const city = String(body.lga || extractMetaCity(body.state, body.address || '')).trim().toLowerCase();
  const clientIp = getClientMetaIp(req);
  const clientUserAgent = getUserAgent(req);
  const fbp = getCookieFromHeader(req.headers.cookie, '_fbp');
  const fbc = getCookieFromHeader(req.headers.cookie, '_fbc');

  const userData: Record<string, any> = {};
  if (email) userData.em = [hashSha256(email)];
  if (phone) userData.ph = [hashSha256(phone)];
  if (firstName) userData.fn = [hashSha256(firstName)];
  if (lastName) userData.ln = [hashSha256(lastName)];
  if (state) userData.st = [hashSha256(state)];
  if (city) userData.ct = [hashSha256(city)];
  userData.country = [hashSha256('ng')];
  if (clientIp) userData.client_ip_address = clientIp;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent;
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  const sku = String(body.sku || '').replace(/\s+/g, '_').toUpperCase() || 'FULANI_HAIR_GRO';
  const quantity = Number(body.quantity) || 1;
  const productAmount = Number(body.productAmount) || totalAmount;
  const packageName = String(body.package || 'Fulani Hair Gro');

  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: orderId,
        action_source: 'website',
        event_source_url: Array.isArray(req.headers.referer) ? req.headers.referer[0] : (req.headers.referer || 'https://fulanihairsecrets.com'),
        user_data: userData,
        custom_data: {
          currency: 'NGN',
          value: totalAmount,
          content_name: packageName,
          content_ids: [sku],
          content_type: 'product',
          order_id: orderId,
          num_items: quantity,
          contents: [{ id: sku, quantity, item_price: productAmount }],
        },
      },
    ],
  };

  const metaUrl = `https://graph.facebook.com/${FB_CAPI_VERSION}/${FB_PIXEL_ID}/events?access_token=${encodeURIComponent(FB_CAPI_ACCESS_TOKEN)}`;
  const res = await fetch(metaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    console.error('[Meta CAPI] Purchase failed:', res.status, text);
    return {
      sent: false,
      status: res.status,
      event_id: orderId,
      error: (parsed && parsed.error && parsed.error.message) || text.slice(0, 300),
    };
  }

  console.log('[Meta CAPI] Purchase sent:', orderId, text.slice(0, 200));
  return {
    sent: true,
    status: res.status,
    events_received: parsed ? parsed.events_received : undefined,
    fbtrace_id: parsed ? parsed.fbtrace_id : undefined,
    messages: parsed ? parsed.messages : undefined,
    event_id: orderId,
    value: totalAmount,
    currency: 'NGN',
  };
}
