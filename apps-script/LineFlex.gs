// Flex Message builders for the LINE bot.
//
// The bot is a noticeboard, not a form: it lists who owes what and links each
// person straight into the web app's ค้างชำระ screen with their pay sheet open.
// Nothing is settled from inside the chat, so these bubbles carry no postbacks.
//
// A sent LINE message can never be edited, so every bubble is stamped with the
// time its data was read.

var LINE_FLEX_MAX_ROWS = 10;

// Mirrors src/styles/index.css :root so the bubble reads as part of the app.
var LINE_COLOR = {
  PRIMARY: '#1D5B94',
  PRIMARY_DARK: '#12395E',
  SURFACE: '#FFFFFF',
  SURFACE_SUNKEN: '#E9F1F9',
  TEXT: '#16232F',
  MUTED: '#64798C',
  BORDER: '#DBE7F2',
  DANGER: '#C4463B',
  SUCCESS: '#1F7A52',
  ON_PRIMARY: '#FFFFFF',
};

function formatAmount_(n) {
  var value = round2_(Number(n) || 0);
  var fixed = Math.round(value) === value ? String(value) : value.toFixed(2);
  var parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// Buddhist year, to match the dates the web app renders with toLocaleString('th-TH').
function formatThaiDateTime_(iso) {
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var d = new Date(iso);
  var parts = Utilities.formatDate(d, tz, 'd/M/yyyy HH:mm').split('/');
  var tail = parts[2].split(' ');
  return parts[0] + '/' + parts[1] + '/' + (Number(tail[0]) + 543) + ' ' + tail[1];
}

function appUrl_() {
  return lineProp_(LINE_PROP.APP_URL);
}

function withParam_(url, key, value) {
  return url + (url.indexOf('?') === -1 ? '?' : '&') + key + '=' + encodeURIComponent(value);
}

// Deep link that opens the ค้างชำระ tab with this player's pay sheet already up.
function payUri_(playerKey) {
  return withParam_(appUrl_(), 'pay', playerKey);
}

function payListUri_() {
  return withParam_(appUrl_(), 'tab', 'pay');
}

function rankBadge_(rank) {
  return {
    type: 'box',
    layout: 'vertical',
    width: '26px',
    height: '26px',
    cornerRadius: '13px',
    backgroundColor: rank <= 3 ? LINE_COLOR.PRIMARY : LINE_COLOR.SURFACE_SUNKEN,
    justifyContent: 'center',
    contents: [
      {
        type: 'text',
        text: String(rank),
        size: 'xs',
        weight: 'bold',
        align: 'center',
        color: rank <= 3 ? LINE_COLOR.ON_PRIMARY : LINE_COLOR.MUTED,
      },
    ],
  };
}

// One line per person: badge and name on the left, amount with the pay button
// stacked directly under it on the right. Keeping the button in the right-hand
// column instead of spanning the full width roughly halves the row height, so
// ten people fit in a bubble that doesn't swallow the whole chat.
function debtorRow_(player, rank, linkable) {
  var right = [
    {
      type: 'text',
      text: '฿' + formatAmount_(player.balance),
      size: 'md',
      weight: 'bold',
      align: 'end',
      color: LINE_COLOR.DANGER,
    },
  ];
  if (linkable) {
    right.push({
      type: 'button',
      style: 'primary',
      color: LINE_COLOR.PRIMARY,
      height: 'sm',
      margin: 'xs',
      action: { type: 'uri', label: 'ชำระเงิน', uri: payUri_(player.player_key) },
    });
  }

  return {
    type: 'box',
    layout: 'horizontal',
    alignItems: 'center',
    spacing: 'md',
    paddingTop: 'sm',
    paddingBottom: 'sm',
    borderWidth: rank === 1 ? 'none' : '1px',
    borderColor: LINE_COLOR.BORDER,
    contents: [
      rankBadge_(rank),
      {
        type: 'box',
        layout: 'vertical',
        flex: 5,
        contents: [
          {
            type: 'text',
            text: player.nickname,
            size: 'sm',
            weight: 'bold',
            color: LINE_COLOR.TEXT,
            wrap: true,
          },
          player.department
            ? { type: 'text', text: player.department, size: 'xxs', color: LINE_COLOR.MUTED }
            : { type: 'filler' },
        ],
      },
      { type: 'box', layout: 'vertical', flex: 4, contents: right },
    ],
  };
}

// One bubble, capped at 10 rows. Anyone past the cap is reachable through the
// footer link rather than by growing the message.
function buildOutstandingFlex_(list, stampIso) {
  var total = list.reduce(function (sum, p) {
    return sum + Number(p.balance);
  }, 0);
  var shown = list.slice(0, LINE_FLEX_MAX_ROWS);
  var hidden = list.length - shown.length;
  var linkable = !!appUrl_();

  var body;
  if (!list.length) {
    body = [
      {
        type: 'text',
        text: '🎉 ทุกคนชำระครบแล้ว',
        size: 'md',
        weight: 'bold',
        align: 'center',
        color: LINE_COLOR.SUCCESS,
        margin: 'xl',
      },
    ];
  } else {
    body = shown.map(function (p, i) {
      return debtorRow_(p, i + 1, linkable);
    });
    if (hidden > 0) {
      body.push({
        type: 'text',
        text: '… และอีก ' + hidden + ' คน',
        size: 'xs',
        color: LINE_COLOR.MUTED,
        align: 'center',
        margin: 'lg',
      });
    }
  }

  var footer = [];
  if (linkable) {
    footer.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: { type: 'uri', label: 'ดูรายชื่อค้างชำระทั้งหมด', uri: payListUri_() },
    });
  } else {
    footer.push({
      type: 'text',
      text: 'ยังไม่ได้ตั้งค่า LINE_LIFF_URL จึงยังลิงก์ไปหน้าชำระเงินไม่ได้',
      size: 'xxs',
      color: LINE_COLOR.MUTED,
      wrap: true,
      align: 'center',
    });
  }

  return {
    type: 'flex',
    altText: list.length
      ? 'ค้างชำระค่าลูกแบด ' + list.length + ' คน รวม ฿' + formatAmount_(total)
      : 'ทุกคนชำระค่าลูกแบดครบแล้ว',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        backgroundColor: LINE_COLOR.PRIMARY,
        paddingAll: 'lg',
        contents: [
          {
            type: 'text',
            text: '💸 ค้างชำระค่าลูกแบด',
            weight: 'bold',
            size: 'lg',
            color: LINE_COLOR.ON_PRIMARY,
            wrap: true,
          },
          {
            type: 'text',
            text: list.length
              ? 'ค้างอยู่ ' + list.length + ' คน · รวม ฿' + formatAmount_(total)
              : 'ไม่มียอดค้างชำระ',
            size: 'sm',
            color: LINE_COLOR.ON_PRIMARY,
          },
          {
            type: 'text',
            text: 'ข้อมูล ณ ' + formatThaiDateTime_(stampIso),
            size: 'xxs',
            color: LINE_COLOR.ON_PRIMARY,
          },
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'none', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer },
    },
  };
}

