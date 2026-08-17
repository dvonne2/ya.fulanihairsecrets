function runDeferredTracking() {
  // TikTok Pixel initialization (stub is in index.html)
  try {
    if (typeof window.ttq === 'object' && typeof window.ttq.load === 'function') {
      window.ttq.load('D6I4NQRC77U4M1757710');
      window.ttq.page();
    }
  } catch (e) {
    console.warn('[TikTok] deferred init failed:', e);
  }
}

var _schedule = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function(cb) { setTimeout(cb, 0); };
_schedule(function() {
  setTimeout(runDeferredTracking, 0);
});
