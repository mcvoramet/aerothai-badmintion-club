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

function computeBalance_(playerKeyValue) {
  var games = getGamesForPlayer_(playerKeyValue);
  var settlements = getSettlementsForPlayer_(playerKeyValue);
  var owed = games.reduce(function (sum, g) {
    return sum + Number(g.cost_per_player);
  }, 0);
  var paid = settlements.reduce(function (sum, s) {
    return sum + Number(s.amount);
  }, 0);
  return {
    owed: owed,
    paid: paid,
    balance: round2_(owed - paid),
    games: games,
    settlements: settlements,
  };
}

function lastSettlementAt_(settlements) {
  var last = null;
  settlements.forEach(function (s) {
    var t = new Date(s.timestamp);
    if (!last || t > last) last = t;
  });
  return last;
}

// When a game was LOGGED, not when it was played. makeId() embeds Date.now()
// as 'G-<epoch>-<rand>'. A settlement can only ever have covered games that
// already existed, so this — not the played date — is the right order to apply
// payments in. Falls back to the played date for anything hand-entered.
function createdAtOf_(row) {
  var parts = String(row.game_id || '').split('-');
  var epoch = parts.length > 1 ? Number(parts[1]) : NaN;
  return isFinite(epoch) && epoch > 0 ? epoch : new Date(row.timestamp).getTime();
}

// Applies everything the player has already paid against their games, oldest
// first, and returns whatever is left over.
//
// This must stay the ONLY definition of "unpaid". Previously the balance was
// money-based (owed - paid) while the list was time-based (games newer than the
// last settlement); the two disagreed whenever a game was back-dated into an
// already-settled period, or a settled game was deleted. Deriving the list from
// the same arithmetic as the balance makes them agree by construction.
function unpaidGames_(games, paid) {
  var sorted = games.slice().sort(function (a, b) {
    return createdAtOf_(a) - createdAtOf_(b);
  });
  var credit = paid;
  var unpaid = [];
  sorted.forEach(function (g) {
    var share = Number(g.cost_per_player);
    if (credit >= share) {
      credit = round2_(credit - share); // fully covered by an earlier payment
      return;
    }
    unpaid.push({ row: g, amount_due: round2_(share - credit) });
    credit = 0;
  });
  return unpaid;
}

function getPlayerBalance(payload) {
  if (!payload || !payload.player_key) throw new Error('ต้องระบุ player_key');
  var player = findPlayerByKey_(payload.player_key);
  var calc = computeBalance_(payload.player_key);
  var settledAt = lastSettlementAt_(calc.settlements);

  var unpaid = unpaidGames_(calc.games, calc.paid).sort(function (a, b) {
    return new Date(a.row.timestamp) - new Date(b.row.timestamp);
  });

  var shuttles = unpaid.reduce(function (sum, u) {
    return sum + Number(u.row.shuttles_used);
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
    unpaid_from: unpaid.length ? unpaid[0].row.timestamp : null,
    unpaid_to: unpaid.length ? unpaid[unpaid.length - 1].row.timestamp : null,
    last_settled_at: settledAt ? settledAt.toISOString() : null,
    // amount_due is what's still owed on this game — normally the full share,
    // but less when an earlier payment partly covered it.
    games: unpaid.map(function (u) {
      var game = rowToGame_(u.row);
      game.amount_due = u.amount_due;
      return game;
    }),
  };
}

// Ranked list of everyone who still owes money, biggest debt first.
function getOutstanding() {
  var players = readSheetAsObjects(getSheet(SHEET_NAMES.PLAYERS));
  var gameRows = readSheetAsObjects(getSheet(SHEET_NAMES.GAMES)).filter(function (r) {
    return !isDeleted_(r.deleted);
  });
  var settleRows = readSheetAsObjects(getSheet(SHEET_NAMES.SETTLEMENTS));

  var owed = {};
  var paid = {};
  var lastGameAt = {};
  gameRows.forEach(function (r) {
    for (var i = 1; i <= 4; i++) {
      var key = r['player' + i + '_key'];
      if (!key) continue;
      owed[key] = (owed[key] || 0) + Number(r.cost_per_player);
      if (!lastGameAt[key] || new Date(r.timestamp) > new Date(lastGameAt[key])) {
        lastGameAt[key] = r.timestamp;
      }
    }
  });
  settleRows.forEach(function (s) {
    paid[s.player_key] = (paid[s.player_key] || 0) + Number(s.amount);
  });

  return players
    .map(function (p) {
      return {
        player_key: p.player_key,
        nickname: p.nickname,
        department: p.department,
        balance: round2_((owed[p.player_key] || 0) - (paid[p.player_key] || 0)),
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
