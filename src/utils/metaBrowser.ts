import { createMetaBrowser } from 'vitalvida-meta-tracking/browser';

let browser: ReturnType<typeof createMetaBrowser> | null = null;

export function getMetaBrowser() {
  if (typeof window === 'undefined') return null;
  const pixelId = typeof __META_PIXEL_ID__ !== 'undefined' ? __META_PIXEL_ID__ : '';
  if (!pixelId) return null;
  if (!browser) {
    browser = createMetaBrowser({
      pixelId,
      capiEndpoint: '/api/meta-capi',
      country: 'ng',
    });
  }
  return browser;
}
