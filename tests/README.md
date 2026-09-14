# Page-turn validation

Run `npm ci`, `npm test`, and `npm run build`.

The Node tests cover navigation order, stale queued work, failed renders,
interrupted animations, readiness timeouts, and swipe classification. They do
not simulate WebKit layout or iPhone touch delivery.

For component integration checks, start `npm run dev -- --host 127.0.0.1` and
open `/tests/reader.html`. Load either fixture, wait for its text, then select
**Run core checks**. Repeat for the other format. The harness uses the actual
reader components at a 390px viewport and reports results beside the reader.
Its EPUB has two chapters; its eight-page PDF includes a landscape page.
The harness and fixtures are outside the production build.

Before merging, run these on an actual iPhone in Safari and as a Home Screen PWA:

| Check | Expected result |
| --- | --- |
| EPUB next/previous and chapter boundary in both directions | Outgoing and incoming content remain painted throughout the slide |
| Rapid forward/back taps | Exactly one page per action, in order |
| PDF horizontal swipe and edge tap | One page turn after destination rendering; correct counter |
| Vertical drag on tall PDF; pan at zoom above 100% | Content scrolls/pans without changing pages |
| Pinch, interrupted swipe, or second finger | No accidental turn |
| Rotate while animating or waiting for rendering | Lands on a real page, preserves position, discards stale turns |
| Change font, margin, fit, zoom, or flow during a turn | Reflows at the settled logical position |
| Animation off; OS Reduce Motion on (including a live change) | No animated page turns; controls still work |
| Highlight, select, follow a link, then turn | Selection/highlights remain correctly aligned; no duplicate turns |
| Close/reopen at a chapter boundary or PDF page | Restores the last settled CFI/page |
| First/last page and long TOC jumps | No overshoot or empty destinations |
| Large PDF, mixed page sizes | Correct per-page fit and bounded canvas memory |

The implementation was checked against the installed epub.js 0.3.93 manager
source and these primary references:

- https://github.com/futurepress/epub.js#render-methods
- https://mozilla.github.io/pdf.js/examples/
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action

This change provides sliding page turns, not a paper-curl renderer.
