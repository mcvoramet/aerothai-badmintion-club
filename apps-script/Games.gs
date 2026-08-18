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

// Slot keys for a payload, creating players as needed.
//
// A person may hold more than one slot when they're covering someone else's
// share, so the same key can come back twice. The Players row is touched once
// per person even then: it's still one game they played, and games_count would
// otherwise drift up faster than the games they appear in.
function resolvePlayerKeys_(players) {
  var seen = {};
  return players.map(function (p) {
    var nickname = String(p.nickname).trim();
    var department = String(p.department).trim();
    var key = playerKey(nickname, department);
    if (!Object.prototype.hasOwnProperty.call(seen, key)) {
      seen[key] = findOrCreatePlayer_(nickname, department);
    }
    return seen[key];
  });
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

// Tells the LINE group what changed, and swallows anything that goes wrong.
//
// This runs after the sheet has already been written, so a failure here is
// never a failure of the save — it comes back as a warning the app shows next
// to the change. notifyGameChange_ guards its own network calls, but it lives
// in Line.gs, and an Apps Script project holding an older copy of that file
// doesn't have it at all: calling a function that isn't there would otherwise
// throw straight through the write path and make a finished delete look like
// it failed.
function announceGameChange_(kind, before, after) {
  var saved = kind === 'delete' ? 'ลบเกมแล้ว' : 'บันทึกการแก้ไขแล้ว';
  if (typeof notifyGameChange_ !== 'function') {
    return (
      saved +
      ' แต่ยังไม่ได้แจ้งกลุ่ม LINE: ไฟล์ Line.gs ใน Apps Script ยังไม่ใช่เวอร์ชันล่าสุด' +
      ' — คัดลอก Line.gs และ LineFlex.gs ใหม่ แล้ว Deploy → Manage deployments → New version'
    );
  }
  try {
    return notifyGameChange_(kind, before, after);
  } catch (err) {
    var warning =
      saved + ' แต่แจ้งเข้ากลุ่ม LINE ไม่สำเร็จ: ' + (err && err.message ? err.message : err);
    console.error(warning);
    return warning;
  }
}

function addGame(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var shuttles = validateGamePayload_(payload);
    var settings = getSettings();
    var price = settings.price_per_shuttle;
    var total = round2_(shuttles * price);
    // Split across however many slots were logged, not always 4. A person
    // entered twice holds two slots and so pays two of these shares.
    var perPlayer = round2_(total / payload.players.length);
    var ts = resolveTimestamp_(payload.timestamp);
    var gameId = makeId('G');

    var keys = resolvePlayerKeys_(payload.players);

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
  var before, after;
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

    var keys = resolvePlayerKeys_(payload.players);

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
    // Snapshot the old shape before it's overwritten — the LINE announcement is
    // a diff, so it needs both sides.
    before = rowToGame_(existing);
    updateObjectRow(sheet, existing.__row, row);
    after = rowToGame_(row);
  } finally {
    lock.releaseLock();
  }

  // Announced outside the lock: a LINE round trip takes seconds, and nobody
  // else should wait on the chat to save their own game.
  after.line_warning = announceGameChange_('edit', before, after);
  return after;
}

function deleteGame(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var before;
  try {
    if (!payload || !payload.game_id) throw new Error('ต้องระบุ game_id');
    var sheet = getSheet(SHEET_NAMES.GAMES);
    var existing = findGameRow_(sheet, payload.game_id);
    // Deleting stays idempotent, but a second delete must not announce again —
    // the ledger didn't change, so there is nothing to tell the group.
    if (isDeleted_(existing.deleted)) {
      return { game_id: payload.game_id, deleted: true, line_warning: null };
    }
    before = rowToGame_(existing);
    var col = headerIndex_(sheet, 'deleted') + 1;
    sheet.getRange(existing.__row, col).setValue(true);
  } finally {
    lock.releaseLock();
  }

  return {
    game_id: payload.game_id,
    deleted: true,
    line_warning: announceGameChange_('delete', before, null),
  };
}
