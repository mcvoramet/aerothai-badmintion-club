// LINE Messaging API integration.
//
// Secrets live in Script Properties, never in the Settings sheet: getSettings()
// is a public unauthenticated GET, so anything in that sheet is one bug away
// from being world-readable.
//
// The bot posts four kinds of message:
//   - the outstanding list, pushed from the web app's Settings tab
//   - the same list, replied when someone types the trigger word in the chat
//   - a "ยืนยันชำระแล้ว" announcement with the payer's slip, pushed when
//     someone confirms a payment in the web app
//   - an edit/delete notice for a recorded game, showing what changed and what
//     each player in it now owes
// Settling always happens in the web app, never in the chat, so the webhook
// only ever reads messages — it never changes the ledger.
var LINE_PROP = {
  TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  WEBHOOK_TOKEN: 'LINE_WEBHOOK_TOKEN',
  TARGET_ID: 'LINE_TARGET_ID',
  APP_URL: 'LINE_LIFF_URL',
  TRIGGER_WORD: 'LINE_TRIGGER_WORD',
  SLIP_FOLDER_ID: 'LINE_SLIP_FOLDER_ID',
  LAST_PUSHED_AT: 'LINE_LAST_PUSHED_AT',
  LAST_PUSHED_AT_MS: 'LINE_LAST_PUSHED_AT_MS',
};

var LINE_API_BASE = 'https://api.line.me/v2/bot';
var LINE_PUSH_COOLDOWN_MS = 30000;

// Slips are relayed, not archived. LINE copies the image onto its own CDN when
// the message is sent, so the chat keeps showing it long after the file is gone.
var SLIP_FOLDER_NAME = 'AeroThai Badminton — slips (ชั่วคราว)';
var SLIP_RETENTION_MS = 60 * 60 * 1000;
var SLIP_MAX_BYTES = 8 * 1024 * 1024;

function lineProps_() {
  return PropertiesService.getScriptProperties();
}

function lineProp_(key) {
  return String(lineProps_().getProperty(key) || '');
}

function lineToken_() {
  var token = lineProp_(LINE_PROP.TOKEN);
  if (!token) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties');
  return token;
}

function lineTargetId_() {
  return lineProp_(LINE_PROP.TARGET_ID);
}

// Captured from the webhook so setup is "add the bot to the group and say
// anything once" instead of hunting for a group id.
//
// Deliberately NOT last-write-wins: a member sending the bot a direct message
// would otherwise silently redirect the club's list into their private chat.
// Once a group is locked in, only editing Script Properties by hand moves it.
// A group does replace a 1:1 target, so testing in a DM first then adding the
// bot to the real group works without a manual reset.
function rememberLineTarget_(source) {
  if (!source) return;
  var groupId = source.groupId || source.roomId;
  var id = groupId || source.userId;
  if (!id) return;

  var current = lineTargetId_();
  if (current === id) return;
  // Already pointed at a group: leave it alone.
  if (current && !groupId) return;
  if (current && groupId && isGroupTarget_(current)) return;

  lineProps_().setProperty(LINE_PROP.TARGET_ID, id);
}

// Group ids start with C, multi-person room ids with R, users with U.
function isGroupTarget_(id) {
  return id.charAt(0) === 'C' || id.charAt(0) === 'R';
}

function lineApi_(path, payload) {
  var res = UrlFetchApp.fetch(LINE_API_BASE + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('LINE API ผิดพลาด (' + code + '): ' + res.getContentText());
  }
  return res.getContentText();
}

function linePush_(to, messages) {
  if (!to) throw new Error('ยังไม่ได้เชื่อมกลุ่ม LINE — เพิ่มบอทเข้ากลุ่มแล้วพิมพ์อะไรก็ได้ 1 ครั้ง');
  return lineApi_('/message/push', { to: to, messages: messages });
}

// Replies land in whichever chat sent the message and, unlike pushes, don't
// count against the monthly message quota.
function lineReply_(replyToken, messages) {
  return lineApi_('/message/reply', { replyToken: replyToken, messages: messages });
}

// ---------------------------------------------------------------------------
// Webhook — only to learn the target chat
// ---------------------------------------------------------------------------

