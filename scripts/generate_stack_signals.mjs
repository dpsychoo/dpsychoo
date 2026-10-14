#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const GRAPHQL_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

export const THEMES = {
  dark: {
    background: '#0A101F',
    panel: '#131D2C',
    panelAlt: '#172438',
    border: '#29364E',
    grid: '#34435D',
    text: '#F8FAFC',
    muted: '#94A3B8',
    quiet: '#64748B',
    cyan: '#22D3EE',
    purple: '#A78BFA',
    green: '#10B981',
    barMuted: '#334155',
    iconBadge: '#E2E8F0',
    iconBorder: '#CBD5E1',
    iconColor: '#0F172A',
    openAiIconColor: '#ACACBE',
    contributionLow: '#0E4429',
    contributionMid: '#26A641',
    contributionBright: '#39D353',
    contributionLowBorder: '#26A641',
    radarCore: '#22D3EE',
    radarSupporting: '#10B981',
    radarExploring: '#A78BFA',
    radarUnassessed: '#64748B',
  },
  light: {
    background: '#F8FAFC',
    panel: '#FFFFFF',
    panelAlt: '#F1F5F9',
    border: '#CBD5E1',
    grid: '#CBD5E1',
    text: '#0F172A',
    muted: '#475569',
    quiet: '#64748B',
    cyan: '#0891B2',
    purple: '#7C3AED',
    green: '#059669',
    barMuted: '#CBD5E1',
    iconBadge: '#F1F5F9',
    iconBorder: '#CBD5E1',
    iconColor: '#0F172A',
    openAiIconColor: '#8E8EA0',
    contributionLow: '#0E4429',
    contributionMid: '#26A641',
    contributionBright: '#39D353',
    contributionLowBorder: '#0E4429',
    radarCore: '#0891B2',
    radarSupporting: '#059669',
    radarExploring: '#7C3AED',
    radarUnassessed: '#64748B',
  },
};

const SVG_WIDTH = 460;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RADAR_LEVELS = ['CORE', 'SUPPORTING', 'EXPLORING', 'UNASSESSED'];
const RADAR_REVIEW_STATUSES = ['REVIEW', 'APPROVED'];
// Categorical display positions only; these radii are not skill scores or measured values.
const RADAR_FOCUS_RADII = {
  CORE: 0.9,
  SUPPORTING: 0.66,
  EXPLORING: 0.41,
};
const RADAR_LEVEL_COLORS = {
  CORE: 'radarCore',
  SUPPORTING: 'radarSupporting',
  EXPLORING: 'radarExploring',
  UNASSESSED: 'radarUnassessed',
};

export function parseDate(value) {
  if (typeof value !== 'string') throw new TypeError('date must be a YYYY-MM-DD string');
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new RangeError(`invalid date: ${value}`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new RangeError(`invalid date: ${value}`);
  }
  return { year, month, day };
}

