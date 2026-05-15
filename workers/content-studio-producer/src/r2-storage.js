/**
 * R2 helpers — uploads, reads, and presigned URLs.
 *
 * Key conventions:
 *   uploads/{tenant}/{timestamp}-{filename}      raw user uploads
 *   assets/{tenant}/{upload_id}-processed.{ext}  Opus / Canva outputs
 *
 * The Pages Function /api/content-studio/upload writes the raw upload directly
 * to R2 with the `uploads/...` key; this module is for everything the worker
 * produces downstream.
 */

const TENANT_ID = 'mtm';

export function processedKey(uploadId, ext) {
  const safeExt = String(ext || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin';
  return `assets/${TENANT_ID}/${uploadId}-processed.${safeExt}`;
}

export async function readObject(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`R2 object not found: ${key}`);
  return obj;
}

export async function putBuffer(bucket, key, buffer, contentType) {
  await bucket.put(key, buffer, {
    httpMetadata: { contentType: contentType || 'application/octet-stream' },
  });
  return key;
}

/**
 * Build a public URL for a stored object.
 *
 * R2 buckets can be publicly accessed via a custom domain or the r2.dev URL.
 * To stay portable across either path, the worker stores R2 keys (not URLs)
 * and the frontend resolves them through a Pages Function that streams the
 * object. The "public_url" we return here is therefore a Pages-rooted path,
 * which works regardless of how the bucket is exposed.
 */
export function publicUrl(env, key) {
  const base = (env.PAGES_BASE_URL || 'https://morethanmomentum.com').replace(/\/$/, '');
  return `${base}/api/content-studio/asset?key=${encodeURIComponent(key)}`;
}

/**
 * Fetch a remote URL into an ArrayBuffer. Used for downloading Opus/Canva
 * exports before persisting to R2.
 */
export async function fetchToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || 'application/octet-stream';
  const buf = await res.arrayBuffer();
  return { buf, contentType: ct };
}