// ---------------------------------------------------------------------------
// Payment history
// ---------------------------------------------------------------------------

// Enough for a busy week; a bubble has a size cap, so the rest are counted
// rather than listed.
var LINE_FLEX_HISTORY_MAX_ROWS = 20;

// A slip link is only ever written by confirmPayment, but the sheet can be
// edited by hand, and LINE rejects the whole message over one bad URI.
function isSlipLink_(url) {
  return /^https:\/\/\S+$/.test(String(url || ''));
}

// Name and date on the left, amount on the right. When there's a slip, the
// name is styled as a link and the whole row opens it.
function paidRow_(payment, first) {
  var hasSlip = isSlipLink_(payment.slip_url);
  var name = payment.nickname + (payment.department ? ' · ' + payment.department : '');
  var when =
    formatThaiDateTime_(payment.timestamp) +
    ' · ' +
    (payment.method === 'cash' ? '💵 เงินสด' : '🏦 โอน');

  var right = [
    {
      type: 'text',
      text: '฿' + formatAmount_(payment.amount),
      size: 'sm',
      weight: 'bold',
      align: 'end',
      color: LINE_COLOR.SUCCESS,
    },
  ];
  if (hasSlip) {
    right.push({ type: 'text', text: 'ดูสลิป ›', size: 'xxs', align: 'end', color: LINE_COLOR.PRIMARY });
  }

  var row = {
    type: 'box',
    layout: 'horizontal',
    alignItems: 'center',
    spacing: 'md',
    paddingTop: 'sm',
    paddingBottom: 'sm',
    borderWidth: first ? 'none' : '1px',
    borderColor: LINE_COLOR.BORDER,
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 6,
        contents: [
          {
            type: 'text',
            text: name,
            size: 'sm',
            weight: 'bold',
            color: hasSlip ? LINE_COLOR.PRIMARY : LINE_COLOR.TEXT,
            decoration: hasSlip ? 'underline' : 'none',
            wrap: true,
          },
          { type: 'text', text: when, size: 'xxs', color: LINE_COLOR.MUTED, wrap: true },
        ],
      },
      { type: 'box', layout: 'vertical', flex: 3, contents: right },
    ],
  };
  if (hasSlip) {
    row.action = { type: 'uri', label: 'ดูสลิป', uri: payment.slip_url };
  }
  return row;
}

