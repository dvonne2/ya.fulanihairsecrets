// Meta tracking disabled for clean Meta-free baseline.
// All exported functions are no-ops to preserve existing imports while
// ensuring no Meta Pixel, CAPI, PageView, ViewContent, InitiateCheckout,
// or Purchase events fire.

export async function captureFbclid(): Promise<void> {}
export async function firePageViewCAPI(): Promise<void> {}
export async function fireViewContent(_data: Record<string, unknown>): Promise<void> {}
export async function fireFormStart(_data?: Record<string, unknown>): Promise<void> {}
export async function fireLeadSync(_data?: Record<string, unknown>): Promise<void> {}
export async function fireCartRecovery(_data?: Record<string, unknown>): Promise<void> {}
export async function reinitPixelWithUserData(_data?: Record<string, unknown>): Promise<void> {}
export async function markEventsAsFired(): Promise<void> {}
export async function resetTracking(): Promise<void> {}

export async function getInitiateCheckoutEventId(_attemptId?: string): Promise<string> {
  return '';
}

export async function fireInitiateCheckoutBrowser(_data: Record<string, unknown>): Promise<void> {}
export async function fireInitiateCheckoutCAPI(_data: Record<string, unknown>): Promise<void> {}
