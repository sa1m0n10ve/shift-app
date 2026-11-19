// データの読み書き窓口。
// CONFIG.API_URL が空のあいだは、ブラウザ内(localStorage)に保存するお試しモードで動きます。
const Api = (() => {
  const KEY = 'shiftapp:submissions';
  const SCHEDULE_KEY = 'shiftapp:schedules';

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch (e) {
      return {};
    }
  }

  // ---------- お試しモード(この端末の中だけ) ----------
  const local = {
    async login() {
      return { staff: CONFIG.STAFF };
    },
    // お試しモードでは暗証番号は確認しない
    async getSubmission(month, name) {
      return { status: 'ok', hasPin: true, submission: read(KEY)[month + ':' + name] || null };
    },
    async saveSubmission(sub) {
      const all = read(KEY);
      const saved = { ...sub, updatedAt: new Date().toISOString() };
      all[sub.month + ':' + sub.name] = saved;
      localStorage.setItem(KEY, JSON.stringify(all));
      return saved;
    },
    async listSubmissions(month) {
      return Object.values(read(KEY)).filter((s) => s.month === month);
    },
    // 確定シフトと臨時休業(月ごとに1つ)
    async getSchedule(month) {
      return read(SCHEDULE_KEY)[month] || null;
    },
    async saveSchedule(schedule) {
      const all = read(SCHEDULE_KEY);
      const saved = { ...schedule, updatedAt: new Date().toISOString() };
      all[schedule.month] = saved;
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(all));
      return saved;
    },
  };

  // ---------- 本番(スプレッドシートに保存) ----------
  async function call(action, payload) {
    let res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        // Apps Script は text/plain で送ると事前確認(プリフライト)なしで受け取れる
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload }),
      });
    } catch (e) {
      throw new Error('通信できませんでした。電波の状態を確認してください');
    }
    if (!res.ok) throw new Error('通信に失敗しました (' + res.status + ')');
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.data;
  }

  const remote = {
    login: () => call('login', {}),
    getSubmission: (month, name, pin) => call('getSubmission', { month, name, pin }),
    saveSubmission: (sub, pin) => call('saveSubmission', { submission: sub, pin }),
    listSubmissions: (month) => call('listSubmissions', { month }),
    getSchedule: (month) => call('getSchedule', { month }),
    saveSchedule: (schedule) => call('saveSchedule', { schedule }),
  };

  const impl = CONFIG.API_URL ? remote : local;
  return {
    ...impl,
    isLocal: !CONFIG.API_URL,
  };
})();