export function formatDateParts({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(dateText, count) {
  const { year, month, day } = parseDate(dateText);
  const date = new Date(Date.UTC(year, month - 1, day + count));
  return formatDateParts({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

export function addMonthsClamped(dateText, count) {
  const { year, month, day } = parseDate(dateText);
  const monthIndex = year * 12 + (month - 1) + count;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return formatDateParts({ year: targetYear, month: targetMonth, day: Math.min(day, lastDay) });
}

export function getReportWindow(asOfDate) {
  const { year, month } = parseDate(asOfDate);
  const monthIndex = year * 12 + month - 1 - 11;
  const startYear = Math.floor(monthIndex / 12);
  const startMonth = ((monthIndex % 12) + 12) % 12 + 1;
  return {
    startDate: formatDateParts({ year: startYear, month: startMonth, day: 1 }),
    asOfDate,
    endDate: addDays(asOfDate, -1),
  };
}

function datePartsInZone(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const result = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second),
  };
}

export function dateInTimeZone(instant, timeZone) {
  const { year, month, day } = datePartsInZone(instant, timeZone);
  return formatDateParts({ year, month, day });
}

export function zonedMidnightAsUtc(dateText, timeZone) {
  const { year, month, day } = parseDate(dateText);
  const desiredWallTime = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = desiredWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = datePartsInZone(new Date(guess), timeZone);
    const observedWallTime = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = desiredWallTime - observedWallTime;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess).toISOString();
}

function datesInclusive(startDate, endDate) {
  if (startDate > endDate) return [];
  const dates = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function flattenCalendar(calendar) {
  if (!calendar || !Array.isArray(calendar.weeks)) throw new TypeError('response is missing contributionCalendar.weeks');
  if (!Number.isSafeInteger(calendar.totalContributions) || calendar.totalContributions < 0) {
    throw new TypeError('response has an invalid contributionCalendar.totalContributions');
  }
  const days = calendar.weeks.flatMap((week) => {
    if (!week || !Array.isArray(week.contributionDays)) throw new TypeError('response contains an invalid calendar week');
    return week.contributionDays.map((day) => {
      parseDate(day?.date);
      if (!Number.isSafeInteger(day.contributionCount) || day.contributionCount < 0) {
        throw new TypeError(`invalid contribution count for ${day.date}`);
      }
      return { date: day.date, count: day.contributionCount };
    });
  }).sort((left, right) => left.date.localeCompare(right.date));

  for (let index = 1; index < days.length; index += 1) {
    if (days[index - 1].date === days[index].date) throw new RangeError(`duplicate contribution date: ${days[index].date}`);
  }
  return days;
}

export function computeMetrics(calendar, { asOfDate, windowStart } = {}) {
  parseDate(asOfDate);
  parseDate(windowStart);
  const allDays = flattenCalendar(calendar);
  const rawTotal = allDays.reduce((sum, day) => sum + day.count, 0);
  if (rawTotal !== calendar.totalContributions) {
    throw new RangeError(`calendar total mismatch: days sum to ${rawTotal}, API reports ${calendar.totalContributions}`);
  }

  const expectedRawDates = datesInclusive(windowStart, asOfDate);
  if (allDays.length !== expectedRawDates.length || allDays.some((day, index) => day.date !== expectedRawDates[index])) {
    throw new RangeError(`calendar dates do not cover ${windowStart} through ${asOfDate} exactly`);
  }

  // The API's final calendar date is still in progress. Metrics deliberately stop the day before asOfDate.
  const days = allDays.filter((day) => day.date < asOfDate);
  const expectedCompleteDates = datesInclusive(windowStart, addDays(asOfDate, -1));
  if (days.length !== expectedCompleteDates.length || days.some((day, index) => day.date !== expectedCompleteDates[index])) {
    throw new RangeError('calendar is missing one or more completed dates');
  }

  const totalContributions = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter((day) => day.count > 0);
  let longestStreak = 0;
  let currentStreak = 0;
  for (const day of days) {
    if (day.count > 0) {
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  let bestDay = null;
  for (const day of activeDays) {
    if (!bestDay || day.count > bestDay.count) bestDay = { ...day };
  }

  const { year: asOfYear, month: asOfMonth } = parseDate(asOfDate);
  const monthKeys = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const monthIndex = asOfYear * 12 + asOfMonth - 1 - offset;
    const year = Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12 + 1;
    monthKeys.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
  }
  const monthTotals = Object.fromEntries(monthKeys.map((month) => [month, 0]));
  for (const day of days) monthTotals[day.date.slice(0, 7)] += day.count;
  const monthlyContributions = monthKeys.map((month) => ({ month, count: monthTotals[month] }));

  const startParts = parseDate(windowStart);
  const endDate = addDays(asOfDate, -1);
  return {
    startDate: windowStart,
    endDate,
    asOfDate,
    totalContributions,
    activeDays: activeDays.length,
    averagePerActiveDay: activeDays.length ? totalContributions / activeDays.length : 0,
    currentStreak,
    longestStreak,
    bestDay,
    monthlyContributions,
    periodLabel: `${monthName(startParts.month)} ${startParts.year}–${monthName(asOfMonth)} ${asOfYear}`,
    timeZone: null,
  };
}

function monthName(month) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, month - 1, 1)));
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function text(x, y, value, { fill, size = 12, weight = 400, anchor = 'start', family = 'Arial, Helvetica, sans-serif', letterSpacing = 0 } = {}) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letterSpacing}">${escapeXml(value)}</text>`;
}

function rootSvg({ title, description, width = SVG_WIDTH, height, theme }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(description)}</desc>
  <rect width="100%" height="100%" rx="18" fill="${theme.background}" />`;
}

function panel(x, y, width, height, theme, radius = 14) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${theme.panel}" stroke="${theme.border}" />`;
}

const ICON_ASSET_DIRECTORY = path.join(REPO_ROOT, 'profile', 'stack-icons');
const iconSourceCache = new Map();

function getIconSource(iconName) {
  if (!/^[a-z0-9-]+$/.test(iconName)) throw new TypeError(`invalid icon name: ${iconName}`);
  if (iconSourceCache.has(iconName)) return iconSourceCache.get(iconName);
  const filePath = path.join(ICON_ASSET_DIRECTORY, `${iconName}.svg`);
  const source = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rootTag = source.match(/<svg\b([^>]*)>/i)?.[1];
  const viewBox = rootTag?.match(/\bviewBox="([^"]+)"/i)?.[1];
  const inner = source.match(/<svg\b[^>]*>([\s\S]*?)<\/svg\s*>/i)?.[1];
  if (!viewBox || !inner || /<(?:script|image|foreignObject)\b|(?:href|xlink:href)\s*=/i.test(inner)) {
    throw new TypeError(`invalid or externally linked SVG icon: ${iconName}`);
  }

  const inheritedAttributes = new Set([
    'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
    'fill-rule', 'clip-rule', 'opacity',
  ]);
  const presentation = [...(rootTag.matchAll(/([\w-]+)="([^"]*)"/g))]
    .filter(([, name]) => inheritedAttributes.has(name))
    .map(([, name, value]) => `${name}="${escapeXml(value)}"`)
    .join(' ');
  const idPrefix = `stack-icon-${iconName}-`;
  const idMap = new Map();
  let markup = inner.replace(/\bid="([^"]+)"/g, (_match, id) => {
    const namespaced = `${idPrefix}${id}`;
    idMap.set(id, namespaced);
    return `id="${namespaced}"`;
  });
  for (const [id, namespaced] of idMap) {
    markup = markup.replaceAll(`url(#${id})`, `url(#${namespaced})`);
    markup = markup.replaceAll(`href="#${id}"`, `href="#${namespaced}"`);
  }
  const icon = { viewBox, presentation, markup };
  iconSourceCache.set(iconName, icon);
  return icon;
}