// Apps Script's doPost(e) exposes no request headers, so LINE's X-Line-Signature
// can't be verified here. Instead the webhook URL registered in the LINE console
// carries ?lineToken=<secret>, which LINE preserves on every delivery.
function lineWebhookAuthorized_(e) {
  var expected = lineProp_(LINE_PROP.WEBHOOK_TOKEN);
  if (!expected) return false;
  var got = e && e.parameter ? String(e.parameter.lineToken || '') : '';
  return got === expected;
}

// Typing any of these in the chat makes the bot post the current list.
// LINE_TRIGGER_WORD overrides it and accepts a comma-separated list.
var LINE_TRIGGER_WORD = 'ยอดค้างชำระ';

// Thai has two encodings for SARA AM: the precomposed U+0E33 (ำ) that phone
// keyboards produce, and the decomposed NIKHAHIT + SARA AA (U+0E4D U+0E32) that
// some copy-pasted text carries. They look identical, so fold them together
// before comparing or the trigger silently fails for some people.
function normalizeThai_(text) {
  return String(text || '')
    .replace(/ํา/g, 'ำ')
    .replace(/[\s ]+/g, '')
    .replace(/[?!.？！。]+$/, '');
}

// The raw words as configured, for display. Comma-separated, either the ASCII
// comma or the fullwidth one that Thai/Japanese keyboards can produce.
function triggerWords_() {
  var raw = lineProp_(LINE_PROP.TRIGGER_WORD) || LINE_TRIGGER_WORD;
  var words = raw.split(/[,，]/).map(function (w) {
    return w.trim();
  }).filter(function (w) {
    return w.length > 0;
  });
  return words.length ? words : [LINE_TRIGGER_WORD];
}

function isTriggerWord_(text) {
  var actual = normalizeThai_(text);
  if (!actual) return false;
  return triggerWords_().some(function (w) {
    return normalizeThai_(w) === actual;
  });
}

// Always answers ok:true — a non-200 makes LINE retry the delivery.
function handleLineWebhook_(e, body) {
  if (!lineWebhookAuthorized_(e)) return { ok: true };

  var events = body && body.events ? body.events : [];
  events.forEach(function (event) {
    try {
      rememberLineTarget_(event.source);

      if (
        event.type === 'message' &&
        event.message &&
        event.message.type === 'text' &&
        isTriggerWord_(event.message.text)
      ) {
        lineReply_(event.replyToken, [buildOutstandingFlex_(getOutstanding(), nowIso())]);
      }
    } catch (err) {
      console.error('LINE event failed: ' + (err && err.message ? err.message : err));
    }
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Slip hosting
// ---------------------------------------------------------------------------

function slipFolder_() {
  var id = lineProp_(LINE_PROP.SLIP_FOLDER_ID);
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      // Folder was deleted by hand — fall through and make a new one.
    }
  }
  var folder = DriveApp.createFolder(SLIP_FOLDER_NAME);
  lineProps_().setProperty(LINE_PROP.SLIP_FOLDER_ID, folder.getId());
  return folder;
}

// LINE will not accept image bytes in a push: it needs a public https URL it can
// fetch. Drive is the only host already on this stack, so the slip lands there
// just long enough to be delivered, then deleteExpiredSlips_ removes it.
function uploadSlip_(base64, mimeType, nickname) {
  if (!base64) throw new Error('ไม่พบไฟล์สลิป');
  if (String(mimeType).indexOf('image/') !== 0) throw new Error('สลิปต้องเป็นไฟล์รูปภาพเท่านั้น');

  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > SLIP_MAX_BYTES) throw new Error('ไฟล์สลิปใหญ่เกินไป (เกิน 8MB)');

  var ext = mimeType === 'image/png' ? 'png' : 'jpg';
  var blob = Utilities.newBlob(bytes, mimeType, 'slip-' + nickname + '-' + Date.now() + '.' + ext);
  var file = slipFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: file.getId(),
    // Serves the raw image bytes, unlike drive.google.com/uc which can answer
    // with an HTML interstitial that LINE cannot render.
    url: 'https://lh3.googleusercontent.com/d/' + file.getId(),
  };
}

