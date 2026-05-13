/**
 * MTM Call Notes Processor — Pages Function
 * Route: POST /api/process-notes
 *
 * Two-event flow:
 *
 *   1. bot.done fires (canonical trigger — recording.done is intentionally ignored
 *      to prevent duplicate transcription jobs and duplicate summary records)
 *      → Fetch meeting title from Recall.ai bot metadata
 *      → Trigger async transcription via Recall.ai API (Gladia)
 *      → Store pending entry in KV (meeting title + date, keyed by bot ID)
 *
 *   2. transcript.done fires
 *      → Dedup guard: skip if this botId has already been processed
 *      → Fetch completed transcript from Recall.ai
 *      → Claude extracts structured fields
 *      → Write finalized call entry to KV rolling history
 *
 * Manual paste flow:
 *   → { event: 'manual_paste', data: { transcript: "..." } }
 *   → Claude extracts fields, writes to KV directly
 *
 * Environment Variables Required:
 *   RECALL_AI_API_KEY         — Recall.ai API key
 *   RECALL_AI_WEBHOOK_SECRET  — Webhook signing secret (optional)
 *   ANTHROPIC_API_KEY         — MTM Anthropic key
 *   MTM_CLIENT_PROFILES       — KV namespace binding
 */

const RECALL_API = 'https://us-west-2.recall.ai/api/v1';
const MAX_CALLS = 5;

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
    console.log('Received event:', event, '| Full payload keys:', Object.keys(payload).join(', '));

    // ── MANUAL PASTE FLOW ────────────────────────────────────────────────
    if (event === 'manual_paste') {
      const pastedText = payload.data?.transcript || '';
      if (!pastedText || pastedText.length < 30) {
        return new Response(JSON.stringify({ error: 'Transcript too short.' }), { status: 400, headers });
      }

      const transcript = typeof pastedText === 'string' ? pastedText :
        pastedText.map(seg => `${seg.speaker || 'Speaker'}: ${seg.text || ''}`).join('\n');

      const fields = await extractCallFields(transcript, env.ANTHROPIC_API_KEY);
      const callEntry = {
        id: generateId(),
        meetingTitle: 'Pasted Notes — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        date: new Date().toISOString(),
        botId: null,
        fields,
        transcript: transcript.slice(0, 3000),
        processedAt: new Date().toISOString(),
      };

      await addCallToHistory(env.MTM_CLIENT_PROFILES, callEntry);
      return new Response(JSON.stringify({ success: true, callId: callEntry.id }), { headers });
    }

    // ── RECORDING.DONE — intentionally ignored to prevent duplicate jobs ──
    // bot.done is the canonical trigger. Subscribing to both caused Recall.ai
    // to receive two async_transcribe requests per meeting, which emitted two
    // transcript.done events and produced duplicate summary records.
    if (event === 'recording.done') {
      const botId = payload.data?.bot?.id;
      console.log('recording.done received for botId:', botId, '— ignored (bot.done is the trigger)');
      return new Response(JSON.stringify({ received: true, action: 'ignored', reason: 'recording.done is not the trigger event' }), { headers });
    }

    // ── TRANSCRIPT.FAILED — log for debugging ─────────────────────────────
    if (event === 'transcript.failed') {
      console.error('Transcript failed:', JSON.stringify(payload.data));
      return new Response(JSON.stringify({ received: true, action: 'logged', event }), { headers });
    }

    // ── STEP 1: BOT.DONE — trigger async transcription ───────────────────
    if (event === 'bot.done') {
      const botId = payload.data?.bot?.id;
      if (!botId) {
        console.warn('No bot ID in bot.done payload');
        return new Response(JSON.stringify({ received: true, action: 'ignored', reason: 'no bot id' }), { headers });
      }

      console.log('bot.done for botId:', botId);

      // Dedup guard: skip if we've already kicked off (or finished) work for this bot
      if (env.MTM_CLIENT_PROFILES) {
        const alreadyProcessed = await env.MTM_CLIENT_PROFILES.get(`processed:bot:${botId}`);
        const alreadyPending = await env.MTM_CLIENT_PROFILES.get(`pending:bot:${botId}`);
        if (alreadyProcessed || alreadyPending) {
          console.log('Duplicate bot.done suppressed for botId:', botId, '| processed:', !!alreadyProcessed, '| pending:', !!alreadyPending);
          return new Response(JSON.stringify({ received: true, action: 'duplicate_skipped', botId }), { headers });
        }
      }

      // Fetch meeting title from bot metadata
      const meetingTitle = await fetchMeetingTitle(botId, env.RECALL_AI_API_KEY);
      console.log('Meeting title:', meetingTitle);

      // Store pending entry so transcript.done can find the title
      if (env.MTM_CLIENT_PROFILES) {
        const pending = {
          botId,
          meetingTitle: meetingTitle || 'Google Meet — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          date: new Date().toISOString(),
        };
        await env.MTM_CLIENT_PROFILES.put(`pending:bot:${botId}`, JSON.stringify(pending), { expirationTtl: 7200 });
        console.log('Pending entry saved for botId:', botId);
      }

      // Trigger async transcription — POST to /bot/{id}/async_transcribe/
      const triggerResult = await triggerAsyncTranscription(botId, env.RECALL_AI_API_KEY);
      console.log('Transcription trigger result:', JSON.stringify(triggerResult));

      return new Response(JSON.stringify({
        received: true,
        action: 'transcription_triggered',
        botId,
        triggerResult,
      }), { headers });
    }

    // ── STEP 2: TRANSCRIPT.DONE — process completed transcript ───────────
    if (event === 'transcript.done') {
      const botId = payload.data?.bot?.id;
      const transcriptId = payload.data?.transcript?.id;

      console.log('transcript.done | botId:', botId, '| transcriptId:', transcriptId);

      if (!botId || !transcriptId) {
        console.warn('Missing bot ID or transcript ID in payload');
        return new Response(JSON.stringify({ received: true, action: 'ignored', reason: 'missing ids' }), { headers });
      }

      // Dedup guard: bail out if this bot's transcript has already been processed,
      // or if a summary record for it already exists in the rolling history.
      // Prevents duplicate summaries when Recall.ai retries the webhook or when
      // multiple transcription jobs fire for the same bot.
      if (env.MTM_CLIENT_PROFILES) {
        const alreadyProcessed = await env.MTM_CLIENT_PROFILES.get(`processed:bot:${botId}`);
        if (alreadyProcessed) {
          console.log('Duplicate transcript.done suppressed for botId:', botId);
          return new Response(JSON.stringify({ received: true, action: 'duplicate_skipped', botId }), { headers });
        }
        if (await historyHasBot(env.MTM_CLIENT_PROFILES, botId)) {
          console.log('Summary already in history for botId:', botId, '— skipping');
          await env.MTM_CLIENT_PROFILES.put(`processed:bot:${botId}`, '1', { expirationTtl: 86400 });
          return new Response(JSON.stringify({ received: true, action: 'duplicate_skipped', botId }), { headers });
        }
        // Claim this botId immediately so a concurrent duplicate bails out above.
        await env.MTM_CLIENT_PROFILES.put(`processed:bot:${botId}`, '1', { expirationTtl: 86400 });
      }

      // Retrieve and clean up the pending entry
      let pending = null;
      if (env.MTM_CLIENT_PROFILES) {
        const raw = await env.MTM_CLIENT_PROFILES.get(`pending:bot:${botId}`);
        if (raw) {
          try { pending = JSON.parse(raw); } catch { pending = null; }
          await env.MTM_CLIENT_PROFILES.delete(`pending:bot:${botId}`);
        }
      }

      // Step 1: Fetch transcript object to get the download_url
      const downloadUrl = await fetchTranscriptDownloadUrl(transcriptId, env.RECALL_AI_API_KEY);
      console.log('Download URL found:', !!downloadUrl);

      // Step 2: Fetch the actual transcript text from the download URL
      let transcript = '';
      if (downloadUrl) {
        transcript = await fetchTranscriptFromDownloadUrl(downloadUrl, env.RECALL_AI_API_KEY);
        console.log('Transcript from download_url, length:', transcript.length);
      }

      // Fallback: try bot transcript endpoint (real-time format)
      if (!transcript || transcript.length < 30) {
        transcript = await fetchTranscriptFromRecall(botId, env.RECALL_AI_API_KEY);
        console.log('Transcript from bot endpoint fallback, length:', transcript.length);
      }

      if (!transcript || transcript.length < 30) {
        console.warn('Transcript too short or empty for bot:', botId);
        return new Response(JSON.stringify({ received: true, action: 'ignored', reason: 'transcript too short' }), { headers });
      }

      // Extract fields via Claude
      const fields = await extractCallFields(transcript, env.ANTHROPIC_API_KEY);

      const callEntry = {
        id: generateId(),
        meetingTitle: pending?.meetingTitle || 'Google Meet — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        date: pending?.date || new Date().toISOString(),
        botId,
        fields,
        transcript: transcript.slice(0, 3000),
        processedAt: new Date().toISOString(),
      };

      await addCallToHistory(env.MTM_CLIENT_PROFILES, callEntry);
      console.log('Call saved to history:', callEntry.id);

      return new Response(JSON.stringify({ success: true, callId: callEntry.id, fieldsExtracted: Object.keys(fields).length }), { headers });
    }

    // All other events
    return new Response(JSON.stringify({ received: true, action: 'ignored', event }), { headers });

  } catch (err) {
    console.error('Process notes error:', err.message, err.stack);
    return new Response(JSON.stringify({ error: 'Processing failed.', detail: err.message }), { status: 500, headers });
  }
}

