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
    'linked chats: ' + (lineTargets_().length ? JSON.stringify(lineTargets_()) : 'MISSING'),
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
  if (typeof linePushAll_ !== 'function') return debugWhichFilesArePresent();

  var groups = linePushAll_([buildOutstandingFlex_(getOutstanding(), nowIso())]);
  return 'pushed to ' + groups + ' chat(s)';
}

// Which chats get the slip / edit announcements, and what each one is.
//
// Ids beginning with C are groups, R multi-person rooms, U a single person —
// a U in this list means the bot was messaged privately before it was ever
// added to a group.
function debugListTargets() {
  if (typeof lineTargets_ !== 'function') return debugWhichFilesArePresent();

  var targets = lineTargets_();
  if (!targets.length) {
    var empty = 'no chats linked — add the bot to a group, or say anything in one';
    console.log(empty);
    return empty;
  }
  var lines = targets.map(function (id, i) {
    var kind = id.charAt(0) === 'C' ? 'group' : id.charAt(0) === 'R' ? 'room' : 'direct message';
    return (i === 0 ? '* ' : '  ') + id + '   (' + kind + ')';
  });
  lines.unshift(targets.length + ' chat(s) receive announcements:');
  console.log(lines.join('\n'));
  return lines.join('\n');
}

// Unlink one chat by hand — for a group the bot is still in but shouldn't
// announce to. Removing the bot from the group does this on its own.
// Edit the id, run, read the log.
function debugForgetTarget() {
  if (typeof forgetLineTarget_ !== 'function') return debugWhichFilesArePresent();

  var id = 'PASTE_THE_ID_FROM_debugListTargets_HERE';
  if (lineTargets_().indexOf(id) === -1) {
    var miss = 'not linked: ' + id + '\n' + debugListTargets();
    console.log(miss);
    return miss;
  }
  forgetLineTarget_(id);
  return 'removed ' + id + '\n' + debugListTargets();
}

// The exact URL that must be registered as the webhook in the LINE console,
// including the ?lineToken= secret. Re-check this after every new deployment.
function debugWebhookUrl() {
  if (typeof lineProp_ !== 'function') return debugWhichFilesArePresent();

  var url = ScriptApp.getService().getUrl() + '?lineToken=' + lineProp_(LINE_PROP.WEBHOOK_TOKEN);
  console.log(url);
  return url;
}
