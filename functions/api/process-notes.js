/**
 * MTM Call Notes Processor — Pages Function
 * Route: POST /api/process-notes
 *
 * Recall.ai webhook handler. When a Google Meet ends:
 *   1. Recall.ai sends bot.done webhook (no transcript in payload)
 *   2. Worker uses bot ID to fetch full transcript from Recall.ai API
 *   3. Claude extracts structured Tool 02 fields from transcript
 *   4. Result stored in KV under 'session:latest_call_notes'
 *   5. Tools dashboard "Load Latest Call" button retrieves it
 *
 * Environment Variables Required:
 *   RECALL_AI_API_KEY         — Recall.ai API key
 *   RECALL_AI_WEBHOOK_SECRET  — Webhook secret for signature verification (optional)
 *   ANTHROPIC_API_KEY         — MTM Anthropic key
 *   MTM_CLIENT_PROFILES       — KV namespace binding (already exists)
 */

const RECALL_API = 'https://us-west-2.recall.ai/api/v1';

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const rawBody = await request.text();

    // Verify webhook signature if secret is configured
    if (env.RECALL_AI_WEBHOOK_SECRET) {
      const signature = request.headers.get('X-Recall-Signature') || request.headers.get('recall-signature');
      if (signature) {
        const isValid = await verifySignature(rawBody, signature, env.RECALL_AI_WEBHOOK_SECRET);
        if (!isValid) {
          console.warn('Recall.ai signature verification failed');
          return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers });
        }
      }
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event;

    // Only process bot.done — transcript is ready at this point
    if (event !== 'bot.done') {
      return new Response(JSON.stringify({ received: true, action: 'ignored', event }), { headers });
    }

    // Extract bot ID from payload
    const botId = payload.data?.bot?.id;
    if (!botId) {
      console.warn('No bot ID in payload:', JSON.stringify(payload));
      return new Response(JSON.stringify({ received: true, action: 'ignored', reason: 'no bot id' }), { headers });
    }

    // Fetch full transcript from Recall.ai API using bot ID
    const transcript = await fetchTranscriptFromRecall(botId, env.RECALL_AI_API_KEY);

    if (!transcript || transcript.length < 30) {
      console.warn('Transcript too short or empty for bot:', botId);
      return new Response(JSON.stringify({ received: true, action: 'ignored', reason: 'transcript too short or empty' }), { headers });
    }

    // Extract Tool 02 fields via Claude
    const fields = await extractCallFields(transcript, env.ANTHROPIC_API_KEY);

    // Store in KV with timestamp
    const stored = {
      fields,
      transcript: transcript.slice(0, 3000),
      botId,
      processedAt: new Date().toISOString(),
    };

    if (env.MTM_CLIENT_PROFILES) {
      await env.MTM_CLIENT_PROFILES.put('session:latest_call_notes', JSON.stringify(stored));
    }

    return new Response(JSON.stringify({ success: true, fieldsExtracted: Object.keys(fields).length }), { headers });

  } catch (err) {
    console.error('Process notes error:', err.message);
    return new Response(JSON.stringify({ error: 'Processing failed.' }), { status: 500, headers });
  }
}

// ── FETCH TRANSCRIPT FROM RECALL.AI ──────────────────────────────────────────

async function fetchTranscriptFromRecall(botId, apiKey) {
  if (!apiKey) {
    console.error('RECALL_AI_API_KEY not configured');
    return '';
  }

  try {
    const resp = await fetch(`${RECALL_API}/bot/${botId}/transcript/`, {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      console.error('Recall.ai transcript fetch failed:', resp.status, await resp.text());
      return '';
    }

    const data = await resp.json();

    // Recall.ai returns an array of transcript segments
    if (Array.isArray(data)) {
      return data.map(seg => {
        const speaker = seg.speaker || 'Speaker';
        const words = Array.isArray(seg.words)
          ? seg.words.map(w => w.text || w.word || '').join(' ')
          : (seg.text || '');
        return `${speaker}: ${words}`;
      }).join('\n');
    }

    // Fallback: handle object with results array
    if (data.results && Array.isArray(data.results)) {
      return data.results.map(seg => {
        const speaker = seg.speaker || 'Speaker';
        const text = seg.text || seg.words?.map(w => w.text).join(' ') || '';
        return `${speaker}: ${text}`;
      }).join('\n');
    }

    console.warn('Unexpected transcript format:', JSON.stringify(data).slice(0, 200));
    return '';

  } catch (err) {
    console.error('fetchTranscriptFromRecall error:', err.message);
    return '';
  }
}

// ── CLAUDE FIELD EXTRACTION ───────────────────────────────────────────────────

async function extractCallFields(transcript, apiKey) {
  if (!apiKey) {
    return { error: 'ANTHROPIC_API_KEY not configured', rawTranscript: transcript.slice(0, 500) };
  }

  const prompt = `You are analyzing a sales discovery call transcript for More Than Momentum (MTM), a digital marketing agency.

Extract the following information from the transcript and return ONLY a JSON object. Use null for fields not mentioned.

Required fields:
{
  "businessName": "prospect's business name if mentioned",
  "contactName": "prospect's name",
  "city": "their city and state",
  "businessType": "type of business (HVAC, Plumbing, Gym, etc.)",
  "avgCustomerValue": "average job/customer value in dollars (number only, no $)",
  "budgetBeforeResults": "how much they're willing to spend before seeing results (number only)",
  "currentMarketingSpend": "current monthly marketing spend (number only)",
  "painPoint": "their #1 pain — pick closest: 'Losing leads — no follow-up system' | 'Website doesn't reflect business quality' | 'No online presence at all' | 'Inconsistent or zero social media' | 'Need more leads / customers' | 'Bad experience with previous agency' | 'Don't have time to manage marketing' | 'Other'",
  "desiredOutcome": "what outcome they said would make them say yes",
  "triedBefore": "what they've tried — pick closest: 'Nothing' | 'DIY social media' | 'Hired an agency before' | 'Hired a freelancer' | 'Ran paid ads' | 'Built own website' | 'Multiple things'",
  "socialGoal": "if social media mentioned: 'leads' | 'brand' | 'both'",
  "meetingCadence": "'weekly' | 'biweekly' | 'monthly_email'",
  "currentWebsiteTraffic": "monthly website visitors (number only)",
  "currentLeadsPerMonth": "leads per month (number only)",
  "currentInstagramFollowers": "Instagram followers (number only)",
  "currentFacebookFollowers": "Facebook followers (number only)",
  "currentGoogleReviews": "Google review count (number only)",
  "serviceInterests": {
    "website": true/false,
    "backend": true/false,
    "social": true/false
  },
  "discoveryNotes": "any other important context from the call (max 300 chars)"
}

TRANSCRIPT:
${transcript.slice(0, 4000)}

Return ONLY valid JSON. No markdown. No backticks. No explanation.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      }),
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text || '{}';
    return JSON.parse(text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim());
  } catch (err) {
    console.error('Claude extraction error:', err.message);
    return { error: 'Extraction failed', rawTranscript: transcript.slice(0, 500) };
  }
}

// ── SIGNATURE VERIFICATION ────────────────────────────────────────────────────

async function verifySignature(body, signature, secret) {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = hexToBytes(signature.replace('sha256=', ''));
    return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(body));
  } catch { return false; }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
