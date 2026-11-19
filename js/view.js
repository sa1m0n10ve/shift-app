// 確定シフトの閲覧画面(公開されたシフトだけを表示)
(() => {
  const $ = (id) => document.getElementById(id);
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const SLOTS = ['early', 'late'];
  const NAME_KEY = 'shiftapp:name';
  const pad = (n) => String(n).padStart(2, '0');

  const state = { year: 0, month: 0, schedule: null, name: '' };
  const monthKey = () => state.year + '-' + pad(state.month + 1);

  // 一度読んだ月は覚えておき、月を行き来するときに待たせない
  const cache = {};
  function fetchSchedule(key) {
    if (!cache[key]) cache[key] = Api.getSchedule(key).catch(() => null);
    return cache[key];
  }
  const keyOf = (date) => date.getFullYear() + '-' + pad(date.getMonth() + 1);

  async function init() {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    state.loading = true;
    render();

    // 今月と来月のシフトを、スタッフ名の読み込みと同時に取りに行く
    const next = new Date(state.year, state.month + 1, 1);
    const pending = Promise.all([fetchSchedule(monthKey()), fetchSchedule(keyOf(next))]);
    await Gate.enter();

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
    $('prevMonth').addEventListener('click', () => {
      state.userMoved = true;
      moveMonth(-1);
    });
    $('nextMonth').addEventListener('click', () => {
      state.userMoved = true;
      moveMonth(1);
    });

    // 今月が未公開で来月が公開済みなら、最初から来月を見せる
    const pickMonth = (current, upcoming) => {
      const useNext = !(current && current.published) && !!(upcoming && upcoming.published);
      const target = useNext ? next : now;
      state.year = target.getFullYear();
      state.month = target.getMonth();
    };
    // 前回この端末で見た内容があれば、通信を待たずにすぐ出す
    const cachedCur = Api.peekSchedule(keyOf(now));
    if (cachedCur !== undefined) {
      pickMonth(cachedCur, Api.peekSchedule(keyOf(next)));
      showCached();
    }
    const [current, upcoming] = await pending;
    if (!state.userMoved) pickMonth(current, upcoming);
    if (!state.userMoved || cachedCur === undefined) load();
  }

  // 前回の内容を表示しておく(最新が届いたら load() で置き換わる)
  function showCached() {
    const cached = Api.peekSchedule(monthKey());
    if (cached === undefined) return false;
    state.schedule = cached;
    state.loading = false;
    setRuntimeClosed(cached ? cached.closed : []);
    render();
    return true;
  }

  const isPublished = () => !!(state.schedule && state.schedule.published);

  function moveMonth(diff) {
    const d = new Date(state.year, state.month + diff, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    return load();
  }

  let loadSeq = 0;
  async function load() {
    const seq = ++loadSeq;
    if (!showCached()) {
      state.loading = true;
      state.schedule = null;
      render();
    }
    const schedule = await fetchSchedule(monthKey());
    if (seq !== loadSeq) return; // 待っているあいだに別の月へ移った
    state.schedule = schedule;
    state.loading = false;
    setRuntimeClosed(schedule ? schedule.closed : []);
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
    $('notYet').firstElementChild.textContent = state.loading ? '読み込み中…' : 'この月のシフトはまだ公開されていません。';
    $('published').hidden = !isPublished();
    if (!isPublished()) return;

    const assign = state.schedule.assign || {};
    const today = new Date();
    const cal = $('shiftCal');
    cal.innerHTML = '';
    const mine = { early: 0, late: 0 };
    const first = new Date(state.year, state.month, 1).getDay();
    const last = new Date(state.year, state.month + 1, 0).getDate();
    for (let i = 0; i < first; i++) cal.appendChild(el('div', 'cal-cell blank'));

    for (let d = 1; d <= last; d++) {
      const key = monthKey() + '-' + pad(d);
      const a = assign[key] || { early: [], late: [] };
      const closed = isClosedDay(state.year, state.month, d);
      const dow = new Date(state.year, state.month, d).getDay();
      const cell = el('div', 'cal-cell' + (closed ? ' closed' : '') + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''));
      if (today.getFullYear() === state.year && today.getMonth() === state.month && today.getDate() === d) {
        cell.classList.add('today');
      }
      cell.appendChild(el('span', 'cal-num', String(d)));
      const labels = [];
      if (closed) {
        cell.appendChild(el('span', 'cal-closed', '休'));
        labels.push('店休日');
      } else {
        // 1人ずつ「新太郎早番」の形で縦に並べる(早番が上、遅番が下)
        SLOTS.forEach((slot) => {
          a[slot].forEach((name) => {
            const isMe = name === state.name;
            if (isMe) mine[slot]++;
            const entry = el('div', 'cal-entry ' + slot + (isMe ? ' me' : ''));
            entry.appendChild(el('span', null, name));
            entry.appendChild(el('span', null, SHIFT_TYPES[slot].label));
            cell.appendChild(entry);
            labels.push(name + SHIFT_TYPES[slot].label);
          });
        });
        if (labels.length === 0) labels.push('未定');
      }
      cell.setAttribute('aria-label', state.month + 1 + '月' + d + '日 ' + labels.join(' '));
      cal.appendChild(cell);
    }

    const summary = $('mySummary');
    summary.hidden = !state.name;
    if (state.name) {
      summary.innerHTML = '';
      summary.appendChild(document.createTextNode(state.name + 'さん:合計 '));
      summary.appendChild(el('strong', null, mine.early + mine.late + '日'));
      summary.appendChild(document.createTextNode('(早番 ' + mine.early + '・遅番 ' + mine.late + ')'));
    }

    const t = new Date(state.schedule.updatedAt);
    $('updated').textContent = '最終更新:' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
  }

  init();
})();