// Who paid in the last PAID_HISTORY_DAYS, newest first — `payments` comes from
// getRecentPayments_.
function buildPaidHistoryFlex_(payments, stampIso) {
  var total = payments.reduce(function (sum, p) {
    return sum + Number(p.amount);
  }, 0);
  var shown = payments.slice(0, LINE_FLEX_HISTORY_MAX_ROWS);
  var hidden = payments.length - shown.length;
  var anySlip = shown.some(function (p) {
    return isSlipLink_(p.slip_url);
  });

  var body;
  if (!payments.length) {
    body = [
      {
        type: 'text',
        text: 'ยังไม่มีใครชำระในช่วง ' + PAID_HISTORY_DAYS + ' วันที่ผ่านมา',
        size: 'sm',
        align: 'center',
        color: LINE_COLOR.MUTED,
        wrap: true,
        margin: 'xl',
      },
    ];
  } else {
    body = shown.map(function (p, i) {
      return paidRow_(p, i === 0);
    });
    if (hidden > 0) {
      body.push({
        type: 'text',
        text: '… และอีก ' + hidden + ' รายการ',
        size: 'xs',
        color: LINE_COLOR.MUTED,
        align: 'center',
        margin: 'lg',
      });
    }
  }

  var bubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      backgroundColor: LINE_COLOR.SUCCESS,
      paddingAll: 'lg',
      contents: [
        {
          type: 'text',
          text: '🧾 ประวัติการชำระเงิน',
          weight: 'bold',
          size: 'lg',
          color: LINE_COLOR.ON_PRIMARY,
          wrap: true,
        },
        {
          type: 'text',
          text:
            PAID_HISTORY_DAYS + ' วันล่าสุด' +
            (payments.length
              ? ' · ' + payments.length + ' รายการ · รวม ฿' + formatAmount_(total)
              : ''),
          size: 'sm',
          color: LINE_COLOR.ON_PRIMARY,
          wrap: true,
        },
        {
          type: 'text',
          text: 'ข้อมูล ณ ' + formatThaiDateTime_(stampIso),
          size: 'xxs',
          color: LINE_COLOR.ON_PRIMARY,
        },
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'none', contents: body },
  };

  // LINE rejects a bubble carrying an empty footer box, so the hint only
  // exists when there is something to tap.
  if (anySlip) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: 'แตะที่ชื่อเพื่อดูสลิปการโอนเงิน',
          size: 'xxs',
          color: LINE_COLOR.MUTED,
          align: 'center',
        },
      ],
    };
  }

  return {
    type: 'flex',
    altText: payments.length
      ? 'ประวัติการชำระเงิน ' + PAID_HISTORY_DAYS + ' วันล่าสุด ' + payments.length +
        ' รายการ รวม ฿' + formatAmount_(total)
      : 'ยังไม่มีใครชำระในช่วง ' + PAID_HISTORY_DAYS + ' วันที่ผ่านมา',
    contents: bubble,
  };
}

// ---------------------------------------------------------------------------
// Game edited / deleted
// ---------------------------------------------------------------------------

