// Diagnostics for "the trigger word stopped working".
//
// handleLineWebhook_ can't be run from the editor (it needs a real request
// object), and its auth check returns ok:true with no log when it fails — so a
// wrong webhook URL is indistinguishable from silence. These stand in for it.
//
// Everything here checks that its dependencies exist before calling them: the
// most common cause of a dead trigger word is Line.gs missing from the Apps
// Script project entirely, and a diagnostic that throws ReferenceError on that
// case reports nothing.

// RUN THIS FIRST. Which .gs files actually made it into this project?
function debugWhichFilesArePresent() {
  var expected = [
    ['Code.gs', 'doPost'],
    ['Utils.gs', 'nowIso'],
    ['Players.gs', 'getPlayers'],
    ['Games.gs', 'addGame'],
    ['Balances.gs', 'getOutstanding'],
    ['Settings.gs', 'getSettings'],
    ['Line.gs', 'handleLineWebhook_'],
    ['LineFlex.gs', 'buildOutstandingFlex_'],
  ];
  var missing = [];
  var lines = expected.map(function (pair) {
    var present = eval('typeof ' + pair[1]) === 'function';
    if (!present) missing.push(pair[0]);
    return (present ? 'OK      ' : 'MISSING ') + pair[0] + '  (' + pair[1] + ')';
  });
  if (missing.length) {
    lines.push('');
    lines.push('=> Paste these files into the editor, then');
    lines.push('   Deploy -> Manage deployments -> pencil -> New version -> Deploy:');
    lines.push('   ' + missing.join(', '));
  }
  console.log(lines.join('\n'));
  return lines.join('\n');
}

// Everything the trigger path depends on. Needs Line.gs present.
function debugLineSetup() {
  if (typeof lineProps_ !== 'function') return debugWhichFilesArePresent();

  var raw = lineProp_(LINE_PROP.TRIGGER_WORD);
  var lines = [
    'CHANNEL_ACCESS_TOKEN: ' + (lineProp_(LINE_PROP.TOKEN) ? 'set' : 'MISSING'),
    'WEBHOOK_TOKEN: ' + (lineProp_(LINE_PROP.WEBHOOK_TOKEN) ? 'set' : 'MISSING — every webhook is dropped'),
    'TARGET_ID: ' + (lineTargetId_() || 'MISSING'),
    'LINE_TRIGGER_WORD (raw): ' + (raw ? JSON.stringify(raw) : '(not set — falling back to default)'),
    'active trigger words: ' + JSON.stringify(triggerWords_()),
    'normalized: ' + JSON.stringify(triggerWords_().map(normalizeThai_)),
  ];
  console.log(lines.join('\n'));
  return lines.join('\n');
}

// Does the word people actually type match? Edit the string, run, read the log.
function debugTriggerMatch() {
  if (typeof isTriggerWord_ !== 'function') return debugWhichFilesArePresent();

  var typed = 'ดูยอด';
  var msg =
    'typed:      ' + JSON.stringify(typed) + '\n' +
    'normalized: ' + JSON.stringify(normalizeThai_(typed)) + '\n' +
    'configured: ' + JSON.stringify(triggerWords_().map(normalizeThai_)) + '\n' +
    'MATCH: ' + isTriggerWord_(typed);
  console.log(msg);
  return msg;
}

// Skips the webhook entirely and pushes the list straight to the group. If this
// works, the bot/token/group are all fine and the problem is upstream: the
// webhook URL registered in the LINE console, or the trigger word itself.
function debugPushNow() {
  if (typeof linePush_ !== 'function') return debugWhichFilesArePresent();

  linePush_(lineTargetId_(), [buildOutstandingFlex_(getOutstanding(), nowIso())]);
  return 'pushed';
}

// The exact URL that must be registered as the webhook in the LINE console,
// including the ?lineToken= secret. Re-check this after every new deployment.
function debugWebhookUrl() {
  if (typeof lineProp_ !== 'function') return debugWhichFilesArePresent();

  var url = ScriptApp.getService().getUrl() + '?lineToken=' + lineProp_(LINE_PROP.WEBHOOK_TOKEN);
  console.log(url);
  return url;
}
