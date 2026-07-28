// A game holds 1–4 players; unused player slots are left blank in the sheet.
function rowToGame_(r) {
  var players = [];
  for (var i = 1; i <= 4; i++) {
    var key = r['player' + i + '_key'];
    if (!key) continue;
    players.push({
      player_key: key,
      nickname: r['player' + i + '_nickname'],
      department: r['player' + i + '_department'],
    });
  }
  return {
    game_id: r.game_id,
    timestamp: r.timestamp,
    players: players,
    shuttles_used: Number(r.shuttles_used),
    price_per_shuttle_at_time: Number(r.price_per_shuttle_at_time),
    total_cost: Number(r.total_cost),
    cost_per_player: Number(r.cost_per_player),
    edited_at: r.edited_at || null,
  };
}

function validateGamePayload_(payload) {
  if (
    !payload ||
    !Array.isArray(payload.players) ||
    payload.players.length < 1 ||
    payload.players.length > 4
  ) {
    throw new Error('ต้องระบุผู้เล่นอย่างน้อย 1 คน และไม่เกิน 4 คน');
  }
  payload.players.forEach(function (p) {
    if (!p || !String(p.nickname || '').trim() || !String(p.department || '').trim()) {
      throw new Error('กรุณาระบุชื่อเล่นและกองของผู้เล่นให้ครบทุกคน');
    }
  });
  var shuttles = Number(payload.shuttles_used);
  if (!isFinite(shuttles) || shuttles <= 0 || Math.floor(shuttles) !== shuttles) {
    throw new Error('จำนวนลูกขนไก่ต้องเป็นจำนวนเต็มที่มากกว่า 0');
  }
  return shuttles;
}

// Games can be logged onto a day chosen in the calendar, so the client may send
// an explicit ISO timestamp. Falls back to "now" when omitted.
function resolveTimestamp_(value) {
  if (!value) return nowIso();
  var d = new Date(value);
  if (isNaN(d.getTime())) throw new Error('วันที่ไม่ถูกต้อง');
  return d.toISOString();
}

function findGameRow_(sheet, gameId) {
  var rows = readSheetAsObjects(sheet);
  var match = rows.filter(function (r) {
    return r.game_id === gameId;
  })[0];
  if (!match) throw new Error('ไม่พบเกมนี้: ' + gameId);
  return match;
}

function getRecentGames(payload) {
  var limit = payload && payload.limit ? Number(payload.limit) : 20;
  var sheet = getSheet(SHEET_NAMES.GAMES);
  var rows = readSheetAsObjects(sheet);
  var games = rows
    .filter(function (r) {
      return !isDeleted_(r.deleted);
    })
    .map(rowToGame_)
    .sort(function (a, b) {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
  return games.slice(0, limit);
}

// Returns non-deleted games with timestamp in [start, end). Boundaries are ISO
// strings computed client-side from the viewer's local timezone, so day
// grouping stays correct regardless of the script's timezone.
function getGamesInRange(payload) {
  if (!payload || !payload.start || !payload.end) {
    throw new Error('ต้องระบุช่วงเวลา start และ end');
  }
  var start = new Date(payload.start);
  var end = new Date(payload.end);
  var sheet = getSheet(SHEET_NAMES.GAMES);
  return readSheetAsObjects(sheet)
    .filter(function (r) {
      if (isDeleted_(r.deleted)) return false;
      var t = new Date(r.timestamp);
      return t >= start && t < end;
    })
    .map(rowToGame_)
    .sort(function (a, b) {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
}

function addGame(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var shuttles = validateGamePayload_(payload);
    var settings = getSettings();
    var price = settings.price_per_shuttle;
    var total = round2_(shuttles * price);
    // Split across however many players were logged, not always 4.
    var perPlayer = round2_(total / payload.players.length);
    var ts = resolveTimestamp_(payload.timestamp);
    var gameId = makeId('G');

    var keys = payload.players.map(function (p) {
      return findOrCreatePlayer_(String(p.nickname).trim(), String(p.department).trim());
    });

    var row = {
      game_id: gameId,
      timestamp: ts,
      shuttles_used: shuttles,
      price_per_shuttle_at_time: price,
      total_cost: total,
      cost_per_player: perPlayer,
      edited_at: '',
      deleted: '',
    };
    for (var i = 0; i < 4; i++) {
      var slot = 'player' + (i + 1);
      row[slot + '_key'] = i < keys.length ? keys[i] : '';
      row[slot + '_nickname'] = i < keys.length ? String(payload.players[i].nickname).trim() : '';
      row[slot + '_department'] =
        i < keys.length ? String(payload.players[i].department).trim() : '';
    }
    var sheet = getSheet(SHEET_NAMES.GAMES);
    appendObjectRow(sheet, row);
    return rowToGame_(row);
  } finally {
    lock.releaseLock();
  }
}

function editGame(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!payload || !payload.game_id) throw new Error('ต้องระบุ game_id');
    var shuttles = validateGamePayload_(payload);
    var sheet = getSheet(SHEET_NAMES.GAMES);
    var existing = findGameRow_(sheet, payload.game_id);
    if (isDeleted_(existing.deleted)) {
      throw new Error('เกมนี้ถูกลบไปแล้ว แก้ไขไม่ได้');
    }

    // Price is frozen from the original entry — edits never re-price at today's setting.
    var price = Number(existing.price_per_shuttle_at_time);
    var total = round2_(shuttles * price);
    var perPlayer = round2_(total / payload.players.length);
    var ts = nowIso();

    var keys = payload.players.map(function (p) {
      return findOrCreatePlayer_(String(p.nickname).trim(), String(p.department).trim());
    });

    var row = {
      game_id: existing.game_id,
      timestamp: payload.timestamp
        ? resolveTimestamp_(payload.timestamp)
        : existing.timestamp,
      shuttles_used: shuttles,
      price_per_shuttle_at_time: price,
      total_cost: total,
      cost_per_player: perPlayer,
      edited_at: ts,
      deleted: existing.deleted || '',
    };
    // Slots beyond the new player count are blanked out, so shrinking a game
    // from 4 players to 2 doesn't leave stale names behind.
    for (var i = 0; i < 4; i++) {
      var slot = 'player' + (i + 1);
      row[slot + '_key'] = i < keys.length ? keys[i] : '';
      row[slot + '_nickname'] = i < keys.length ? String(payload.players[i].nickname).trim() : '';
      row[slot + '_department'] =
        i < keys.length ? String(payload.players[i].department).trim() : '';
    }
    updateObjectRow(sheet, existing.__row, row);
    return rowToGame_(row);
  } finally {
    lock.releaseLock();
  }
}

function deleteGame(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!payload || !payload.game_id) throw new Error('ต้องระบุ game_id');
    var sheet = getSheet(SHEET_NAMES.GAMES);
    var existing = findGameRow_(sheet, payload.game_id);
    var col = headerIndex_(sheet, 'deleted') + 1;
    sheet.getRange(existing.__row, col).setValue(true);
    return { game_id: payload.game_id, deleted: true };
  } finally {
    lock.releaseLock();
  }
}
