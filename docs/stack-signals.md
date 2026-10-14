# STACK & SIGNALS

The README uses standard `<picture>` and `<source media>` selection to load pre-rendered SVG assets without depending on CSS that GitHub may strip. The approved radar pair appears once, directly below the professional introduction note; its original Contribution Snake follows immediately. At widths of 768 pixels and above, the 920-pixel radar SVG places Product & Frontend Engineering beside Platform, Data & Automation. At 767 pixels and below, a 328-pixel radar SVG stacks the equal-height cards vertically and wraps longer axis labels for legibility. Dark and light variants are generated for both radar layouts.

The stack-only SVGs follow the GitHub statistics cards. The 1000x292 desktop variant (3.42:1) arranges all three technology categories horizontally. The 460x390 narrow variant stacks the categories while retaining two-column technology rows. Both variants contain the same sixteen local icons and readable labels; neither contains radar artwork. Dark and light variants are generated for both stack layouts.

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

The stack-only assets and four radar-pair assets are rendered from the same configuration. Radar classifications and card artwork are the same across themes and viewports; only theme colors, card positions, and narrow label wrapping vary. The charts are separate from both the stack artwork and the Developer Signals statistics card, so the README can place the single radar pair above the snake without duplicating it.
## Contribution statistics

The generator requests only `date` and `contributionCount` from `user(login: "dpsychoo").contributionsCollection.contributionCalendar`, plus `totalContributions` to validate the day rows. It does not request contribution records, repository names, or private source details. GitHub's [GraphQL schema documentation](https://docs.github.com/en/graphql/reference/users) states that contributions in private and internal repositories are included only with the optional `read:user` scope. The local GitHub CLI token did not have that scope, and the query succeeded. The workflow requests only repository `contents` permission and no `read:user` access.

The report covers twelve calendar months, from the first day of the month eleven months before the current reporting month through the latest complete day. The reporting timezone is `America/Santiago`; date-only calendar values are not converted through the runner's local timezone. The in-progress current date is excluded. The report labels this completed-day cutoff.

- **Current streak** counts consecutive active dates ending at the latest completed date.
- **Longest streak** is the longest consecutive run inside the displayed window.
- **Active day** means one or more public contributions on that calendar date.
- **Average** is public contributions divided by active days; it is zero when there are no active days.
- **Best day** is the completed date with the largest contribution count; ties resolve to the earliest date.
- **Monthly bars** sum the same completed-day data. The current month is necessarily partial.

The generated SVG is self-contained. Its `<title>` and `<desc>`, the README image alt text, and the visible methodology paragraph provide text context. The image panels are not the only explanation of what the figures mean.

## API, failure behavior, and manual generation

The live GraphQL query was validated from the local authenticated GitHub CLI session for `dpsychoo` and the reporting window beginning `2025-11-01`: the response returned 348 dates and the sum of the daily counts matched GitHub's calendar total. This check confirms the query and data validation with the local CLI credential; it does not test the separate Actions `GITHUB_TOKEN`. The public contribution total is not a measure of all professional development or work.

The active [`Developer Stats manual workflow`](../.github/workflows/developer-stats.yml) has only a `workflow_dispatch` trigger. It has no schedule. Its `publish` input defaults to false. The read-only verification job requests only `contents: read`, uses the job's `GITHUB_TOKEN` for the public GraphQL request, runs the tests, validates the response, generates the dark and light SVGs in a temporary directory, parses them as XML, and reports which files differ. A one-day Actions artifact contains those two preview SVGs. The workflow-token request has not yet been exercised: the task prohibits triggering Actions, so a manual dry run is still required to confirm that repository-level token settings permit this GraphQL query.

To run a read-only dry run, open the repository's **Actions** tab, select **Developer Stats (manual verification)**, choose **Run workflow**, and leave **Publish the two validated Developer Stats SVGs to main** unchecked. Review the job summary, preview artifact, and logs. The manual workflow does not claim the snapshot is current until a successful run completes.

To publish, start the workflow from `main` and explicitly check the `publish` input after reviewing the generated preview. The write-enabled job requests only `contents: write`; it can update only `profile/developer-stats-dark.svg` and `profile/developer-stats-light.svg`. It makes no commit when they are unchanged. Before publishing, it checks that the workflow's generation inputs and both target SVGs have not changed on `main` since verification. If unrelated commits arrive, it fast-forwards or safely rebases and retries one time. It stops on changed target files, changed generation inputs, non-descendant history, a rebase conflict, or a denied push. It never force-pushes, stages unrelated files, or retries indefinitely. Because the existing stats workflow also pushes to `main`, its write job and the Developer Stats publish job share a queued concurrency group; this prevents their commits from racing. The projects and snake workflows publish to separate branches. GitHub documents that pushes made with `GITHUB_TOKEN` do not trigger additional workflow runs, and this workflow has no `push` trigger in any case.

API, authentication/permission, invalid-data, generation, git-conflict, and push-permission failures are reported separately. Strict workflow generation writes only to the temporary preview directory. On failure it exits unsuccessfully and leaves the checked-in, last-valid SVGs untouched; it does not estimate values, publish empty cards, or write unavailable placeholders over the profile assets. No PAT or new secret is required. If repository or organization Actions policy restricts the requested write permission, the publish step will fail without force-pushing; inspect the failed job's summary and log in the **Actions** tab. The workflow can be disabled from the Actions workflow menu. A daily schedule is intentionally deferred until a successful manual run and separate approval.

For a local preview with Node.js 24 and an authenticated GitHub CLI session:

```powershell
node scripts/generate_stack_signals.mjs --stats-only --strict-api --output-dir .local-assets/developer-stats-preview
node --test tests/developer_stats.test.mjs
```

The temporary preview is ignored by Git and is not part of the published profile assets. The existing `.local-assets/profile-v4-preview/index.html` preview remains available for the dark and light Stack & Signals panels at desktop and mobile viewport widths.