var GAME_CHANGE_STYLE = {
  edit: { title: '✏️ แก้ไขเกม', color: LINE_COLOR.PRIMARY },
  delete: { title: '🗑️ ลบเกม', color: LINE_COLOR.DANGER },
};

// A label on the left, the value (or the before → after pair) on the right.
function fieldRow_(label, values) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    paddingTop: 'sm',
    paddingBottom: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: LINE_COLOR.MUTED, flex: 4 },
      { type: 'box', layout: 'vertical', flex: 6, contents: values },
    ],
  };
}

// The whole point of the message is what moved, so an unchanged field reads as
// a plain value and a changed one shows the old value struck through above the
// new one. Stacked rather than side by side because a changed date is far too
// long to fit on one line, and a truncated "5/8/2569 18:30 → 6/8/25…" would hide
// exactly the part that changed.
//
// Pass before = null for a delete, where there is no "after" to compare to.
function changeValue_(before, after) {
  var current = {
    type: 'text',
    text: String(after),
    size: 'sm',
    weight: 'bold',
    align: 'end',
    color: LINE_COLOR.TEXT,
    wrap: true,
  };
  if (before === null || before === undefined || String(before) === String(after)) {
    return [current];
  }
  current.text = '→ ' + String(after);
  return [
    {
      type: 'text',
      text: String(before),
      size: 'xs',
      align: 'end',
      color: LINE_COLOR.MUTED,
      decoration: 'line-through',
      wrap: true,
    },
    current,
  ];
}

// One row per person the change touched. The status line is what makes an added
// or removed player obvious; the amount underneath is their share of this game,
// and the balance is everything they still owe once the change is applied.
function affectedRow_(entry, kind) {
  var status, statusColor, amount, amountColor;
  if (kind === 'delete') {
    status = 'ยอดของเกมนี้ถูกยกออก';
    statusColor = LINE_COLOR.DANGER;
    amount = '−฿' + formatAmount_(entry.was);
    amountColor = LINE_COLOR.DANGER;
  } else if (entry.was === null) {
    status = 'เพิ่มเข้าเกม';
    statusColor = LINE_COLOR.SUCCESS;
    amount = '+฿' + formatAmount_(entry.now);
    amountColor = LINE_COLOR.SUCCESS;
  } else if (entry.now === null) {
    status = 'นำออกจากเกม';
    statusColor = LINE_COLOR.DANGER;
    amount = '−฿' + formatAmount_(entry.was);
    amountColor = LINE_COLOR.DANGER;
  } else {
    status = 'อยู่ในเกมเหมือนเดิม';
    statusColor = LINE_COLOR.MUTED;
    amount =
      entry.was === entry.now
        ? '฿' + formatAmount_(entry.now)
        : '฿' + formatAmount_(entry.was) + ' → ฿' + formatAmount_(entry.now);
    amountColor = entry.was === entry.now ? LINE_COLOR.TEXT : LINE_COLOR.PRIMARY;
  }

  var name = entry.nickname + (entry.department ? ' · ' + entry.department : '');

  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    paddingTop: 'sm',
    paddingBottom: 'sm',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 5,
        contents: [
          { type: 'text', text: name, size: 'sm', weight: 'bold', color: LINE_COLOR.TEXT, wrap: true },
          { type: 'text', text: status, size: 'xxs', color: statusColor, wrap: true },
        ],
      },
      {
        type: 'box',
        layout: 'vertical',
        flex: 4,
        contents: [
          { type: 'text', text: amount, size: 'sm', weight: 'bold', align: 'end', color: amountColor, wrap: true },
          {
            type: 'text',
            text: 'ค้างตอนนี้ ฿' + formatAmount_(entry.balance),
            size: 'xxs',
            align: 'end',
            color: LINE_COLOR.MUTED,
          },
        ],
      },
    ],
  };
}

// "4 คน", or "3 คน (4 ส่วน)" when somebody is in the game more than once —
// the head count and the number of shares the cost was split into stop being
// the same number as soon as one person covers two slots.
function playersLabel_(game) {
  var seen = {};
  var people = 0;
  game.players.forEach(function (p) {
    if (!Object.prototype.hasOwnProperty.call(seen, p.player_key)) {
      seen[p.player_key] = true;
      people++;
    }
  });
  return people === game.players.length
    ? people + ' คน'
    : people + ' คน (' + game.players.length + ' ส่วน)';
}

