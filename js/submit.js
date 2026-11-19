// シフト提出画面
(() => {
  const $ = (id) => document.getElementById(id);
  const NAME_KEY = 'shiftapp:name';
  const PIN_KEY = 'shiftapp:pin:'; // + 名前。そのスマホでは暗証番号を覚えておく

  const getPin = (name) => {
    try {
      return localStorage.getItem(PIN_KEY + name) || '';
    } catch (e) {
      return '';
    }
  };
  const setPin = (name, pin) => {
    try {
      if (pin) localStorage.setItem(PIN_KEY + name, pin);
      else localStorage.removeItem(PIN_KEY + name);
    } catch (e) {
      // 覚えられなくても、毎回入れれば使える
    }
  };

  const state = {
    name: '',
    year: 0,
    month: 0, // 0-11
    days: {}, // { '2026-12-01': 'early' | 'late' | 'any' }
    savedAt: null,
    dirty: false,
  };

  const pad = (n) => String(n).padStart(2, '0');
  const monthKey = () => state.year + '-' + pad(state.month + 1);
  const dateKey = (d) => monthKey() + '-' + pad(d);

  function init() {
    // 提出対象は来月。締切日(20日)を過ぎたら、さらに次の月にする
    // 例:11/1〜11/20 → 12月分、11/21〜12/20 → 1月分
    const now = new Date();
    const ahead = now.getDate() > CONFIG.DEADLINE_DAY ? 2 : 1;
    const target = new Date(now.getFullYear(), now.getMonth() + ahead, 1);
    state.year = target.getFullYear();
    state.month = target.getMonth();

    const select = $('nameSelect');
    CONFIG.STAFF.forEach((n) => select.add(new Option(n, n)));
    const remembered = localStorage.getItem(NAME_KEY);
    if (remembered && CONFIG.STAFF.includes(remembered)) {
      select.value = remembered;
      state.name = remembered;
    }

    $('localNote').hidden = !Api.isLocal;

    select.addEventListener('change', () => {
      if (!confirmDiscard()) {
        select.value = state.name;
        return;
      }
      state.name = select.value;
      localStorage.setItem(NAME_KEY, state.name);
      load();
    });
    $('prevMonth').addEventListener('click', () => moveMonth(-1));
    $('nextMonth').addEventListener('click', () => moveMonth(1));
    $('comment').addEventListener('input', markDirty);
    $('submitBtn').addEventListener('click', submit);
    $('pinBtn').addEventListener('click', unlock);
    $('pinInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.pinMode === 'unlock') unlock();
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) e.preventDefault();
    });

    load();
  }

  function confirmDiscard() {
    return !state.dirty || confirm('まだ提出していない変更があります。破棄してよいですか?');
  }

  function moveMonth(diff) {
    if (!confirmDiscard()) return;
    const d = new Date(state.year, state.month + diff, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    load();
  }

  let loadSeq = 0;

  async function load() {
    const seq = ++loadSeq;
    const month = monthKey();
    const name = state.name;
    state.days = {};
    state.savedAt = null;
    state.dirty = false;
    state.loading = true;
    state.locked = false;
    $('comment').value = '';
    render(); // 通信を待つあいだも、先にカレンダーを出しておく
    renderPin();

    // 臨時休業と、自分の提出済みデータを同時に取りに行く
    let failed = '';
    let [schedule, sub] = await Promise.all([
      Api.getSchedule(month).catch(() => null),
      name
        ? Api.getSubmission(month, name, getPin(name)).catch((e) => {
            failed = e.message;
            return null;
          })
        : null,
    ]);
    if (seq !== loadSeq) return; // 待っているあいだに名前や月が変わった

    setRuntimeClosed(schedule ? schedule.closed : []);
    state.locked = false;
    state.hasPin = true;
    if (sub && sub.status === 'locked') {
      // 暗証番号が違う・まだ入れていない(覚えていた番号が古い場合も)
      setPin(name, '');
      state.locked = true;
      sub = null;
    } else if (sub && 'status' in sub) {
      state.hasPin = sub.hasPin;
      sub = sub.submission;
    }
    // ('status' がない場合は暗証番号に対応する前のスクリプト。提出データがそのまま返る)
    if (sub) {
      // 提出後に休みになった日は外す
      Object.entries(sub.days).forEach(([key, type]) => {
        if (!isClosedDay(state.year, state.month, Number(key.slice(8)))) state.days[key] = type;
      });
      state.savedAt = sub.updatedAt;
      $('comment').value = sub.comment || '';
    }
    state.loading = false;
    render();
    renderPin();
    if (failed) toast('読み込みに失敗しました:' + failed);
  }

  // 暗証番号の欄。unlock = 見るために入れる / create = 初めての提出で決める
  function renderPin() {
    const mode = !state.name || state.loading ? null : state.locked ? 'unlock' : !state.hasPin ? 'create' : null;
    state.pinMode = mode;
    $('pinCard').hidden = !mode;
    $('calCard').hidden = mode === 'unlock';
    $('commentCard').hidden = mode === 'unlock';
    document.querySelector('.submit-bar').hidden = mode === 'unlock';
    $('pinBtn').hidden = mode !== 'unlock';
    if (mode === 'unlock') {
      $('pinLabel').textContent = state.name + 'さんの暗証番号(4桁)';
      $('pinHint').textContent = '自分の提出内容を見たり直したりするには、暗証番号が必要です。忘れたときは店長に連絡してください。';
    } else if (mode === 'create') {
      $('pinLabel').textContent = '暗証番号を決めてください(数字4桁)';
      $('pinHint').textContent = '次から自分の提出内容を見るときに使います。ほかの人には教えないでください。';
    }
  }

  async function unlock() {
    const pin = $('pinInput').value.trim();
    if (!/^\d{4}$/.test(pin)) {
      toast('数字4桁で入れてください');
      return;
    }
    $('pinBtn').disabled = true;
    setPin(state.name, pin);
    $('pinInput').value = '';
    await load();
    $('pinBtn').disabled = false;
    if (state.locked) toast('暗証番号が違います');
  }

  function render() {
    $('monthTitle').textContent = state.year + '年' + (state.month + 1) + '月';
    renderDeadline();
    renderCalendar();
    renderStatus();
    renderSummary();
  }

  function renderDeadline() {
    const deadline = new Date(state.year, state.month - 1, CONFIG.DEADLINE_DAY, 23, 59, 59);
    const el = $('deadline');
    const text = '提出締切:' + (deadline.getMonth() + 1) + '月' + deadline.getDate() + '日';
    const over = new Date() > deadline;
    el.textContent = over ? text + '(締切を過ぎています。変更は店長に連絡してください)' : text;
    el.classList.toggle('over', over);
  }

  function renderCalendar() {
    const cal = $('calendar');
    cal.innerHTML = '';
    const first = new Date(state.year, state.month, 1).getDay();
    const last = new Date(state.year, state.month + 1, 0).getDate();
    for (let i = 0; i < first; i++) cal.appendChild(document.createElement('span'));
    for (let d = 1; d <= last; d++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.day = d;
      btn.innerHTML = '<span class="num">' + d + '</span><span class="mark"></span>';
      if (isClosedDay(state.year, state.month, d)) {
        btn.className = 'day closed';
        btn.disabled = true;
        btn.querySelector('.mark').textContent = '休';
        btn.setAttribute('aria-label', state.month + 1 + '月' + d + '日 店休日');
      } else {
        btn.addEventListener('click', () => cycle(d, btn));
        paintDay(btn, d);
      }
      cal.appendChild(btn);
    }
  }

  function paintDay(btn, d) {
    const dow = new Date(state.year, state.month, d).getDay();
    const type = state.days[dateKey(d)];
    btn.className = 'day' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '') + (type ? ' ' + type : '');
    btn.querySelector('.mark').textContent = type ? SHIFT_TYPES[type].short : '';
    btn.setAttribute(
      'aria-label',
      state.month + 1 + '月' + d + '日 ' + (type ? SHIFT_TYPES[type].label : 'OFF')
    );
  }

  // なし → 早番 → 遅番 → どちらでも可 → なし
  function cycle(d, btn) {
    const key = dateKey(d);
    const next = SHIFT_ORDER[SHIFT_ORDER.indexOf(state.days[key]) + 1];
    if (next) state.days[key] = next;
    else delete state.days[key];
    paintDay(btn, d);
    markDirty();
    renderSummary();
  }

  function markDirty() {
    state.dirty = true;
    renderStatus();
  }

  function renderStatus() {
    const el = $('status');
    $('calendar').classList.toggle('loading', !!state.loading);
    $('submitBtn').disabled = !!state.loading;
    if (state.loading) {
      el.hidden = false;
      el.className = 'status loading';
      el.textContent = '読み込み中…';
    } else if (state.dirty && state.savedAt) {
      el.hidden = false;
      el.className = 'status editing';
      el.textContent = '変更があります。「提出する」を押すと反映されます。';
    } else if (state.savedAt) {
      const t = new Date(state.savedAt);
      el.hidden = false;
      el.className = 'status';
      el.textContent =
        '提出済み(' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ')。修正して再提出できます。';
    } else {
      el.hidden = true;
    }
    $('submitBtn').textContent = state.savedAt ? '修正して再提出する' : 'この内容で提出する';
  }

  function renderSummary() {
    const count = { early: 0, late: 0, any: 0 };
    Object.values(state.days).forEach((t) => count[t]++);
    const total = count.early + count.late + count.any;
    $('summary').innerHTML =
      '合計 <strong>' + total + '日</strong>(早番 ' + count.early + '・遅番 ' + count.late + '・どちらでも ' + count.any + ')';
  }

  async function submit() {
    if (!state.name) {
      toast('名前を選んでください');
      $('nameSelect').focus();
      return;
    }
    if (Object.keys(state.days).length === 0 && !confirm('全部の日がOFFになっています。このまま提出しますか?')) {
      return;
    }
    // 初めて提出する人は、ここで暗証番号を決める
    let pin = getPin(state.name);
    if (!state.hasPin) {
      pin = $('pinInput').value.trim();
      if (!/^\d{4}$/.test(pin)) {
        toast('暗証番号(数字4桁)を決めてください');
        $('pinInput').focus();
        return;
      }
    }
    const btn = $('submitBtn');
    btn.disabled = true;
    try {
      const saved = await Api.saveSubmission(
        {
          name: state.name,
          month: monthKey(),
          days: state.days,
          comment: $('comment').value.trim(),
        },
        pin
      );
      if (!state.hasPin) {
        setPin(state.name, pin);
        state.hasPin = true;
        $('pinInput').value = '';
        renderPin();
      }
      state.savedAt = saved.updatedAt;
      state.dirty = false;
      renderStatus();
      toast('提出しました');
    } catch (e) {
      if (e.message === 'PIN') {
        setPin(state.name, '');
        toast('暗証番号が変わっています。入れ直してください');
        load();
      } else {
        toast('提出に失敗しました:' + e.message);
      }
    } finally {
      btn.disabled = false;
    }
  }

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  Gate.enter().then(init);
})();