// Run on a time-driven trigger — see setupSlips.
function deleteExpiredSlips_() {
  var id = lineProp_(LINE_PROP.SLIP_FOLDER_ID);
  if (!id) return 0;
  var folder;
  try {
    folder = DriveApp.getFolderById(id);
  } catch (err) {
    return 0;
  }

  var cutoff = Date.now() - SLIP_RETENTION_MS;
  var files = folder.getFiles();
  var removed = 0;
  while (files.hasNext()) {
    var file = files.next();
    if (file.getDateCreated().getTime() < cutoff) {
      file.setTrashed(true);
      removed++;
    }
  }
  return removed;
}

// Run once from the editor after adding the LINE files.
//
// Touching DriveApp here is the point, not a side effect: a web app request can
// never trigger an authorization prompt, so if Drive hasn't been consented to,
// the first real payment fails with "คุณไม่ได้รับอนุญาตให้เรียกใช้ DriveApp".
// Creating the folder from the editor surfaces that prompt while someone is
// there to click Authorize. deleteExpiredSlips_ is private (trailing
// underscore) and so can't be selected in the Run dropdown — this is the
// public entry point that stands in for it.
function setupSlips() {
  var folder = slipFolder_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'deleteExpiredSlips_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('deleteExpiredSlips_').timeBased().everyHours(1).create();

  var message =
    'พร้อมใช้งาน — โฟลเดอร์สลิป: "' +
    folder.getName() +
    '" (id: ' +
    folder.getId() +
    ') และตั้งลบอัตโนมัติทุก 1 ชั่วโมงแล้ว';
  console.log(message);
  return message;
}

// ---------------------------------------------------------------------------
// Actions called from the web app
// ---------------------------------------------------------------------------

function getLineStatus() {
  return {
    configured: !!lineProp_(LINE_PROP.TOKEN) && !!lineProp_(LINE_PROP.WEBHOOK_TOKEN),
    linked: !!lineTargetId_(),
    app_url_set: !!lineProp_(LINE_PROP.APP_URL),
    trigger_words: triggerWords_(),
    last_pushed_at: lineProp_(LINE_PROP.LAST_PUSHED_AT) || null,
  };
}

// Posts the current outstanding list into the linked group. Password-gated
// because unlike settlePlayer this is outward-facing — a leaked /exec URL
// shouldn't let anyone spam the club's LINE group.
function pushOutstandingToLine(payload) {
  verifyPassword(payload);

  var last = Number(lineProp_(LINE_PROP.LAST_PUSHED_AT_MS) || 0);
  var now = Date.now();
  if (last && now - last < LINE_PUSH_COOLDOWN_MS) {
    throw new Error('เพิ่งส่งไปเมื่อสักครู่ กรุณารอสักครู่แล้วลองใหม่');
  }

  var list = getOutstanding();
  linePush_(lineTargetId_(), [buildOutstandingFlex_(list, nowIso())]);

  var props = {};
  props[LINE_PROP.LAST_PUSHED_AT] = nowIso();
  props[LINE_PROP.LAST_PUSHED_AT_MS] = String(now);
  lineProps_().setProperties(props);

  return { sent: list.length };
}

// The web app's "ยืนยันว่าชำระแล้ว" button. Settles first, because the ledger is
// the source of truth and the announcement is only a courtesy — if LINE is down
// the payment must still be recorded. A failed announcement comes back as a
// warning rather than an error so the user isn't told to pay twice.
//
// Cash needs no slip: there is nothing to photograph when money changes hands
// at the court, so the group just gets the text with a cash marker.
function confirmPayment(payload) {
  if (!payload || !payload.player_key) throw new Error('ต้องระบุ player_key');
  var isCash = payload.method === 'cash';
  if (!isCash && !payload.slip_base64) throw new Error('กรุณาแนบสลิปหลักฐานการโอนเงิน');

  var player = findPlayerByKey_(payload.player_key);
  var result = settlePlayer({
    player_key: payload.player_key,
    source: 'app',
    method: isCash ? 'cash' : 'transfer',
  });

  var warning = null;
  var slip = null;
  try {
    if (!isCash) {
      slip = uploadSlip_(payload.slip_base64, payload.slip_mime_type, player.nickname);
    }
    announcePayment_(player, result.amount_settled, slip ? slip.url : null, isCash);
  } catch (err) {
    // Don't leave the slip behind if it never made it into the chat.
    if (slip) {
      try {
        DriveApp.getFileById(slip.id).setTrashed(true);
      } catch (cleanupErr) {
        console.error('slip cleanup failed: ' + cleanupErr);
      }
    }
    warning = 'บันทึกการชำระเงินแล้ว แต่แจ้งเข้ากลุ่ม LINE ไม่สำเร็จ: ' + err.message;
    console.error(warning);
  }

  return {
    player_key: result.player_key,
    amount_settled: result.amount_settled,
    new_balance: 0,
    settlement_id: result.settlement_id,
    announced: !warning,
    warning: warning,
  };
}

