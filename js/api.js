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
    async getSubmission(month, name) {
      return read(KEY)[month + ':' + name] || null;
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
    async checkAdmin() {
      return { ok: true };
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
  // 1回の通信に2〜3秒かかり、同時に送っても順番に処理されるため、
  // 同じ瞬間に出た問い合わせは1つにまとめて送る。
  async function send(body) {
    let res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        // Apps Script は text/plain で送ると事前確認(プリフライト)なしで受け取れる
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error('通信できませんでした。電波の状態を確認してください');
    }
    if (!res.ok) throw new Error('通信に失敗しました (' + res.status + ')');
    return res.json();
  }

  async function sendOne(req) {
    const json = await send(req);
    if (json.error) throw new Error(json.error);
    return json.data;
  }

  let queue = [];
  let timer = null;
  let canBatch = true; // まとめ送りに対応していない古いスクリプトなら false にする

  function call(action, payload) {
    const req = { action, ...payload };
    if (!canBatch) return sendOne(req);
    return new Promise((resolve, reject) => {
      queue.push({ req, resolve, reject });
      if (!timer) timer = setTimeout(flush, 0);
    });
  }

  async function flush() {
    const items = queue;
    queue = [];
    timer = null;
    const runEach = () => items.forEach((it) => sendOne(it.req).then(it.resolve, it.reject));
    if (items.length === 1 || !canBatch) return runEach();
    try {
      const json = await send({ action: 'batch', requests: items.map((it) => it.req) });
      if (json.error) {
        canBatch = false; // 古いスクリプト:1つずつ送り直す
        return runEach();
      }
      json.data.forEach((r, i) => (r.error ? items[i].reject(new Error(r.error)) : items[i].resolve(r.data)));
    } catch (e) {
      items.forEach((it) => it.reject(e));
    }
  }

  // 読み取った結果をこの端末に覚えておき、次に開いたときすぐ表示できるようにする
  const CACHE_KEY = 'shiftapp:cache:';
  function remember(key, promise) {
    return promise.then((data) => {
      try {
        localStorage.setItem(CACHE_KEY + key, JSON.stringify(data));
      } catch (e) {
        // 覚えられなくても動作には影響しない
      }
      return data;
    });
  }
  function peek(key) {
    try {
      const text = localStorage.getItem(CACHE_KEY + key);
      return text === null ? undefined : JSON.parse(text);
    } catch (e) {
      return undefined;
    }
  }

  // 管理画面のパスワード(一度入れたら、この端末が覚えておく)
  const ADMIN_KEY = 'shiftapp:adminpw';
  function adminPassword() {
    try {
      return localStorage.getItem(ADMIN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  const remote = {
    login: () => call('login', {}),
    getSubmission: (month, name) => remember('sub:' + month + ':' + name, call('getSubmission', { month, name })),
    saveSubmission: (sub) =>
      remember('sub:' + sub.month + ':' + sub.name, call('saveSubmission', { submission: sub })),
    listSubmissions: (month) => call('listSubmissions', { month, password: adminPassword() }),
    getSchedule: (month) => remember('schedule:' + month, call('getSchedule', { month })),
    saveSchedule: (schedule) => call('saveSchedule', { schedule, password: adminPassword() }),
    checkAdmin: (password) => call('checkAdmin', { password }),
  };

  const impl = CONFIG.API_URL ? remote : local;
  return {
    ...impl,
    isLocal: !CONFIG.API_URL,
    adminPassword,
    setAdminPassword: (pw) => {
      try {
        if (pw) localStorage.setItem(ADMIN_KEY, pw);
        else localStorage.removeItem(ADMIN_KEY);
      } catch (e) {
        // 覚えられない端末では、開くたびに入力してもらう
      }
    },
    // 前回読み取った結果(なければ undefined)。お試しモードでは使わない
    peekSubmission: (month, name) => (CONFIG.API_URL ? peek('sub:' + month + ':' + name) : undefined),
    peekSchedule: (month) => (CONFIG.API_URL ? peek('schedule:' + month) : undefined),
  };
})();
