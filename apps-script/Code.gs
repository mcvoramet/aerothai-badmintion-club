function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

function handleRequest_(e, method) {
  try {
    var action, payload;
    if (method === 'POST') {
      var body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
      action = body.action;
      payload = body;
    } else {
      action = e.parameter.action;
      payload = e.parameter;
    }

    var result;
    switch (action) {
      case 'getPlayers':
        result = getPlayers();
        break;
      case 'getSettings':
        result = getSettings();
        break;
      case 'getRecentGames':
        result = getRecentGames(payload);
        break;
      case 'getGamesInRange':
        result = getGamesInRange(payload);
        break;
      case 'getPlayerBalance':
        result = getPlayerBalance(payload);
        break;
      case 'getStats':
        result = getStats(payload);
        break;
      case 'getSummary':
        result = getSummary(payload);
        break;
      case 'getOutstanding':
        result = getOutstanding();
        break;
      case 'verifyPassword':
        result = verifyPassword(payload);
        break;
      case 'addGame':
        result = addGame(payload);
        break;
      case 'editGame':
        result = editGame(payload);
        break;
      case 'deleteGame':
        result = deleteGame(payload);
        break;
      case 'settlePlayer':
        result = settlePlayer(payload);
        break;
      case 'updateSettings':
        result = updateSettings(payload);
        break;
      default:
        throw new Error('ไม่รู้จักคำสั่ง: ' + action);
    }
    return jsonOut({ ok: true, data: result });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

// One-time convenience setup: run this manually from the Apps Script editor
// (select setupSheets in the function dropdown, click Run) to create the 4
// tabs with the correct headers if they don't exist yet, and seed a default
// price_per_shuttle setting.
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  createSheetIfMissing_(ss, SHEET_NAMES.PLAYERS, [
    'player_key',
    'nickname',
    'department',
    'first_seen',
    'last_seen',
    'games_count',
  ]);
  createSheetIfMissing_(ss, SHEET_NAMES.GAMES, [
    'game_id',
    'timestamp',
    'player1_key',
    'player1_nickname',
    'player1_department',
    'player2_key',
    'player2_nickname',
    'player2_department',
    'player3_key',
    'player3_nickname',
    'player3_department',
    'player4_key',
    'player4_nickname',
    'player4_department',
    'shuttles_used',
    'price_per_shuttle_at_time',
    'total_cost',
    'cost_per_player',
    'edited_at',
    'deleted',
  ]);
  createSheetIfMissing_(ss, SHEET_NAMES.SETTLEMENTS, [
    'settlement_id',
    'player_key',
    'nickname',
    'department',
    'amount',
    'timestamp',
  ]);
  createSheetIfMissing_(ss, SHEET_NAMES.SETTINGS, ['key', 'value', 'updated_at']);

  var settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  var rows = readSheetAsObjects(settingsSheet);
  function seedSetting(key, value) {
    var exists = rows.some(function (r) {
      return r.key === key;
    });
    if (!exists) {
      appendObjectRow(settingsSheet, { key: key, value: value, updated_at: nowIso() });
    }
  }
  seedSetting('price_per_shuttle', 10);
  seedSetting('payment_details', 'ธนาคาร: \nเลขที่บัญชี: \nชื่อบัญชี: \nพร้อมเพย์: ');
  seedSetting(SETTINGS_PASSWORD_KEY, DEFAULT_SETTINGS_PASSWORD);
}

function createSheetIfMissing_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}
