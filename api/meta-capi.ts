import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createMetaCapi } from 'vitalvida-meta-tracking/server';

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
    allowedOrigins: ['https://ya.fulanihairsecrets.com'],
    allowedSourceHosts: ['ya.fulanihairsecrets.com'],
  });
}

const VALID_EVENTS = ['PageView', 'ViewContent', 'InitiateCheckout', 'Purchase'] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!capi) {
    return res.status(503).json({ ok: false, error: 'Meta CAPI not configured' });
  }

  const rest = (req.body || {}) as Record<string, any>;
  const { event_name } = rest;
  if (!VALID_EVENTS.includes(event_name)) {
    return res.status(400).json({ ok: false, error: 'Invalid event_name' });
  }

  // Normalize event_time to server time to avoid client clock drift
  rest.event_time = Math.floor(Date.now() / 1000);

  const remoteAddress = req.socket?.remoteAddress;
  try {
    const send = (capi as any)[`send${event_name}`];
    if (typeof send !== 'function') {
      return res.status(500).json({ ok: false, error: `Unknown event: ${event_name}` });
    }
    const result = await send.call(capi, { body: rest, headers: req.headers, remoteAddress });
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
