import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  addDays,
  addMonthsClamped,
  computeMetrics,
  dateInTimeZone,
  fetchCalendar,
  generate,
  generateDeveloperStats,
  getReportWindow,
  main,
  preserveLastValidStats,
  renderRadarPairSvg,
  renderStackSvg,
  renderStatsSvg,
  renderUnavailableStatsSvg,
  zonedMidnightAsUtc,
} from '../scripts/generate_stack_signals.mjs';

const config = JSON.parse(readFileSync(new URL('../profile/stack-signals.config.json', import.meta.url), 'utf8'));
const profileReadme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const manualWorkflow = readFileSync(new URL('../.github/workflows/developer-stats.yml', import.meta.url), 'utf8');
const existingStatsWorkflow = readFileSync(new URL('../.github/workflows/stats.yml', import.meta.url), 'utf8');
const publisherPath = new URL('../scripts/publish_developer_stats.mjs', import.meta.url);

function calendarFixture(startDate, asOfDate, counts = {}) {
  const days = [];
  for (let date = startDate; date <= asOfDate; date = addDays(date, 1)) {
    days.push({ date, contributionCount: counts[date] ?? 0 });
  }
  return {
    totalContributions: days.reduce((sum, day) => sum + day.contributionCount, 0),
    weeks: Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => ({
      contributionDays: days.slice(index * 7, (index + 1) * 7),
    })),
  };
}

