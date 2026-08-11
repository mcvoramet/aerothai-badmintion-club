export interface Player {
  player_key: string;
  nickname: string;
  department: string;
  first_seen: string;
  last_seen: string;
  games_count: number;
}

export interface PlayerRef {
  player_key: string;
  nickname: string;
  department: string;
}

export interface Game {
  game_id: string;
  timestamp: string;
  players: PlayerRef[];
  shuttles_used: number;
  price_per_shuttle_at_time: number;
  total_cost: number;
  cost_per_player: number;
  edited_at: string | null;
}

/**
 * A saved edit. Editing a game moves what people owe, so the bot announces it
 * in the group — `line_warning` is set when the game was saved but that
 * announcement failed, never when the save itself failed.
 */
export interface GameEdit extends Game {
  line_warning: string | null;
}

export interface GameDeletion {
  game_id: string;
  deleted: true;
  line_warning: string | null;
}

export interface PlayerBalance {
  player_key: string;
  nickname: string;
  department: string;
  balance: number;
  games_count: number;
  last_game_at: string | null;
  unpaid_games: number;
  unpaid_shuttles: number;
  unpaid_from: string | null;
  unpaid_to: string | null;
  last_settled_at: string | null;
  games: Game[];
}

export interface OutstandingPlayer {
  player_key: string;
  nickname: string;
  department: string;
  balance: number;
  last_game_at: string | null;
}

export interface Settings {
  price_per_shuttle: number;
  payment_details: string;
  updated_at: string | null;
}

export interface LineStatus {
  /** Channel access token + webhook secret are both set in Script Properties. */
  configured: boolean;
  /** The bot has seen at least one event, so it knows which chat to push to. */
  linked: boolean;
  /** LINE_LIFF_URL is set, so the bubble can deep-link into the pay screen. */
  app_url_set: boolean;
  /** Typing any of these in the chat makes the bot post the list. */
  trigger_words: string[];
  last_pushed_at: string | null;
}

/** 'cash' skips the slip — there's nothing to photograph at the court. */
export type PaymentMethod = 'transfer' | 'cash';

export interface PaymentConfirmation {
  player_key: string;
  amount_settled: number;
  new_balance: 0;
  settlement_id: string;
  /** False when the payment was recorded but the LINE announcement failed. */
  announced: boolean;
  warning: string | null;
}

/** Everything the calendar screen needs, fetched in one request. */
export interface BootstrapData {
  settings: Settings;
  players: Player[];
  games: Game[];
}

export interface PlayerInput {
  nickname: string;
  department: string;
}

export interface GamePayload {
  players: PlayerInput[];
  shuttles_used: number;
  /** ISO timestamp built from the day picked in the calendar. Omit to use "now". */
  timestamp?: string;
}
