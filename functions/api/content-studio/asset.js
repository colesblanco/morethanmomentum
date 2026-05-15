/**
 * GET /api/content-studio/asset?key=<r2-key>
 *
 * Streams an R2 object through Cloudflare Pages so the rest of the system
 * can reference assets with a stable Pages-rooted URL even if the underlying
 * R2 bucket is private. The Producer worker's r2-storage.publicUrl() resolves
 * keys through this endpoint.
 *
 * Tenant scope: keys must start with 'uploads/mtm/' or 'assets/mtm/' so other
 * tenants' keys can't be probed by guessing.
 *
 * ─── ENV ──────────────────────────────────────────────────────────────────
 *   ASSETS_BUCKET   R2 binding (must match the Producer worker binding)
 */

const TENANT_ID = 'mtm';

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.ASSETS_BUCKET) {
    return new Response(JSON.stringify({ status: 'not_configured', message: 'ASSETS_BUCKET R2 binding missing' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const okPrefix = key.startsWith(`uploads/${TENANT_ID}/`) || key.startsWith(`assets/${TENANT_ID}/`);
  if (!key || !okPrefix) {
    return new Response('forbidden', { status: 403 });
  }

  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) return new Response('not found', { status: 404 });

  const headers = new Headers();
  if (obj.httpMetadata?.contentType) headers.set('Content-Type', obj.httpMetadata.contentType);
  // Assets are immutable after Worker stores them (timestamped/IDed keys);
  // safe to cache aggressively at the edge.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { status: 200, headers });
}
