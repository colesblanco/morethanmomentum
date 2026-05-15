/**
 * Thin wrapper over the Content Studio Pages Functions.
 * All endpoints return JSON; this client surfaces network errors as
 * { status: 'error', message: ... } so views can render friendly states.
 */
window.CSApi = (function () {
  const BASE = '/api/content-studio';

  async function get(path) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method:  'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) {
        return { status: 'error', message: `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (err) {
      return { status: 'error', message: err.message || 'network error' };
    }
  }

  return {
    analyticsSnapshot:  ()           => get('/analytics-snapshot'),
    socialSummary:      (days = 7)   => get(`/social-summary?days=${days}`),
    formatLibrary:      ()           => get('/format-library'),
  };
})();
