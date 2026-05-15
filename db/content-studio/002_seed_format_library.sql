-- ─────────────────────────────────────────────────────────────────────────────
-- Format Library — 10 starter entries for Phase 1
--
-- Apply (remote):
--   npx wrangler d1 execute mtm_content_studio --remote --file=./db/content-studio/002_seed_format_library.sql
--
-- Verify:
--   npx wrangler d1 execute mtm_content_studio --remote --command="SELECT count(*) FROM format_library"
--   → expect 10
--
-- These are placeholders. The Trend Scout (Phase 3) replaces them with real captures
-- harvested organically from MTM-followed accounts. They exist so the Phase 2 Strategist
-- Agent has real-enough rows to query against during agent development.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO format_library
  (tenant_id, source_account, source_post_url, hook_type, structure_summary, pacing_notes, why_it_works, mtm_adaptations)
VALUES
  ('mtm', 'generic_fitness_pattern', NULL,
   'Mistake reveal',
   'Opens with a POV declaration ("POV: you''re doing this wrong"), shows the wrong version for 3-4 seconds, hard cut to the correct version, ends on the payoff/why it matters.',
   '8-12 seconds total; visual flip happens at the 40% mark to maintain retention through the contrast.',
   'Pattern interrupts the viewer''s assumption of competence, then resolves the tension with a teach — high retention from the implicit "am I doing this wrong?" anxiety.',
   '["POV: you''re onboarding clients wrong — show messy DM thread, cut to a clean automated GHL workflow.","POV: you''re tracking leads wrong — show a chaotic spreadsheet, cut to MTM''s pipeline view.","POV: you''re posting content wrong — show random posts, cut to a planned weekly grid."]'),

  ('mtm', 'hormozi_pattern', NULL,
   'Cost framing',
   'Opens with a specific dollar number tied to the viewer''s daily behavior ("You''re losing $X every time you Y"), spends the middle quantifying the leak, ends with the cheap fix.',
   '15-22 seconds; the number stays on screen the whole video as a sticky text element.',
   'Anchoring + loss aversion. Specific numbers feel real; loss framing hits 2x harder than equivalent gain framing in short-form.',
   '["You''re losing $400/mo every time a lead waits more than 5 min for a reply — automate it.","You''re losing $1,200 per ghosted proposal — the fix is a 15-min follow-up sequence.","You''re losing 3 hours/week pulling pipeline reports manually — here''s the GHL view that does it for you."]'),

  ('mtm', 'grant_beans_pattern', NULL,
   'Identity callout',
   'Hard, specific identity hook ("If you''re a [niche] owner doing [behavior], stop"), then the reframe, then the better behavior with one concrete example.',
   '10-15 seconds; the identity tag stays pinned in the corner the whole video.',
   'Identity-targeted hooks dramatically out-perform generic hooks because the viewer self-selects in the first second — everyone else scrolls, but the target audience locks in.',
   '["If you''re a local service business still answering DMs manually, stop — automate the first response.","If you''re a coach taking notes by hand on calls, stop — let an AI transcribe and tag them.","If you''re a small business using a spreadsheet as a CRM, stop — GHL''s free tier is enough."]'),

  ('mtm', 'devin_jatho_pattern', NULL,
   'Skit setup',
   'Cold-open into a 2-character scene (boss vs. employee, founder vs. client, etc.); the conflict is the business lesson; lands with one cutting line that doubles as the takeaway.',
   '20-35 seconds; cut between characters every 3-5 seconds to keep pace.',
   'Narrative engages a different brain region than direct teaching; the lesson lands harder because the viewer earns it by laughing.',
   '["Founder vs. founder: one is drowning in admin, the other shows the GHL dashboard that runs it.","Business owner vs. AI assistant: owner argues with it, assistant calmly books the appointment anyway.","Old-school marketer vs. new-school: paper invoices vs. instant-pay link — the punchline is the speed gap."]'),

  ('mtm', 'universal_shortform', NULL,
   'Numbered list',
   'Title-card hook ("3 things every [target] needs to know about [topic]"), then count down with one frame per item, each item on screen 2-4 seconds.',
   '15-25 seconds total; on-screen numbers ascend visually so the viewer feels progress.',
   'Numbered lists set retention expectations — viewers stay for the count. Works because the brain wants closure on enumerated sequences.',
   '["3 GHL automations every small business should turn on today.","3 things every solo founder is wasting time on right now.","3 lead-source signals that predict whether a prospect will actually close."]'),

  ('mtm', 'educational_vertical', NULL,
   'Behind-the-scenes reveal',
   'Opens with "Here''s what nobody tells you about [topic]" over a static or process shot, then walks through one specific non-obvious detail that practitioners know.',
   '20-30 seconds; uses one continuous take to feel authentic rather than produced.',
   'Insider framing triggers parasocial trust — the viewer feels they''re being let in on something, which raises perceived value and shareability.',
   '["Here''s what nobody tells you about running a coaching business: the calendar is your real product.","Here''s what nobody tells you about cold outreach: the second message converts 3x the first.","Here''s what nobody tells you about AI tools: setup time is 90% of the value, runtime is the easy part."]'),

  ('mtm', 'business_education_vertical', NULL,
   'Stat punch',
   'Drops a specific, surprising number in the first second ("87% of small businesses…"), then unpacks the why over the next 10-20 seconds, ends on the action.',
   '12-20 seconds; the stat itself is sticky text that never leaves the frame.',
   'A specific number signals research, which signals authority. Pairing it with an actionable conclusion converts the authority into utility.',
   '["73% of inbound leads don''t hear back in the first hour — here''s the 5-minute fix.","Small businesses leave $14B/yr on the table by not following up — one workflow recovers most of it.","60% of service-business owners can''t name their top lead source — fix it with one GHL dashboard."]'),

  ('mtm', 'universal_pattern', NULL,
   'Comparison',
   'Head-to-head split-screen of two approaches/tools/behaviors, scored on 3-4 criteria visible on screen, with a clear declared winner at the end.',
   '15-25 seconds; the split-screen format makes the contrast immediately legible without narration.',
   'Comparisons feel like decisions being made for the viewer — lower cognitive cost, higher trust because the verdict feels earned by the visible criteria.',
   '["Manual lead tracking vs. GHL pipeline — speed, accuracy, cost.","Hiring a VA vs. automating with AI for first-response — three scenarios where each wins.","Building a website from scratch vs. using MTM''s generator — time, polish, ongoing cost."]'),

  ('mtm', 'lifestyle_business_overlap', NULL,
   'Day-in-the-life',
   'Time-stamped sequence (6am, 9am, 1pm…) of the founder''s actual day, but each timestamp carries a business takeaway in the caption — not just "ran 5k", but "ran 5k because the calendar is empty before 9am on purpose".',
   '25-40 seconds; one cut per timestamp, no dwell.',
   'Pairs the parasocial appeal of lifestyle content with a teach, so the algorithm reads it as both entertainment and education — best of both feeds.',
   '["MTM founder''s Tuesday: every block is intentional, here''s why.","Solo-founder day: how I batch content + client work into 4 hours.","Behind a content day: from raw clips at 7am to scheduled posts by 5pm."]'),

  ('mtm', 'hook_craft_fundamental', NULL,
   'Question hook',
   'Opens with a direct closed-form question the viewer cannot help mentally answering ("Do you actually know your cost per lead?"), then delivers the answer/teach.',
   '10-18 seconds; the question is on screen as text for the first 2 seconds so silent viewers still engage.',
   'A question creates an open loop in the viewer''s mind — they have to stay through the payoff to close it. Best when the question feels personal, not rhetorical.',
   '["Do you actually know your cost per lead? Most owners are off by 40%.","When was the last time you audited your follow-up sequence? Here''s a 2-minute one.","Could your business survive a week without you touching it? Here''s the test."]');
