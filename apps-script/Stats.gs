function periodRange_(period, anchor) {
  var start, end;
  if (period === 'weekly') {
    var day = anchor.getDay(); // 0 = Sunday
    var diffToMonday = day === 0 ? -6 : 1 - day;
    start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + diffToMonday);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  } else if (period === 'monthly') {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  } else {
    start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  }
  return { start: start, end: end };
}

// Headline numbers for the stats screen: how many shuttles were burned in a
// time range, what that cost, and how many distinct people were involved.
function getSummary(payload) {
  var period = (payload && payload.period) || 'daily';
  var rows = readSheetAsObjects(getSheet(SHEET_NAMES.GAMES)).filter(function (r) {
    return !isDeleted_(r.deleted);
  });

  if (period !== 'all') {
    var anchor = payload && payload.date ? new Date(payload.date) : new Date();
    var range = periodRange_(period, anchor);
    rows = rows.filter(function (r) {
      var t = new Date(r.timestamp);
      return t >= range.start && t < range.end;
    });
  }

  var shuttles = 0;
  var cost = 0;
  var playerSet = {};
  rows.forEach(function (r) {
    shuttles += Number(r.shuttles_used);
    cost += Number(r.total_cost);
    for (var i = 1; i <= 4; i++) {
      var key = r['player' + i + '_key'];
      if (key) playerSet[key] = true;
    }
  });

  return {
    period: period,
    games: rows.length,
    shuttles_used: shuttles,
    total_cost: round2_(cost),
    players_involved: Object.keys(playerSet).length,
  };
}

function getStats(payload) {
  var period = (payload && payload.period) || 'daily';
  var anchor = payload && payload.date ? new Date(payload.date) : new Date();
  var range = periodRange_(period, anchor);

  var sheet = getSheet(SHEET_NAMES.GAMES);
  var rows = readSheetAsObjects(sheet)
    .filter(function (r) {
      return !isDeleted_(r.deleted);
    })
    .filter(function (r) {
      var t = new Date(r.timestamp);
      return t >= range.start && t < range.end;
    });

  var byPlayer = {};
  rows.forEach(function (r) {
    for (var i = 1; i <= 4; i++) {
      var key = r['player' + i + '_key'];
      if (!key) continue;
      if (!byPlayer[key]) {
        byPlayer[key] = {
          player_key: key,
          nickname: r['player' + i + '_nickname'],
          department: r['player' + i + '_department'],
          games_played: 0,
          shuttles_used: 0,
          cost: 0,
        };
      }
      byPlayer[key].games_played += 1;
      byPlayer[key].shuttles_used += Number(r.shuttles_used);
      byPlayer[key].cost += Number(r.cost_per_player);
    }
  });

  return Object.keys(byPlayer)
    .map(function (k) {
      byPlayer[k].cost = round2_(byPlayer[k].cost);
      return byPlayer[k];
    })
    .sort(function (a, b) {
      return b.cost - a.cost;
    });
}
