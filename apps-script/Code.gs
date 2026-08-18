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

      // LINE webhook deliveries have no `action` — they're { destination, events }.
      // Answer them before the action switch, and always with 200: a non-200
      // makes LINE retry, which for a settle postback means paying twice.
      if (body && body.events) {
        return jsonOut(handleLineWebhook_(e, body));
      }

      action = body.action;
      payload = body;
    } else {
      action = e.parameter.action;
      payload = e.parameter;
    }

    var result;
    switch (action) {
      case 'bootstrap':
        result = bootstrap(payload);
        break;
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
      case 'mergePlayers':
        result = mergePlayers(payload);
        break;
      case 'settlePlayer':
        result = settlePlayer(payload);
        break;
      case 'updateSettings':
        result = updateSettings(payload);
        break;
      case 'getLineStatus':
        result = getLineStatus();
        break;
      case 'pushOutstandingToLine':
        result = pushOutstandingToLine(payload);
        break;
      // confirmPaymentWithSlip is the old name, kept so a browser holding a
      // cached bundle keeps working if the frontend deploys before this does.
      case 'confirmPayment':
      case 'confirmPaymentWithSlip':
        result = confirmPayment(payload);
        break;
      default:
        throw new Error('ไม่รู้จักคำสั่ง: ' + action);
    }
    return jsonOut({ ok: true, data: result });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

// Everything the main screen needs, in a single request.
//
// Each Apps Script call costs ~1s of fixed platform overhead (redirect +
// possible cold start) no matter how little work it does, so the number of
// round trips matters far more than the size of any one response. Folding
// settings + players + the visible month's games into one call is worth more
// than optimising any of them individually.
function bootstrap(payload) {
  return {
    settings: getSettings(),
    players: getPlayers(),
    games: getGamesInRange(payload),
  };
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
    'source',
    'line_user_id',
    'method',
  ]);
  createSheetIfMissing_(ss, SHEET_NAMES.SETTINGS, ['key', 'value', 'updated_at']);

  // Sheets that predate the LINE feature already exist, so createSheetIfMissing_
  // leaves their headers alone. Append the audit columns to them here.
  addColumnsIfMissing_(ss.getSheetByName(SHEET_NAMES.SETTLEMENTS), [
    'source',
    'line_user_id',
    'method',
  ]);

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

// Additive-only header migration: appendObjectRow maps values by header name,
// so a sheet gaining a column keeps working for rows written before it existed.
function addColumnsIfMissing_(sheet, headers) {
  if (!sheet || sheet.getLastRow() === 0) return;
  var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var missing = headers.filter(function (h) {
    return existing.indexOf(h) === -1;
  });
  if (!missing.length) return;
  sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
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
