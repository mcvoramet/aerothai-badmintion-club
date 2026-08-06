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
