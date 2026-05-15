/**
 * Google Drive archive sync.
 *
 * STATUS: Gated behind env.GOOGLE_DRIVE_ENABLED === 'true'.
 * When disabled, uploadToDrive() returns null and the caller treats Drive as
 * an optional secondary store -- R2 remains the primary asset store.
 *
 * Auth path: service-account JWT → access token → Drive multipart upload.
 *
 * Service account setup (Cole, one time):
 *   1. console.cloud.google.com → new project → enable Google Drive API
 *   2. IAM → Service Accounts → Create → download JSON key
 *   3. Drive: create folder "MTM Content Studio Assets", share with the SA email
 *   4. Worker secrets:
 *        npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
 *        npx wrangler secret put GOOGLE_DRIVE_FOLDER_ID
 *   5. Flip GOOGLE_DRIVE_ENABLED to "true" in wrangler.toml + redeploy.
 */

const TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

function isEnabled(env) {
  return String(env.GOOGLE_DRIVE_ENABLED || '').toLowerCase() === 'true';
}

/* ── Base64url helpers for JWT signing ───────────────────────────────────── */
function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToBinary(pem) {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Exchange a service-account JSON for an OAuth access token (1h lifetime). */
async function getAccessToken(serviceAccountJsonString) {
  const sa = typeof serviceAccountJsonString === 'string'
    ? JSON.parse(serviceAccountJsonString)
    : serviceAccountJsonString;

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBinary(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`drive token HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token;
}

/**
 * Upload a buffer to Google Drive. Returns the shareable view URL.
 * Returns null when disabled.
 */
export async function uploadToDrive(env, { buffer, filename, mimeType }) {
  if (!isEnabled(env)) return null;
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new Error('Drive enabled but GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_FOLDER_ID missing.');
  }

  const token = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const metadata = {
    name:    filename,
    parents: [env.GOOGLE_DRIVE_FOLDER_ID],
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file',     new Blob([buffer], { type: mimeType || 'application/octet-stream' }));

  const res = await fetch(UPLOAD_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body:    form,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`drive upload HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return `https://drive.google.com/file/d/${data.id}/view`;
}

export const driveEnabled = isEnabled;