// One card for one logged edit or delete — `change` comes from
// getRecentGameChanges_.
//
// `after` is null for a delete, in which case every field is shown as it stood
// when the game was removed. `affected` comes from affectedPlayers_ and carries
// each person's balance as it is now, not as it was at the time of the change.
function buildGameChangeBubble_(change, affected) {
  var kind = change.kind;
  var before = change.before;
  var after = change.after;
  var style = GAME_CHANGE_STYLE[kind] || GAME_CHANGE_STYLE.edit;
  var latest = after || before;

  function row(label, beforeText, afterText) {
    return fieldRow_(label, changeValue_(after ? beforeText : null, afterText));
  }

  var details = [
    row('วันที่เล่น', formatThaiDateTime_(before.timestamp), formatThaiDateTime_(latest.timestamp)),
    row('ลูกขนไก่', before.shuttles_used + ' ลูก', latest.shuttles_used + ' ลูก'),
    row('ผู้เล่น', playersLabel_(before), playersLabel_(latest)),
    row('รวม', '฿' + formatAmount_(before.total_cost), '฿' + formatAmount_(latest.total_cost)),
    row(
      'คนละ',
      '฿' + formatAmount_(before.cost_per_player),
      '฿' + formatAmount_(latest.cost_per_player)
    ),
  ];

  var body = details.concat([
    { type: 'separator', margin: 'md', color: LINE_COLOR.BORDER },
    {
      type: 'text',
      text: 'ผู้เล่นที่เกี่ยวข้อง (' + affected.length + ' คน)',
      size: 'xs',
      weight: 'bold',
      color: LINE_COLOR.MUTED,
      margin: 'lg',
    },
    {
      type: 'box',
      layout: 'vertical',
      spacing: 'none',
      contents: affected.map(function (entry) {
        return affectedRow_(entry, kind);
      }),
    },
  ]);

  var bubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      backgroundColor: style.color,
      paddingAll: 'lg',
      contents: [
        {
          type: 'text',
          text: style.title,
          weight: 'bold',
          size: 'lg',
          color: LINE_COLOR.ON_PRIMARY,
          wrap: true,
        },
        {
          type: 'text',
          text:
            kind === 'delete'
              ? 'เกมนี้ถูกลบออกจากระบบแล้ว'
              : 'ข้อมูลเกมถูกแก้ไข ยอดของผู้เล่นเปลี่ยนตามด้านล่าง',
          size: 'sm',
          color: LINE_COLOR.ON_PRIMARY,
          wrap: true,
        },
        {
          type: 'text',
          text: (kind === 'delete' ? 'ลบเมื่อ ' : 'แก้ไขเมื่อ ') + formatThaiDateTime_(change.changed_at),
          size: 'xxs',
          color: LINE_COLOR.ON_PRIMARY,
        },
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'none', contents: body },
  };

  // LINE rejects a bubble carrying an empty footer box, so the block only
  // exists when there is actually a link to put in it.
  if (appUrl_()) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          action: { type: 'uri', label: 'ดูรายชื่อค้างชำระ', uri: payListUri_() },
        },
      ],
    };
  }

  return bubble;
}

// The reply to LINE_EDIT_TRIGGER_WORD: the latest changes, newest first, as one
// swipeable carousel. `affectedList[i]` belongs to `changes[i]`.
function buildGameChangesFlex_(changes, affectedList) {
  if (!changes.length) {
    return {
      type: 'text',
      text: 'ยังไม่มีประวัติการแก้ไขหรือลบเกม\n(บันทึกเฉพาะการแก้ไขที่เกิดขึ้นหลังเปิดใช้ฟีเจอร์นี้)',
    };
  }
  return {
    type: 'flex',
    altText: 'ประวัติการแก้ไขเกม ' + changes.length + ' รายการล่าสุด',
    contents: {
      type: 'carousel',
      contents: changes.map(function (change, i) {
        return buildGameChangeBubble_(change, affectedList[i]);
      }),
    },
  };
}
