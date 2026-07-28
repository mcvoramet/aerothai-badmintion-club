var SETTINGS_PASSWORD_KEY = 'settings_password';
var DEFAULT_SETTINGS_PASSWORD = 'aerothaibadmintonclub2026';

function readSettingsMap_() {
  var rows = readSheetAsObjects(getSheet(SHEET_NAMES.SETTINGS));
  var map = {};
  rows.forEach(function (r) {
    map[r.key] = { value: r.value, updated_at: r.updated_at, row: r.__row };
  });
  return map;
}

// Never includes the settings password — that value only ever leaves the sheet
// through verifyPassword's boolean answer.
function getSettings() {
  var map = readSettingsMap_();
  return {
    price_per_shuttle: map.price_per_shuttle ? Number(map.price_per_shuttle.value) : 0,
    payment_details: map.payment_details ? String(map.payment_details.value) : '',
    updated_at: map.price_per_shuttle ? map.price_per_shuttle.updated_at : null,
  };
}

function upsertSetting_(key, value) {
  var sheet = getSheet(SHEET_NAMES.SETTINGS);
  var map = readSettingsMap_();
  var ts = nowIso();
  if (map[key]) {
    updateObjectRow(sheet, map[key].row, { key: key, value: value, updated_at: ts });
  } else {
    appendObjectRow(sheet, { key: key, value: value, updated_at: ts });
  }
  return ts;
}

function updateSettings(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var touched = false;

    if (payload.price_per_shuttle !== undefined && payload.price_per_shuttle !== '') {
      var price = Number(payload.price_per_shuttle);
      if (!isFinite(price) || price < 0) {
        throw new Error('ราคาลูกขนไก่ต้องเป็นตัวเลขที่ไม่ติดลบ');
      }
      upsertSetting_('price_per_shuttle', price);
      touched = true;
    }

    if (payload.payment_details !== undefined) {
      upsertSetting_('payment_details', String(payload.payment_details));
      touched = true;
    }

    if (!touched) throw new Error('ไม่มีข้อมูลที่ต้องบันทึก');
    return getSettings();
  } finally {
    lock.releaseLock();
  }
}

function verifyPassword(payload) {
  var map = readSettingsMap_();
  var expected = map[SETTINGS_PASSWORD_KEY]
    ? String(map[SETTINGS_PASSWORD_KEY].value)
    : DEFAULT_SETTINGS_PASSWORD;
  if (String((payload && payload.password) || '') !== expected) {
    throw new Error('รหัสผ่านไม่ถูกต้อง');
  }
  return { ok: true };
}
