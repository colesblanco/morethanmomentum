/**
 * MTM Prospect Intelligence — Research Engine
 * Route: POST /api/prospect
 *
 * Environment Variables Required:
 *   ANTHROPIC_API_KEY — MTM's internal Anthropic API key (separate from client keys)
 *
 * Accepts: { businessName, city, websiteUrl? }
 * Returns: { success: true, brief: { ... } }
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const body = await request.json();
    const { businessName, city, websiteUrl } = body;

    if (!businessName || !city) {
      return new Response(
        JSON.stringify({ error: 'Business name and city are required.' }),
        { status: 400, headers }
      );
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'API key not configured. Add ANTHROPIC_API_KEY to environment variables.' }),
        { status: 500, headers }
      );
    }

    // Build the user message
    const userMessage = websiteUrl
      ? `Research this prospect business for an MTM discovery brief:\n\nBusiness: "${businessName}"\nLocation: "${city}"\nWebsite: ${websiteUrl}\n\nSearch thoroughly and return the JSON brief.`
      : `Research this prospect business for an MTM discovery brief:\n\nBusiness: "${businessName}"\nLocation: "${city}"\n\nFind their website if one exists. Search thoroughly and return the JSON brief.`;

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: `You are a digital marketing analyst for More Than Momentum (MTM), an AI-native digital growth agency serving small and mid-size local businesses — primarily trades and local service providers.

MTM's three packages:
- Starter ($800 setup + $1,200/month): AI content calendar, 2-platform social management, 8 posts/month, basic automation
- Growth Engine ($2,500 setup + $1,500/month): Everything in Starter + video production, advanced automation, 4 platforms, lead scoring
- Full System ($3,500 setup + $2,500/month): Everything in Growth Engine + custom AI agents, website build/redesign, paid ads management

Your job: Research the prospect business using web search and return a structured intelligence brief for MTM's sales team to use on a discovery call.

Search for:
1. Their website — platform (Wix/WordPress/Squarespace/Shopify/Custom/None), quality, mobile-friendliness, lead capture
2. Social media — Instagram, Facebook, TikTok, LinkedIn (Active = posted in last 30 days, Inactive = account exists but dormant, None = no account found)
3. Google Business Profile — review count and rating
4. Any obvious digital gaps or problems

Return ONLY a valid raw JSON object. No markdown. No backticks. No explanation before or after. Just the JSON:

{
  "businessName": "exact name as found",
  "city": "city, state",
  "profile": {
    "websitePlatform": "Wix|WordPress|Squarespace|Shopify|Custom|None|Unknown",
    "websiteQuality": "Poor|Average|Good|None",
    "websiteNotes": "1-2 specific sentences describing exactly what you found about their site",
    "socialMedia": {
      "instagram": "Active|Inactive|None",
      "facebook": "Active|Inactive|None",
      "tiktok": "Active|Inactive|None",
      "linkedin": "Active|Inactive|None"
    },
    "googleReviews": "e.g. 47 reviews · 4.8 stars  — or  Not Found",
    "overallGrade": "A|B|C|D|F",
    "gradeSummary": "One direct sentence explaining the grade based on what you found"
  },
  "gapAnalysis": [
    "Specific gap 1 — be concrete, e.g. No lead capture on website",
    "Specific gap 2",
    "Specific gap 3"
  ],
  "discoveryQuestions": [
    "Question tailored to their specific situation, e.g. What happens when someone calls and you miss it?",
    "Question 2",
    "Question 3",
    "Question 4"
  ],
  "talkingPoints": [
    "MTM talking point tied directly to a gap you found, e.g. Your competitor down the street has 180 Google reviews — here's how we close that gap fast.",
    "Talking point 2",
    "Talking point 3"
  ],
  "recommendedPackage": {
    "name": "Starter|Growth Engine|Full System",
    "rationale": "2-3 sentences explaining why this specific package fits based on what you found about this business"
  }
}`,
        messages: [
          { role: 'user', content: userMessage }
        ],
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search'
          }
        ]
      })
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error('Anthropic API error:', apiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: `API error ${apiResponse.status} — check your ANTHROPIC_API_KEY in Cloudflare env vars.` }),
        { status: 500, headers }
      );
    }

    const apiData = await apiResponse.json();

    // Extract text blocks from response (response may contain tool_use + tool_result + text)
    const textContent = apiData.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    if (!textContent) {
      return new Response(
        JSON.stringify({ error: 'No research results returned. Try again.' }),
        { status: 500, headers }
      );
    }

    // Parse JSON — handle markdown fences, preamble, and postamble
    let brief;
    try {
      // Strategy 1: strip markdown fences and parse directly
      let cleaned = textContent.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      try {
        brief = JSON.parse(cleaned);
      } catch {
        // Strategy 2: extract the outermost {...} block from the text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object found in response');
        brief = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.error('JSON parse error. Raw response:', textContent);
      return new Response(
        JSON.stringify({ error: 'Could not parse research results. Raw: ' + textContent.slice(0, 300) }),
        { status: 500, headers }
      );
    }

    return new Response(JSON.stringify({ success: true, brief }), { headers });

  } catch (err) {
    console.error('Prospect function error:', err.message);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