function stackIconMarkup(iconName, x, y, theme) {
  const icon = getIconSource(iconName);
  const iconColor = iconName === 'openai' ? theme.openAiIconColor : theme.iconColor;
  return `<rect x="${x + 4}" y="${y + 2.5}" width="20" height="20" rx="6" fill="${theme.iconBadge}" stroke="${theme.iconBorder}" stroke-width="0.55" />
    <svg x="${x + 6}" y="${y + 4.5}" width="16" height="16" viewBox="${escapeXml(icon.viewBox)}" color="${iconColor}" ${icon.presentation} aria-hidden="true" focusable="false">${icon.markup}</svg>`;
}

function chipMarkup(item, x, y, theme, width = 194) {
  if (!item.icon || !item.name) throw new TypeError('stack items must include a name and local icon asset');
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="25" rx="8" fill="${theme.panelAlt}" stroke="${theme.border}" />
    ${stackIconMarkup(item.icon, x, y, theme)}
    ${text(x + 32, y + 17, item.name, { fill: theme.text, size: 13.2, weight: 600 })}
  </g>`;
}

function radarCard(chart, x, y, theme, focusStatus, { compact = false } = {}) {
  const cardWidth = compact ? 328 : 428;
  const cardHeight = 344;
  const cx = x + cardWidth / 2;
  const cy = y + 194;
  const radius = compact ? 57 : 71;
  const labelRadius = compact ? 82 : 101;
  const axisCount = chart.axes.length;
  const angleAt = (index) => (-Math.PI / 2) + (Math.PI * 2 * index) / axisCount;
  const pointAt = (index, pointRadius) => {
    const angle = angleAt(index);
    return { x: cx + Math.cos(angle) * pointRadius, y: cy + Math.sin(angle) * pointRadius };
  };
  const polygonPoints = (pointRadius) => chart.axes.map((_, index) => {
    const point = pointAt(index, pointRadius);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');
  const classificationColor = (classification) => theme[RADAR_LEVEL_COLORS[classification]];
  const titleSize = compact ? 10.6 : 13;

  let markup = `${panel(x, y, cardWidth, cardHeight, theme)}
    ${text(x + 16, y + 25, chart.title, { fill: theme.text, size: titleSize, weight: 700, letterSpacing: compact ? 0.25 : 0.6 })}
    <rect x="${x + cardWidth - 76}" y="${y + 11}" width="60" height="22" rx="11" fill="${theme.panelAlt}" stroke="${theme.border}" />
    ${text(x + cardWidth - 46, y + 26, focusStatus, { fill: theme.purple, size: 9, weight: 700, anchor: 'middle', letterSpacing: 0.6 })}`;

  const legendColumn = compact ? 176 : 222;
  const legend = [
    { classification: 'CORE', x: x + 22, y: y + 50 },
    { classification: 'SUPPORTING', x: x + legendColumn, y: y + 50 },
    { classification: 'EXPLORING', x: x + 22, y: y + 71 },
    { classification: 'UNASSESSED', x: x + legendColumn, y: y + 71 },
  ];
  for (const item of legend) {
    const color = classificationColor(item.classification);
    const marker = item.classification === 'UNASSESSED'
      ? `<circle cx="${item.x + 4}" cy="${item.y - 3}" r="3.1" fill="none" stroke="${color}" stroke-width="1.2" />`
      : `<circle cx="${item.x + 4}" cy="${item.y - 3}" r="3.1" fill="${color}" />`;
    markup += `${marker}
      ${text(item.x + 13, item.y, item.classification, { fill: color, size: 9.5, weight: 700, letterSpacing: 0.45 })}`;
  }

  for (const classification of ['CORE', 'SUPPORTING', 'EXPLORING']) {
    const ringRadius = radius * RADAR_FOCUS_RADII[classification];
    const color = classificationColor(classification);
    markup += `<polygon points="${polygonPoints(ringRadius)}" fill="none" stroke="${color}" stroke-width="${classification === 'CORE' ? 1.1 : 0.8}" opacity="0.34" />`;
  }
  chart.axes.forEach((axis, index) => {
    const point = pointAt(index, radius);
    const label = pointAt(index, labelRadius);
    const cos = Math.cos(angleAt(index));
    const anchor = cos > 0.24 ? 'start' : cos < -0.24 ? 'end' : 'middle';
    markup += `<line x1="${cx}" y1="${cy}" x2="${point.x.toFixed(1)}" y2="${point.y.toFixed(1)}" stroke="${theme.grid}" stroke-width="0.85" />`;
    if (compact) {
      const lines = [];
      for (const word of axis.label.split(/\s+/)) {
        const current = lines.at(-1);
        if (current && `${current} ${word}`.length <= 15) lines[lines.length - 1] += ` ${word}`;
        else lines.push(word);
      }
      const firstY = label.y - (lines.length > 1 ? 10 : 3);
      lines.forEach((line, lineIndex) => {
        markup += text(label.x.toFixed(1), (firstY + lineIndex * 11).toFixed(1), line, { fill: theme.muted, size: 11, weight: 600, anchor });
      });
      markup += text(label.x.toFixed(1), (label.y + (lines.length > 1 ? 15 : 9)).toFixed(1), axis.classification, { fill: classificationColor(axis.classification), size: 9, weight: 700, anchor, letterSpacing: 0.2 });
    } else {
      markup += text(label.x.toFixed(1), (label.y - 3).toFixed(1), axis.label, { fill: theme.muted, size: 12, weight: 600, anchor });
      markup += text(label.x.toFixed(1), (label.y + 9).toFixed(1), axis.classification, { fill: classificationColor(axis.classification), size: 8.4, weight: 700, anchor, letterSpacing: 0.2 });
    }
  });

  chart.axes.forEach((axis, index) => {
    const nextIndex = (index + 1) % axisCount;
    const nextAxis = chart.axes[nextIndex];
    if (axis.classification === 'UNASSESSED' || nextAxis.classification === 'UNASSESSED') return;
    const start = pointAt(index, radius * RADAR_FOCUS_RADII[axis.classification]);
    const end = pointAt(nextIndex, radius * RADAR_FOCUS_RADII[nextAxis.classification]);
    markup += `<line x1="${start.x.toFixed(1)}" y1="${start.y.toFixed(1)}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" stroke="${theme.muted}" stroke-width="1.15" stroke-dasharray="3 3" opacity="0.72" />`;
  });
  chart.axes.forEach((axis, index) => {
    if (axis.classification === 'UNASSESSED') return;
    const point = pointAt(index, radius * RADAR_FOCUS_RADII[axis.classification]);
    const color = classificationColor(axis.classification);
    markup += `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="${color}" stroke="${theme.background}" stroke-width="1.4"><title>${escapeXml(axis.label)} - ${axis.classification}</title></circle>`;
  });
  markup += `<circle cx="${cx}" cy="${cy}" r="2" fill="${theme.grid}" />`;
  const footer = compact ? 'FOCUS PRIORITY - NOT PROFICIENCY OR PERFORMANCE' : 'DISTANCE SHOWS FOCUS PRIORITY ONLY - NOT PROFICIENCY OR PERFORMANCE';
  markup += text(cx, y + cardHeight - 11, footer, { fill: theme.quiet, size: compact ? 8.2 : 8.2, weight: 600, anchor: 'middle', letterSpacing: compact ? 0 : 0.15 });
  return markup;
}

function validateRenderConfig(themeName, config) {
  const theme = THEMES[themeName];
  if (!theme) throw new RangeError(`unknown theme: ${themeName}`);
  const charts = config?.focusRadar?.charts;
  if (!Array.isArray(config?.stackGroups) || !Array.isArray(charts) || charts.length !== 2) {
    throw new TypeError('config must include stackGroups and exactly two focus radar charts');
  }
  if (!RADAR_REVIEW_STATUSES.includes(config.focusRadar.status)) throw new TypeError('invalid focus radar review status');
  return { theme, charts, focusStatus: config.focusRadar.status };
}

export function renderStackSvg(themeName, config, layout = 'wide') {
  const { theme } = validateRenderConfig(themeName, config);
  if (!['wide', 'narrow'].includes(layout)) throw new RangeError(`unknown stack layout: ${layout}`);
  const isWide = layout === 'wide';
  const width = isWide ? 1000 : SVG_WIDTH;
  const height = isWide ? 292 : 390;
  const stackX = 16;
  const cardY = isWide ? 12 : 12;
  const cardHeight = isWide ? 268 : 366;
  let markup = rootSvg({
    title: `SGODX technology stack - ${themeName} theme, ${layout} layout`,
    description: `Sixteen documented technologies grouped into Languages and Interfaces, Services and Data, and Delivery and Tools in a ${isWide ? 'horizontal three-column' : 'vertical category'} layout. Each technology mark is inlined from a local profile asset.`,
    width,
    height,
    theme,
  });
  markup += `${panel(stackX, cardY, width - 2 * stackX, cardHeight, theme)}`;
  markup += `${text(stackX + 16, isWide ? 42 : 36, 'MY PERFECT STACK', { fill: theme.text, size: isWide ? 16 : 14, weight: 700, letterSpacing: 0.5 })}
    ${text(stackX + 16, isWide ? 59 : 53, 'DOCUMENTED TECHNOLOGY STACK', { fill: theme.muted, size: 9.2, weight: 600, letterSpacing: 0.35 })}`;

  const groupLayout = isWide
    ? [
      { x: 32, labelY: 82, chipY: 96 },
      { x: 356, labelY: 82, chipY: 96 },
      { x: 680, labelY: 82, chipY: 96 },
    ]
    : [
      { x: 32, labelY: 76, chipY: 84 },
      { x: 32, labelY: 188, chipY: 196 },
      { x: 32, labelY: 300, chipY: 308 },
    ];
  if (isWide) {
    markup += `<line x1="338" y1="74" x2="338" y2="258" stroke="${theme.border}" stroke-width="1" />
      <line x1="662" y1="74" x2="662" y2="258" stroke="${theme.border}" stroke-width="1" />`;
  }
  config.stackGroups.forEach((group, groupIndex) => {
    const groupPosition = groupLayout[groupIndex];
    if (!groupPosition) return;
    markup += text(groupPosition.x, groupPosition.labelY, group.label.toUpperCase(), { fill: theme.cyan, size: isWide ? 10 : 10.5, weight: 700, letterSpacing: 0.55 });
    group.items.forEach((item, itemIndex) => {
      const row = Math.floor(itemIndex / 2);
      const column = itemIndex % 2;
      const chipWidth = isWide ? 140 : 194;
      const columnStep = isWide ? 148 : 202;
      const rowStep = isWide ? 46 : 26;
      markup += chipMarkup(item, groupPosition.x + column * columnStep, groupPosition.chipY + row * rowStep, theme, chipWidth);
    });
  });
  return `${markup}</svg>`;
}

export function renderRadarPairSvg(themeName, config, layout = 'wide') {
  const { theme, charts, focusStatus } = validateRenderConfig(themeName, config);
  if (!['wide', 'narrow'].includes(layout)) throw new RangeError(`unknown radar-pair layout: ${layout}`);
  const isWide = layout === 'wide';
  const width = isWide ? 920 : 328;
  const height = isWide ? 376 : 736;
  const chartSummary = charts.map((chart) => `${chart.title}: ${chart.axes.map((axis) => `${axis.label}, ${axis.classification}`).join('; ')}`).join('. ');
  let markup = rootSvg({
    title: `SGODX qualitative focus radar pair - ${themeName} theme, ${layout} layout`,
    description: `Two ${focusStatus.toLowerCase()} qualitative professional-focus radars in a ${isWide ? 'side-by-side' : 'vertical'} layout. The classifications are owner-approved descriptions informed by public project context where available; public material does not independently verify private work. CORE means primary current focus; SUPPORTING means complementary documented work; EXPLORING means a developing or future area; UNASSESSED means no owner-approved category is assigned. Radial distance shows categorical focus priority only, never proficiency, performance, seniority, or certification. UNASSESSED dimensions have no plotted point. ${chartSummary}.`,
    width,
    height,
    theme,
  });
  if (isWide) {
    markup += radarCard(charts[0], 16, 16, theme, focusStatus);
    markup += radarCard(charts[1], 476, 16, theme, focusStatus);
  } else {
    markup += radarCard(charts[0], 0, 16, theme, focusStatus, { compact: true });
    markup += radarCard(charts[1], 0, 376, theme, focusStatus, { compact: true });
  }
  return `${markup}</svg>`;
}
function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function displayDate(dateText) {
  const { year, month, day } = parseDate(dateText);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function shortDate(dateText) {
  const { year, month, day } = parseDate(dateText);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function statsDescription(metrics, timeZone) {
  if (!metrics) return 'Developer contribution metrics are unavailable because no verified GitHub GraphQL calendar response is available.';
  const monthly = metrics.monthlyContributions.map(({ month, count }) => `${monthName(Number(month.slice(5)))} ${month.slice(0, 4)}: ${count}`).join('; ');
  const best = metrics.bestDay ? `${metrics.bestDay.count} on ${displayDate(metrics.bestDay.date)}` : 'no contribution day in this window';
  return `Public GitHub contributions only. ${metrics.periodLabel}, through ${displayDate(metrics.endDate)} in ${timeZone}; today's incomplete date is excluded. Total ${metrics.totalContributions}; active days ${metrics.activeDays}; current complete-day streak ${metrics.currentStreak}; longest streak ${metrics.longestStreak}; average per active day ${metrics.averagePerActiveDay.toFixed(2)}; best day ${best}. Monthly contributions: ${monthly}.`;
}

