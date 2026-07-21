# Benchmark prompts (give each verbatim to the AI tool, then save its output)

Each prompt ends with: **"It must render correctly in Arabic (right-to-left)."**

1. A login form (email, password, submit) with a "Back" link.
2. A product card: image, title, price, an "Add to cart" button, a heart icon.
3. A top navigation bar with a logo on the leading side and menu items on the trailing side.
4. A pricing table with three tiers and check/cross feature icons.
5. A chat message list with sender avatars and timestamps.
6. A sidebar with collapsible sections and chevron icons.
7. A breadcrumb trail with chevron separators.
8. A stats dashboard: 4 KPI cards with up/down arrows and numbers.
9. A settings page with labels on the leading side and toggles on the trailing side.
10. A date-range picker with a calendar and prev/next arrows.
11. A notification toast that slides in from the corner.
12. A file-upload dropzone with a progress bar.
13. A comment thread with reply/indent.
14. A checkout summary: item list, subtotal, currency, a "Place order" button.
15. A hero section with a headline, subtext, and a CTA that points forward.

Save outputs to `outputs/<tool>/<n>.tsx` (or `.css`), then run `node benchmark/score.js outputs`.