// ── TRIGGER ASYNC TRANSCRIPTION ───────────────────────────────────────────────
// Recall.ai docs: POST /api/v1/recording/{recording_id}/create_transcript/
// The recording ID is different from the bot ID — must be fetched first via
// GET /api/v1/recording/?bot_id={botId}
// Provider body format: { "provider": { "gladia_v2_async": {} } }

async function triggerAsyncTranscription(botId, apiKey) {
  if (!apiKey) {
    console.error('RECALL_AI_API_KEY not configured');
    return { error: 'no api key' };
  }

  try {
    // Step 1: Get the recording ID for this bot
    const recordingId = await fetchRecordingId(botId, apiKey);
    if (!recordingId) {
      console.error('No recording found for bot:', botId);
      return { error: 'no recording id found for bot' };
    }
    console.log('Recording ID for bot', botId, ':', recordingId);

    // Step 2: Trigger async transcription using the recording ID
    const url = `${RECALL_API}/recording/${recordingId}/create_transcript/`;
    const body = {
      provider: {
        gladia_v2_async: {},
      },
    };

    console.log('Triggering async transcription at:', url);

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await resp.text();
    console.log('Async transcription response:', resp.status, responseText.slice(0, 300));

    if (!resp.ok) {
      return { error: `HTTP ${resp.status}`, detail: responseText.slice(0, 200) };
    }

    try {
      return JSON.parse(responseText);
    } catch {
      return { raw: responseText.slice(0, 200) };
    }
  } catch (err) {
    console.error('triggerAsyncTranscription error:', err.message);
    return { error: err.message };
  }
}

