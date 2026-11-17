// お店ごとの設定。ここを書き換えるだけで名前や締切を変えられます。
const CONFIG = {
  // バイト生の名前(仮の名前です。実際の名前に書き換えてください)
  STAFF: ['スタッフ1', 'スタッフ2', 'スタッフ3', 'スタッフ4', 'スタッフ5', 'スタッフ6', 'スタッフ7', 'スタッフ8'],

  // 締切日(対象月の前の月の、この日まで)
  DEADLINE_DAY: 25,

  // 1日に必要な人数
  REQUIRED: { early: 1, late: 1 },

  // 毎週の定休日(0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土)
  CLOSED_WEEKDAYS: [0],

  // 「第○ ○曜日」の定休日(nth=第何, weekday=曜日)。例は第3月曜
  CLOSED_NTH_WEEKDAYS: [{ nth: 3, weekday: 1 }],

  // 臨時休業日。'2026-12-31' の形で足していく(あとで管理画面から設定できるようにします)
  EXTRA_CLOSED: [],

  // データ保存先(Apps Script の URL)。空のあいだは、この端末のブラウザ内だけに保存します(お試し用)
  API_URL: 'https://script.google.com/macros/s/AKfycbwq9CUdjs-IutmlfP9tEucTuLPFL5VXdyutCLkD6e3SNLNXGhtX-FBVIwBEPUbal7kB/exec',
};

// その日が休みかどうか(year, month は 0-11, day は 1-31)
function isClosedDay(year, month, day) {
  const weekday = new Date(year, month, day).getDay();
  if (CONFIG.CLOSED_WEEKDAYS.includes(weekday)) return true;
  const nth = Math.ceil(day / 7);
  if (CONFIG.CLOSED_NTH_WEEKDAYS.some((r) => r.nth === nth && r.weekday === weekday)) return true;
  const key = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  return CONFIG.EXTRA_CLOSED.includes(key) || runtimeClosed.includes(key);
}

// 定休日のルールだけで休みかどうか(臨時休業は含めない)
function isRegularClosedDay(year, month, day) {
  const weekday = new Date(year, month, day).getDay();
  const nth = Math.ceil(day / 7);
  return (
    CONFIG.CLOSED_WEEKDAYS.includes(weekday) ||
    CONFIG.CLOSED_NTH_WEEKDAYS.some((r) => r.nth === nth && r.weekday === weekday)
  );
}

// 管理画面で設定した臨時休業日(保存データから読み込んで入れる)
let runtimeClosed = [];
function setRuntimeClosed(list) {
  runtimeClosed = list || [];
}

// シフトの種類
const SHIFT_TYPES = {
  early: { label: '早番', short: '早' },
  late: { label: '遅番', short: '遅' },
  any: { label: 'どちらでも可', short: '可' },
};
const SHIFT_ORDER = ['early', 'late', 'any'];
