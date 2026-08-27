// One-time automatic recovery for lazy/dynamic chunk load failures.
//
// When a new deployment replaces content-hashed chunk files while a user
// still has an old session open, dynamic imports can fail with errors like
// "Failed to fetch dynamically imported module". A single reload fetches the
// new HTML and matching chunks. A sessionStorage marker prevents reload
// loops: if the retry also fails, the error propagates to the normal
// ErrorBoundary screen. Ordinary runtime errors never trigger a reload.

const STORAGE_KEY = 'fhs_chunk_reload_at';
const MARKER_CLEAR_DELAY_MS = 30_000;

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
];

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

function hasReloadedRecently(): boolean {
  try {
    return !!window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // sessionStorage unavailable (private browsing) — never reload so we
    // cannot loop; the error boundary handles the failure instead.
    return true;
  }
}

/**
 * Reloads the page exactly once for a genuine chunk-load failure.
 * Returns true if a reload was triggered (callers can suppress the error).
 */
export function reloadOnceForChunkError(error: unknown): boolean {
  if (typeof window === 'undefined') return false;
  if (!isChunkLoadError(error)) return false;
  if (hasReloadedRecently()) return false;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function installChunkReloadRecovery(): void {
  if (typeof window === 'undefined') return;

  // Vite dispatches this event when a dynamic import / modulepreload fails.
  window.addEventListener('vite:preloadError', (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    const error =
      payload instanceof Error
        ? payload
        : new Error('Failed to fetch dynamically imported module');
    if (reloadOnceForChunkError(error)) {
      event.preventDefault();
    }
  });

  // Dynamic import() rejections that are not handled elsewhere.
  window.addEventListener('unhandledrejection', (event) => {
    if (reloadOnceForChunkError(event.reason)) {
      event.preventDefault();
    }
  });

  // After the reloaded page has been stable for a while, clear the marker so
  // a future deployment can be recovered from again. If a chunk error recurs
  // within this window, the marker is still set and no reload loop occurs.
  window.addEventListener(
    'load',
    () => {
      window.setTimeout(() => {
        try {
          window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      }, MARKER_CLEAR_DELAY_MS);
    },
    { once: true }
  );
}
