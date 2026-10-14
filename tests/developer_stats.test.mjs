import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addDays,
  addMonthsClamped,
  computeMetrics,
  dateInTimeZone,
  getReportWindow,
  preserveOrMarkUnavailable,
  renderRadarPairSvg,
  renderStackSvg,
  renderStatsSvg,
  renderUnavailableStatsSvg,
  zonedMidnightAsUtc,
} from '../scripts/generate_stack_signals.mjs';

const config = JSON.parse(readFileSync(new URL('../profile/stack-signals.config.json', import.meta.url), 'utf8'));
const profileReadme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

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
  const stack = renderStackSvg('dark', config);
  assert.match(stack, /MY PERFECT STACK/);
  assert.doesNotMatch(stack, /PRODUCT &amp; FRONTEND ENGINEERING|PLATFORM, DATA &amp; AUTOMATION/);
  assert.equal((stack.match(/<svg x="/g) ?? []).length, 16);
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

test('README places stack, Developer Signals, radar pair, and snake in the requested order', () => {
  const snakeIndex = profileReadme.indexOf('<!-- ===== CONTRIBUTION SNAKE ===== -->');
  const itachiIndex = profileReadme.indexOf('https://github.com/dpsychoo/Itachi_SGODX');
  const projectIndex = profileReadme.indexOf('<!-- ===== PROJECTS ===== -->');
  const githubStatsIndex = profileReadme.indexOf('<!-- ===== GITHUB STATS ===== -->');
  const stackIndex = profileReadme.indexOf('<!-- ===== STACK & SIGNALS ===== -->');
  const developerSignalsIndex = profileReadme.indexOf('profile/developer-stats-dark.svg');
  const radarIndex = profileReadme.indexOf('profile/radar-pair-narrow-dark.svg');
  const radarEnd = profileReadme.indexOf('</p>', radarIndex) + '</p>'.length;
  const socialIndex = profileReadme.indexOf('<!-- ===== SOCIAL BADGES ===== -->');

  assert.ok(projectIndex < itachiIndex && itachiIndex < githubStatsIndex);
  assert.ok(githubStatsIndex < stackIndex && stackIndex < developerSignalsIndex);
  assert.ok(developerSignalsIndex < radarIndex && radarIndex < snakeIndex && snakeIndex < socialIndex);
  assert.equal(profileReadme.slice(radarEnd, snakeIndex).trim(), '');
  const radarPictureStart = profileReadme.lastIndexOf('<picture>', radarIndex);
  const radarPictureEnd = profileReadme.indexOf('</picture>', radarIndex) + '</picture>'.length;
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
  const svg = renderStackSvg('dark', config);
  assert.equal((svg.match(/<svg x="/g) ?? []).length, 16);
  assert.match(svg, /viewBox="0 0 24 24"[^>]*fill="none" stroke="currentColor"/);
  assert.doesNotMatch(svg, />(?:TS|JS|WG|API|PG|GH|VS)<\/text>/);
  assert.doesNotMatch(svg, /(?:href|xlink:href)=/i);
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

test('API failure preserves existing stats and marks missing themes unavailable', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'sgodx-profile-stats-test-'));
  try {
    const darkPath = path.join(outputDir, 'developer-stats-dark.svg');
    const lightPath = path.join(outputDir, 'developer-stats-light.svg');
    const lastValidDark = '<svg xmlns="http://www.w3.org/2000/svg"><title>last valid stats</title></svg>\n';
    await writeFile(darkPath, lastValidDark, 'utf8');

    const changed = await preserveOrMarkUnavailable(outputDir, 'America/Santiago');
    assert.deepEqual(changed, [lightPath]);
    assert.equal(await readFile(darkPath, 'utf8'), lastValidDark);
    assert.match(await readFile(lightPath, 'utf8'), /DATA UNAVAILABLE/);
  } finally {
    const resolved = path.resolve(outputDir);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`), 'cleanup target must remain under the OS temp directory');
    await rm(resolved, { recursive: true, force: true });
  }
});
