import { readCache, writeCache } from './cache';
import type { Player, PlayerInput } from '../types';

/**
 * Spotting the same person written down twice.
 *
 * A player's identity is `nickname|department`, and the nickname is whatever
 * the person holding the phone felt like typing: "น้องไอลีน" one week,
 * "พี่ลีน" the next. Those are two keys, so they collect two histories and two
 * balances — and each only ever settles half the debt.
 *
 * Nothing here decides anything on its own. It only raises a hand so the app
 * can ask, because "คนละคน" is a perfectly normal answer: two people really
 * can be called ลีน.
 */

/** Thai kinship prefixes used as politeness, not as part of the name. */
const HONORIFICS = [
  'น้อง',
  'พี่',
  'คุณ',
  'ป๋า',
  'ป้า',
  'ลุง',
  'น้า',
  'เจ๊',
  'เฮีย',
  'ไอ้',
  'หนู',
];

// Tone marks and การันต์ are written inconsistently and never separate two
// different people, so they're dropped before comparing.
const DIACRITICS = /[็-๎]/g;

function normalize(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, '').replace(DIACRITICS, '');
}

/**
 * The name with its honorific taken off — "น้องไอลีน" → "ไอลีน".
 *
 * Only one prefix comes off, and only when at least two characters survive:
 * stripping "ป้า" out of "ป้าง" would leave a fragment that matches anything.
 */
function core(normalized: string) {
  for (const honorific of HONORIFICS) {
    const prefix = normalize(honorific);
    if (normalized.startsWith(prefix) && normalized.length - prefix.length >= 2) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

/**
 * The forms a name is compared in: as written, and with the honorific off.
 *
 * Both are kept because stripping isn't symmetric — "เจมส์" keeps its เจ (too
 * little would be left of it), while "เจม" loses nothing, and comparing only
 * the stripped forms would miss that they're the same name.
 */
function variantsOf(raw: string) {
  const normalized = normalize(raw);
  const stripped = core(normalized);
  return stripped === normalized ? [normalized] : [normalized, stripped];
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * How alike two nicknames read, 0–1, or 0 when they aren't worth asking about.
 *
 * Containment is what catches the honorific case ("ไอลีน" holds "ลีน"), and
 * edit distance catches the spelling drift ("เอก" / "เอ้ก").
 */
export function nicknameSimilarity(a: string, b: string): number {
  let best = 0;
  for (const left of variantsOf(a)) {
    for (const right of variantsOf(b)) {
      best = Math.max(best, closeness(left, right));
    }
  }
  return best;
}

function closeness(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  // One-character cores are too generic — "เ" inside a name means nothing.
  if (shorter.length >= 2 && longer.includes(shorter)) {
    return 0.9 - Math.min(0.25, (longer.length - shorter.length) * 0.05);
  }

  const gap = levenshtein(left, right);
  const ratio = 1 - gap / longer.length;
  return gap <= 2 && ratio >= 0.6 ? 0.5 + ratio * 0.3 : 0;
}

export const playerKeyOf = (input: PlayerInput | Player) =>
  `${input.nickname.trim()}|${input.department.trim()}`;

export interface SimilarPlayer {
  player: Player;
  score: number;
}

/**
 * Existing players whose name reads like the one just typed, best first.
 *
 * The typed person themself is never a match — an exact key is the same
 * person, and there is nothing to ask about. Pairs already answered with
 * "คนละคน" are dropped too, so the question is asked once and not every week.
 */
export function findSimilarPlayers(
  input: PlayerInput,
  players: Player[],
  limit = 3
): SimilarPlayer[] {
  const nickname = input.nickname.trim();
  if (!nickname) return [];
  const key = playerKeyOf(input);

  return players
    .filter((p) => p.player_key !== key && !isMarkedDistinct(key, p.player_key))
    .map((player) => ({ player, score: nicknameSimilarity(nickname, player.nickname) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.player.games_count - a.player.games_count)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Remembering "คนละคน"
//
// Kept in localStorage rather than the sheet: it's an answer about this
// phone's habits, and getting it wrong costs one extra question, not data.

const DISTINCT_CACHE_KEY = 'distinct-players';

const pairId = (a: string, b: string) => [a, b].sort().join('::');

function readDistinctPairs(): string[] {
  return readCache<string[]>(DISTINCT_CACHE_KEY) ?? [];
}

export function isMarkedDistinct(a: string, b: string): boolean {
  return readDistinctPairs().includes(pairId(a, b));
}

export function markDistinct(a: string, b: string): void {
  const id = pairId(a, b);
  const pairs = readDistinctPairs();
  if (pairs.includes(id)) return;
  writeCache(DISTINCT_CACHE_KEY, [...pairs, id]);
}