export function renderStatsSvg(themeName, metrics, timeZone = 'UTC') {
  const theme = THEMES[themeName];
  if (!theme) throw new RangeError(`unknown theme: ${themeName}`);
  const height = 650;
  const period = metrics?.periodLabel ?? '12-month public contribution window';
  const through = metrics?.endDate ? displayDate(metrics.endDate) : null;
  let markup = rootSvg({
    title: `Developer signals — ${themeName} theme`,
    description: statsDescription(metrics, timeZone),
    height,
    theme,
  });
  markup += `${text(24, 32, 'SGODX / PUBLIC ACTIVITY', { fill: theme.cyan, size: 10, weight: 700, family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', letterSpacing: 1 })}
    ${text(24, 61, 'DEVELOPER SIGNALS', { fill: theme.text, size: 20, weight: 700, letterSpacing: 0.45 })}
    <rect x="348" y="20" width="88" height="25" rx="12.5" fill="${theme.panel}" stroke="${theme.green}" />
    ${text(392, 37, 'PUBLIC ONLY', { fill: theme.green, size: 9, weight: 700, anchor: 'middle', letterSpacing: 0.4 })}
    ${text(24, 82, `${period} · COMPLETE DAYS`, { fill: theme.muted, size: 9.5, weight: 600 })}`;
  if (!metrics) {
    markup += `${panel(16, 104, 428, 520, theme)}
      ${text(230, 330, 'DATA UNAVAILABLE', { fill: theme.cyan, size: 16, weight: 700, anchor: 'middle', letterSpacing: 0.7 })}
      ${text(230, 360, 'No verified contribution calendar was received.', { fill: theme.muted, size: 11, anchor: 'middle' })}
      ${text(230, 382, 'No statistics have been estimated or substituted.', { fill: theme.muted, size: 11, anchor: 'middle' })}`;
    return `${markup}</svg>`;
  }

  const tileData = [
    { label: 'CURRENT STREAK', value: `${metrics.currentStreak}d`, detail: 'complete days' },
    { label: 'LONGEST · 12M', value: `${metrics.longestStreak}d`, detail: 'within this window' },
    { label: 'TOTAL CONTRIBUTIONS', value: formatNumber(metrics.totalContributions), detail: 'public · completed dates' },
    { label: 'ACTIVE DAYS', value: formatNumber(metrics.activeDays), detail: 'one or more' },
    { label: 'AVG / ACTIVE DAY', value: formatNumber(metrics.averagePerActiveDay), detail: 'contributions' },
    { label: 'BEST DAY', value: metrics.bestDay ? formatNumber(metrics.bestDay.count) : '—', detail: metrics.bestDay ? shortDate(metrics.bestDay.date) : 'no activity' },
  ];
  const tileWidth = 202;
  const tileHeight = 76;
  const tileX = [16, 230];
  const tileY = [98, 184, 270];
  tileData.forEach((tile, index) => {
    const x = tileX[index % 2];
    const y = tileY[Math.floor(index / 2)];
    markup += `${panel(x, y, tileWidth, tileHeight, theme, 10)}
      ${text(x + 12, y + 21, tile.label, { fill: theme.muted, size: 11.5, weight: 700, letterSpacing: 0.3 })}
      ${text(x + 12, y + 50, tile.value, { fill: theme.text, size: 22, weight: 700, family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' })}
      ${text(x + 12, y + 68, tile.detail, { fill: theme.quiet, size: 10.5, weight: 500 })}`;
  });

  const chartX = 16;
  const chartY = 362;
  const chartWidth = 428;
  const chartHeight = 210;
  const graphTop = chartY + 47;
  const graphBottom = chartY + 151;
  const graphHeight = graphBottom - graphTop;
  const maxCount = Math.max(1, ...metrics.monthlyContributions.map(({ count }) => count));
  const barWidth = 17;
  const barGap = 15;
  const totalBarsWidth = metrics.monthlyContributions.length * barWidth + (metrics.monthlyContributions.length - 1) * barGap;
  const firstBarX = chartX + (chartWidth - totalBarsWidth) / 2;
  markup += `${panel(chartX, chartY, chartWidth, chartHeight, theme)}
    ${text(chartX + 16, chartY + 25, 'CONTRIBUTIONS / MONTH', { fill: theme.text, size: 10, weight: 700, letterSpacing: 0.5 })}
    ${text(chartX + chartWidth - 16, chartY + 25, `MAX ${formatNumber(maxCount)}`, { fill: theme.quiet, size: 9.5, weight: 600, anchor: 'end', family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' })}`;
  for (let line = 0; line <= 2; line += 1) {
    const y = graphTop + graphHeight * line / 2;
    markup += `<line x1="${chartX + 17}" y1="${y.toFixed(1)}" x2="${chartX + chartWidth - 17}" y2="${y.toFixed(1)}" stroke="${theme.grid}" stroke-width="0.8" opacity="0.8" />`;
  }
  metrics.monthlyContributions.forEach(({ month, count }, index) => {
    const x = firstBarX + index * (barWidth + barGap);
    const barHeight = count === 0 ? 0 : Math.max(2, graphHeight * count / maxCount);
    const y = graphBottom - barHeight;
    const currentMonth = index === metrics.monthlyContributions.length - 1;
    const intensity = count === 0 ? 0 : count / maxCount;
    const barColor = intensity > 0.66 ? theme.contributionBright : intensity > 0.33 ? theme.contributionMid : theme.contributionLow;
    const barStroke = intensity > 0 && intensity <= 0.33 ? theme.contributionLowBorder : 'none';
    markup += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${barHeight.toFixed(1)}" rx="3" fill="${barColor}" stroke="${barStroke}" stroke-width="0.8" opacity="${count === 0 ? 0 : 0.92}" />`;
    if (count > 0) markup += text(x + barWidth / 2, y - 4, formatNumber(count), { fill: theme.muted, size: 9, weight: 600, anchor: 'middle' });
    const monthNumber = Number(month.slice(5));
    markup += text(x + barWidth / 2, graphBottom + 18, monthName(monthNumber), { fill: currentMonth ? theme.contributionBright : theme.quiet, size: 10.2, weight: currentMonth ? 700 : 500, anchor: 'middle' });
  });
  markup += `${text(24, 596, `WINDOW  ${displayDate(metrics.startDate)} — ${displayDate(metrics.endDate)}  ·  ${timeZone}`, { fill: theme.muted, size: 10.2, weight: 600, family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' })}
    ${text(24, 616, `TODAY EXCLUDED · ${through ? `THROUGH ${through.toUpperCase()}` : ''} · CURRENT MONTH IS PARTIAL`, { fill: theme.quiet, size: 10, weight: 600, letterSpacing: 0.1 })}
    ${text(24, 636, 'Public activity only · current and longest streaks count completed days in this window.', { fill: theme.quiet, size: 9.7 })}`;
  return `${markup}</svg>`;
}

