function getPlayers() {
  var sheet = getSheet(SHEET_NAMES.PLAYERS);
  var rows = readSheetAsObjects(sheet);
  rows.sort(function (a, b) {
    return new Date(b.last_seen) - new Date(a.last_seen);
  });
  return rows.map(function (r) {
    return {
      player_key: r.player_key,
      nickname: r.nickname,
      department: r.department,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      games_count: Number(r.games_count) || 0,
    };
  });
}

// Must be called while the caller already holds the script lock (e.g. from addGame).
function findOrCreatePlayer_(nickname, department) {
  var sheet = getSheet(SHEET_NAMES.PLAYERS);
  var rows = readSheetAsObjects(sheet);
  var key = playerKey(nickname, department);
  var ts = nowIso();
  var existing = rows.filter(function (r) {
    return r.player_key === key;
  })[0];
  if (existing) {
    updateObjectRow(sheet, existing.__row, {
      player_key: key,
      nickname: nickname,
      department: department,
      first_seen: existing.first_seen,
      last_seen: ts,
      games_count: (Number(existing.games_count) || 0) + 1,
    });
  } else {
    appendObjectRow(sheet, {
      player_key: key,
      nickname: nickname,
      department: department,
      first_seen: ts,
      last_seen: ts,
      games_count: 1,
    });
  }
  return key;
}

function findPlayerByKey_(playerKeyValue) {
  var sheet = getSheet(SHEET_NAMES.PLAYERS);
  var rows = readSheetAsObjects(sheet);
  var match = rows.filter(function (r) {
    return r.player_key === playerKeyValue;
  })[0];
  if (!match) throw new Error('ไม่พบผู้เล่นนี้: ' + playerKeyValue);
  return match;
}

// ---------------------------------------------------------------------------
// Merging two people who were logged under different names
//
// The same person gets written down with whatever honorific fit the moment —
// "น้องไอลีน" one week, "พี่ลีน" the next — and because player_key is
// `nickname|department`, that splits one person into two players: two
// histories, two balances, and a debt that only ever half-settles.
//
// Merging rewrites every reference to the source key over to the target's key.
// Renaming is part of the same operation rather than a separate step: the key
// is derived from the name, so "merge and keep the new name" also moves the
// target's own rows onto a new key.
function mergePlayers(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var targetKey = String((payload && payload.target_key) || '').trim();
    var sourceKey = String((payload && payload.source_key) || '').trim();
    if (!targetKey) throw new Error('ต้องระบุ target_key');
    if (sourceKey && sourceKey === targetKey) throw new Error('รวมผู้เล่นคนเดียวกันไม่ได้');

    var sheet = getSheet(SHEET_NAMES.PLAYERS);
    var rows = readSheetAsObjects(sheet);
    var target = rows.filter(function (r) {
      return r.player_key === targetKey;
    })[0];
    if (!target) throw new Error('ไม่พบผู้เล่นนี้: ' + targetKey);
    // A source that was never saved (a name typed for the first time) has
    // nothing to move, so this stays a plain rename of the target.
    var source = sourceKey
      ? rows.filter(function (r) {
          return r.player_key === sourceKey;
        })[0]
      : null;

    var nickname = String((payload && payload.nickname) || target.nickname).trim();
    var department = String((payload && payload.department) || target.department).trim();
    if (!nickname || !department) throw new Error('กรุณาระบุชื่อเล่นและกอง');
    var finalKey = playerKey(nickname, department);

    // Renaming onto a third person's key would swallow them silently.
    var collision = rows.filter(function (r) {
      return r.player_key === finalKey && r.player_key !== targetKey && r.player_key !== sourceKey;
    })[0];
    if (collision) {
      throw new Error('มีผู้เล่น "' + nickname + ' (' + department + ')" อยู่แล้ว — ใช้ชื่อนั้นเป็นชื่อหลักแทน');
    }

    var oldKeys = sourceKey ? [targetKey, sourceKey] : [targetKey];
    var gamesUpdated = rewritePlayerKeyInGames_(oldKeys, finalKey, nickname, department);
    var settlementsUpdated = rewritePlayerKeyInSettlements_(oldKeys, finalKey, nickname, department);

    var merged = {
      player_key: finalKey,
      nickname: nickname,
      department: department,
      first_seen: earlierIso_(target.first_seen, source ? source.first_seen : ''),
      last_seen: laterIso_(target.last_seen, source ? source.last_seen : ''),
      games_count:
        (Number(target.games_count) || 0) + (source ? Number(source.games_count) || 0 : 0),
    };
    // Written before the delete: removing a row shifts everything below it up,
    // which would invalidate target.__row if the source sits above it.
    updateObjectRow(sheet, target.__row, merged);
    if (source) sheet.deleteRow(source.__row);

    return {
      player: merged,
      merged_from: sourceKey || null,
      games_updated: gamesUpdated,
      settlements_updated: settlementsUpdated,
    };
  } finally {
    lock.releaseLock();
  }
}