// ── FETCH RECORDING ID FOR A BOT ──────────────────────────────────────────────
// GET /api/v1/recording/?bot_id={botId}

async function fetchRecordingId(botId, apiKey) {
  if (!apiKey) return null;
  try {
    const resp = await fetch(`${RECALL_API}/recording/?bot_id=${botId}`, {
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
      console.error('Recording list fetch failed:', resp.status, await resp.text());
      return null;
    }
    const data = await resp.json();
    const results = data.results || (Array.isArray(data) ? data : []);
    if (!results.length) {
      console.warn('No recordings found for bot:', botId);
      return null;
    }
    // Prefer a done recording, fall back to first
    const done = results.find(r => r.status?.code === 'done') || results[0];
    console.log('Found recording:', done?.id, '| status:', done?.status?.code);
    return done?.id || null;
  } catch (err) {
    console.error('fetchRecordingId error:', err.message);
    return null;
  }
}

// ── FETCH MEETING TITLE ───────────────────────────────────────────────────────

async function fetchMeetingTitle(botId, apiKey) {
  if (!apiKey) return null;
  try {
    const resp = await fetch(`${RECALL_API}/bot/${botId}/`, {
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return null;
    const bot = await resp.json();
    return bot.meeting_metadata?.title
      || bot.calendar_meeting?.title
      || bot.meeting_metadata?.meeting_title
      || null;
  } catch (err) {
    console.error('fetchMeetingTitle error:', err.message);
    return null;
  }
}

// ── FETCH TRANSCRIPT DOWNLOAD URL ────────────────────────────────────────────
// GET /api/v1/transcript/{id}/ — returns transcript object with data.download_url

async function fetchTranscriptDownloadUrl(transcriptId, apiKey) {
  if (!transcriptId || !apiKey) return null;
  try {
    const resp = await fetch(`${RECALL_API}/transcript/${transcriptId}/`, {
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
      console.error('Transcript object fetch failed:', resp.status);
      return null;
    }
    const data = await resp.json();
    const url = data.data?.download_url || null;
    console.log('Transcript download_url:', url ? 'found' : 'not found');
    return url;
  } catch (err) {
    console.error('fetchTranscriptDownloadUrl error:', err.message);
    return null;
  }
}

// ── FETCH TRANSCRIPT FROM DOWNLOAD URL ───────────────────────────────────────
// Async transcript format: [{ participant: { name }, transcript: "text", words: [...] }]

async function fetchTranscriptFromDownloadUrl(downloadUrl, apiKey) {
  if (!downloadUrl) return '';
  try {
    const resp = await fetch(downloadUrl, {
      headers: { 'Authorization': `Token ${apiKey}` },
    });
    if (!resp.ok) {
      console.error('Download URL fetch failed:', resp.status);
      return '';
    }
    const data = await resp.json();
    if (Array.isArray(data)) {
      return data.map(item => {
        const speaker = item.participant?.name || 'Speaker';
        const text = item.transcript || item.words?.map(w => w.word || w.text || '').join(' ') || '';
        return `${speaker}: ${text}`;
      }).filter(line => line.trim().length > 2).join('\n');
    }
    console.warn('Unexpected download URL format:', JSON.stringify(data).slice(0, 200));
    return '';
  } catch (err) {
    console.error('fetchTranscriptFromDownloadUrl error:', err.message);
    return '';
  }
}

// ── FETCH TRANSCRIPT ──────────────────────────────────────────────────────────

async function fetchTranscriptFromRecall(botId, apiKey) {
  if (!apiKey) { console.error('RECALL_AI_API_KEY not configured'); return ''; }

  try {
    const resp = await fetch(`${RECALL_API}/bot/${botId}/transcript/`, {
      headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (!resp.ok) {
      console.error('Transcript fetch failed:', resp.status, await resp.text());
      return '';
    }

    const data = await resp.json();

    // Handle array of segments (standard Recall.ai format)
    if (Array.isArray(data)) {
      return data.map(seg => {
        const speaker = seg.speaker || 'Speaker';
        const words = Array.isArray(seg.words)
          ? seg.words.map(w => w.text || w.word || '').join(' ')
          : (seg.text || '');
        return `${speaker}: ${words}`;
      }).filter(line => line.trim().length > 0).join('\n');
    }

    // Handle object with segments array
    if (data.segments && Array.isArray(data.segments)) {
      return data.segments.map(seg => {
        const speaker = seg.speaker || 'Speaker';
        const text = seg.text || '';
        return `${speaker}: ${text}`;
      }).filter(line => line.trim().length > 0).join('\n');
    }

    // Handle object with results array
    if (data.results && Array.isArray(data.results)) {
      return data.results.map(seg => {
        const speaker = seg.speaker || 'Speaker';
        const text = seg.text || seg.words?.map(w => w.text).join(' ') || '';
        return `${speaker}: ${text}`;
      }).filter(line => line.trim().length > 0).join('\n');
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

  const systemPrompt = `You are a call intelligence analyst for More Than Momentum (MTM), a digital marketing agency. You process raw sales discovery call transcripts and extract two things:

1. Structured intelligence — specific, verbatim-level detail. Never paraphrase vaguely. If the prospect said "my employees refuse to collect emails," write that. If they gave a number, include the number. If they described a specific scenario, quote it. Generic summaries ("wants more leads") are useless — specific language ("losing customers because nobody follows up after a walk-in") is what we need.

2. A cleaned transcript — the full conversation with only true filler removed (ums, ahs, repeated false starts, pleasantries like "yeah totally" and "sounds good"). Every substantive sentence stays. Every specific detail stays. The goal is a version of the transcript that takes 20% less time to read but loses 0% of the meaning. Do not summarize. Do not collapse paragraphs. Preserve the back-and-forth.

Return ONLY valid JSON. No markdown fences. No preamble. No explanation.`;

  const userMessage = `Here is the full transcript. Extract structured intelligence AND return a cleaned version of the transcript.

TRANSCRIPT:
${transcript.slice(0, 80000)}

Return this exact JSON schema:

{
  "meta": {
    "business_name": "string — from transcript, not inferred",
    "owner_name": "string",
    "business_type": "string",
    "location": "string — city/state if mentioned",
    "call_date": "string",
    "call_duration_estimate": "string",
    "deal_signal": "HOT | WARM | COLD | UNKNOWN",
    "deal_signal_reasoning": "string — specific reason based on what was actually said"
  },
  "top_highlights": [
    {
      "headline": "string — 10 words max, specific (e.g. 'Owner manages remotely, 2 hrs away, visits twice/month')",
      "detail": "string — 1-3 sentences of specific detail. Quote the prospect directly if possible.",
      "importance": "CRITICAL | HIGH | MEDIUM"
    }
  ],
  "pain_points": [
    {
      "title": "string — specific, not generic",
      "severity": "Critical | High | Medium | Low",
      "exact_language": "string — quote or close paraphrase of how they described this problem",
      "business_impact": "string — what it's actually costing them (revenue, time, customers)"
    }
  ],
  "desired_outcomes": [
    {
      "outcome": "string — what they said they want, specifically",
      "their_words": "string — direct quote if available"
    }
  ],
  "key_quotes": [
    {
      "speaker": "string",
      "quote": "string — verbatim or near-verbatim",
      "why_it_matters": "string"
    }
  ],
  "contacts": [
    {
      "name": "string",
      "role": "string",
      "what_they_said": "string — specific things this person said or that were said about them",
      "approach": "string — how to handle this person specifically"
    }
  ],
  "services_discussed": ["string — exactly as discussed, not repackaged into MTM product names"],
  "objections_raised": [
    {
      "objection": "string — what they actually said",
      "context": "string — what prompted it",
      "how_it_was_handled": "string — or null if it wasn't"
    }
  ],
  "action_items": [
    {
      "action": "string — specific task",
      "owner": "Cole | Prospect | Both",
      "due": "string — if mentioned, otherwise 'ASAP'",
      "verbatim_commitment": "string — quote of the commitment made if one was made"
    }
  ],
  "next_steps_agreed": "string — exactly what was agreed at the end of the call",
  "open_questions": ["string — things that came up but weren't resolved"],
  "cleaned_transcript": "string — the full cleaned transcript, preserving all speaker labels and the back-and-forth structure. Remove only: filler words (um, uh, like, you know), repeated false starts, pure social filler (yeah totally, sounds good, for sure, absolutely) when they add no meaning. Keep everything substantive. Format as: SPEAKER: [text]\\nSPEAKER: [text]",
  "claude_context_block": "string — a block starting with 'PROSPECT CONTEXT — [BUSINESS NAME]' that includes: the top highlights as bullet points with their exact language, the 3-5 most important quotes verbatim, all action items, and then the instruction: 'Full cleaned transcript follows — read it before responding.' Then paste the cleaned transcript inline."
}`;

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
        max_tokens: 32000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
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

// ── ROLLING CALL HISTORY ──────────────────────────────────────────────────────

async function addCallToHistory(kv, callEntry) {
  if (!kv) { console.error('MTM_CLIENT_PROFILES KV not bound'); return; }

  let history = [];
  try {
    const raw = await kv.get('session:call_history');
    if (raw) {
      const parsed = JSON.parse(raw);
      history = Array.isArray(parsed) ? parsed : [];
    }
  } catch { history = []; }

  if (callEntry.botId && history.some(c => c?.botId === callEntry.botId)) {
    console.log('addCallToHistory: botId already present, skipping unshift:', callEntry.botId);
    return;
  }

  history.unshift(callEntry);
  if (history.length > MAX_CALLS) history = history.slice(0, MAX_CALLS);
  await kv.put('session:call_history', JSON.stringify(history));
}

async function historyHasBot(kv, botId) {
  if (!kv || !botId) return false;
  try {
    const raw = await kv.get('session:call_history');
    if (!raw) return false;
    const history = JSON.parse(raw);
    return Array.isArray(history) && history.some(c => c?.botId === botId);
  } catch { return false; }
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

function generateId() {
  return 'call_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
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
