/**
 * シフト管理アプリ:スプレッドシート側のスクリプト
 *
 * 使い方(くわしくは README.md):
 *  1. スプレッドシートの「拡張機能 → Apps Script」にこのファイルの中身を貼り付ける
 *  2. 関数「setup」を1回実行する(シートが3枚できる)
 *  3. 「スタッフ」シートに名前を入れる
 *  4. 「デプロイ → 新しいデプロイ → ウェブアプリ」で公開し、URL を js/config.js の API_URL に貼る
 */

var SHEET = {
  staff: 'スタッフ',
  submissions: '提出データ',
  schedules: 'シフトデータ',
};

var SHIFT_SHORT = { early: '早', late: '遅', any: '可' };

// ---------- 最初に1回だけ実行する ----------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET.staff, ['名前'], []);
  ensureSheet_(ss, SHEET.submissions, ['月', '名前', '希望(データ)', '希望(読みやすい形)', '連絡事項', '更新日時'], []);
  ensureSheet_(ss, SHEET.schedules, ['月', 'データ', '公開', '更新日時'], []);
}

function ensureSheet_(ss, name, header, rows) {
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name);
  // 「2026-12」が日付に化けないよう、全体を文字列の書式にしておく
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setNumberFormat('@');
  sheet.appendRow(header);
  rows.forEach(function (row) {
    sheet.appendRow(row);
  });
  sheet.setFrozenRows(1);
  return sheet;
}

// ---------- アプリからの通信の入口 ----------
function doPost(e) {
  var result;
  try {
    var req = JSON.parse(e.postData.contents);
    result = { data: handle_(req) };
  } catch (err) {
    result = { error: err.message || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('shift-app is running');
}

function handle_(req) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // リンクを知っている人は全員、すべての操作ができる(合言葉・パスワードなし)
  switch (req.action) {
    case 'login':
      return { staff: getStaff_(ss) };

    case 'getSubmission':
      return findSubmission_(ss, checkMonth_(req.month), String(req.name));

    case 'saveSubmission':
      return withLock_(function () {
        return saveSubmission_(ss, req.submission);
      });

    case 'listSubmissions':
      return listSubmissions_(ss, checkMonth_(req.month));

    case 'getSchedule':
      return getSchedule_(ss, checkMonth_(req.month));

    case 'saveSchedule':
      return withLock_(function () {
        return saveSchedule_(ss, req.schedule);
      });

    default:
      throw new Error('不明な操作です');
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- 共通の小道具 ----------
function checkMonth_(month) {
  month = String(month);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('月の形式が正しくありません');
  return month;
}

// シートが日付に変えてしまっていた場合も「2026-12」の形に戻す
function monthText_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return String(value);
}

function getStaff_(ss) {
  return ss
    .getSheetByName(SHEET.staff)
    .getDataRange()
    .getValues()
    .slice(1)
    .map(function (row) {
      return String(row[0]).trim();
    })
    .filter(function (name) {
      return name !== '';
    });
}

function parseJson_(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

// ---------- 提出データ ----------
function rowToSubmission_(row) {
  return {
    month: monthText_(row[0]),
    name: String(row[1]),
    days: parseJson_(row[2], {}),
    comment: String(row[4]),
    updatedAt: String(row[5]),
  };
}

function findSubmission_(ss, month, name) {
  var rows = ss.getSheetByName(SHEET.submissions).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (monthText_(rows[i][0]) === month && String(rows[i][1]) === name) return rowToSubmission_(rows[i]);
  }
  return null;
}

function listSubmissions_(ss, month) {
  return ss
    .getSheetByName(SHEET.submissions)
    .getDataRange()
    .getValues()
    .slice(1)
    .filter(function (row) {
      return monthText_(row[0]) === month;
    })
    .map(rowToSubmission_);
}

function saveSubmission_(ss, sub) {
  var month = checkMonth_(sub.month);
  var name = String(sub.name).trim();
  if (getStaff_(ss).indexOf(name) === -1) throw new Error('「スタッフ」シートにない名前です:' + name);

  // 正しい形の日付と種類だけを残す
  var days = {};
  Object.keys(sub.days || {})
    .sort()
    .forEach(function (key) {
      if (key.indexOf(month + '-') === 0 && /^\d{4}-\d{2}-\d{2}$/.test(key) && SHIFT_SHORT[sub.days[key]]) {
        days[key] = sub.days[key];
      }
    });
  var readable = Object.keys(days)
    .map(function (key) {
      return Number(key.slice(8)) + SHIFT_SHORT[days[key]];
    })
    .join(' ');
  var comment = String(sub.comment || '').slice(0, 500);
  var updatedAt = new Date().toISOString();
  var values = [month, name, JSON.stringify(days), readable, comment, updatedAt];

  var sheet = ss.getSheetByName(SHEET.submissions);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (monthText_(rows[i][0]) === month && String(rows[i][1]) === name) {
      sheet.getRange(i + 1, 1, 1, values.length).setValues([values]);
      return rowToSubmission_(values);
    }
  }
  sheet.appendRow(values);
  return rowToSubmission_(values);
}

// ---------- 確定シフト ----------
function getSchedule_(ss, month) {
  var rows = ss.getSheetByName(SHEET.schedules).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (monthText_(rows[i][0]) !== month) continue;
    var schedule = parseJson_(rows[i][1], null);
    if (!schedule) return null;
    schedule.updatedAt = String(rows[i][3]);
    return schedule;
  }
  return null;
}

function saveSchedule_(ss, input) {
  var month = checkMonth_(input.month);
  var schedule = {
    month: month,
    assign: input.assign || {},
    closed: input.closed || [],
    published: !!input.published,
  };
  var updatedAt = new Date().toISOString();
  var values = [month, JSON.stringify(schedule), schedule.published ? '公開中' : '作成中', updatedAt];

  var sheet = ss.getSheetByName(SHEET.schedules);
  var rows = sheet.getDataRange().getValues();
  var written = false;
  for (var i = 1; i < rows.length; i++) {
    if (monthText_(rows[i][0]) === month) {
      sheet.getRange(i + 1, 1, 1, values.length).setValues([values]);
      written = true;
      break;
    }
  }
  if (!written) sheet.appendRow(values);
  schedule.updatedAt = updatedAt;
  return schedule;
}