function runGit(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args[0]} failed: ${result.stderr || result.stdout}`);
  return (result.stdout || '').trim();
}

async function createPublisherFixture() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sgodx-stats-publisher-test-'));
  const repoDir = path.join(tempRoot, 'worktree');
  const originDir = path.join(tempRoot, 'origin.git');
  const peerDir = path.join(tempRoot, 'peer');
  const statsDir = path.join(tempRoot, 'preview');
  await mkdir(repoDir, { recursive: true });
  await mkdir(statsDir, { recursive: true });
  runGit(tempRoot, 'init', '--bare', '--initial-branch=main', originDir);
  runGit(repoDir, 'init', '--initial-branch=main');
  runGit(repoDir, 'config', 'user.name', 'Stats test');
  runGit(repoDir, 'config', 'user.email', 'stats-test@example.invalid');

  for (const relativePath of [
    '.github/workflows/developer-stats.yml',
    'profile/stack-signals.config.json',
    'scripts/publish_developer_stats.mjs',
    'scripts/generate_stack_signals.mjs',
    'profile/developer-stats-dark.svg',
    'profile/developer-stats-light.svg',
    'README.md',
  ]) {
    const target = path.join(repoDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, relativePath.startsWith('profile/developer-stats-')
      ? `<svg xmlns="http://www.w3.org/2000/svg"><title>baseline ${relativePath}</title></svg>\n`
      : `baseline ${relativePath}\n`, 'utf8');
  }
  runGit(repoDir, 'add', '--all');
  runGit(repoDir, 'commit', '-m', 'baseline');
  const baseSha = runGit(repoDir, 'rev-parse', 'HEAD');
  runGit(repoDir, 'remote', 'add', 'origin', originDir);
  runGit(repoDir, 'push', '--set-upstream', 'origin', 'main');

  for (const name of ['developer-stats-dark.svg', 'developer-stats-light.svg']) {
    await writeFile(path.join(statsDir, name), `<svg xmlns="http://www.w3.org/2000/svg"><title>preview ${name}</title></svg>\n`, 'utf8');
  }
  return { tempRoot, repoDir, originDir, peerDir, statsDir, baseSha };
}

function runPublisher({ repoDir, statsDir, baseSha }) {
  return spawnSync(process.execPath, [
    fileURLToPath(publisherPath),
    '--repo-dir', repoDir,
    '--stats-dir', statsDir,
    '--base-sha', baseSha,
  ], { cwd: repoDir, encoding: 'utf8', windowsHide: true });
}

test('month clamping and day stepping handle leap dates', () => {
  assert.equal(addMonthsClamped('2024-02-29', -12), '2023-02-28');
  assert.equal(addMonthsClamped('2023-02-28', 12), '2024-02-28');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
});

test('the rolling report window contains exactly twelve calendar months', () => {
  assert.deepEqual(getReportWindow('2026-10-14'), {
    startDate: '2025-11-01',
    asOfDate: '2026-10-14',
    endDate: '2026-10-13',
  });
  assert.equal(getReportWindow('2024-03-15').startDate, '2023-04-01');
});

test('timezone conversion uses the configured zone rather than the host zone', () => {
  assert.equal(dateInTimeZone(new Date('2026-10-14T02:59:00Z'), 'America/Santiago'), '2026-10-13');
  assert.equal(dateInTimeZone(new Date('2026-10-14T03:00:00Z'), 'America/Santiago'), '2026-10-14');
  assert.equal(zonedMidnightAsUtc('2026-10-14', 'America/Santiago'), '2026-10-14T03:00:00.000Z');
});

test('completed-day metrics exclude an incomplete current date and aggregate leap day correctly', () => {
  const asOfDate = '2024-03-02';
  const windowStart = getReportWindow(asOfDate).startDate;
  const calendar = calendarFixture(windowStart, asOfDate, {
    '2024-02-27': 2,
    '2024-02-29': 3,
    '2024-03-01': 3,
    '2024-03-02': 8,
  });
  const metrics = computeMetrics(calendar, { asOfDate, windowStart });

  assert.equal(calendar.totalContributions, 16);
  assert.equal(metrics.totalContributions, 8);
  assert.equal(metrics.activeDays, 3);
  assert.equal(metrics.averagePerActiveDay, 8 / 3);
  assert.equal(metrics.currentStreak, 2);
  assert.equal(metrics.longestStreak, 2);
  assert.deepEqual(metrics.bestDay, { date: '2024-02-29', count: 3 });
  assert.equal(metrics.monthlyContributions.find(({ month }) => month === '2024-02').count, 5);
  assert.equal(metrics.monthlyContributions.find(({ month }) => month === '2024-03').count, 3);
  assert.equal(metrics.monthlyContributions.length, 12);
  assert.equal(metrics.endDate, '2024-03-01');
});

test('a zero-contribution day resets streaks; ties for best day use the earliest date', () => {
  const asOfDate = '2024-03-04';
  const windowStart = getReportWindow(asOfDate).startDate;
  const calendar = calendarFixture(windowStart, asOfDate, {
    '2024-03-01': 4,
    '2024-03-02': 0,
    '2024-03-03': 0,
    '2024-03-04': 7,
  });
  const metrics = computeMetrics(calendar, { asOfDate, windowStart });
  assert.equal(metrics.currentStreak, 0);
  assert.equal(metrics.longestStreak, 1);
  assert.deepEqual(metrics.bestDay, { date: '2024-03-01', count: 4 });
});

test('an all-zero calendar returns zero-safe averages and no best day', () => {
  const asOfDate = '2024-03-02';
  const windowStart = getReportWindow(asOfDate).startDate;
  const metrics = computeMetrics(calendarFixture(windowStart, asOfDate), { asOfDate, windowStart });
  assert.equal(metrics.totalContributions, 0);
  assert.equal(metrics.activeDays, 0);
  assert.equal(metrics.averagePerActiveDay, 0);
  assert.equal(metrics.currentStreak, 0);
  assert.equal(metrics.longestStreak, 0);
  assert.equal(metrics.bestDay, null);
  assert.ok(metrics.monthlyContributions.every(({ count }) => count === 0));
});

test('invalid, duplicate, missing, and inconsistent calendar data is rejected', () => {
  const asOfDate = '2024-03-02';
  const windowStart = getReportWindow(asOfDate).startDate;
  const valid = calendarFixture(windowStart, asOfDate, { '2024-03-01': 1 });

  const duplicate = structuredClone(valid);
  duplicate.weeks[0].contributionDays.push({ date: windowStart, contributionCount: 0 });
  assert.throws(() => computeMetrics(duplicate, { asOfDate, windowStart }), /duplicate contribution date/);

  const gap = structuredClone(valid);
  gap.weeks[0].contributionDays.pop();
  gap.totalContributions -= 0;
  assert.throws(() => computeMetrics(gap, { asOfDate, windowStart }), /do not cover/);

  const mismatch = structuredClone(valid);
  mismatch.totalContributions += 1;
  assert.throws(() => computeMetrics(mismatch, { asOfDate, windowStart }), /total mismatch/);

  const negative = structuredClone(valid);
  negative.weeks[0].contributionDays[0].contributionCount = -1;
  assert.throws(() => computeMetrics(negative, { asOfDate, windowStart }), /invalid contribution count/);
});

test('stack artwork is independent from the approved qualitative radar cards', () => {
  for (const layout of ['wide', 'narrow']) {
    const stack = renderStackSvg('dark', config, layout);
    assert.match(stack, /MY PERFECT STACK/);
    assert.doesNotMatch(stack, /radar|PRODUCT &amp; FRONTEND ENGINEERING|PLATFORM, DATA &amp; AUTOMATION/i);
    assert.equal((stack.match(/<svg x="/g) ?? []).length, 16);
  }
});

test('approved radars render qualitative classifications without score placeholders or external assets', () => {
  const svg = renderRadarPairSvg('dark', config, 'wide');
  assert.match(svg, /PRODUCT &amp; FRONTEND ENGINEERING/);
  assert.match(svg, /PLATFORM, DATA &amp; AUTOMATION/);
  assert.match(svg, />APPROVED</);
  assert.doesNotMatch(svg, /DRAFT|NO SCORES SET/);
  for (const label of ['CORE', 'SUPPORTING', 'EXPLORING', 'UNASSESSED']) assert.match(svg, new RegExp(label));
  assert.match(svg, /DISTANCE SHOWS FOCUS PRIORITY ONLY/);
  assert.match(svg, /NOT PROFICIENCY OR PERFORMANCE/);
  assert.doesNotMatch(svg, /data-focus-values="configured"/);
  assert.doesNotMatch(svg, /0.?100|GUIDE SCALE|SELF-ASSESSED FOCUS/);
  assert.doesNotMatch(svg, /<script\b|foreignObject|<image\b|(?:href|xlink:href)=/i);
  assert.throws(() => renderStackSvg('dark', {
    ...config,
    focusRadar: { ...config.focusRadar, status: 'DRAFT' },
  }), /invalid focus radar review status/);
});

test('wide radar cards are equal side by side and the narrow pair stacks at mobile width', () => {
  const wide = renderRadarPairSvg('dark', config, 'wide');
  assert.match(wide, /width="920" height="376" viewBox="0 0 920 376"/);
  assert.match(wide, /<rect x="16" y="16" width="428" height="344"/);
  assert.match(wide, /<rect x="476" y="16" width="428" height="344"/);

  const narrow = renderRadarPairSvg('light', config, 'narrow');
  assert.match(narrow, /width="328" height="736" viewBox="0 0 328 736"/);
  assert.match(narrow, /<rect x="0" y="16" width="328" height="344"/);
  assert.match(narrow, /<rect x="0" y="376" width="328" height="344"/);
  assert.match(narrow, />Responsive</);
  assert.match(narrow, />Interfaces</);
});

test('the wide stack is a compact landscape card and its narrow variant stacks categories', () => {
  const wide = renderStackSvg('dark', config, 'wide');
  assert.match(wide, /width="1000" height="292" viewBox="0 0 1000 292"/);
  assert.match(wide, /<rect x="16" y="12" width="968" height="268"/);
  assert.ok(1000 / 292 >= 2.5 && 1000 / 292 <= 3.5);
  assert.match(wide, /x="32" y="82"[^>]*>LANGUAGES &amp; INTERFACES</);
  assert.match(wide, /x="356" y="82"[^>]*>SERVICES &amp; DATA</);
  assert.match(wide, /x="680" y="82"[^>]*>DELIVERY &amp; TOOLS</);

  const narrow = renderStackSvg('light', config, 'narrow');
  assert.match(narrow, /width="460" height="390" viewBox="0 0 460 390"/);
  assert.match(narrow, /x="32" y="76"[^>]*>LANGUAGES &amp; INTERFACES</);
  assert.match(narrow, /x="32" y="188"[^>]*>SERVICES &amp; DATA</);
  assert.match(narrow, /x="32" y="300"[^>]*>DELIVERY &amp; TOOLS</);
});

test('README places the single radar pair and original snake after the intro note', () => {
  const snakeIndex = profileReadme.indexOf('<!-- ===== CONTRIBUTION SNAKE ===== -->');
  const itachiIndex = profileReadme.indexOf('https://github.com/dpsychoo/Itachi_SGODX');
  const projectIndex = profileReadme.indexOf('<!-- ===== PROJECTS ===== -->');
  const githubStatsIndex = profileReadme.indexOf('<!-- ===== GITHUB STATS ===== -->');
  const stackIndex = profileReadme.indexOf('<!-- ===== STACK & SIGNALS ===== -->');
  const developerSignalsIndex = profileReadme.indexOf('profile/developer-stats-dark.svg');
  const introNoteIndex = profileReadme.indexOf('Portfolio links document existing work; industry references describe future opportunities.');
  const radarIndex = profileReadme.indexOf('profile/radar-pair-narrow-dark.svg');
  const radarPictureStart = profileReadme.lastIndexOf('<picture>', radarIndex);
  const radarPictureEnd = profileReadme.indexOf('</picture>', radarIndex) + '</picture>'.length;
  const radarEnd = profileReadme.indexOf('</p>', radarIndex) + '</p>'.length;
  const socialIndex = profileReadme.indexOf('<!-- ===== SOCIAL BADGES ===== -->');

  assert.ok(introNoteIndex < radarIndex && radarIndex < snakeIndex && snakeIndex < projectIndex);
  assert.ok(projectIndex < itachiIndex && itachiIndex < githubStatsIndex);
  assert.ok(githubStatsIndex < stackIndex && stackIndex < developerSignalsIndex && developerSignalsIndex < socialIndex);
  const introNoteEnd = profileReadme.indexOf('</p>', introNoteIndex) + '</p>'.length;
  assert.match(profileReadme.slice(introNoteEnd, radarPictureStart), /^\s*<p align="center">\s*$/);
  assert.equal(profileReadme.slice(radarEnd, snakeIndex).trim(), '');
  assert.equal((profileReadme.match(/<!-- ===== CONTRIBUTION SNAKE ===== -->/g) ?? []).length, 1);
  const radarPicture = profileReadme.slice(radarPictureStart, radarPictureEnd);
  assert.ok(radarPictureStart >= 0 && radarPictureEnd > radarPictureStart);
  assert.doesNotMatch(profileReadme.replace(radarPicture, ''), /radar-pair-/);
  for (const asset of [
    'profile/stats-dark.svg',
    'profile/stats-light.svg',
    'profile/languages-dark.svg',
    'profile/languages-light.svg',
    'profile/stack-signals-dark.svg',
    'profile/stack-signals-light.svg',
    'profile/stack-signals-narrow-dark.svg',
    'profile/stack-signals-narrow-light.svg',
    'profile/radar-pair-dark.svg',
    'profile/radar-pair-light.svg',
    'profile/radar-pair-narrow-dark.svg',
    'profile/radar-pair-narrow-light.svg',
  ]) assert.ok(profileReadme.includes(asset), `README must reference ${asset}`);
  for (const asset of ['radar-pair-dark.svg', 'radar-pair-light.svg', 'radar-pair-narrow-dark.svg', 'radar-pair-narrow-light.svg']) {
    const sourceReference = `srcset="./profile/${asset}"`;
    assert.equal(profileReadme.split(sourceReference).length - 1, 1, `README must include ${sourceReference} once`);
  }
});

test('radar config uses only qualitative levels and carries the owner-approved focus', () => {
  const levels = new Set(['CORE', 'SUPPORTING', 'EXPLORING', 'UNASSESSED']);
  assert.equal(config.focusRadar.status, 'APPROVED');
  assert.ok(config.focusRadar.charts.every(({ axes }) => axes.length === 6));
  for (const axis of config.focusRadar.charts.flatMap(({ axes }) => axes)) {
    assert.ok(levels.has(axis.classification));
    assert.equal('value' in axis, false);
  }
  assert.deepEqual(config.focusRadar.charts.map(({ axes }) => axes.map(({ label, classification }) => [label, classification])), [
    [
      ['TypeScript', 'SUPPORTING'],
      ['React / UI Components', 'SUPPORTING'],
      ['Interface Engineering', 'CORE'],
      ['Responsive Interfaces', 'SUPPORTING'],
      ['Interactive Experiences', 'CORE'],
      ['Product Engineering', 'CORE'],
    ],
    [
      ['Backend / APIs', 'SUPPORTING'],
      ['PostgreSQL / Data', 'EXPLORING'],
      ['Supabase', 'SUPPORTING'],
      ['AI Integrations', 'SUPPORTING'],
      ['Automation', 'EXPLORING'],
      ['Cloud Deployment', 'SUPPORTING'],
    ],
  ]);
});

test('stack rows inline sixteen local technology icons with no text pills or remote loads', () => {
  for (const layout of ['wide', 'narrow']) {
    const svg = renderStackSvg('dark', config, layout);
    assert.equal((svg.match(/<svg x="/g) ?? []).length, 16);
    assert.match(svg, /viewBox="0 0 24 24"[^>]*fill="none" stroke="currentColor"/);
    assert.doesNotMatch(svg, />(?:TS|JS|WG|API|PG|GH|VS)<\/text>/);
    assert.doesNotMatch(svg, /(?:href|xlink:href)=/i);
  }
  assert.ok(config.stackGroups.flatMap(({ items }) => items).every(({ icon }) => typeof icon === 'string'));
});

test('statistics SVGs include accessible summary and explicit unavailable state', () => {
  const asOfDate = '2024-03-02';
  const windowStart = getReportWindow(asOfDate).startDate;
  const metrics = computeMetrics(calendarFixture(windowStart, asOfDate, { '2024-03-01': 2 }), { asOfDate, windowStart });
  const svg = renderStatsSvg('light', metrics, 'America/Santiago');
  assert.match(svg, /PUBLIC ONLY/);
  assert.match(svg, /TODAY EXCLUDED/);
  assert.match(svg, /active days 1/);
  assert.match(svg, /2 on Mar 1, 2024/);
  assert.match(svg, /<rect\b/);
  assert.doesNotMatch(svg, /<script\b|foreignObject|<image\b|(?:href|xlink:href)=/i);

  const unavailable = renderUnavailableStatsSvg('dark', 'America/Santiago');
  assert.match(unavailable, /DATA UNAVAILABLE/);
  assert.match(unavailable, /No statistics have been estimated or substituted/);
});

test('monthly contribution bars use GitHub-inspired greens in dark and light themes', () => {
  const asOfDate = '2024-03-04';
  const windowStart = getReportWindow(asOfDate).startDate;
  const calendar = calendarFixture(windowStart, asOfDate, {
    '2023-05-02': 1,
    '2023-10-05': 3,
    '2024-03-01': 6,
  });
  const metrics = computeMetrics(calendar, { asOfDate, windowStart });
  const expectedColors = ['#0E4429', '#26A641', '#39D353'];

  for (const theme of ['dark', 'light']) {
    const svg = renderStatsSvg(theme, metrics, 'America/Santiago');
    const chart = svg.slice(svg.indexOf('CONTRIBUTIONS / MONTH'));
    const barColors = [...chart.matchAll(/<rect\b(?=[^>]*opacity="0\.92")[^>]*fill="(#[0-9A-F]{6})"/g)]
      .map(([, color]) => color);
    assert.deepEqual([...new Set(barColors)].sort(), [...expectedColors].sort());
    assert.match(svg, /PUBLIC ONLY/);
    assert.match(svg, /TODAY EXCLUDED/);
  }
});

test('GraphQL calendar requests use the configured login, timezone boundary, and bearer token', async () => {
  const previousToken = process.env.GITHUB_TOKEN;
  const previousGhToken = process.env.GH_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token-never-printed';
  delete process.env.GH_TOKEN;
  const asOfDate = '2024-03-02';
  const now = new Date('2024-03-02T06:00:00.000Z');
  const range = getReportWindow(asOfDate);
  const fixture = calendarFixture(range.startDate, asOfDate, { '2024-03-01': 2 });

  try {
    const calendar = await fetchCalendar(config, range, now, async (url, init) => {
      assert.equal(url, 'https://api.github.com/graphql');
      assert.equal(init.headers.Authorization, 'Bearer test-token-never-printed');
      const request = JSON.parse(init.body);
      assert.match(request.query, /contributionCalendar/);
      assert.deepEqual(request.variables, {
        login: 'dpsychoo',
        from: zonedMidnightAsUtc(range.startDate, config.reportingTimeZone),
        to: now.toISOString(),
      });
      return { ok: true, json: async () => ({ data: { user: { contributionsCollection: { contributionCalendar: fixture } } } }) };
    });
    assert.equal(calendar.totalContributions, 2);
  } finally {
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
    if (previousGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGhToken;
  }
});

test('GraphQL authentication and permission failures are distinguished from API failures', async () => {
  const previousToken = process.env.GITHUB_TOKEN;
  const previousGhToken = process.env.GH_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token-never-printed';
  delete process.env.GH_TOKEN;
  const range = getReportWindow('2024-03-02');
  try {
    await assert.rejects(
      fetchCalendar(config, range, new Date('2024-03-02T06:00:00.000Z'), async () => ({ ok: false, status: 403 })),
      (error) => error.kind === 'authentication' && /HTTP 403/.test(error.message),
    );
  } finally {
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
    if (previousGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGhToken;
  }
});

test('API and invalid-data failures do not overwrite existing Developer Stats', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'sgodx-profile-stats-only-test-'));
  try {
    const darkPath = path.join(outputDir, 'developer-stats-dark.svg');
    const lightPath = path.join(outputDir, 'developer-stats-light.svg');
    const lastValidDark = '<svg xmlns="http://www.w3.org/2000/svg"><title>last dark</title></svg>\n';
    const lastValidLight = '<svg xmlns="http://www.w3.org/2000/svg"><title>last light</title></svg>\n';
    await writeFile(darkPath, lastValidDark, 'utf8');
    await writeFile(lightPath, lastValidLight, 'utf8');

    await assert.rejects(
      generateDeveloperStats({
        outputDir,
        config,
        now: new Date('2024-03-02T06:00:00.000Z'),
        fetcher: async () => { throw new Error('simulated network failure'); },
      }),
      (error) => error.kind === 'api' && /GraphQL request failed/.test(error.message),
    );
    assert.equal(await readFile(darkPath, 'utf8'), lastValidDark);
    assert.equal(await readFile(lightPath, 'utf8'), lastValidLight);

    const asOfDate = '2024-03-02';
    const range = getReportWindow(asOfDate);
    const invalidCalendar = calendarFixture(range.startDate, asOfDate, { '2024-03-01': 1 });
    invalidCalendar.totalContributions += 1;
    await assert.rejects(
      generateDeveloperStats({
        outputDir,
        config,
        now: new Date('2024-03-02T06:00:00.000Z'),
        fetcher: async () => invalidCalendar,
      }),
      (error) => error.kind === 'data' && /Invalid contribution data/.test(error.message),
    );
    assert.equal(await readFile(darkPath, 'utf8'), lastValidDark);
    assert.equal(await readFile(lightPath, 'utf8'), lastValidLight);
  } finally {
    const resolved = path.resolve(outputDir);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), 'cleanup target must remain under the OS temp directory');
    await rm(resolved, { recursive: true, force: true });
  }
});

test('stats-only generation writes exactly two deterministic Developer Stats SVGs', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'sgodx-profile-stats-only-generation-test-'));
  const asOfDate = '2024-03-02';
  const range = getReportWindow(asOfDate);
  const calendar = calendarFixture(range.startDate, asOfDate, { '2024-03-01': 2 });
  const now = new Date('2024-03-02T06:00:00.000Z');
  try {
    const first = await generate({ outputDir, config, now, fetcher: async () => calendar, statsOnly: true });
    const files = (await readdir(outputDir)).sort();
    assert.deepEqual(files, ['developer-stats-dark.svg', 'developer-stats-light.svg']);
    assert.equal(first.changed.length, 2);
    const before = await Promise.all(files.map((file) => readFile(path.join(outputDir, file), 'utf8')));

    const second = await generate({ outputDir, config, now, fetcher: async () => calendar, statsOnly: true });
    const after = await Promise.all(files.map((file) => readFile(path.join(outputDir, file), 'utf8')));
    assert.deepEqual(second.changed, []);
    assert.deepEqual(after, before);
  } finally {
    const resolved = path.resolve(outputDir);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), 'cleanup target must remain under the OS temp directory');
    await rm(resolved, { recursive: true, force: true });
  }
});

test('strict stats-only CLI fails on API errors without creating fallback cards or stack assets', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'sgodx-profile-strict-api-test-'));
  const previousToken = process.env.GITHUB_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.GITHUB_TOKEN = 'test-token-never-printed';
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    const result = await main(['--stats-only', '--strict-api', '--output-dir', outputDir]);
    assert.equal(result, 1);
    assert.deepEqual(await readdir(outputDir), []);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
    const resolved = path.resolve(outputDir);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), 'cleanup target must remain under the OS temp directory');
    await rm(resolved, { recursive: true, force: true });
  }
});

test('API failure preserves valid SVGs and leaves missing themes unwritten', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'sgodx-profile-stats-test-'));
  try {
    const darkPath = path.join(outputDir, 'developer-stats-dark.svg');
    const lightPath = path.join(outputDir, 'developer-stats-light.svg');
    const lastValidDark = '<svg xmlns="http://www.w3.org/2000/svg"><title>last valid stats</title></svg>\n';
    await writeFile(darkPath, lastValidDark, 'utf8');

    await preserveLastValidStats(outputDir);
    assert.equal(await readFile(darkPath, 'utf8'), lastValidDark);
    await assert.rejects(readFile(lightPath, 'utf8'), { code: 'ENOENT' });
  } finally {
    const resolved = path.resolve(outputDir);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), 'cleanup target must remain under the OS temp directory');
    await rm(resolved, { recursive: true, force: true });
  }
});

test('daily and manual automation enforce the three-case publication matrix', () => {
  assert.match(manualWorkflow, /^on:\s*\n\s+schedule:\s*\n\s+- cron: "29 3 \* \* \*"\s*\n\s+timezone: "America\/Santiago"/m);
  assert.match(manualWorkflow, /^\s+workflow_dispatch:/m);
  assert.match(manualWorkflow, /publish:[\s\S]*?type: boolean[\s\S]*?default: false/);
  const verifyJob = manualWorkflow.split(/\r?\n  verify:\r?\n/)[1].split(/\r?\n  publish:\r?\n/)[0];
  const publishJob = manualWorkflow.split(/\r?\n  publish:\r?\n/)[1];
  assert.match(verifyJob, /permissions:\s*\r?\n\s+contents: read/);
  assert.doesNotMatch(verifyJob, /contents: write/);
  assert.match(verifyJob, /github\.event_name == 'schedule'/);
  assert.match(verifyJob, /github\.event_name == 'workflow_dispatch' && inputs\.publish == true/);
  assert.match(publishJob, /needs\.verify\.result == 'success'/);
  assert.match(publishJob, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publishJob, /github\.event_name == 'schedule'/);
  assert.match(publishJob, /github\.event_name == 'workflow_dispatch' && inputs\.publish == true/);
  assert.match(publishJob, /permissions:\s*\r?\n\s+contents: write/);

  const eligible = ({ event, publish, branch, verified }) => verified
    && branch === 'main'
    && (event === 'schedule' || (event === 'workflow_dispatch' && publish === true));
  assert.equal(eligible({ event: 'workflow_dispatch', publish: false, branch: 'main', verified: true }), false);
  assert.equal(eligible({ event: 'workflow_dispatch', publish: true, branch: 'main', verified: true }), true);
  assert.equal(eligible({ event: 'workflow_dispatch', publish: true, branch: 'feature', verified: true }), false);
  assert.equal(eligible({ event: 'schedule', branch: 'main', verified: true }), true);
  assert.equal(eligible({ event: 'schedule', branch: 'feature', verified: true }), false);
  assert.equal(eligible({ event: 'schedule', branch: 'main', verified: false }), false);
  assert.equal(eligible({ event: 'workflow_dispatch', publish: true, branch: 'main', verified: false }), false);

  assert.match(manualWorkflow, /--stats-only[\s\S]*?--strict-api/);
  assert.match(manualWorkflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(manualWorkflow, /actions\/setup-node@v7\.1\.0[\s\S]*?node-version: 24/);
  assert.match(manualWorkflow, /actions\/checkout@v7\.0\.1/);
  assert.match(manualWorkflow, /actions\/upload-artifact@v7\.0\.2/);
  assert.match(manualWorkflow, /actions\/download-artifact@v8\.0\.2/);
  assert.match(manualWorkflow, /scripts\/publish_developer_stats\.mjs/);
  assert.match(manualWorkflow, /group: profile-main-generated-assets[\s\S]*?queue: max/);
  assert.match(existingStatsWorkflow, /group: profile-main-generated-assets[\s\S]*?queue: max/);
  assert.doesNotMatch(manualWorkflow, /--force|--force-with-lease/);
});

test('publisher fast-forwards unrelated main changes, commits only two SVGs, and skips identical output', async () => {
  const fixture = await createPublisherFixture();
  try {
    runGit(fixture.tempRoot, 'clone', fixture.originDir, fixture.peerDir);
    runGit(fixture.peerDir, 'config', 'user.name', 'Concurrent workflow');
    runGit(fixture.peerDir, 'config', 'user.email', 'concurrent@example.invalid');
    await writeFile(path.join(fixture.peerDir, 'README.md'), 'unrelated main update\n', 'utf8');
    runGit(fixture.peerDir, 'add', '--', 'README.md');
    runGit(fixture.peerDir, 'commit', '-m', 'unrelated main update');
    runGit(fixture.peerDir, 'push', 'origin', 'main');

    const publish = runPublisher(fixture);
    assert.equal(publish.status, 0, publish.stderr || publish.stdout);
    runGit(fixture.repoDir, 'fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    assert.equal(runGit(fixture.repoDir, 'show', 'refs/remotes/origin/main:README.md'), 'unrelated main update');
    assert.match(runGit(fixture.repoDir, 'show', 'refs/remotes/origin/main:profile/developer-stats-dark.svg'), /preview developer-stats-dark/);
    const commitPaths = runGit(fixture.repoDir, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'refs/remotes/origin/main')
      .split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(commitPaths, ['profile/developer-stats-dark.svg', 'profile/developer-stats-light.svg']);

    const publishedSha = runGit(fixture.repoDir, 'rev-parse', 'refs/remotes/origin/main');
    const noOp = runPublisher({ ...fixture, baseSha: publishedSha });
    assert.equal(noOp.status, 0, noOp.stderr || noOp.stdout);
    runGit(fixture.repoDir, 'fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    assert.equal(runGit(fixture.repoDir, 'rev-parse', 'refs/remotes/origin/main'), publishedSha);
    assert.match(noOp.stdout, /no commit is needed/);
  } finally {
    const resolved = path.resolve(fixture.tempRoot);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), 'cleanup target must remain under the OS temp directory');
    await rm(resolved, { recursive: true, force: true });
  }
});

test('publisher refuses to overwrite a Developer Stats SVG changed after verification', async () => {
  const fixture = await createPublisherFixture();
  try {
    runGit(fixture.tempRoot, 'clone', fixture.originDir, fixture.peerDir);
    runGit(fixture.peerDir, 'config', 'user.name', 'Concurrent workflow');
    runGit(fixture.peerDir, 'config', 'user.email', 'concurrent@example.invalid');
    const changedDark = '<svg xmlns="http://www.w3.org/2000/svg"><title>newer valid stats</title></svg>\n';
    await writeFile(path.join(fixture.peerDir, 'profile/developer-stats-dark.svg'), changedDark, 'utf8');
    runGit(fixture.peerDir, 'add', '--', 'profile/developer-stats-dark.svg');
    runGit(fixture.peerDir, 'commit', '-m', 'concurrent stats update');
    runGit(fixture.peerDir, 'push', 'origin', 'main');

    const publish = runPublisher(fixture);
    assert.equal(publish.status, 1);
    assert.match(publish.stderr, /Git conflict: a Developer Stats SVG changed on main/);
    runGit(fixture.repoDir, 'fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    assert.equal(runGit(fixture.repoDir, 'show', 'refs/remotes/origin/main:profile/developer-stats-dark.svg'), changedDark.trimEnd());
    assert.equal(runGit(fixture.repoDir, 'rev-parse', 'refs/remotes/origin/main'), runGit(fixture.peerDir, 'rev-parse', 'HEAD'));
  } finally {
    const resolved = path.resolve(fixture.tempRoot);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), 'cleanup target must remain under the OS temp directory');
    await rm(resolved, { recursive: true, force: true });
  }
});

test('publisher safely rebases and retries once after a non-fast-forward race', async () => {
  const fixture = await createPublisherFixture();
  try {
    runGit(fixture.tempRoot, 'clone', fixture.originDir, fixture.peerDir);
    runGit(fixture.peerDir, 'config', 'user.name', 'Concurrent workflow');
    runGit(fixture.peerDir, 'config', 'user.email', 'concurrent@example.invalid');
    await writeFile(path.join(fixture.peerDir, 'README.md'), 'concurrent push during publication\n', 'utf8');

    const hookPath = path.join(fixture.repoDir, '.git/hooks/pre-push');
    const peerPosixPath = fixture.peerDir.replaceAll('\\', '/');
    const flagPosixPath = path.join(fixture.repoDir, '.git/stats-race-handled').replaceAll('\\', '/');
    await writeFile(hookPath, `#!/bin/sh