export function renderUnavailableStatsSvg(themeName, timeZone = 'UTC') {
  return renderStatsSvg(themeName, null, timeZone);
}

function isSvgFile(contents) {
  return typeof contents === 'string' && /^\s*<svg\b/.test(contents) && /<\/svg>\s*$/.test(contents);
}

async function writeSvgIfChanged(filePath, svg) {
  const normalizedSvg = svg.replace(/[ \t]+(?=\r?\n)/g, '').trimEnd();
  const output = `${normalizedSvg}\n`;
  let current;
  try {
    current = await readFile(filePath, 'utf8');
  } catch {
    current = null;
  }
  if (current === output) return false;
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, output, 'utf8');
  await rename(temporaryPath, filePath);
  return true;
}

async function writeStackAssets(outputDir, config) {
  const changed = [];
  for (const themeName of Object.keys(THEMES)) {
    for (const layout of ['wide', 'narrow']) {
      const layoutSuffix = layout === 'wide' ? '' : '-narrow';
      const stackPath = path.join(outputDir, `stack-signals${layoutSuffix}-${themeName}.svg`);
      if (await writeSvgIfChanged(stackPath, renderStackSvg(themeName, config, layout))) changed.push(stackPath);
      const radarPath = path.join(outputDir, `radar-pair${layoutSuffix}-${themeName}.svg`);
      if (await writeSvgIfChanged(radarPath, renderRadarPairSvg(themeName, config, layout))) changed.push(radarPath);
    }
  }
  return changed;
}

