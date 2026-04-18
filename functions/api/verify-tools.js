/**
 * MTM Tools — Password Verification Endpoint
 * Route: POST /api/verify-tools
 *
 * Environment Variables Required:
 *   TOOLS_PASSWORD_HASH — SHA-256 hex hash of the tools dashboard password
 *
 * Accepts two modes:
 *   1. { password: "plaintext" } — hashes and compares, returns token on success
 *   2. { token: "hash" }        — validates a stored session token
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers — scoped to morethanmomentum.com in production
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const body = await request.json();
    const storedHash = env.TOOLS_PASSWORD_HASH;

    if (!storedHash) {
      return new Response(
        JSON.stringify({ success: false, error: 'Server misconfiguration — env var missing.' }),
        { status: 500, headers }
      );
    }

    // ── MODE 1: Validate a stored session token ──
    if (body.token) {
      const isValid = body.token === storedHash;
      return new Response(JSON.stringify({ success: isValid }), { headers });
    }

    // ── MODE 2: Validate a plaintext password ────
    if (body.password) {
      const encoder = new TextEncoder();
      const data = encoder.encode(body.password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const isValid = hashHex === storedHash;

      return new Response(
        JSON.stringify({
          success: isValid,
          token: isValid ? storedHash : null,
        }),
        { headers }
      );
    }

    // No valid payload
    return new Response(JSON.stringify({ success: false }), { headers });

  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Request error.' }),
      { status: 400, headers }
    );
  }
}

// Handle preflight OPTIONS requests
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