// Announces a settlement in the group as three messages in one push:
//   1. who paid
//   2. their slip
//   3. the refreshed list, with that person already gone
//
// Called after settlePlayer has committed, so getOutstanding() here reflects the
// payment — that's what makes the list drop them. LINE messages can't be edited,
// so re-posting the list is the only way to keep the chat current.
function announcePayment_(player, amount, slipUrl, isCash) {
  var messages = [
    {
      type: 'text',
      text:
        player.nickname +
        (player.department ? ' · ' + player.department : '') +
        ' ยืนยันชำระเงิน ✅\nจำนวน ฿' +
        formatAmount_(amount) +
        (isCash ? '\nชำระด้วยเงินสด 💵' : ''),
    },
  ];
  if (slipUrl) {
    messages.push({ type: 'image', originalContentUrl: slipUrl, previewImageUrl: slipUrl });
  }
  messages.push(buildOutstandingFlex_(getOutstanding(), nowIso()));
  linePush_(lineTargetId_(), messages);
}

// ---------------------------------------------------------------------------
// Game edit / delete announcements
// ---------------------------------------------------------------------------

// A game is only ever visible to the group through what people owe, so editing
// or deleting one silently moves money around behind their backs. These pushes
// close that gap: every change to a recorded game is announced with what moved
// and who it moved for.
//
// Best effort by design, like announcePayment_: the sheet is the ledger, and a
// LINE outage must never stop someone correcting a wrong entry. Returns null on
// success, or a warning string the web app can show next to the saved game.
//
// `after` is null for a delete. Silently does nothing until the bot is set up,
// so a fresh install isn't nagged about LINE on every edit.
function notifyGameChange_(kind, before, after) {
  if (!lineProp_(LINE_PROP.TOKEN) || !lineTargetId_()) return null;
  try {
    var affected = affectedPlayers_(before, after);
    linePush_(lineTargetId_(), [
      buildGameChangeFlex_(kind, before, after, affected, nowIso()),
    ]);
    return null;
  } catch (err) {
    var warning =
      (kind === 'delete' ? 'ลบเกมแล้ว' : 'บันทึกการแก้ไขแล้ว') +
      ' แต่แจ้งเข้ากลุ่ม LINE ไม่สำเร็จ: ' +
      (err && err.message ? err.message : err);
    console.error(warning);
    return warning;
  }
}

// Everyone the change touched: whoever was in the game before, whoever is in it
// after, or both. `was`/`now` are what that person owed for the game on each
// side — two shares if they held two slots — and null when they weren't in it — which is what makes an added or removed player
// readable at a glance.
//
// Balances are read after the write has committed, so the number next to each
// name is what they actually owe now, not what they owed a moment ago.
function affectedPlayers_(before, after) {
  var balances = {};
  getOutstanding().forEach(function (p) {
    balances[p.player_key] = p.balance;
  });

  var index = {};
  var order = [];
  function slotFor(player) {
    var entry = index[player.player_key];
    if (!entry) {
      entry = {
        player_key: player.player_key,
        nickname: player.nickname,
        department: player.department,
        was: null,
        now: null,
        balance: round2_(balances[player.player_key] || 0),
      };
      index[player.player_key] = entry;
      order.push(entry);
    }
    return entry;
  }

  // Added up per slot, not per person: somebody covering two shares of the
  // game should see both of them in the number next to their name.
  if (before) {
    before.players.forEach(function (p) {
      var entry = slotFor(p);
      entry.was = round2_((entry.was || 0) + Number(before.cost_per_player));
    });
  }
  if (after) {
    after.players.forEach(function (p) {
      var entry = slotFor(p);
      entry.now = round2_((entry.now || 0) + Number(after.cost_per_player));
    });
  }
  return order;
}
