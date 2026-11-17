// 管理画面:提出状況の一覧とシフト作成
(() => {
  const $ = (id) => document.getElementById(id);
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const SLOTS = ['early', 'late'];
  const pad = (n) => String(n).padStart(2, '0');

  const state = { year: 0, month: 0, subs: [], schedule: null };
  const monthKey = () => state.year + '-' + pad(state.month + 1);
  const dateKey = (d) => monthKey() + '-' + pad(d);
  const lastDay = () => new Date(state.year, state.month + 1, 0).getDate();

  function init() {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    state.year = target.getFullYear();
    state.month = target.getMonth();

    $('localNote').hidden = !Api.isLocal;
    $('prevMonth').addEventListener('click', () => moveMonth(-1));
    $('nextMonth').addEventListener('click', () => moveMonth(1));
    $('sampleBtn').addEventListener('click', addSamples);
    $('clearBtn').addEventListener('click', () => {
      if (!confirm('この端末に保存した提出データと作成中のシフトをすべて消します。よいですか?')) return;
      localStorage.removeItem('shiftapp:submissions');
      localStorage.removeItem('shiftapp:schedules');
      load();
    });
    $('autoBtn').addEventListener('click', autoAssign);
    $('resetBtn').addEventListener('click', () => {
      if (!confirm('この月の割り当てをすべてはずします。よいですか?')) return;
      state.schedule.assign = {};
      changed();
    });
    const savedFormat = localStorage.getItem(FORMAT_KEY);
    if (savedFormat) $('formatSelect').value = savedFormat;
    $('formatSelect').addEventListener('change', () => {
      localStorage.setItem(FORMAT_KEY, $('formatSelect').value);
      renderExport();
    });
    $('copyAllBtn').addEventListener('click', async () => {
      const text = exportItems().map((i) => i.label + ' ' + i.title).join('\n');
      if (await copyText(text)) toast('一覧をコピーしました');
    });
    $('icsBtn').addEventListener('click', downloadIcs);
    $('publishBtn').addEventListener('click', () => {
      state.schedule.published = !state.schedule.published;
      changed();
    });
    load();
  }

  async function moveMonth(diff) {
    await flushSave();
    const d = new Date(state.year, state.month + diff, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    load();
  }

  async function load() {
    try {
      const [subs, schedule] = await Promise.all([Api.listSubmissions(monthKey()), Api.getSchedule(monthKey())]);
      state.subs = subs;
      state.schedule = schedule || { month: monthKey(), assign: {}, closed: [], published: false };
    } catch (e) {
      state.subs = [];
      state.schedule = { month: monthKey(), assign: {}, closed: [], published: false };
      alert('読み込みに失敗しました:' + e.message);
    }
    setRuntimeClosed(state.schedule.closed);
    $('saveStatus').textContent = '';
    render();
  }

  // ---------- 保存(変更のたびに自動保存) ----------
  let saveTimer = null;
  let saving = Promise.resolve();

  function changed() {
    setRuntimeClosed(state.schedule.closed);
    render();
    $('saveStatus').textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 600);
  }

  function doSave() {
    saveTimer = null;
    const snapshot = JSON.parse(JSON.stringify(state.schedule));
    saving = saving
      .then(() => Api.saveSchedule(snapshot))
      .then(() => {
        if (!saveTimer) $('saveStatus').textContent = '保存しました';
      })
      .catch((e) => {
        $('saveStatus').textContent = '保存に失敗しました:' + e.message;
      });
    return saving;
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      return doSave();
    }
    return saving;
  }

  // ---------- データの読み取り ----------
  function getAssign(key) {
    const a = state.schedule.assign;
    if (!a[key]) a[key] = { early: [], late: [] };
    return a[key];
  }

  // その日の希望者 { 名前: 'early' | 'late' | 'any' }
  function applicants(key) {
    const people = {};
    state.subs.forEach((s) => {
      if (s.days[key]) people[s.name] = s.days[key];
    });
    return people;
  }

  function assignedSlot(key, name) {
    const a = state.schedule.assign[key];
    if (!a) return null;
    return SLOTS.find((slot) => a[slot].includes(name)) || null;
  }

  function assignedCounts() {
    const counts = {};
    Object.values(state.schedule.assign).forEach((a) => {
      SLOTS.forEach((slot) => a[slot].forEach((n) => (counts[n] = (counts[n] || 0) + 1)));
    });
    return counts;
  }

  // ---------- 表示 ----------
  function render() {
    $('monthTitle').textContent = state.year + '年' + (state.month + 1) + '月';
    const deadline = new Date(state.year, state.month - 1, CONFIG.DEADLINE_DAY);
    $('deadline').textContent = '提出締切:' + (deadline.getMonth() + 1) + '月' + deadline.getDate() + '日';
    renderStaff();
    renderDays();
    const pub = state.schedule.published;
    $('publishText').textContent = pub ? 'このシフトは公開中です(スタッフが見られます)' : 'このシフトはまだ非公開です(作成中)';
    $('publishBtn').textContent = pub ? '公開を取り消す' : 'シフトを公開する';
    $('publishBtn').classList.toggle('primary', !pub);
    renderExport();
  }

  // ---------- TimeTree用の出力 ----------
  const FORMAT_KEY = 'shiftapp:exportFormat';
  const copied = new Set(); // この画面を開いているあいだにコピーした日

  // 割り当てのある営業日だけを [{ day, key, label, title }] で返す
  function exportItems() {
    const format = $('formatSelect').value;
    const items = [];
    for (let d = 1; d <= lastDay(); d++) {
      if (isClosedDay(state.year, state.month, d)) continue;
      const key = dateKey(d);
      const a = state.schedule.assign[key];
      if (!a || a.early.length + a.late.length === 0) continue;
      let title;
      if (format === 'names') {
        title = a.early.concat(a.late).join('・');
      } else {
        // 例:田中早番　山田遅番
        title = SLOTS.flatMap((slot) => a[slot].map((name) => name + SHIFT_TYPES[slot].label)).join('　');
      }
      const dow = WEEK[new Date(state.year, state.month, d).getDay()];
      items.push({ day: d, key, label: state.month + 1 + '/' + d + '(' + dow + ')', title });
    }
    return items;
  }

  function renderExport() {
    const items = exportItems();
    const box = $('exportList');
    box.innerHTML = '';
    $('exportCount').textContent = items.length + '日ぶん';
    $('copyAllBtn').disabled = $('icsBtn').disabled = items.length === 0;
    if (items.length === 0) {
      box.appendChild(el('p', 'day-empty', '割り当てのある日がまだありません。'));
      return;
    }
    items.forEach((item) => {
      const id = item.key + '|' + item.title;
      const row = el('div', 'export-row' + (copied.has(id) ? ' copied' : ''));
      row.appendChild(el('span', 'export-date', item.label));
      row.appendChild(el('span', 'export-title', item.title));
      const btn = el('button', 'sub-btn small', copied.has(id) ? 'コピー済み' : 'コピー');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        if (await copyText(item.title)) {
          copied.add(id);
          toast(item.label + ' のタイトルをコピーしました');
          renderExport();
        }
      });
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // 古いブラウザや file:// で開いたとき用
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) toast('コピーできませんでした。文字を長押しして選んでください');
      return ok;
    }
  }

  // 終日の予定として .ics ファイルを作る
  function buildIcs(items) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shift-app//JA', 'CALSCALE:GREGORIAN'];
    items.forEach((item) => {
      const next = new Date(state.year, state.month, item.day + 1);
      const end = next.getFullYear() + pad(next.getMonth() + 1) + pad(next.getDate());
      lines.push(
        'BEGIN:VEVENT',
        'UID:shift-' + item.key + '@shift-app',
        'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + item.key.replace(/-/g, ''),
        'DTEND;VALUE=DATE:' + end,
        'SUMMARY:' + esc(item.title),
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  function downloadIcs() {
    const blob = new Blob([buildIcs(exportItems())], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'shift-' + monthKey() + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let toastTimer;
  function toast(msg) {
    const node = $('toast');
    node.textContent = msg;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2500);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // 誰が提出済みか
  function renderStaff() {
    const list = $('staffList');
    list.innerHTML = '';
    const byName = {};
    state.subs.forEach((s) => (byName[s.name] = s));
    const counts = assignedCounts();
    // 設定にない名前で提出されたものも漏らさず出す
    const names = CONFIG.STAFF.concat(Object.keys(byName).filter((n) => !CONFIG.STAFF.includes(n)));
    let done = 0;
    names.forEach((name) => {
      const sub = byName[name];
      const li = el('li', 'staff-row' + (sub ? '' : ' pending'));
      const head = el('div', 'staff-head');
      head.appendChild(el('span', 'staff-name', name));
      if (sub) {
        done++;
        const t = new Date(sub.updatedAt);
        head.appendChild(el('span', 'badge ok', '提出済み'));
        head.appendChild(
          el('span', 'staff-meta', '希望 ' + Object.keys(sub.days).length + '日 → 確定 ' + (counts[name] || 0) + '日 ・ ' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()))
        );
      } else {
        head.appendChild(el('span', 'badge wait', '未提出(全日OFF扱い)'));
        if (counts[name]) head.appendChild(el('span', 'staff-meta', '確定 ' + counts[name] + '日'));
      }
      li.appendChild(head);
      if (sub && sub.comment) li.appendChild(el('p', 'staff-comment', sub.comment));
      list.appendChild(li);
    });
    $('submitCount').textContent = done + ' / ' + names.length + '人';
  }

  // 日ごとの希望者と割り当て
  function renderDays() {
    const box = $('dayList');
    box.innerHTML = '';
    let openDays = 0;
    let doneDays = 0;
    for (let d = 1; d <= lastDay(); d++) {
      const key = dateKey(d);
      const dow = new Date(state.year, state.month, d).getDay();
      const row = el('div', 'day-row');
      const date = el('div', 'day-date' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''));
      date.appendChild(el('span', 'day-num', String(d)));
      date.appendChild(el('span', 'day-dow', WEEK[dow]));
      row.appendChild(date);

      const body = el('div', 'day-body');
      row.appendChild(body);

      if (isRegularClosedDay(state.year, state.month, d) || CONFIG.EXTRA_CLOSED.includes(key)) {
        row.classList.add('closed');
        body.appendChild(el('span', 'day-empty', '店休日'));
      } else if (state.schedule.closed.includes(key)) {
        row.classList.add('closed');
        body.appendChild(el('span', 'day-empty', '臨時休業'));
        row.appendChild(closeButton(key, true));
      } else {
        openDays++;
        if (renderOpenDay(row, body, key)) doneDays++;
        row.appendChild(closeButton(key, false));
      }
      box.appendChild(row);
    }
    const rest = openDays - doneDays;
    $('shortCount').textContent = rest > 0 ? '未確定:あと' + rest + '日(営業 ' + openDays + '日)' : '全 ' + openDays + '日 確定済み';
    $('shortCount').classList.toggle('warn-text', rest > 0);
  }

  // 営業日1日分。人数がそろっていれば true を返す
  function renderOpenDay(row, body, key) {
    const people = applicants(key);
    const a = getAssign(key);

    SHIFT_ORDER.forEach((type) => {
      Object.keys(people)
        .filter((n) => people[n] === type)
        .forEach((name) => body.appendChild(nameChip(key, name, type)));
    });
    // 希望を取り下げたのに割り当てが残っている人
    SLOTS.forEach((slot) => {
      a[slot].filter((n) => !people[n]).forEach((name) => body.appendChild(nameChip(key, name, null)));
    });
    if (body.children.length === 0) body.appendChild(el('span', 'day-empty', '希望者なし'));

    let complete = true;
    const lacking = [];
    SLOTS.forEach((slot) => {
      const lack = CONFIG.REQUIRED[slot] - a[slot].length;
      if (lack > 0) {
        complete = false;
        lacking.push(SHIFT_TYPES[slot].label + 'あと' + lack + '人');
      }
    });

    if (complete) {
      row.classList.add('done');
      body.appendChild(el('span', 'badge ok', '確定'));
    } else {
      // まだ割り当てていない希望者で残りの枠を埋められるか
      const free = Object.keys(people).filter((n) => !assignedSlot(key, n));
      let anyLeft = free.filter((n) => people[n] === 'any').length;
      let impossible = 0;
      SLOTS.forEach((slot) => {
        let lack = CONFIG.REQUIRED[slot] - a[slot].length - free.filter((n) => people[n] === slot).length;
        while (lack > 0 && anyLeft > 0) {
          lack--;
          anyLeft--;
        }
        if (lack > 0) impossible += lack;
      });
      if (impossible > 0) {
        row.classList.add('short');
        body.appendChild(el('span', 'badge warn', '希望者が' + impossible + '人足りません'));
      } else {
        body.appendChild(el('span', 'badge wait', lacking.join('・')));
      }
    }
    return complete;
  }

  function nameChip(key, name, type) {
    const slot = assignedSlot(key, name);
    const chip = el('button', 'name-chip ' + (type || 'gone') + (slot ? ' assigned slot-' + slot : ''));
    chip.type = 'button';
    const mark = slot ? SHIFT_TYPES[slot].short : type ? SHIFT_TYPES[type].short : '?';
    chip.appendChild(el('span', 'name-chip-mark', mark));
    chip.appendChild(document.createTextNode(name + (type ? '' : '(希望なし)')));
    chip.setAttribute(
      'aria-label',
      name + ' ' + (type ? SHIFT_TYPES[type].label + '希望' : '希望なし') + ' ' + (slot ? SHIFT_TYPES[slot].label + 'に割り当て済み' : '未割り当て')
    );
    chip.addEventListener('click', () => toggleAssign(key, name, type));
    return chip;
  }

  function toggleAssign(key, name, type) {
    const a = getAssign(key);
    const current = assignedSlot(key, name);
    SLOTS.forEach((slot) => (a[slot] = a[slot].filter((n) => n !== name)));
    let next = null;
    if (type === 'any') next = current === null ? 'early' : current === 'early' ? 'late' : null;
    else if (type) next = current === null ? type : null;
    if (next) a[next].push(name);
    changed();
  }

  function closeButton(key, isClosed) {
    const btn = el('button', 'link-btn close-btn', isClosed ? '営業に戻す' : '休みにする');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (isClosed) {
        state.schedule.closed = state.schedule.closed.filter((k) => k !== key);
      } else {
        const a = state.schedule.assign[key];
        const has = a && a.early.length + a.late.length > 0;
        if (has && !confirm('この日の割り当てをはずして休みにします。よいですか?')) return;
        delete state.schedule.assign[key];
        state.schedule.closed.push(key);
      }
      changed();
    });
    return btn;
  }

  // ---------- 自動割り当て ----------
  // まだ埋まっていない枠だけを、割り当て日数が少ない人から順に埋める
  function autoAssign() {
    const counts = assignedCounts();
    for (let d = 1; d <= lastDay(); d++) {
      if (isClosedDay(state.year, state.month, d)) continue;
      const key = dateKey(d);
      const people = applicants(key);
      const a = getAssign(key);
      for (;;) {
        const free = Object.keys(people).filter((n) => !assignedSlot(key, n));
        const options = SLOTS.filter((slot) => a[slot].length < CONFIG.REQUIRED[slot])
          .map((slot) => ({ slot, cands: free.filter((n) => people[n] === slot || people[n] === 'any') }))
          .filter((o) => o.cands.length > 0)
          // 候補が少ない枠から先に決める
          .sort((x, y) => x.cands.length - y.cands.length);
        if (options.length === 0) break;
        const { slot, cands } = options[0];
        cands.sort((x, y) => (counts[x] || 0) - (counts[y] || 0) || (people[x] === 'any') - (people[y] === 'any'));
        a[slot].push(cands[0]);
        counts[cands[0]] = (counts[cands[0]] || 0) + 1;
      }
    }
    changed();
  }

  // お試し用:スタッフ6人分のランダムな提出を作る
  async function addSamples() {
    for (const name of CONFIG.STAFF.slice(0, 6)) {
      const days = {};
      for (let d = 1; d <= lastDay(); d++) {
        if (isClosedDay(state.year, state.month, d) || Math.random() > 0.4) continue;
        days[dateKey(d)] = SHIFT_ORDER[Math.floor(Math.random() * 3)];
      }
      await Api.saveSubmission({ name, month: monthKey(), days, comment: name === CONFIG.STAFF[0] ? '月末はテスト期間で少なめです' : '' });
    }
    load();
  }

  Gate.enter().then(init);
})();
