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