set -eu
if [ ! -f '${flagPosixPath}' ]; then
  git -C '${peerPosixPath}' add -- README.md
  git -C '${peerPosixPath}' commit -m 'concurrent push during publication'
  git -C '${peerPosixPath}' push origin main
  touch '${flagPosixPath}'
fi
`, 'utf8');
    await chmod(hookPath, 0o755);

    const publish = runPublisher(fixture);
    assert.equal(publish.status, 0, publish.stderr || publish.stdout);
    assert.match(publish.stdout, /Published only profile\/developer-stats-dark\.svg and profile\/developer-stats-light\.svg/);
    runGit(fixture.repoDir, 'fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main');
    assert.equal(runGit(fixture.repoDir, 'show', 'refs/remotes/origin/main:README.md'), 'concurrent push during publication');
    assert.match(runGit(fixture.repoDir, 'show', 'refs/remotes/origin/main:profile/developer-stats-light.svg'), /preview developer-stats-light/);
    const commitPaths = runGit(fixture.repoDir, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'refs/remotes/origin/main')
      .split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(commitPaths, ['profile/developer-stats-dark.svg', 'profile/developer-stats-light.svg']);
  } finally {
    const resolved = path.resolve(fixture.tempRoot);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), 'cleanup target must remain under the OS temp directory');
    await rm(resolved, { recursive: true, force: true });
  }
});
