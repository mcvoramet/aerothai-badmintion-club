import type {
  BootstrapData,
  Game,
  GamePayload,
  LineStatus,
  OutstandingPlayer,
  PaymentConfirmation,
  PaymentMethod,
  Player,
  PlayerBalance,
  Settings,
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

/** Settings + players + the month's games in one round trip. */
export function bootstrap(start: string, end: string): Promise<BootstrapData> {
  return apiGet<BootstrapData>('bootstrap', { start, end });
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

export function getLineStatus(): Promise<LineStatus> {
  return apiGet<LineStatus>('getLineStatus');
}

/**
 * Settles the player and announces it in the LINE group.
 *
 * A transfer must carry a slip; cash carries none, since there is nothing to
 * photograph when money changes hands at the court. The settlement is committed
 * first, so `announced: false` means the payment was recorded but the group
 * message failed — never that the payment was lost.
 */
export function confirmPayment(payload: {
  playerKey: string;
  method: PaymentMethod;
  slipBase64?: string;
  slipMimeType?: string;
}): Promise<PaymentConfirmation> {
  return apiPost<PaymentConfirmation>('confirmPayment', {
    player_key: payload.playerKey,
    method: payload.method,
    slip_base64: payload.slipBase64 ?? '',
    slip_mime_type: payload.slipMimeType ?? '',
  });
}

/**
 * Posts the current outstanding list into the linked LINE group as a Flex
 * Message. Password-gated server-side: unlike settlePlayer this is
 * outward-facing, so a leaked /exec URL shouldn't let anyone spam the group.
 */
export function pushOutstandingToLine(password: string): Promise<{ sent: number }> {
  return apiPost<{ sent: number }>('pushOutstandingToLine', { password });
}
