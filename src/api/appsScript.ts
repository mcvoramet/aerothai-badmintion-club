import type {
  Game,
  GamePayload,
  OutstandingPlayer,
  Player,
  PlayerBalance,
  Settings,
  StatsPeriod,
  StatsSummary,
} from '../types';

const BASE_URL = import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function assertConfigured() {
  if (!BASE_URL) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า VITE_APPS_SCRIPT_URL — กรุณาตั้งค่าใน .env.local (ดู .env.example)'
    );
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as Envelope<T>;
  if (!json.ok) {
    throw new Error(json.error || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
  }
  return json.data as T;
}

async function apiGet<T>(action: string, params: Record<string, string | number> = {}): Promise<T> {
  assertConfigured();
  const url = new URL(BASE_URL as string);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url.toString());
  return unwrap<T>(res);
}

// Apps Script Web Apps can't answer a browser CORS preflight, so a POST with
// Content-Type: application/json triggers an OPTIONS request that fails.
// Sending as text/plain keeps it a CORS "simple request" and skips preflight;
// Apps Script only looks at e.postData.contents, not the declared content type.
async function apiPost<T>(action: string, body: object = {}): Promise<T> {
  assertConfigured();
  const res = await fetch(BASE_URL as string, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...body }),
  });
  return unwrap<T>(res);
}

export function getPlayers(): Promise<Player[]> {
  return apiGet<Player[]>('getPlayers');
}

export function getSettings(): Promise<Settings> {
  return apiGet<Settings>('getSettings');
}

export function getRecentGames(limit = 20): Promise<Game[]> {
  return apiGet<Game[]>('getRecentGames', { limit });
}

export function getGamesInRange(start: string, end: string): Promise<Game[]> {
  return apiGet<Game[]>('getGamesInRange', { start, end });
}

export function getPlayerBalance(playerKey: string): Promise<PlayerBalance> {
  return apiGet<PlayerBalance>('getPlayerBalance', { player_key: playerKey });
}

export function getSummary(period: StatsPeriod, date?: string): Promise<StatsSummary> {
  return apiGet<StatsSummary>('getSummary', date ? { period, date } : { period });
}

export function getOutstanding(): Promise<OutstandingPlayer[]> {
  return apiGet<OutstandingPlayer[]>('getOutstanding');
}

export function verifyPassword(password: string): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>('verifyPassword', { password });
}

export function addGame(payload: GamePayload): Promise<Game> {
  return apiPost<Game>('addGame', payload);
}

export function editGame(gameId: string, payload: GamePayload): Promise<Game> {
  return apiPost<Game>('editGame', { game_id: gameId, ...payload });
}

export function deleteGame(gameId: string): Promise<{ game_id: string; deleted: true }> {
  return apiPost('deleteGame', { game_id: gameId });
}

export function settlePlayer(
  playerKey: string
): Promise<{ player_key: string; amount_settled: number; new_balance: 0; settlement_id: string }> {
  return apiPost('settlePlayer', { player_key: playerKey });
}

export function updateSettings(patch: {
  price_per_shuttle?: number;
  payment_details?: string;
}): Promise<Settings> {
  return apiPost<Settings>('updateSettings', patch);
}
