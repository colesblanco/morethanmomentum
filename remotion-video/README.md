# MTM — AutomationDemo (Remotion)

A ~27-second 1080×1920 (9:16) Remotion composition that animates the More Than Momentum lead-automation pitch — opening logo → Cedar Grove form submit → notification cascade → calendar booking → stats → "Ready to build yours?" CTA → fade to black. Every scene includes a 15-frame entrance + 30-frame readable hold + 15-frame exit, and consecutive scenes overlap by 15 frames so they cross-fade with an upward slide instead of cutting.

- **Format:** 1080×1920 @ 30fps
- **Duration:** 27.23 seconds (817 frames)
- **Composition ID:** `AutomationDemo`
- **Stack:** Remotion 4 + React 18 + TypeScript (inline styles only — no Tailwind, no external CSS files)

## Brand palette

| Token          | Hex      |
| -------------- | -------- |
| Deep Black     | `#0C0C0C` |
| Rich Dark      | `#1A1A1A` |
| Card Border    | `#2A2A2A` |
| Power Blue     | `#2D6BE4` |
| Electric Blue  | `#5B8FF0` |
| Victory Yellow | `#F5C518` |
| Off-White      | `#F4F4F2` |

## Fonts

Loaded automatically by `@remotion/google-fonts` (no system install needed):

- **Barlow Condensed** — headlines, big numbers
- **Inter** — labels, UI text, body
- **Cormorant Garamond** (italic) — accent words ("broken.", "Ready to build yours?", "Form submitted.")

## Install

From this folder (`remotion-video/`):

```bash
npm install
```

## Preview in Remotion Studio

```bash
npm run preview
```

Open the URL Remotion prints (typically `http://localhost:3000`) and select **AutomationDemo** in the sidebar.

## Render

```bash
npm run render
```

Output: `out/AutomationDemo.mp4`.

Custom render flags:

```bash
# ProRes for editing handoff
npx remotion render src/Root.tsx AutomationDemo out/AutomationDemo.mov --codec=prores

# Render only a sub-range while iterating
npx remotion render src/Root.tsx AutomationDemo out/preview.mp4 --frames=0-180
```

## File structure

```
remotion-video/
├── package.json
├── README.md
└── src/
    ├── Root.tsx              ← Composition registration (817f / 30fps / 1080×1920)
    ├── AutomationDemo.tsx    ← Master composition (6 overlapping <Sequence> blocks)
    ├── theme.ts              ← Brand palette + Google font loading
    ├── transitions.ts        ← Cross-scene entrance + exit (opacity + translateY)
    └── scenes/
        ├── RunningMan.tsx    ← Shared MTM logo (used in Scene 01 + Scene 06)
        ├── Scene01.tsx       ← Opening logo + tagline
        ├── Scene02.tsx       ← Cedar Grove Plumbing phone form
        ├── Scene03.tsx       ← Notification cascade
        ├── Scene04.tsx       ← Calendar with 2:00 PM booked
        ├── Scene05.tsx       ← Stats reveal
        └── Scene06.tsx       ← "Ready to build yours?" CTA + fade
```

## Scene timeline

Each scene = 15f entrance transition → content animations → 30f readable hold → 15f exit transition. Consecutive scenes overlap by 15 frames so the exit of scene N and the entrance of scene N+1 cross-fade on the same frames (true cross-fade with upward slide, not a hard cut).

| Time band       | Global frames | Length | Scene file    | What's on screen |
| --------------- | ------------- | ------ | ------------- | ---------------- |
| 0–4.73s         | 0–142         | 142f   | `Scene01.tsx` | Running-man logo → Power Blue accent line → "MORE THAN MOMENTUM" → "What happens when a lead comes in?" → "A 60-second look" |
| 4.23–9.13s      | 127–274       | 147f   | `Scene02.tsx` | "THE MOMENT IT STARTS" → phone springs up showing Cedar Grove Plumbing form (Maria Alvarez / Leak repair · kitchen) → SEND REQUEST pulses → "Form submitted." |
| 8.63–13.43s     | 259–403       | 144f   | `Scene03.tsx` | "WHILE YOU WERE BUSY" → three cards cascade in from the right with count-up timestamps :00 / :47 / :60 |
| 12.93–17.93s    | 388–538       | 150f   | `Scene04.tsx` | "BOOKED. / AUTOMATICALLY." → March 2026 calendar → Thursday 26 highlighted → 2:00 PM "Discovery Call · Maria Alvarez" row slides in with checkmark → "NO MANUAL EFFORT" pill |
| 17.43–22.73s    | 523–682       | 159f   | `Scene05.tsx` | "BY THE NUMBERS" → 60 SEC → 100% (with pulsing Power Blue radial glow) → 0 — each number counts up with ease-out |
| 22.23–27.23s    | 667–817       | 150f   | `Scene06.tsx` | Mirror Scene 01 → "Ready to build yours?" → GET STARTED button springs in → morethanmomentum.com → fade to black (the cross-scene fade for Scene 06's exit is disabled; the existing `finalFade` handles the fade-to-black) |

Cross-fade windows (where two scenes render simultaneously):

| Crossfade           | Frames    | Time          |
| ------------------- | --------- | ------------- |
| Scene 01 → Scene 02 | 127–142   | 4.23–4.73s    |
| Scene 02 → Scene 03 | 259–274   | 8.63–9.13s    |
| Scene 03 → Scene 04 | 388–403   | 12.93–13.43s  |
| Scene 04 → Scene 05 | 523–538   | 17.43–17.93s  |
| Scene 05 → Scene 06 | 667–682   | 22.23–22.73s  |

## Animation conventions

- Spring physics use `{ damping: 12, mass: 0.5 }` as the default natural-feel preset (`SPRING_DEFAULT` in `theme.ts`). Scene 02's phone uses a heavier `{ damping: 16, mass: 1.4 }` so the device feels weighty as it slides up.
- All scene timings are local — each scene's `useCurrentFrame()` returns frames within its own `<Sequence>` window. Scene durations: 142 / 147 / 144 / 150 / 159 / 150. Scene `from` offsets (with 15-frame overlap): 0 / 127 / 259 / 388 / 523 / 667.
- Each scene file internally shifts its working `frame` by 15 (`const frame = Math.max(0, rawFrame - 15)`) so internal animations declared at scene-local frame 0 actually start *after* the entrance transition window closes. `rawFrame` is used only for the cross-scene transition computation in `transitions.ts`.
- All colors come from `COLORS` in `theme.ts`. All fonts come from `FONTS` in `theme.ts`. Do not hardcode hex values or font strings inside scene files.

## Notes

- This composition is **not yet embedded in the main site.** Render to MP4, then drop into `images/` or `videos/` and wire into `work.html` when ready.
- The running-man SVG in `scenes/RunningMan.tsx` is a stand-in approximation of the MTM logo built from primitives. Swap for the production SVG asset once it's available — keep the `size` / `color` prop contract.
