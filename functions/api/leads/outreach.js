/**
 * MTM Tool 07 — GHL Outreach Push
 * Route: POST /api/leads/outreach
 *
 * Takes scored leads from D1 and upserts them into GoHighLevel (v2 API) as
 * contacts with the right tags to trigger GHL automation workflows. On
 * success, marks the lead as contacted in D1 and stores the returned GHL
 * contact id so we can correlate later.
 *
 * Body — either:
 *   { leadIds: [1,2,3], dryRun?: false }
 * or batch mode:
 *   { tier: "Hot" | "Warm" | "Cold", limit?: 20, dryRun?: false }
 * If both leadIds and tier are present, leadIds wins.
 *
 * dryRun: true → builds the GHL payload and returns it without calling GHL
 * or touching D1. Use this to verify tag logic before going live.
 *
 * Returns:
 *   {
 *     success, attempted, pushed, failed, skipped_already_contacted,
 *     dryRun, results: [{ id, business_name, ok, ghl_contact_id?,
 *     tags_applied?, custom_fields_updated?, error?, skipped? }]
 *   }
 *
 * ─── Required environment variables (Cloudflare Pages → Settings → Env) ───
 *   ADMIN_PASSWORD_HASH | TOOLS_PASSWORD_HASH — auth (Bearer)
 *   DB                  — D1 binding
 *   GHL_API_KEY         — GHL private integration API key
 *                         (GHL → Settings → Integrations → API Keys)
 *   GHL_LOCATION_ID     — sub-account location id
 *                         (GHL → Settings, bottom of page)
 *
 * ─── D1 migration (run once in Cloudflare D1 console before deploying) ───
 *   ALTER TABLE leads_outreach ADD COLUMN ghl_contact_id TEXT;
 *
 * ─── GHL custom fields to create manually before custom-field updates work ───
 * Create these under GHL → Settings → Custom Fields → Contact, with the exact
 * field keys below (GHL prefixes keys with `contact.` internally — we pass
 * the bare key, which is what the v2 API expects):
 *
 *   Name              | Field Key         | Type
 *   ------------------+-------------------+------------------
 *   MTM Score         | mtm_score         | Number (or Text)
 *   MTM Tier          | mtm_tier          | Single Line / Dropdown
 *   MTM Score Reason  | mtm_score_reason  | Multi-Line Text
 *   MTM Category      | mtm_category      | Single Line
 *   MTM Source Batch  | mtm_source_batch  | Single Line
 *
 * If these don't exist yet, the upsert still succeeds — the second PUT call
 * to set custom fields is best-effort and logs `custom_fields_updated: false`
 * in the per-lead result.
 */

import { jsonResponse, corsPreflight, requireAdmin, requireDb } from './_auth.js';

export const onRequestOptions = () => corsPreflight();

const GHL_BASE      = 'https://services.leadconnectorhq.com';
const GHL_VERSION   = '2021-07-28';
const BATCH_CHUNK   = 5;          // concurrent GHL calls per chunk
const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;
const RATE_RETRY_MS = 1000;       // wait before single retry on 429