function parseArguments(args) {
  const result = { outputDir: path.join(REPO_ROOT, 'profile'), configPath: path.join(REPO_ROOT, 'profile', 'stack-signals.config.json') };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output-dir' && args[index + 1]) result.outputDir = path.resolve(args[++index]);
    else if (argument === '--config' && args[index + 1]) result.configPath = path.resolve(args[++index]);
    else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`unknown or incomplete argument: ${argument}`);
  }
  return result;
}

function printHelp() {
  return [
    'Generate theme-specific Stack & Signals SVGs and public contribution metrics.',
    '',
    'Usage: node scripts/generate_stack_signals.mjs [--output-dir DIR] [--config FILE]',
    '',
    'Authentication: GITHUB_TOKEN/GH_TOKEN, or an authenticated `gh` CLI session.',
  ].join('\n');
}

async function loadConfig(configPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config.schemaVersion !== 1 || !config.owner || !config.reportingTimeZone) throw new TypeError('invalid Stack & Signals configuration');
  if (!RADAR_REVIEW_STATUSES.includes(config.focusRadar?.status)) throw new TypeError('invalid focus radar review status');
  if (!Array.isArray(config.focusRadar?.charts) || config.focusRadar.charts.length !== 2) throw new TypeError('focus radar must contain exactly two charts');
  for (const chart of config.focusRadar.charts) {
    if (!Array.isArray(chart.axes) || chart.axes.length < 3) throw new TypeError(`invalid radar axes in ${chart.id}`);
    for (const axis of chart.axes) {
      if (typeof axis.label !== 'string' || !axis.label.trim() || !RADAR_LEVELS.includes(axis.classification)) {
        throw new TypeError(`invalid qualitative classification for ${chart.id}/${axis.label}`);
      }
    }
  }
  return config;
}

