# STACK & SIGNALS

This section uses small, stacked SVG panels. GitHub README HTML does not provide a reliable responsive grid across desktop and mobile, so the panels stay readable in one column instead of shrinking radar labels into a two-column layout.

## Evidence and scope

The stack labels are backed by the public profile and project materials:

- [`projects.json`](../projects.json) lists Astro, React, Supabase, JavaScript, WebGL, and Canvas.
- [`generate_hero.py`](../scripts/generate_hero.py) contains the profile's declared TypeScript, JavaScript, React, Astro, Node.js, Express, REST API, PostgreSQL, Supabase, Vercel, GitHub Actions, Git, and VS Code stack.
- The [public SGX VI case study](https://github.com/dpsychoo/gta-vi-generator-showcase) documents TypeScript, React, Astro, Supabase, OpenAI, Mercado Pago, Resend, and Vercel in the product context.
- The existing profile workflows are direct evidence of GitHub Actions usage.

Tailwind CSS and other unsupported or speculative tools are omitted. Stack names are evidence of documented project use, not proficiency scores.

Stack cards use local brand SVGs at [`profile/stack-icons/`](../profile/stack-icons/) with consistent 20-pixel badge sizing. Devicon 2.17.0 supplies the language, framework, database, delivery, Git, and editor marks; WebGL and OpenAI use their official marks; Canvas and REST APIs use original local pictograms. Source links, license notices, and trademark notes are in [`SOURCES.md`](../profile/stack-icons/SOURCES.md). The generator inlines the local SVG paths, with no runtime icon requests, remote fonts, JavaScript, or `foreignObject` elements.

The monthly contribution bars use green levels inspired by GitHub's contribution palette: `#0E4429`, `#26A641`, and `#39D353`. The chart's layout, labels, grid, public-only label, and reporting notes remain unchanged.

## Qualitative focus radar methodology

The two charts show owner-approved descriptions of professional focus. Public project documentation informs the categories where it is available, but it does not independently verify the owner's self-description or the private SGX VI implementation. The visible legend defines CORE as primary current focus, SUPPORTING as complementary documented work, EXPLORING as a developing or future area, and UNASSESSED as an area without enough information to assign a focus category.

Radial distance encodes categorical focus priority: CORE is outermost, SUPPORTING is in the middle, and EXPLORING is innermost. UNASSESSED dimensions have no plotted point. The `RADAR_FOCUS_RADII` constants in the generator are display coordinates for these category positions; they are not configured scores, percentages, measurements, or skill metrics. The radars are not scientifically validated and do not measure proficiency, performance, seniority, certification, or years of experience. The owner approved the displayed classifications.

The README includes a text explanation, and the SVG title and description carry accessible context. The [dimension-by-dimension evidence notes](radar-evidence.md) distinguish the approved self-description from public evidence and document its limits.
## Contribution statistics

The generator requests only `date` and `contributionCount` from `user(login: "dpsychoo").contributionsCollection.contributionCalendar`, plus `totalContributions` to validate the day rows. It does not request contribution records, repository names, or private source details. The query does not request private contributions. GitHub documents private and internal contributions as requiring the optional `read:user` scope; the available local GitHub CLI token did not have that scope, and the public calendar query succeeded.

The report covers twelve calendar months, from the first day of the month eleven months before the current reporting month through the latest complete day. The reporting timezone is `America/Santiago`; date-only calendar values are not converted through the runner's local timezone. The in-progress current date is excluded. The report labels this completed-day cutoff.

- **Current streak** counts consecutive active dates ending at the latest completed date.
- **Longest streak** is the longest consecutive run inside the displayed window.
- **Active day** means one or more public contributions on that calendar date.
- **Average** is public contributions divided by active days; it is zero when there are no active days.
- **Best day** is the completed date with the largest contribution count; ties resolve to the earliest date.
- **Monthly bars** sum the same completed-day data. The current month is necessarily partial.

The generated SVG is self-contained. Its `<title>` and `<desc>`, the README image alt text, and the visible methodology paragraph provide text context. The image panels are not the only explanation of what the figures mean.

## API, failure behavior, and manual generation

The live GraphQL response was validated with the available `gh` CLI login for `2025-11-01` through `2026-10-14`: 348 date rows summed to the API total of 26, including 4 contributions on the still-open current date. The generated panel therefore reports 22 contributions through `2026-10-13`. No numbers are hardcoded in the generator.

The workflow `GITHUB_TOKEN` could not be exercised from this local shell. The inactive proposal in [`docs/proposals/developer-stats.workflow.yml`](proposals/developer-stats.workflow.yml) uses that token and only requests `contents: write` so it can update the two SVGs. It does not add a PAT. If the GraphQL request fails, valid existing stats SVGs are preserved; if none exist, the generator writes an explicit `DATA UNAVAILABLE` card. It never substitutes fabricated values.

With Node.js and an authenticated GitHub CLI session, regenerate locally:

```powershell
node scripts/generate_stack_signals.mjs --output-dir profile
node --test tests/developer_stats.test.mjs
```

For this checkout, open `.local-assets/profile-v4-preview/index.html` to inspect the dark and light panels at desktop and mobile viewport widths. The preview is ignored by Git and is not part of the published assets.