export async function onRequestPost(context) {
  const { request, env } = context;

  const authErr = requireAdmin(request, env); if (authErr) return authErr;
  const dbErr   = requireDb(env);             if (dbErr)   return dbErr;

  let body = {};
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON body.' }, { status: 400 }); }

  const dryRun = !!body.dryRun;

  // Credential checks happen only when we're actually going to call GHL.
  if (!dryRun) {
    if (!env.GHL_API_KEY) {
      return jsonResponse(
        { error: 'GHL_API_KEY env var missing. Add it under Pages → Settings → Environment variables.' },
        { status: 500 }
      );
    }
    if (!env.GHL_LOCATION_ID) {
      return jsonResponse(
        { error: 'GHL_LOCATION_ID env var missing. Find it under GHL → Settings (bottom of page).' },
        { status: 500 }
      );
    }
  }

  // ─── Resolve the work set ───
  const explicitIds = Array.isArray(body.leadIds)
    ? body.leadIds.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0)
    : null;
  const tier  = body.tier && ['Hot', 'Warm', 'Cold'].includes(body.tier) ? body.tier : null;
  const limit = Math.min(Math.max(parseInt(body.limit || DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  if (!explicitIds?.length && !tier) {
    return jsonResponse(
      { error: 'Body must include either `leadIds` (array of ids) or `tier` ("Hot"|"Warm"|"Cold").' },
      { status: 400 }
    );
  }

  let leads;
  try {
    if (explicitIds?.length) {
      const placeholders = explicitIds.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `SELECT id, business_name, category, address, phone, email, website_url,
                score, tier, score_reason, source_batch, contacted
         FROM leads_outreach WHERE id IN (${placeholders})`
      ).bind(...explicitIds).all();
      leads = r.results || [];
    } else {
      const r = await env.DB.prepare(
        `SELECT id, business_name, category, address, phone, email, website_url,
                score, tier, score_reason, source_batch, contacted
         FROM leads_outreach
         WHERE tier = ? AND contacted = 0
         ORDER BY score DESC, id ASC
         LIMIT ?`
      ).bind(tier, limit).all();
      leads = r.results || [];
    }
  } catch (err) {
    return jsonResponse({ error: 'Could not load leads: ' + err.message }, { status: 500 });
  }

  if (!leads.length) {
    return jsonResponse({
      success: true, attempted: 0, pushed: 0, failed: 0,
      skipped_already_contacted: 0, dryRun, results: [],
      message: explicitIds?.length ? 'No matching leads.' : 'No uncontacted leads in that tier.',
    });
  }

  const results = [];
  let pushed = 0, failed = 0, skippedContacted = 0;

  // Process in chunks of 5 — keeps us under GHL rate limits while still parallel.
  for (let i = 0; i < leads.length; i += BATCH_CHUNK) {
    const chunk = leads.slice(i, i + BATCH_CHUNK);
    await Promise.all(chunk.map(async (lead) => {
      // Skip rows that were explicitly requested but are already contacted —
      // in batch (tier) mode the SQL already filters these out.
      if (explicitIds?.length && lead.contacted === 1) {
        skippedContacted++;
        results.push({
          id: lead.id, business_name: lead.business_name, ok: false,
          skipped: 'already_contacted',
        });
        return;
      }

      const payload = buildContactPayload(lead, env.GHL_LOCATION_ID || '<GHL_LOCATION_ID>');

      // GHL requires phone or email; without either the upsert will 422.
      if (!payload.phone && !payload.email) {
        failed++;
        results.push({
          id: lead.id, business_name: lead.business_name, ok: false,
          skipped: 'skipped_no_contact_info',
          error: 'Lead has neither phone nor email — GHL requires at least one.',
        });
        return;
      }

      if (dryRun) {
        results.push({
          id: lead.id, business_name: lead.business_name, ok: true,
          dryRun: true,
          tags_applied: payload.tags,
          ghl_payload: payload,
          custom_fields_preview: buildCustomFields(lead),
        });
        pushed++;
        return;
      }

      try {
        const upsertRes = await ghlUpsertContact(payload, env);
        const contactId = upsertRes?.contact?.id || upsertRes?.id || null;
        if (!contactId) {
          throw new Error('GHL upsert returned no contact id: ' + JSON.stringify(upsertRes).slice(0, 200));
        }

        // Custom fields are best-effort — they require the fields to exist in
        // GHL already (see header comment). Don't fail the whole push if this
        // step errors out.
        let cfUpdated = false, cfError = null;
        try {
          await ghlUpdateCustomFields(contactId, buildCustomFields(lead), env);
          cfUpdated = true;
        } catch (err) {
          cfError = err.message;
        }

        // Mark contacted in D1.
        try {
          await env.DB.prepare(
            `UPDATE leads_outreach
             SET contacted = 1, contacted_at = datetime('now'), ghl_contact_id = ?
             WHERE id = ?`
          ).bind(contactId, lead.id).run();
        } catch (err) {
          // D1 update failure shouldn't roll back the GHL push — surface it but
          // count as success since the contact is in GHL.
          results.push({
            id: lead.id, business_name: lead.business_name, ok: true,
            ghl_contact_id: contactId,
            tags_applied: payload.tags,
            custom_fields_updated: cfUpdated,
            custom_fields_error: cfError,
            warning: 'D1 update failed (ghl_contact_id column missing? run the migration): ' + err.message,
          });
          pushed++;
          return;
        }

        results.push({
          id: lead.id, business_name: lead.business_name, ok: true,
          ghl_contact_id: contactId,
          tags_applied: payload.tags,
          custom_fields_updated: cfUpdated,
          ...(cfError ? { custom_fields_error: cfError } : {}),
        });
        pushed++;
      } catch (err) {
        results.push({
          id: lead.id, business_name: lead.business_name, ok: false,
          error: err.message,
        });
        failed++;
      }
    }));
  }

  return jsonResponse({
    success: failed === 0,
    attempted: leads.length,
    pushed,
    failed,
    skipped_already_contacted: skippedContacted,
    dryRun,
    results,
  });
}

/* ────────────────────── payload builders ────────────────────── */

function buildContactPayload(lead, locationId) {
  const { firstName, companyName } = splitBusinessName(lead.business_name || '');
  const phone = normalizePhone(lead.phone);
  const email = lead.email ? String(lead.email).trim().toLowerCase() || null : null;
  const tags  = buildTags(lead);

  // NOTE: v2 rejects `customFields` and `notes` on the upsert body — those go
  // through the dedicated PUT /contacts/{id} call afterwards. customFields is
  // intentionally an empty array here.
  const payload = {
    locationId,
    firstName,
    companyName: companyName || lead.business_name || '',
    tags,
    customFields: [],
  };
  if (phone) payload.phone = phone;
  if (email) payload.email = email;
  if (lead.address) payload.address1 = String(lead.address).trim();
  if (lead.website_url) payload.website = String(lead.website_url).trim();

  return payload;
}

function buildTags(lead) {
  const tags = ['outreach-tool'];
  if (lead.tier) tags.unshift(`tier-${String(lead.tier).toLowerCase()}`);
  if (lead.category) {
    const norm = String(lead.category)
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (norm) tags.splice(1, 0, `category-${norm}`);
  }
  return tags;
}

function buildCustomFields(lead) {
  return [
    { key: 'mtm_score',        field_value: lead.score != null ? String(lead.score) : '' },
    { key: 'mtm_tier',         field_value: lead.tier || '' },
    { key: 'mtm_score_reason', field_value: lead.score_reason || '' },
    { key: 'mtm_category',     field_value: lead.category || '' },
    { key: 'mtm_source_batch', field_value: lead.source_batch || '' },
  ];
}

/**
 * GHL works best with a firstName populated. For B2B leads we usually only
 * have a business name, so this is a best-effort split: if the business name
 * matches a common "FirstName LastName <suffix>" pattern (e.g. "Bob Smith
 * Plumbing"), pull the first token as firstName. Otherwise fall back to
 * "Team" and stuff the whole thing into companyName.
 */
function splitBusinessName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return { firstName: 'Team', companyName: '' };

  // Common owner-name pattern: starts with two capitalized words followed by
  // a business descriptor. e.g. "John Doe HVAC" / "Mary Smith Plumbing Co".
  const m = trimmed.match(/^([A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(.+)$/);
  if (m) {
    return { firstName: m[1], companyName: trimmed };
  }
  // Possessive pattern: "Smith's HVAC", "Bob's Plumbing"
  const poss = trimmed.match(/^([A-Z][a-z]+)['’]s\b/);
  if (poss) {
    return { firstName: poss[1], companyName: trimmed };
  }
  return { firstName: 'Team', companyName: trimmed };
}

/**
 * GHL v2 expects E.164 (+1XXXXXXXXXX for US). Anything we can't confidently
 * normalize gets returned as null so we don't ship bad data to GHL.
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15 ? '+' + digits : null;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

/* ────────────────────── GHL calls ────────────────────── */

async function ghlUpsertContact(payload, env) {
  return ghlFetch('POST', '/contacts/upsert', payload, env);
}

async function ghlUpdateCustomFields(contactId, customFields, env) {
  return ghlFetch('PUT', `/contacts/${encodeURIComponent(contactId)}`, { customFields }, env);
}

async function ghlFetch(method, path, body, env) {
  const doFetch = () => fetch(GHL_BASE + path, {
    method,
    headers: {
      'Authorization': `Bearer ${env.GHL_API_KEY}`,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let res = await doFetch();
  // Single retry on 429 — GHL's rate limiter is bursty but recovers quickly.
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, RATE_RETRY_MS));
    res = await doFetch();
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GHL API ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}
