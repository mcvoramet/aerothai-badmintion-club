var SHEET_NAMES = {
  PLAYERS: 'Players',
  GAMES: 'Games',
  SETTLEMENTS: 'Settlements',
  SETTINGS: 'Settings',
};

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีต: ' + name);
  return sheet;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

function playerKey(nickname, department) {
  return String(nickname).trim() + '|' + String(department).trim();
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function isDeleted_(value) {
  return value === true || value === 'TRUE';
}

// Reads a sheet's data range into an array of plain objects keyed by the header row (row 1).
// Skips fully-blank rows. Adds __row (1-indexed sheet row number) for later updates.
function readSheetAsObjects(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    var hasValue = false;
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
      if (row[j] !== '' && row[j] !== null && row[j] !== undefined) hasValue = true;
    }
    if (hasValue) {
      obj.__row = i + 1;
      rows.push(obj);
    }
  }
  return rows;
}

function appendObjectRow(sheet, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '';
  });
  sheet.appendRow(row);
}

function updateObjectRow(sheet, rowIndex, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '';
  });
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
}

function headerIndex_(sheet, headerName) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = headers.indexOf(headerName);
  if (idx === -1) throw new Error('ไม่พบคอลัมน์: ' + headerName);
  return idx;
}