async function fetchCalendar(config, range, now) {
  const variables = {
    login: config.owner,
    from: zonedMidnightAsUtc(range.startDate, config.reportingTimeZone),
    to: now.toISOString(),
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  let response;
  if (token) {
    const httpResponse = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'dpsychoo-stack-signals/1.0',
      },
      body: JSON.stringify({ query: GRAPHQL_QUERY, variables }),
    });
    if (!httpResponse.ok) throw new Error(`GitHub GraphQL returned HTTP ${httpResponse.status}`);
    response = await httpResponse.json();
  } else {
    const args = [
      'api', 'graphql',
      '-f', `query=${GRAPHQL_QUERY}`,
      '-F', `login=${variables.login}`,
      '-F', `from=${variables.from}`,
      '-F', `to=${variables.to}`,
    ];
    const result = spawnSync('gh', args, { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error('GitHub CLI GraphQL request failed; authenticate with `gh auth login` or provide GITHUB_TOKEN');
    try {
      response = JSON.parse(result.stdout);
    } catch {
      throw new Error('GitHub CLI returned invalid GraphQL JSON');
    }
  }
  if (Array.isArray(response.errors) && response.errors.length) {
    throw new Error(`GitHub GraphQL returned an error: ${response.errors[0]?.message || 'unknown schema or permission error'}`);
  }
  const calendar = response?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error(`GitHub user ${config.owner} or contributionCalendar was unavailable`);
  return calendar;
}

async function writeStatsAssets(outputDir, metrics, timeZone) {
  const changed = [];
  for (const themeName of Object.keys(THEMES)) {
    const filePath = path.join(outputDir, `developer-stats-${themeName}.svg`);
    if (await writeSvgIfChanged(filePath, renderStatsSvg(themeName, metrics, timeZone))) changed.push(filePath);
  }
  return changed;
}

export async function preserveOrMarkUnavailable(outputDir, timeZone) {
  const changed = [];
  for (const themeName of Object.keys(THEMES)) {
    const filePath = path.join(outputDir, `developer-stats-${themeName}.svg`);
    let existing = null;
    try {
      existing = await readFile(filePath, 'utf8');
    } catch {
      // Generate a truthful unavailable card below when no prior output exists.
    }
    if (isSvgFile(existing)) {
      console.warn(`Preserving last valid ${themeName} developer stats SVG after API failure.`);
    } else if (await writeSvgIfChanged(filePath, renderUnavailableStatsSvg(themeName, timeZone))) {
      changed.push(filePath);
    }
  }
  return changed;
}

export async function generate({ outputDir, config, now = new Date(), fetcher = fetchCalendar } = {}) {
  const asOfDate = dateInTimeZone(now, config.reportingTimeZone);
  const range = getReportWindow(asOfDate);
  await mkdir(outputDir, { recursive: true });
  const changed = await writeStackAssets(outputDir, config);
  const calendar = await fetcher(config, range, now);
  const metrics = computeMetrics(calendar, { asOfDate, windowStart: range.startDate });
  metrics.timeZone = config.reportingTimeZone;
  changed.push(...await writeStatsAssets(outputDir, metrics, config.reportingTimeZone));
  return { metrics, changed, range };
}

export async function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArguments(args);
    if (options.help) {
      console.log(printHelp());
      return 0;
    }
    const config = await loadConfig(options.configPath);
    const now = new Date();
    const asOfDate = dateInTimeZone(now, config.reportingTimeZone);
    const range = getReportWindow(asOfDate);
    await mkdir(options.outputDir, { recursive: true });
    const changed = await writeStackAssets(options.outputDir, config);
    let calendar;
    try {
      calendar = await fetchCalendar(config, range, now);
    } catch (error) {
      const fallbackChanged = await preserveOrMarkUnavailable(options.outputDir, config.reportingTimeZone);
      console.warn(`Developer stats unavailable: ${error.message}`);
      if (fallbackChanged.length) console.warn('Wrote explicit unavailable SVG state because no prior valid card existed.');
      return 0;
    }
    const metrics = computeMetrics(calendar, { asOfDate, windowStart: range.startDate });
    metrics.timeZone = config.reportingTimeZone;
    changed.push(...await writeStatsAssets(options.outputDir, metrics, config.reportingTimeZone));
    console.log(`Generated public contribution stats for ${metrics.periodLabel}, through ${displayDate(metrics.endDate)} (${metrics.totalContributions} contributions).`);
    console.log(`Updated ${changed.length} SVG asset(s).`);
    return 0;
  } catch (error) {
    console.error(`Generation failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
