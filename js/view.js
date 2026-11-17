// 確定シフトの閲覧画面(公開されたシフトだけを表示)
(() => {
  const $ = (id) => document.getElementById(id);
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const SLOTS = ['early', 'late'];
  const NAME_KEY = 'shiftapp:name';
  const pad = (n) => String(n).padStart(2, '0');

  const state = { year: 0, month: 0, schedule: null, name: '' };
  const monthKey = () => state.year + '-' + pad(state.month + 1);

  async function init() {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();

    const select = $('nameSelect');
    CONFIG.STAFF.forEach((n) => select.add(new Option(n, n)));
    const remembered = localStorage.getItem(NAME_KEY);
    if (remembered && CONFIG.STAFF.includes(remembered)) {
      select.value = remembered;
      state.name = remembered;
    }
    select.addEventListener('change', () => {
      state.name = select.value;
      if (state.name) localStorage.setItem(NAME_KEY, state.name);
      render();
    });
    $('onlyMine').addEventListener('change', render);
    $('prevMonth').addEventListener('click', () => moveMonth(-1));
    $('nextMonth').addEventListener('click', () => moveMonth(1));

    await load();
    // 今月が未公開で来月が公開済みなら、最初から来月を見せる
    if (!isPublished()) {
      const next = new Date(state.year, state.month + 1, 1);
      const nextKey = next.getFullYear() + '-' + pad(next.getMonth() + 1);
      const nextSchedule = await Api.getSchedule(nextKey).catch(() => null);
      if (nextSchedule && nextSchedule.published) moveMonth(1);
    }
  }

  const isPublished = () => !!(state.schedule && state.schedule.published);

  function moveMonth(diff) {
    const d = new Date(state.year, state.month + diff, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    return load();
  }

  async function load() {
    try {
      state.schedule = await Api.getSchedule(monthKey());
    } catch (e) {
      state.schedule = null;
    }
    setRuntimeClosed(state.schedule ? state.schedule.closed : []);
    render();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function render() {
    $('monthTitle').textContent = state.year + '年' + (state.month + 1) + '月';
    $('notYet').hidden = isPublished();
    $('published').hidden = !isPublished();
    if (!isPublished()) return;

    const assign = state.schedule.assign || {};
    const onlyMine = $('onlyMine').checked && state.name;
    const today = new Date();
    const list = $('shiftList');
    list.innerHTML = '';
    const mine = { early: 0, late: 0 };
    const last = new Date(state.year, state.month + 1, 0).getDate();

    for (let d = 1; d <= last; d++) {
      const key = monthKey() + '-' + pad(d);
      const a = assign[key] || { early: [], late: [] };
      const closed = isClosedDay(state.year, state.month, d);
      const mySlot = closed ? null : SLOTS.find((slot) => a[slot].includes(state.name)) || null;
      if (mySlot) mine[mySlot]++;
      if (onlyMine && !mySlot) continue;

      const dow = new Date(state.year, state.month, d).getDay();
      const row = el('div', 'shift-row' + (closed ? ' closed' : '') + (mySlot ? ' mine' : ''));
      if (today.getFullYear() === state.year && today.getMonth() === state.month && today.getDate() === d) {
        row.classList.add('today');
      }
      const date = el('div', 'day-date' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''));
      date.appendChild(el('span', 'day-num', String(d)));
      date.appendChild(el('span', 'day-dow', WEEK[dow]));
      row.appendChild(date);

      const body = el('div', 'shift-body');
      if (closed) {
        body.appendChild(el('span', 'day-empty', '店休日'));
      } else {
        SLOTS.forEach((slot) => {
          const line = el('div', 'shift-line');
          line.appendChild(el('span', 'chip ' + slot, SHIFT_TYPES[slot].short));
          if (a[slot].length === 0) {
            line.appendChild(el('span', 'day-empty', '未定'));
          } else {
            a[slot].forEach((name) => line.appendChild(el('span', 'shift-name' + (name === state.name ? ' me' : ''), name)));
          }
          body.appendChild(line);
        });
      }
      row.appendChild(body);
      list.appendChild(row);
    }
    if (list.children.length === 0) list.appendChild(el('p', 'day-empty', 'この月に入る日はありません。'));

    const summary = $('mySummary');
    summary.hidden = !state.name;
    if (state.name) {
      summary.innerHTML = '';
      summary.appendChild(document.createTextNode(state.name + 'さん:合計 '));
      summary.appendChild(el('strong', null, mine.early + mine.late + '日'));
      summary.appendChild(document.createTextNode('(早番 ' + mine.early + '・遅番 ' + mine.late + ')'));
    }
    $('onlyMine').disabled = !state.name;

    const t = new Date(state.schedule.updatedAt);
    $('updated').textContent = '最終更新:' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
  }

  Gate.enter().then(init);
})();
