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
  /** Only set on unpaid-game lists: what's still owed on this game. Equals
   *  cost_per_player unless an earlier payment partly covered it. */
  amount_due?: number;
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
