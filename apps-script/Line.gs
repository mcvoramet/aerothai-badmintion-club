// LINE Messaging API integration.
//
// Secrets live in Script Properties, never in the Settings sheet: getSettings()
// is a public unauthenticated GET, so anything in that sheet is one bug away
// from being world-readable.
//
// A push to a group costs one message per member against the monthly quota,
// so the bot pushes as little as possible:
//   - a weekly summary, Monday 09:00 (Bangkok): who still owes, and who paid in
//     the last 7 days with a link to each slip — one push, two cards
//   - the owed list, pushed on demand from the web app's Settings tab
// Everything else is a reply, which is free:
//   - the owed list, when someone types LINE_TRIGGER_WORD
//   - the payment history, when someone types LINE_HISTORY_TRIGGER_WORD
// Payments and game edits are deliberately not announced as they happen; they
// show up in the next weekly summary instead.
//
// Settling always happens in the web app, never in the chat, so the webhook
// only ever reads messages — it never changes the ledger.
var LINE_PROP = {
  TOKEN: 'LINE_CHANNEL_ACCESS_TOKEN',
  WEBHOOK_TOKEN: 'LINE_WEBHOOK_TOKEN',
  TARGET_ID: 'LINE_TARGET_ID',
  TARGET_IDS: 'LINE_TARGET_IDS',
  APP_URL: 'LINE_LIFF_URL',
  TRIGGER_WORD: 'LINE_TRIGGER_WORD',
  HISTORY_TRIGGER_WORD: 'LINE_HISTORY_TRIGGER_WORD',
  SLIP_FOLDER_ID: 'LINE_SLIP_FOLDER_ID',
  LAST_PUSHED_AT: 'LINE_LAST_PUSHED_AT',
  LAST_PUSHED_AT_MS: 'LINE_LAST_PUSHED_AT_MS',
  WEEKLY_SENT_AT: 'LINE_WEEKLY_SENT_AT',
};

var LINE_API_BASE = 'https://api.line.me/v2/bot';
var LINE_PUSH_COOLDOWN_MS = 30000;
var LINE_NOT_LINKED_MESSAGE = 'ยังไม่ได้เชื่อมกลุ่ม LINE — เพิ่มบอทเข้ากลุ่ม';

// The payment history covers a rolling window rather than "since Monday", so
// the Monday summary and someone asking on a Thursday both see a full week.
var PAID_HISTORY_DAYS = 7;

var WEEKLY_SUMMARY_HANDLER = 'sendWeeklyLineSummary';
var WEEKLY_SUMMARY_TZ = 'Asia/Bangkok';

// Slips are the proof behind each payment, linked from the payment history, so
// they are kept for good.
var SLIP_FOLDER_NAME = 'AeroThai Badminton — slips';
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

// Every chat the bot pushes to. Replies (the trigger words) go back to whoever
// asked and need none of this; pushes — the weekly summary and the button in
// Settings — have to name a destination, and there can be more than one group.
//
// Stored as a JSON array in LINE_TARGET_IDS. LINE_TARGET_ID is kept in sync
// with the first entry so the older single-target property still reads true
// for anything looking at it by hand.
function lineTargets_() {
  var raw = lineProp_(LINE_PROP.TARGET_IDS);
  if (!raw) {
    // Never migrated: adopt whatever the single-target era left behind.
    var legacy = lineProp_(LINE_PROP.TARGET_ID);
    return legacy ? [legacy] : [];
  }
  var ids;
  try {
    ids = JSON.parse(raw);
  } catch (err) {
    ids = [];
  }
  if (!Array.isArray(ids)) return [];
  return ids.filter(function (id) {
    return typeof id === 'string' && id.length > 0;
  });
}

// The primary chat — the first group the bot was added to. Only for status and
// diagnostics; pushes go to lineTargets_(), not here.
function lineTargetId_() {
  var targets = lineTargets_();
  return targets.length ? targets[0] : '';
}