// Sheet cells come back as strings for ISO timestamps, but a sheet that was
// edited by hand can hand back a Date instead.
function isoOf_(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function pickIso_(a, b, keepLater) {
  var left = isoOf_(a);
  var right = isoOf_(b);
  if (!left) return right;
  if (!right) return left;
  var lt = new Date(left).getTime();
  var rt = new Date(right).getTime();
  if (!isFinite(lt)) return right;
  if (!isFinite(rt)) return left;
  return (keepLater ? rt > lt : rt < lt) ? right : left;
}

function earlierIso_(a, b) {
  return pickIso_(a, b, false);
}

function laterIso_(a, b) {
  return pickIso_(a, b, true);
}

// Deleted games are rewritten too: they're still the audit trail, and leaving
// a dead key behind would make a restored row point at nobody.
function rewritePlayerKeyInGames_(oldKeys, newKey, nickname, department) {
  var sheet = getSheet(SHEET_NAMES.GAMES);
  var cols = {};
  for (var slot = 1; slot <= 4; slot++) {
    cols[slot] = {
      key: headerIndex_(sheet, 'player' + slot + '_key') + 1,
      nickname: headerIndex_(sheet, 'player' + slot + '_nickname') + 1,
      department: headerIndex_(sheet, 'player' + slot + '_department') + 1,
    };
  }
  var touched = 0;
  readSheetAsObjects(sheet).forEach(function (r) {
    var changed = false;
    for (var i = 1; i <= 4; i++) {
      var key = r['player' + i + '_key'];
      if (!key || oldKeys.indexOf(key) === -1) continue;
      if (
        key === newKey &&
        r['player' + i + '_nickname'] === nickname &&
        r['player' + i + '_department'] === department
      ) {
        continue; // already says exactly this
      }
      sheet.getRange(r.__row, cols[i].key).setValue(newKey);
      sheet.getRange(r.__row, cols[i].nickname).setValue(nickname);
      sheet.getRange(r.__row, cols[i].department).setValue(department);
      changed = true;
    }
    if (changed) touched++;
  });
  return touched;
}

// Settlements carry the cutoff that decides what's still owed, so they have to
// move with the games — a payment left on the old key would stop counting.
function rewritePlayerKeyInSettlements_(oldKeys, newKey, nickname, department) {
  var sheet = getSheet(SHEET_NAMES.SETTLEMENTS);
  var keyCol = headerIndex_(sheet, 'player_key') + 1;
  var nicknameCol = headerIndex_(sheet, 'nickname') + 1;
  var departmentCol = headerIndex_(sheet, 'department') + 1;
  var touched = 0;
  readSheetAsObjects(sheet).forEach(function (r) {
    if (!r.player_key || oldKeys.indexOf(r.player_key) === -1) return;
    if (r.player_key === newKey && r.nickname === nickname && r.department === department) return;
    sheet.getRange(r.__row, keyCol).setValue(newKey);
    sheet.getRange(r.__row, nicknameCol).setValue(nickname);
    sheet.getRange(r.__row, departmentCol).setValue(department);
    touched++;
  });
  return touched;
}
