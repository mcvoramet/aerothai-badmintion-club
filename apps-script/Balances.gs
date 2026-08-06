function getGamesForPlayer_(playerKeyValue) {
  var sheet = getSheet(SHEET_NAMES.GAMES);
  var rows = readSheetAsObjects(sheet);
  return rows.filter(function (r) {
    if (isDeleted_(r.deleted)) return false;
    return (
      [r.player1_key, r.player2_key, r.player3_key, r.player4_key].indexOf(playerKeyValue) !== -1
    );
  });
}

function getSettlementsForPlayer_(playerKeyValue) {
  var sheet = getSheet(SHEET_NAMES.SETTLEMENTS);
  var rows = readSheetAsObjects(sheet);
  return rows.filter(function (r) {
    return r.player_key === playerKeyValue;
  });
}

// When a game was LOGGED, not when it was played. makeId() embeds Date.now()
// as 'G-<epoch>-<rand>'. Falls back to the played date for hand-entered rows.
function createdAtOf_(row) {
  var parts = String(row.game_id || '').split('-');
  var epoch = parts.length > 1 ? Number(parts[1]) : NaN;
  return isFinite(epoch) && epoch > 0 ? epoch : new Date(row.timestamp).getTime();
}

// Epoch ms of the player's most recent payment, or null if they've never paid.
function settledCutoff_(settlements) {
  var last = null;
  settlements.forEach(function (s) {
    var t = new Date(s.timestamp).getTime();
    if (isFinite(t) && (last === null || t > last)) last = t;
  });
  return last;
}

// Paying closes the books at that moment: everything logged up to then is done
// with, and the player starts over from zero. So what they owe is simply the
// games logged AFTER their last payment.
//
// Two things this deliberately gets right:
//   - It keys off when a game was LOGGED, not when it was played, so a game
//     back-dated into an already-paid day is still charged.
//   - Deleting a game that was already paid for does NOT create credit against
//     future games. The old code derived the balance as (all owed - all paid),
//     which left a phantom credit behind whenever a settled game was deleted.
//
// This is the single definition of "unpaid" — the balance is the sum of exactly
// these rows, so the total and the itemised list can never disagree.
function unpaidGamesFor_(playerKeyValue) {
  var cutoff = settledCutoff_(getSettlementsForPlayer_(playerKeyValue));
  return getGamesForPlayer_(playerKeyValue)
    .filter(function (g) {
      return cutoff === null || createdAtOf_(g) > cutoff;
    })
    .sort(function (a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
}

function computeBalance_(playerKeyValue) {
  var settlements = getSettlementsForPlayer_(playerKeyValue);
  var cutoff = settledCutoff_(settlements);
  var allGames = getGamesForPlayer_(playerKeyValue);
  var unpaid = allGames
    .filter(function (g) {
      return cutoff === null || createdAtOf_(g) > cutoff;
    })
    .sort(function (a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
  var balance = round2_(
    unpaid.reduce(function (sum, g) {
      return sum + Number(g.cost_per_player);
    }, 0)
  );
  return {
    balance: balance,
    games: allGames,
    unpaid: unpaid,
    settlements: settlements,
    cutoff: cutoff,
  };
}

function getPlayerBalance(payload) {
  if (!payload || !payload.player_key) throw new Error('ต้องระบุ player_key');
  var player = findPlayerByKey_(payload.player_key);
  var calc = computeBalance_(payload.player_key);
  var unpaid = calc.unpaid;

  var shuttles = unpaid.reduce(function (sum, g) {
    return sum + Number(g.shuttles_used);
  }, 0);

  return {
    player_key: player.player_key,
    nickname: player.nickname,
    department: player.department,
    balance: calc.balance,
    games_count: calc.games.length,
    last_game_at: calc.games.length
      ? calc.games
          .slice()
          .sort(function (a, b) {
            return new Date(b.timestamp) - new Date(a.timestamp);
          })[0].timestamp
      : null,
    unpaid_games: unpaid.length,
    unpaid_shuttles: shuttles,
    unpaid_from: unpaid.length ? unpaid[0].timestamp : null,
    unpaid_to: unpaid.length ? unpaid[unpaid.length - 1].timestamp : null,
    last_settled_at: calc.cutoff === null ? null : new Date(calc.cutoff).toISOString(),
    games: unpaid.map(rowToGame_),
  };
}

// Ranked list of everyone who still owes money, biggest debt first.
// Uses the same "logged after your last payment" rule as getPlayerBalance, so
// the ranking and the detail popup always show the same number.
function getOutstanding() {
  var players = readSheetAsObjects(getSheet(SHEET_NAMES.PLAYERS));
  var gameRows = readSheetAsObjects(getSheet(SHEET_NAMES.GAMES)).filter(function (r) {
    return !isDeleted_(r.deleted);
  });
  var settleRows = readSheetAsObjects(getSheet(SHEET_NAMES.SETTLEMENTS));

  var cutoff = {};
  settleRows.forEach(function (s) {
    var t = new Date(s.timestamp).getTime();
    if (!isFinite(t)) return;
    if (cutoff[s.player_key] === undefined || t > cutoff[s.player_key]) {
      cutoff[s.player_key] = t;
    }
  });

  var owed = {};
  var lastGameAt = {};
  gameRows.forEach(function (r) {
    var createdAt = createdAtOf_(r);
    for (var i = 1; i <= 4; i++) {
      var key = r['player' + i + '_key'];
      if (!key) continue;
      if (!lastGameAt[key] || new Date(r.timestamp) > new Date(lastGameAt[key])) {
        lastGameAt[key] = r.timestamp;
      }
      if (cutoff[key] !== undefined && createdAt <= cutoff[key]) continue; // already paid
      owed[key] = (owed[key] || 0) + Number(r.cost_per_player);
    }
  });

  return players
    .map(function (p) {
      return {
        player_key: p.player_key,
        nickname: p.nickname,
        department: p.department,
        balance: round2_(owed[p.player_key] || 0),
        last_game_at: lastGameAt[p.player_key] || null,
      };
    })
    .filter(function (p) {
      return p.balance > 0.001;
    })
    .sort(function (a, b) {
      return b.balance - a.balance;
    });
}

function settlePlayer(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!payload || !payload.player_key) throw new Error('ต้องระบุ player_key');
    var player = findPlayerByKey_(payload.player_key);
    var calc = computeBalance_(payload.player_key);
    var amount = calc.balance;
    if (amount <= 0) throw new Error('ผู้เล่นนี้ไม่มียอดค้างชำระ');

    var sheet = getSheet(SHEET_NAMES.SETTLEMENTS);
    var settlementId = makeId('S');
    var ts = nowIso();
    appendObjectRow(sheet, {
      settlement_id: settlementId,
      player_key: player.player_key,
      nickname: player.nickname,
      department: player.department,
      amount: amount,
      timestamp: ts,
      source: payload.source === 'line' ? 'line' : 'app',
      line_user_id: payload.line_user_id ? String(payload.line_user_id) : '',
      method: payload.method === 'cash' ? 'cash' : 'transfer',
    });
    return {
      player_key: player.player_key,
      amount_settled: amount,
      new_balance: 0,
      settlement_id: settlementId,
    };
  } finally {
    lock.releaseLock();
  }
}