function saveLineTargets_(ids) {
  var seen = {};
  var unique = ids.filter(function (id) {
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
  var props = {};
  props[LINE_PROP.TARGET_IDS] = JSON.stringify(unique);
  props[LINE_PROP.TARGET_ID] = unique.length ? unique[0] : '';
  lineProps_().setProperties(props);
  return unique;
}

// The chat an event came from: the group, or the person in a 1:1.
function lineSourceId_(source) {
  if (!source) return '';
  return source.groupId || source.roomId || source.userId || '';
}

// Captured from the webhook so setup is "add the bot to the group" instead of
// hunting for a group id. Every group the bot is in gets announcements —
// adding it to a second group does not unlink the first.
//
// A 1:1 chat is only ever a stand-in for a group that doesn't exist yet: it is
// taken while nothing else is known, and dropped the moment a real group
// appears. Without that, a member messaging the bot privately would quietly
// add their own DM to the club's announcement list.
function rememberLineTarget_(source) {
  var id = lineSourceId_(source);
  if (!id) return;
  // Cheap unlocked check first: nearly every event comes from a chat that is
  // already linked, and those shouldn't queue behind a game save.
  if (lineTargets_().indexOf(id) !== -1) return;

  withLineTargetsLock_(function () {
    var targets = lineTargets_();
    if (targets.indexOf(id) !== -1) return;

    if (isGroupTarget_(id)) {
      saveLineTargets_(targets.filter(isGroupTarget_).concat([id]));
      return;
    }
    if (targets.length) return;
    saveLineTargets_([id]);
  });
}

// Removing the bot from a group must stop its announcements — otherwise the
// test group keeps getting the club's summaries forever.
function forgetLineTarget_(id) {
  if (!id) return;
  withLineTargetsLock_(function () {
    var targets = lineTargets_();
    if (targets.indexOf(id) === -1) return;
    saveLineTargets_(targets.filter(function (t) {
      return t !== id;
    }));
  });
}

// The target list is read-modify-write on a single property, and LINE delivers
// webhooks from different chats as separate, concurrent requests. Without a
// lock, the bot joining group B while someone types in group A lets A's write
// land on top of B's — and B, having already had its one join event, silently
// never gets another announcement.
function withLineTargetsLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Group ids start with C, multi-person room ids with R, users with U.
function isGroupTarget_(id) {
  return id.charAt(0) === 'C' || id.charAt(0) === 'R';
}

function lineFetch_(path, payload) {
  return UrlFetchApp.fetch(LINE_API_BASE + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

function lineApi_(path, payload) {
  var res = lineFetch_(path, payload);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('LINE API ผิดพลาด (' + code + '): ' + res.getContentText());
  }
  return res.getContentText();
}

// Sends the same messages to every linked chat.
//
// Each destination costs one message per member against the monthly quota,
// however many message objects are in the request — so the weekly summary's
// two cards go in one call, not two.
//
// One chat failing never stops the others, and never unlinks it: LINE also
// answers 403 for account-wide problems (the plan doesn't allow push, quota
// exhausted), and unlinking on that would wipe every group at once. Removal is
// left to the `leave` webhook and debugForgetTarget.
//
// Throws only when nothing was delivered. A partial failure comes back in
// `failed` so the caller can say so; see linePushWarning_.
function linePushAll_(messages) {
  var targets = lineTargets_();
  if (!targets.length) throw new Error(LINE_NOT_LINKED_MESSAGE);

  var sent = 0;
  var failed = [];

  targets.forEach(function (to) {
    var code;
    var detail;
    try {
      var res = lineFetch_('/message/push', { to: to, messages: messages });
      code = res.getResponseCode();
      detail = res.getContentText();
    } catch (err) {
      code = 0;
      detail = err && err.message ? err.message : String(err);
    }
    if (code >= 200 && code < 300) {
      sent++;
      return;
    }
    console.error('LINE push to ' + to + ' failed (' + code + '): ' + detail);
    failed.push({ to: to, code: code, detail: detail });
  });

  if (!sent) {
    throw new Error('LINE API ผิดพลาด (' + failed[0].code + '): ' + failed[0].detail);
  }
  return { sent: sent, total: targets.length, failed: failed };
}

// null when every chat got the push, otherwise a Thai sentence for the web app.
function linePushWarning_(result) {
  if (!result.failed.length) return null;
  return (
    'ส่งเข้ากลุ่ม LINE ไม่ครบ — สำเร็จ ' + result.sent + ' จาก ' + result.total + ' กลุ่ม (' +
    result.failed.map(function (f) {
      return f.code + ': ' + f.detail;
    }).join('; ') +
    ')'
  );
}

// Replies land in whichever chat sent the message and, unlike pushes, don't
// count against the monthly message quota.
function lineReply_(replyToken, messages) {
  return lineApi_('/message/reply', { replyToken: replyToken, messages: messages });
}

// ---------------------------------------------------------------------------
// Webhook — learns the target chats and answers the trigger words
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

// Typing any of these in the chat makes the bot reply with the owed list, or
// with the payment history. The matching properties override them and accept
// a comma-separated list.
var LINE_TRIGGER_WORD = 'ยอดค้างชำระ';
var LINE_HISTORY_TRIGGER_WORD = 'ดูประวัติการจ่ายเงิน';

// Thai has two encodings for SARA AM: the precomposed U+0E33 (ำ) that phone
// keyboards produce, and the decomposed NIKHAHIT + SARA AA (U+0E4D U+0E32) that
// some copy-pasted text carries. They look identical, so fold them together
// before comparing or the trigger silently fails for some people.
function normalizeThai_(text) {
  return String(text || '')
    .replace(/ํา/g, 'ำ')
    .replace(/[\s ]+/g, '')
    .replace(/[?!.？！。]+$/, '');
}

// The raw words as configured, for display. Comma-separated, either the ASCII
// comma or the fullwidth one that Thai/Japanese keyboards can produce.
function configuredWords_(propKey, fallback) {
  var raw = lineProp_(propKey) || fallback;
  var words = raw.split(/[,，]/).map(function (w) {
    return w.trim();
  }).filter(function (w) {
    return w.length > 0;
  });
  return words.length ? words : [fallback];
}

function triggerWords_() {
  return configuredWords_(LINE_PROP.TRIGGER_WORD, LINE_TRIGGER_WORD);
}

function historyTriggerWords_() {
  return configuredWords_(LINE_PROP.HISTORY_TRIGGER_WORD, LINE_HISTORY_TRIGGER_WORD);
}

function matchesWord_(text, words) {
  var actual = normalizeThai_(text);
  if (!actual) return false;
  return words.some(function (w) {
    return normalizeThai_(w) === actual;
  });
}

function isTriggerWord_(text) {
  return matchesWord_(text, triggerWords_());
}

function isHistoryTriggerWord_(text) {
  return matchesWord_(text, historyTriggerWords_());
}

function joinGreeting_() {
  return (
    'เชื่อมกลุ่มนี้เรียบร้อยแล้ว ✅\n' +
    'ทุกวันจันทร์ 09:00 บอทจะสรุปรายชื่อคนค้างชำระ และรายชื่อคนที่จ่ายแล้วใน 7 วันที่ผ่านมาให้\n\n' +
    'พิมพ์ ' + triggerWords_().join(' หรือ ') + ' เพื่อดูยอดค้างชำระ\n' +
    'พิมพ์ ' + historyTriggerWords_().join(' หรือ ') + ' เพื่อดูประวัติการจ่ายเงิน'
  );
}

// Always answers ok:true — a non-200 makes LINE retry the delivery.
function handleLineWebhook_(e, body) {
  if (!lineWebhookAuthorized_(e)) return { ok: true };

  var events = body && body.events ? body.events : [];
  events.forEach(function (event) {
    try {
      // Removed from the group, or blocked in a 1:1 — stop announcing there.
      if (event.type === 'leave' || event.type === 'unfollow') {
        forgetLineTarget_(lineSourceId_(event.source));
        return;
      }

      rememberLineTarget_(event.source);

      // Added to a group: it is linked from this moment, without waiting for
      // anyone to type. Say so, so nobody has to guess whether it worked.
      if (event.type === 'join') {
        lineReply_(event.replyToken, [{ type: 'text', text: joinGreeting_() }]);
        return;
      }

      if (event.type !== 'message' || !event.message || event.message.type !== 'text') return;
      var text = event.message.text;
      // History first, so a custom owed-list word can't shadow it.
      if (isHistoryTriggerWord_(text)) {
        lineReply_(event.replyToken, [buildPaidHistoryFlex_(getRecentPayments_(), nowIso())]);
      } else if (isTriggerWord_(text)) {
        lineReply_(event.replyToken, [buildOutstandingFlex_(getOutstanding(), nowIso())]);
      }
    } catch (err) {
      console.error('LINE event failed: ' + (err && err.message ? err.message : err));
    }
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Payment history
// ---------------------------------------------------------------------------

// Everyone who paid in the last PAID_HISTORY_DAYS, newest first. Payments
// recorded before slips were kept have no slip_url, and cash never has one.
function getRecentPayments_() {
  var since = Date.now() - PAID_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  return readSheetAsObjects(getSheet(SHEET_NAMES.SETTLEMENTS))
    .map(function (r) {
      return {
        nickname: String(r.nickname || ''),
        department: String(r.department || ''),
        amount: Number(r.amount) || 0,
        timestamp: new Date(r.timestamp),
        method: r.method === 'cash' ? 'cash' : 'transfer',
        slip_url: String(r.slip_url || ''),
      };
    })
    .filter(function (p) {
      var t = p.timestamp.getTime();
      return isFinite(t) && t >= since;
    })
    .sort(function (a, b) {
      return b.timestamp - a.timestamp;
    })
    .map(function (p) {
      p.timestamp = p.timestamp.toISOString();
      return p;
    });
}

// ---------------------------------------------------------------------------
// Weekly summary
// ---------------------------------------------------------------------------

// Run by the Monday trigger (see setupWeeklySummary), and safe to run by hand
// from the editor to send one now. Both cards go in a single push, so a week
// costs one message per group member, not two.
//
// Throws when nothing was delivered — Apps Script then emails the owner about
// the failed trigger, which is the only place anyone would notice.
function sendWeeklyLineSummary() {
  var stamp = nowIso();
  var pushed = linePushAll_([
    buildOutstandingFlex_(getOutstanding(), stamp),
    buildPaidHistoryFlex_(getRecentPayments_(), stamp),
  ]);
  lineProps_().setProperty(LINE_PROP.WEEKLY_SENT_AT, stamp);

  var result = 'weekly summary pushed to ' + pushed.sent + ' of ' + pushed.total + ' chat(s)';
  var warning = linePushWarning_(pushed);
  if (warning) {
    console.error(warning);
    result += '\n' + warning;
  } else {
    console.log(result);
  }
  return result;
}

// Run once from the editor. Replaces any earlier copy of the trigger, so
// running it twice doesn't send the summary twice.
//
// Google fires time-driven triggers somewhere within about 15 minutes of the
// requested time, so the summary lands between roughly 09:00 and 09:15.
function setupWeeklySummary() {
  removeTriggers_(WEEKLY_SUMMARY_HANDLER);
  ScriptApp.newTrigger(WEEKLY_SUMMARY_HANDLER)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .nearMinute(0)
    .inTimezone(WEEKLY_SUMMARY_TZ)
    .create();

  var message = 'ตั้งส่งสรุปเข้ากลุ่ม LINE ทุกวันจันทร์ 09:00 (' + WEEKLY_SUMMARY_TZ + ') แล้ว';
  console.log(message);
  return message;
}

function weeklySummaryScheduled_() {
  try {
    return ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === WEEKLY_SUMMARY_HANDLER;
    });
  } catch (err) {
    // No trigger scope in this execution — report unknown as not scheduled.
    return false;
  }
}

function removeTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
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

// The slip is shared as "anyone with the link can view" so a tap on the name
// in the LINE history opens it without a Google sign-in. The link is only ever
// posted into the club's own group.
function uploadSlip_(base64, mimeType, nickname) {
  if (!base64) throw new Error('ไม่พบไฟล์สลิป');
  if (String(mimeType).indexOf('image/') !== 0) throw new Error('สลิปต้องเป็นไฟล์รูปภาพเท่านั้น');

  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > SLIP_MAX_BYTES) throw new Error('ไฟล์สลิปใหญ่เกินไป (เกิน 8MB)');

  var ext = mimeType === 'image/png' ? 'png' : 'jpg';
  var blob = Utilities.newBlob(bytes, mimeType, 'slip-' + nickname + '-' + Date.now() + '.' + ext);
  var file = slipFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { id: file.getId(), url: 'https://drive.google.com/file/d/' + file.getId() + '/view' };
}

// Slips used to be deleted an hour after they were posted. They are now kept
// as proof, but a project set up before that still has the hourly trigger
// pointing here — so instead of deleting anything, this removes that trigger.
function deleteExpiredSlips_() {
  removeTriggers_('deleteExpiredSlips_');
}

// Run once from the editor after adding the LINE files.
//
// Touching DriveApp here is the point, not a side effect: a web app request can
// never trigger an authorization prompt, so if Drive hasn't been consented to,
// the first real payment fails with "คุณไม่ได้รับอนุญาตให้เรียกใช้ DriveApp".
// Creating the folder from the editor surfaces that prompt while someone is
// there to click Authorize. It also retires the old hourly slip cleanup.
function setupSlips() {
  var folder = slipFolder_();
  // Older setups named the folder as temporary; it isn't any more.
  if (folder.getName() !== SLIP_FOLDER_NAME) folder.setName(SLIP_FOLDER_NAME);
  removeTriggers_('deleteExpiredSlips_');

  var message =
    'พร้อมใช้งาน — โฟลเดอร์สลิป: "' + folder.getName() + '" (id: ' + folder.getId() + ')';
  console.log(message);
  return message;
}

// ---------------------------------------------------------------------------
// Actions called from the web app
// ---------------------------------------------------------------------------

function getLineStatus() {
  return {
    configured: !!lineProp_(LINE_PROP.TOKEN) && !!lineProp_(LINE_PROP.WEBHOOK_TOKEN),
    linked: lineTargets_().length > 0,
    // How many chats an announcement reaches. Ids stay server-side.
    linked_count: lineTargets_().length,
    app_url_set: !!lineProp_(LINE_PROP.APP_URL),
    trigger_words: triggerWords_(),
    history_trigger_words: historyTriggerWords_(),
    weekly_summary_scheduled: weeklySummaryScheduled_(),
    weekly_sent_at: lineProp_(LINE_PROP.WEEKLY_SENT_AT) || null,
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
  var pushed = linePushAll_([buildOutstandingFlex_(list, nowIso())]);

  var props = {};
  props[LINE_PROP.LAST_PUSHED_AT] = nowIso();
  props[LINE_PROP.LAST_PUSHED_AT_MS] = String(now);
  lineProps_().setProperties(props);

  return { sent: list.length, groups: pushed.sent, warning: linePushWarning_(pushed) };
}

// The web app's "ยืนยันว่าชำระแล้ว" button. Records the payment and keeps the
// slip as its proof; nothing is posted to LINE — the payment appears in the
// next weekly summary and in the history reply.
//
// The slip is uploaded before settling so its link can be written on the same
// row. If Drive fails, nothing is recorded and the user simply tries again; if
// the settle fails, the uploaded slip is thrown away.
//
// Cash needs no slip: there is nothing to photograph when money changes hands
// at the court.
function confirmPayment(payload) {
  if (!payload || !payload.player_key) throw new Error('ต้องระบุ player_key');
  var isCash = payload.method === 'cash';
  if (!isCash && !payload.slip_base64) throw new Error('กรุณาแนบสลิปหลักฐานการโอนเงิน');

  var player = findPlayerByKey_(payload.player_key);
  // Sheets set up before slips were kept have no column to hold the link.
  addColumnsIfMissing_(getSheet(SHEET_NAMES.SETTLEMENTS), ['slip_url']);

  var slip = isCash ? null : uploadSlip_(payload.slip_base64, payload.slip_mime_type, player.nickname);
  var result;
  try {
    result = settlePlayer(
      { player_key: payload.player_key, source: 'app', method: isCash ? 'cash' : 'transfer' },
      { slip_url: slip ? slip.url : '' }
    );
  } catch (err) {
    if (slip) {
      try {
        DriveApp.getFileById(slip.id).setTrashed(true);
      } catch (cleanupErr) {
        console.error('slip cleanup failed: ' + cleanupErr);
      }
    }
    throw err;
  }

  return {
    player_key: result.player_key,
    amount_settled: result.amount_settled,
    new_balance: 0,
    settlement_id: result.settlement_id,
  };
}
