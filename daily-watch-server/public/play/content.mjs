import { seedForDay } from './engine.mjs';

/**
 * Original fiction for The Sea Gates. These objects and descriptions are
 * authored for the game, not attributed historical objects or quotations.
 * Theme order must match the engine's seedForDay(day) % 7 variants.
 */
export const DAILY_THEMES = Object.freeze([
  {
    id: 'open-water',
    title: 'Open Water',
    subtitle: 'A clear horizon. A measured defense.',
    description: 'A balanced watch of skiffs and raiders. Read both channels and build coverage before committing to a taller tower.',
    motif: 'wave',
  },
  {
    id: 'swift-oars',
    title: 'Swift Oars',
    subtitle: 'Distance is time you can spend.',
    description: 'More fast skiffs approach the gates. Early contact and overlapping coverage give your machines longer to work.',
    motif: 'oars',
  },
  {
    id: 'bronze-hulls',
    title: 'Bronze Hulls',
    subtitle: 'A stronger hull asks a different question.',
    description: 'Armored ships appear more often. Choose machines for the hulls ahead instead of relying on the largest damage number.',
    motif: 'hull',
  },
  {
    id: 'close-formation',
    title: 'Close Formation',
    subtitle: 'Many hulls. One narrow reach.',
    description: 'Ships arrive in tighter groups. Plan where enemies will gather and give your defenses room to act together.',
    motif: 'formation',
  },
  {
    id: 'split-approach',
    title: 'Split Approach',
    subtitle: 'Two channels share one harbor.',
    description: 'The approach alternates between channels. A powerful shore still needs a partner on the other side.',
    motif: 'channels',
  },
  {
    id: 'aegis-escort',
    title: 'Aegis Escort',
    subtitle: 'Find the ship holding the line together.',
    description: 'Wardships bring an armor aura to nearby allies. Read the escort formation as carefully as the leading hull.',
    motif: 'shield',
  },
  {
    id: 'heavy-tide',
    title: 'Heavy Tide',
    subtitle: 'Build for what the water is carrying.',
    description: 'Heavier raiders press the harbor before the seventh-tide boss. Prepare sustained coverage without leaving a channel bare.',
    motif: 'storm',
  },
].map(Object.freeze));

const rewardDefinitions = [
  {
    id: 'first-watch-tessera',
    days: 1,
    title: 'First-Watch Tessera',
    description: 'A terracotta harbor tile set into a small bronze frame. The first piece in your house of soundings.',
    motif: 'tile',
  },
  {
    id: 'bronze-dividers',
    days: 3,
    title: 'Bronze Dividers',
    description: 'A pair of worn measuring arms for the chart table. Their open points trace the space between two safe shores.',
    motif: 'caliper',
  },
  {
    id: 'returning-water-dial',
    days: 7,
    title: 'Returning-Water Dial',
    description: 'A fictional bronze instrument of nested rings and tide marks. A week of separate watches becomes a circle on the wall.',
    motif: 'astrolabe',
  },
  {
    id: 'counterweight-model',
    days: 14,
    title: 'Counterweight Model',
    description: 'A small harbor crane balanced by a suspended stone. An ordinary weight, carefully placed, can move something much larger.',
    motif: 'crane',
  },
  {
    id: 'two-gates-relief',
    days: 28,
    title: 'The Two Gates',
    description: 'A complete harbor panel in bronze, charcoal and sea green. Both channels, both shores and the house that kept their record.',
    motif: 'harbor-panel',
  },
];

export const REWARDS = Object.freeze(rewardDefinitions.map((reward) => Object.freeze({
  ...reward,
  name: reward.title,
  threshold: reward.days,
  kind: 'artifact',
  icon: reward.motif,
  requirement: reward.days === 1
    ? 'Finish your first daily watch'
    : `Finish daily watches on ${reward.days} different UTC days`,
})));

const canonicalDay = /^\d{4}-\d{2}-\d{2}$/;
const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function toDate(value) {
  let date;
  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else if (typeof value === 'string' && canonicalDay.test(value)) {
    date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new RangeError('Invalid UTC date.');
    }
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else {
    throw new RangeError('Invalid UTC date.');
  }
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid UTC date.');
  return date;
}

/** A calendar key in UTC. Invalid or impossible dates are rejected. */
export function utcDay(date = new Date()) {
  return toDate(date).toISOString().slice(0, 10);
}

/** The same seeded theme used by the engine, including historical challenges. */
export function themeForDay(day) {
  return DAILY_THEMES[(seedForDay(utcDay(day)) >>> 0) % DAILY_THEMES.length];
}

export function formatDay(day) {
  return dayFormatter.format(toDate(day));
}

/**
 * `days` counts distinct, validated dates of actual daily-watch participation.
 * It is not a streak, a score, a count of wins, or a count of archive dates.
 * No reward changes the combat rules or grants account-only power.
 */
export function rewardStatus(days) {
  const amount = Number(days);
  const count = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  return REWARDS.map((reward) => ({
    ...reward,
    unlocked: count >= reward.days,
    remaining: Math.max(0, reward.days - count),
    progress: Math.min(1, count / reward.days),
  }));
}
