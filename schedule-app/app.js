'use strict';

/* ================= 常量与工具 ================= */
const STORAGE_KEY = 'schedule-app-v1';
const HOUR_PX = 60;
const COLOR_PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = n => String(n).padStart(2, '0');

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayStr() { return toDateStr(new Date()); }

function mondayOf(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function toMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtDisplayDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${+m}月${+d}日`;
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================= 数据状态 ================= */
function defaultCategories() {
  return [
    { id: 'cat-work', name: '工作', color: '#3b82f6' },
    { id: 'cat-life', name: '个人', color: '#10b981' },
    { id: 'cat-study', name: '学习', color: '#8b5cf6' },
    { id: 'cat-health', name: '健康', color: '#f59e0b' },
    { id: 'cat-other', name: '其他', color: '#94a3b8' },
  ];
}

function seedSample() {
  const today = new Date();
  const mk = (offsetDays, title, start, end, category, remind) => ({
    id: uid(), title,
    date: toDateStr(addDays(today, offsetDays)),
    startTime: start, endTime: end,
    category, notes: '', remindMinutes: remind,
    createdAt: Date.now(),
  });
  return [
    mk(0, '团队周会', '10:00', '11:00', 'cat-work', 10),
    mk(0, '健身', '19:00', '20:00', 'cat-health', 30),
    mk(1, '产品评审', '14:00', '15:30', 'cat-work', null),
    mk(2, '学习英语', '20:30', '21:30', 'cat-study', 15),
    mk(3, '和朋友的晚餐', '18:30', '20:00', 'cat-life', null),
    mk(-1, '阅读时间', '21:00', '22:00', 'cat-study', null),
    mk(0, '整理周报', null, null, 'cat-work', null),
  ];
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        events: data.events || [],
        categories: data.categories && data.categories.length ? data.categories : defaultCategories(),
        notifyEnabled: !!data.notifyEnabled,
        notifiedKeys: data.notifiedKeys || [],
      };
    }
  } catch (e) {
    console.warn('读取本地数据失败', e);
  }
  const s = { events: seedSample(), categories: defaultCategories(), notifyEnabled: false, notifiedKeys: [] };
  persist(s);
  return s;
}

function persist(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next || state));
  } catch (e) {
    console.warn('保存数据失败', e);
    showToast('保存失败：浏览器存储空间可能已满');
  }
}

function categoryById(id) {
  return state.categories.find(c => c.id === id) || null;
}

function categoryName(id) {
  const c = categoryById(id);
  return c ? c.name : '其他';
}

function categoryColor(id) {
  const c = categoryById(id);
  return c ? c.color : '#94a3b8';
}

function ensureCategory(name) {
  name = String(name || '').trim();
  if (!name) return null;
  const existing = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const id = uid();
  state.categories.push({ id, name, color: COLOR_PALETTE[state.categories.length % COLOR_PALETTE.length] });
  return id;
}

function eventsOnDate(dateStr) {
  return state.events
    .filter(e => e.date === dateStr)
    .sort((a, b) => (a.startTime || '24:00').localeCompare(b.startTime || '00:00'));
}

/* ================= 视图状态 ================= */
const view = {
  monday: mondayOf(new Date()),
  filter: '',
  monthCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDate: null,
};
let editingId = null;
let pendingImport = null;
let importType = 'json';
let copyContext = null;

/* ================= DOM 引用 ================= */
const $ = id => document.getElementById(id);
const weekLabel = $('weekLabel');
const weekBody = $('weekBody');
const categoryFilter = $('categoryFilter');
const toasts = $('toasts');
const monthGrid = $('monthGrid');
const monthLabel = $('monthLabel');
const dayLabel = $('dayLabel');
const singleDay = $('singleDay');
const dayPanelList = $('dayPanelList');
const dayPanelCount = $('dayPanelCount');
const backArea = $('backArea');
const brandArea = $('brandArea');

/* ================= 弹窗 ================= */
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('mousedown', e => {
    if (e.target === m) m.classList.remove('open');
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
  }
});

/* ================= 二级菜单导航 ================= */
const NAV_SCREENS = { month: 'monthView', day: 'dayView', week: 'weekView' };
const navStack = ['month'];

function updateBackArea() {
  const showBack = navStack.length > 1;
  backArea.hidden = !showBack;
  brandArea.hidden = showBack;
}

function navTo(name) {
  const curName = navStack[navStack.length - 1];
  if (curName === name) return;
  const cur = $(NAV_SCREENS[curName]);
  const next = $(NAV_SCREENS[name]);
  next.classList.remove('next');
  next.classList.add('current');
  cur.classList.add('back');
  navStack.push(name);
  updateBackArea();
}

function navBack() {
  if (navStack.length <= 1) return;
  const topName = navStack.pop();
  const top = $(NAV_SCREENS[topName]);
  const belowName = navStack[navStack.length - 1];
  const below = $(NAV_SCREENS[belowName]);
  top.classList.remove('current');
  top.classList.add('next');
  below.classList.remove('back');
  below.classList.add('current');
  updateBackArea();
}

/* ================= 提示 ================= */
function showToast(msg) {
  while (toasts.children.length >= 4) toasts.firstChild.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  toasts.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 350);
  }, 3800);
}

/* ================= 周视图渲染 ================= */
function renderWeekLabel() {
  const start = view.monday;
  const end = addDays(start, 6);
  const fmt = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  let label;
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    label = `${fmt(start)} – ${end.getDate()}日`;
  } else if (start.getFullYear() === end.getFullYear()) {
    label = `${fmt(start)} – ${end.getMonth() + 1}月${end.getDate()}日`;
  } else {
    label = `${fmt(start)} – ${fmt(end)}`;
  }
  weekLabel.textContent = label;
}

function computeLayout(events) {
  const sorted = [...events].sort((a, b) => {
    const sa = toMinutes(a.startTime), sb = toMinutes(b.startTime);
    return sa - sb || (toMinutes(b.endTime) - toMinutes(b.startTime)) - (toMinutes(a.endTime) - toMinutes(a.startTime));
  });
  let clusters = [];
  for (const ev of sorted) {
    const start = toMinutes(ev.startTime);
    const end = toMinutes(ev.endTime) || start + 60;
    const overlapping = clusters.filter(c => c.maxEnd > start);
    if (overlapping.length === 0) {
      clusters.push({ items: [ev], maxEnd: toMinutes(ev.endTime) || start + 60 });
    } else if (overlapping.length === 1) {
      overlapping[0].items.push(ev);
      overlapping[0].maxEnd = Math.max(overlapping[0].maxEnd, end);
    } else {
      const merged = {
        maxEnd: Math.max(end, ...overlapping.map(c => c.maxEnd)),
        items: [...overlapping.flatMap(c => c.items), ev],
      };
      clusters = clusters.filter(c => !overlapping.includes(c));
      clusters.push(merged);
    }
  }
  const placed = [];
  for (const cluster of clusters) {
    cluster.items.sort((a, b) => {
      const sa = toMinutes(a.startTime), sb = toMinutes(b.startTime);
      return sa - sb || (toMinutes(b.endTime) - toMinutes(b.startTime)) - (toMinutes(a.endTime) - toMinutes(a.startTime));
    });
    const laneEnds = [];
    const clusterPlaced = [];
    for (const ev of cluster.items) {
      const start = toMinutes(ev.startTime);
      let lane = laneEnds.findIndex(end => end <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = toMinutes(ev.endTime) || start + 60;
      clusterPlaced.push({ ev, lane });
    }
    clusterPlaced.forEach(p => placed.push({ ev: p.ev, lane: p.lane, laneCount: laneEnds.length }));
  }
  return placed;
}

function eventChip(ev) {
  const el = document.createElement('div');
  el.className = 'event-chip';
  el.style.background = categoryColor(ev.category);
  const t = document.createElement('div');
  t.className = 'event-time';
  t.textContent = ev.startTime ? `${ev.startTime}${ev.endTime ? '–' + ev.endTime : ''}` : '全天';
  const title = document.createElement('div');
  title.className = 'event-title';
  title.textContent = ev.title || '(无标题)';
  el.appendChild(t);
  el.appendChild(title);
  el.title = `${ev.title}（${categoryName(ev.category)}）`;
  el.addEventListener('click', e => {
    e.stopPropagation();
    openEventModal(ev);
  });
  return el;
}

function allDayPill(ev) {
  const el = document.createElement('div');
  el.className = 'allday-pill';
  el.style.background = categoryColor(ev.category);
  el.textContent = ev.title || '(无标题)';
  el.title = `${ev.title}（${categoryName(ev.category)}）`;
  el.addEventListener('click', () => openEventModal(ev));
  return el;
}

function renderDayCol(date) {
  const dateStr = toDateStr(date);
  const today = dateStr === todayStr();
  const col = document.createElement('div');
  col.className = 'day-col' + (today ? ' today' : '');

  const header = document.createElement('div');
  header.className = 'day-header';

  const row = document.createElement('div');
  row.className = 'day-header-row';
  const dname = document.createElement('div');
  dname.className = 'day-name';
  const wd = document.createElement('span');
  wd.className = 'wd';
  wd.textContent = WEEKDAYS[(date.getDay() + 6) % 7];
  const md = document.createElement('span');
  md.className = 'md';
  md.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
  dname.appendChild(wd);
  dname.appendChild(md);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn copy-day-btn';
  copyBtn.title = '复制此日日程到其他日期';
  copyBtn.setAttribute('aria-label', '复制此日日程到其他日期');
  copyBtn.textContent = '⧉';
  copyBtn.addEventListener('click', e => {
    e.stopPropagation();
    openCopyDialog(dateStr);
  });

  row.appendChild(dname);
  row.appendChild(copyBtn);
  header.appendChild(row);

  const dayEvents = eventsOnDate(dateStr).filter(e => !view.filter || e.category === view.filter);
  const allday = dayEvents.filter(e => !e.startTime);
  if (allday.length) {
    const band = document.createElement('div');
    band.className = 'allday-band';
    allday.forEach(ev => band.appendChild(allDayPill(ev)));
    header.appendChild(band);
  }
  col.appendChild(header);

  const slots = document.createElement('div');
  slots.className = 'day-slots';
  const todayNow = todayStr();
  const isPastDay = dateStr < todayNow;
  const isTodayCol = dateStr === todayNow;
  const nowHour = new Date().getHours();
  for (let h = 0; h < 24; h++) {
    const cell = document.createElement('div');
    cell.className = 'slot-cell';
    if (isPastDay) cell.classList.add('past-day');
    else if (isTodayCol && h < nowHour) cell.classList.add('past-hour');
    else if (isTodayCol && h === nowHour) cell.classList.add('now-hour');
    cell.title = `${dateStr} ${pad2(h)}:00`;
    cell.addEventListener('click', () => {
      const end = h === 23 ? '23:59' : minutesToTime(h * 60 + 60);
      openEventModal(null, dateStr, `${pad2(h)}:00`, end);
    });
    slots.appendChild(cell);
  }
  col.appendChild(slots);

  const timed = dayEvents.filter(e => e.startTime);
  computeLayout(timed).forEach(({ ev, lane, laneCount }) => {
    const start = toMinutes(ev.startTime);
    const end = toMinutes(ev.endTime) || start + 60;
    const el = eventChip(ev);
    el.style.top = (start / 60) * HOUR_PX + 'px';
    el.style.height = Math.max(((end - start) / 60) * HOUR_PX, 24) + 'px';
    el.style.left = `calc(${(lane * 100) / laneCount}% + 1px)`;
    el.style.width = `calc(${100 / laneCount}% - 2px)`;
    slots.appendChild(el);
  });

  return col;
}

function renderWeek() {
  renderWeekCore();
  renderMonth();
  if (view.selectedDate) renderSingleDay(view.selectedDate);
}

function renderWeekCore() {
  renderWeekLabel();
  weekBody.innerHTML = '';

  const gutter = document.createElement('div');
  gutter.className = 'time-gutter';
  const spacer = document.createElement('div');
  spacer.className = 'gutter-spacer';
  gutter.appendChild(spacer);
  const todayNow = todayStr();
  const todayInWeek = todayNow >= toDateStr(view.monday) && todayNow <= toDateStr(addDays(view.monday, 6));
  const nowHour = new Date().getHours();
  for (let h = 0; h < 24; h++) {
    const cell = document.createElement('div');
    cell.className = 'gutter-cell' + (todayInWeek && h < nowHour ? ' past' : '');
    cell.textContent = `${pad2(h)}:00`;
    gutter.appendChild(cell);
  }
  weekBody.appendChild(gutter);

  for (let i = 0; i < 7; i++) {
    weekBody.appendChild(renderDayCol(addDays(view.monday, i)));
  }
}

/* ================= 第一级：月度天数菜单 ================= */
function renderMonth() {
  const y = view.monthCursor.getFullYear();
  const m = view.monthCursor.getMonth();
  monthLabel.textContent = `${y}年${m + 1}月`;
  monthGrid.innerHTML = '';

  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const today = todayStr();

  for (let i = 0; i < lead; i++) {
    const blank = document.createElement('div');
    blank.className = 'month-day blank';
    monthGrid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    const dateStr = toDateStr(date);
    const cell = document.createElement('div');
    cell.dataset.date = dateStr;
    cell.className = 'month-day'
      + (dateStr === today ? ' today' : '')
      + (dateStr < today ? ' past' : '')
      + (dateStr === view.selectedDate ? ' selected' : '');

    const num = document.createElement('div');
    num.className = 'md-num';
    num.textContent = d;
    const wd = document.createElement('div');
    wd.className = 'md-wd';
    wd.textContent = WEEKDAYS[(date.getDay() + 6) % 7];
    cell.appendChild(num);
    cell.appendChild(wd);

    const count = state.events.filter(e => e.date === dateStr).length;
    if (count) {
      const badge = document.createElement('div');
      badge.className = 'md-count';
      badge.textContent = `${count} 项`;
      cell.appendChild(badge);
    }

    cell.addEventListener('click', () => openDay(dateStr));
    monthGrid.appendChild(cell);
  }
}

/* ================= 第二级：当日日程 ================= */
function renderSingleDay(dateStr) {
  const d = parseDateStr(dateStr);
  dayLabel.textContent = `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEKDAYS[(d.getDay() + 6) % 7]}`;
  singleDay.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'single-day';

  const gutter = document.createElement('div');
  gutter.className = 'time-gutter';
  const spacer = document.createElement('div');
  spacer.className = 'gutter-spacer';
  gutter.appendChild(spacer);
  const todayNow = todayStr();
  const isPastDay = dateStr < todayNow;
  const isToday = dateStr === todayNow;
  const nowHour = new Date().getHours();
  for (let h = 0; h < 24; h++) {
    const cell = document.createElement('div');
    cell.className = 'gutter-cell' + ((isPastDay || (isToday && h < nowHour)) ? ' past' : '');
    cell.textContent = `${pad2(h)}:00`;
    gutter.appendChild(cell);
  }
  wrap.appendChild(gutter);

  wrap.appendChild(renderDayCol(d));
  singleDay.appendChild(wrap);
  renderDayPanel(dateStr);
}

function renderDayPanel(dateStr) {
  const dayEvents = eventsOnDate(dateStr).filter(e => !view.filter || e.category === view.filter);
  dayPanelCount.textContent = dayEvents.length ? `${dayEvents.length} 项` : '';
  dayPanelList.innerHTML = '';

  if (!dayEvents.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.textContent = '这一天还没有日程\n点击左侧空白时间格或“＋ 新建”添加';
    dayPanelList.appendChild(empty);
    return;
  }

  dayEvents.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.title = ev.title || '(无标题)';

    const bar = document.createElement('div');
    bar.className = 'pi-bar';
    bar.style.background = categoryColor(ev.category);

    const main = document.createElement('div');
    main.className = 'pi-main';

    const title = document.createElement('div');
    title.className = 'pi-title';
    title.textContent = ev.title || '(无标题)';

    const time = document.createElement('div');
    time.className = 'pi-time';
    const timeText = ev.startTime ? `${ev.startTime}${ev.endTime ? '–' + ev.endTime : ''}` : '全天';
    time.textContent = `${timeText} · ${categoryName(ev.category)}`;

    const notes = document.createElement('div');
    notes.className = 'pi-notes' + (ev.notes ? '' : ' no-note');
    notes.textContent = ev.notes ? ev.notes : '无备注';

    main.appendChild(title);
    main.appendChild(time);
    main.appendChild(notes);
    item.appendChild(bar);
    item.appendChild(main);
    item.addEventListener('click', () => openEventModal(ev));
    dayPanelList.appendChild(item);
  });
}

function openDay(dateStr) {
  view.selectedDate = dateStr;
  const d = parseDateStr(dateStr);
  view.monthCursor = new Date(d.getFullYear(), d.getMonth(), 1);
  renderMonth();
  renderSingleDay(dateStr);
  navTo('day');
}

/* ================= 分类 ================= */
function renderChips() {
  categoryFilter.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'chip' + (!view.filter ? ' active' : '');
  all.dataset.cat = '';
  all.textContent = '全部';
  all.addEventListener('click', () => {
    view.filter = '';
    renderChips();
    renderWeek();
  });
  categoryFilter.appendChild(all);

  state.categories.forEach(c => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (view.filter === c.id ? ' active' : '');
    chip.dataset.cat = c.id;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = c.color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(c.name));
    chip.addEventListener('click', () => {
      view.filter = c.id;
      renderChips();
      renderWeek();
    });
    categoryFilter.appendChild(chip);
  });

  const manage = document.createElement('button');
  manage.className = 'chip';
  manage.id = 'manageCatsBtn';
  manage.textContent = '＋ 分类';
  manage.title = '分类管理';
  manage.addEventListener('click', () => {
    renderCatList();
    openModal('catDialog');
  });
  categoryFilter.appendChild(manage);
}

function renderCatList() {
  const catList = $('catList');
  catList.innerHTML = '';
  state.categories.forEach(c => {
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.dataset.id = c.id;

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = c.color;
    colorInput.title = '颜色';
    colorInput.addEventListener('change', () => {
      c.color = colorInput.value;
      persist();
      renderChips();
      renderWeek();
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = c.name;
    nameInput.maxLength = 20;
    nameInput.addEventListener('change', () => {
      const val = nameInput.value.trim();
      if (!val) {
        nameInput.value = c.name;
        return;
      }
      if (state.categories.some(o => o.id !== c.id && o.name.toLowerCase() === val.toLowerCase())) {
        showToast('已存在同名分类');
        nameInput.value = c.name;
        return;
      }
      c.name = val;
      persist();
      renderChips();
      renderWeek();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => {
      if (state.categories.length <= 1) {
        showToast('至少需要保留一个分类');
        return;
      }
      if (!confirm(`确定删除分类「${c.name}」吗？该分类下的日程将归入其他分类。`)) return;
      const fallback = state.categories.find(o => o.id !== c.id);
      state.events.forEach(e => {
        if (e.category === c.id) e.category = fallback ? fallback.id : null;
      });
      state.categories = state.categories.filter(o => o.id !== c.id);
      if (view.filter === c.id) view.filter = '';
      persist();
      renderCatList();
      renderChips();
      renderWeek();
    });

    row.appendChild(colorInput);
    row.appendChild(nameInput);
    row.appendChild(delBtn);
    catList.appendChild(row);
  });
}

/* ================= 日程编辑弹窗 ================= */
function renderCategorySelect(selectedId) {
  $('evCategory').innerHTML = state.categories
    .map(c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${esc(c.name)}</option>`)
    .join('');
}

function updateAllDayFields() {
  const disabled = $('evAllDay').checked;
  $('evStart').disabled = disabled;
  $('evEnd').disabled = disabled;
  $('evRemind').disabled = disabled;
  $('evTimeFields').style.opacity = disabled ? 0.5 : 1;
}

function openEventModal(ev, date, start, end) {
  editingId = ev ? ev.id : null;
  $('evModalTitle').textContent = ev ? '编辑日程' : '新建日程';
  $('evTitle').value = ev ? ev.title : '';
  $('evDate').value = ev ? ev.date : (date || todayStr());
  $('evAllDay').checked = ev ? !ev.startTime : !!(date && !start);
  $('evStart').value = ev ? (ev.startTime || '09:00') : (start || '09:00');
  $('evEnd').value = ev ? (ev.endTime || '') : (end || '');
  $('evRemind').value = ev && ev.remindMinutes != null ? String(ev.remindMinutes) : '';
  $('evNotes').value = ev ? (ev.notes || '') : '';
  renderCategorySelect(ev ? ev.category : (state.categories[0] ? state.categories[0].id : null));
  $('evDeleteBtn').style.display = ev ? '' : 'none';
  $('evCopyBtn').style.display = ev ? '' : 'none';
  updateAllDayFields();
  openModal('eventModal');
  $('evTitle').focus();
}

function saveEvent() {
  const title = $('evTitle').value.trim();
  const date = $('evDate').value;
  if (!title) return showToast('请填写标题');
  if (!date) return showToast('请选择日期');

  let startTime = null, endTime = null, remindMinutes = null;
  if (!$('evAllDay').checked) {
    startTime = $('evStart').value || null;
    endTime = $('evEnd').value || null;
    if (!startTime) return showToast('请填写开始时间');
    if (endTime && endTime <= startTime) return showToast('结束时间需要晚于开始时间');
    const rv = $('evRemind').value;
    remindMinutes = rv !== '' ? parseInt(rv, 10) : null;
  }

  const base = {
    title,
    date,
    startTime,
    endTime,
    category: $('evCategory').value || null,
    remindMinutes,
    notes: $('evNotes').value.trim(),
  };

  if (editingId) {
    const ev = state.events.find(e => e.id === editingId);
    if (ev) Object.assign(ev, base);
  } else {
    state.events.push({ id: uid(), ...base, createdAt: Date.now() });
  }
  persist();
  closeModal('eventModal');
  renderChips();
  renderWeek();
  showToast(`已保存「${title}」`);
}

function deleteEvent() {
  const ev = state.events.find(e => e.id === editingId);
  if (!ev) return;
  if (!confirm(`确定删除「${ev.title}」吗？`)) return;
  state.events = state.events.filter(e => e.id !== editingId);
  persist();
  closeModal('eventModal');
  renderChips();
  renderWeek();
  showToast('已删除日程');
}

/* ================= 复制日程 ================= */
function openCopyDialog(sourceDate, onlyId) {
  const items = eventsOnDate(sourceDate).filter(e => !onlyId || e.id === onlyId);
  if (!items.length) {
    showToast('该日期没有可复制的日程');
    return;
  }
  copyContext = { sourceDate, onlyId: onlyId || null };
  $('copyTitle').textContent = onlyId ? '复制日程' : '复制当天日程';
  $('copySourceLabel').textContent = `来源：${fmtDisplayDate(sourceDate)}，共 ${items.length} 条`;
  $('copyTargetDate').value = toDateStr(addDays(parseDateStr(sourceDate), 1));

  const list = $('copyList');
  list.innerHTML = '';
  const allLabel = document.createElement('label');
  allLabel.className = 'copy-item copy-all';
  const allCb = document.createElement('input');
  allCb.type = 'checkbox';
  allCb.checked = true;
  const allSpan = document.createElement('span');
  allSpan.textContent = '全选';
  allLabel.appendChild(allCb);
  allLabel.appendChild(allSpan);
  allCb.addEventListener('change', () => {
    list.querySelectorAll('.copy-item input[type="checkbox"]:not(.copy-all input)').forEach(cb => { cb.checked = allCb.checked; });
  });
  list.appendChild(allLabel);

  items.forEach(ev => {
    const label = document.createElement('label');
    label.className = 'copy-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.id = ev.id;
    const color = document.createElement('span');
    color.className = 'ci-color';
    color.style.background = categoryColor(ev.category);
    const time = document.createElement('span');
    time.className = 'ci-time';
    time.textContent = ev.startTime ? `${ev.startTime}${ev.endTime ? '–' + ev.endTime : ''}` : '全天';
    const title = document.createElement('span');
    title.className = 'ci-title';
    title.textContent = ev.title || '(无标题)';
    label.appendChild(cb);
    label.appendChild(color);
    label.appendChild(time);
    label.appendChild(title);
    list.appendChild(label);
  });
  openModal('copyDialog');
}

function confirmCopy() {
  if (!copyContext) return;
  const target = $('copyTargetDate').value;
  if (!target) return showToast('请选择目标日期');
  const ids = [...$('copyList').querySelectorAll('input[type="checkbox"]:checked:not(.copy-all input)')].map(cb => cb.dataset.id);
  const src = state.events.filter(e => ids.includes(e.id));
  const copies = src.map(e => ({ ...e, id: uid(), date: target, createdAt: Date.now() }));
  state.events.push(...copies);
  persist();
  closeModal('copyDialog');
  renderChips();
  renderWeek();
  showToast(`已复制 ${copies.length} 条日程到 ${fmtDisplayDate(target)}`);
}

/* ================= 导入 ================= */
function parseCSVRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function normalizeDate(s) {
  s = String(s || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad2(+m[1])}-${pad2(+m[2])}`;
  return null;
}

function normalizeTime(s) {
  s = String(s || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[:：](\d{1,2})(?::\d{1,2})?$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

function unescapeIcs(s) {
  return String(s || '').replace(/\\([nN\\,;])/g, (_, c) => (c === 'n' || c === 'N') ? '\n' : c).trim();
}

function parseIcalDt(raw) {
  if (!raw) return null;
  const dt = String(raw).trim();
  let m = dt.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
  m = dt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:\d{2})?(?:Z)?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
  return null;
}

function parseIcalDuration(s) {
  const m = String(s || '').match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  return ((+m[1] || 0) * 7 * 1440) + ((+m[2] || 0) * 1440) + ((+m[3] || 0) * 60) + (+m[4] || 0) + ((+m[5] || 0) / 60);
}

function parseICS(text) {
  const warnings = [];
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (const l of raw) {
    if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1);
    else lines.push(l);
  }
  const vevents = [];
  let cur = null;
  for (const l of lines) {
    if (/^BEGIN:VEVENT/i.test(l)) { cur = []; vevents.push(cur); continue; }
    if (/^END:VEVENT/i.test(l)) { cur = null; continue; }
    if (cur) cur.push(l);
  }
  const events = [];
  const cats = new Set();
  let recurCount = 0;
  vevents.forEach(block => {
    const props = {};
    for (const l of block) {
      const idx = l.indexOf(':');
      if (idx === -1) continue;
      const key = l.slice(0, idx).toUpperCase();
      if (!(key in props)) props[key] = l.slice(idx + 1);
    }
    const summary = unescapeIcs(props.SUMMARY || '(无标题)');
    if (props.RRULE) recurCount++;
    const startInfo = parseIcalDt(props.DTSTART);
    if (!startInfo) {
      warnings.push(`跳过无法识别日期的事件：${summary}`);
      return;
    }
    let endTime = null;
    if (startInfo.time) {
      const endInfo = props.DTEND ? parseIcalDt(props.DTEND) : null;
      if (endInfo && endInfo.time) endTime = endInfo.time;
      else if (props.DURATION) {
        const durMin = parseIcalDuration(props.DURATION);
        if (durMin != null) endTime = minutesToTime(toMinutes(startInfo.time) + durMin);
      }
      if (!endTime) endTime = minutesToTime(toMinutes(startInfo.time) + 60);
    }
    let category = null;
    if (props.CATEGORIES) {
      const first = String(props.CATEGORIES).split(',').map(s => s.trim()).filter(Boolean)[0];
      if (first) {
        category = first;
        cats.add(first);
      }
    }
    events.push({
      title: summary,
      date: startInfo.date,
      startTime: startInfo.time,
      endTime,
      notes: unescapeIcs(props.DESCRIPTION || ''),
      category,
      remindMinutes: null,
    });
  });
  if (recurCount) warnings.push(`${recurCount} 个循环日程已按首次出现导入，如需重复可手动复制。`);
  if (!events.length && !warnings.length) warnings.push('文件中没有找到任何日程（VEVENT）。');
  return { events, categories: [...cats], warnings };
}

function parseJSONImport(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.events)) {
    throw new Error('不是有效的日程备份文件（缺少 events 数组）');
  }
  const warnings = [];
  const idToName = {};
  (data.categories || []).forEach(c => {
    if (c && c.id && c.name) idToName[c.id] = String(c.name);
  });
  const events = (data.events || []).map(raw => ({
    title: raw.title,
    date: raw.date,
    startTime: raw.startTime,
    endTime: raw.endTime,
    notes: raw.notes || raw.description || '',
    category: raw.category ? (idToName[raw.category] || String(raw.category)) : null,
    remindMinutes: raw.remindMinutes != null ? raw.remindMinutes : null,
  }));
  const categories = (data.categories || [])
    .map(c => ({ id: c.id || uid(), name: String(c.name || '').trim(), color: c.color || '#94a3b8' }))
    .filter(c => c.name);
  return { events, categories, warnings };
}

function parseCSVImport(text) {
  const rows = parseCSVRows(text);
  const warnings = [];
  if (rows.length < 2) throw new Error('CSV 文件需要至少包含一行表头和一行数据');
  const header = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  const find = names => header.findIndex(h => names.includes(h));
  const cDate = find(['日期', 'date', 'day', '开始日期']);
  const cTitle = find(['标题', 'title', '事项', '日程', '事项名称', 'subject', 'name']);
  const cStart = find(['开始', '开始时间', 'start', 'starttime']);
  const cEnd = find(['结束', '结束时间', 'end', 'endtime']);
  const cCat = find(['分类', 'category', '类别', 'type']);
  const cNotes = find(['备注', 'notes', 'note', '描述', 'description']);
  const cRemind = find(['提醒', 'remind', '提醒(分钟)', '提醒分钟', '提醒（分钟）', 'remindminutes']);
  if (cTitle === -1 || cDate === -1) {
    throw new Error('CSV 表头需要包含「日期」和「标题」列');
  }
  const events = [];
  const cats = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const title = String(r[cTitle] || '').trim();
    const date = normalizeDate(r[cDate]);
    if (!title && !date) continue;
    if (!title || !date) {
      warnings.push(`跳过第 ${i + 1} 行：缺少标题或日期`);
      continue;
    }
    const startTime = cStart >= 0 ? normalizeTime(r[cStart]) : null;
    const endTime = cEnd >= 0 ? normalizeTime(r[cEnd]) : null;
    if (cStart >= 0 && String(r[cStart] || '').trim() && !startTime) warnings.push(`第 ${i + 1} 行开始时间无法识别`);
    if (cEnd >= 0 && String(r[cEnd] || '').trim() && !endTime) warnings.push(`第 ${i + 1} 行结束时间无法识别`);
    const cat = cCat >= 0 ? String(r[cCat] || '').trim() : '';
    if (cat) cats.add(cat);
    let remindMinutes = null;
    if (cRemind >= 0 && String(r[cRemind] || '').trim() !== '') {
      const n = parseInt(r[cRemind], 10);
      if (!isNaN(n)) remindMinutes = Math.max(0, n);
      else warnings.push(`第 ${i + 1} 行提醒时间无法识别`);
    }
    events.push({
      title,
      date,
      startTime,
      endTime,
      notes: cNotes >= 0 ? String(r[cNotes] || '') : '',
      category: cat || null,
      remindMinutes,
    });
  }
  if (!events.length) throw new Error('没有解析到任何日程');
  return { events, categories: [...cats], warnings };
}

function setupImportTabs() {
  $('importTabs').querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $('importTabs').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      importType = tab.dataset.type;
      pendingImport = null;
      $('importPreview').innerHTML = '';
      $('importConfirmBtn').disabled = true;
      $('importFile').value = '';
    });
  });
}

async function handleImportFile() {
  const file = $('importFile').files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const result = (() => {
      if (importType === 'json') return parseJSONImport(text);
      if (importType === 'csv') return parseCSVImport(text);
      return parseICS(text);
    })();
    pendingImport = result;
    const { events, categories, warnings } = result;
    let html = `<div class="ok">解析成功：将导入 <b>${events.length}</b> 条日程</div>`;
    if (categories && categories.length) html += `<div>涉及分类：${esc(categories.join('、'))}</div>`;
    if (warnings && warnings.length) html += `<div class="warn">${esc(warnings.join('；'))}</div>`;
    $('importPreview').innerHTML = html;
    $('importConfirmBtn').disabled = false;
  } catch (err) {
    $('importPreview').innerHTML = `<div class="err">解析失败：${esc(err.message)}</div>`;
    pendingImport = null;
    $('importConfirmBtn').disabled = true;
  }
}

function confirmImport() {
  if (!pendingImport) return;
  const { events, categories, warnings } = pendingImport;
  (categories || []).forEach(name => ensureCategory(name));
  let added = 0;
  events.forEach(raw => {
    const title = String(raw.title || '').trim();
    const date = normalizeDate(raw.date);
    if (!title || !date) return;
    const catId = ensureCategory(raw.category);
    state.events.push({
      id: uid(),
      title,
      date,
      startTime: normalizeTime(raw.startTime),
      endTime: normalizeTime(raw.endTime),
      category: catId,
      notes: String(raw.notes || ''),
      remindMinutes: raw.remindMinutes == null || raw.remindMinutes === '' ? null : Math.max(0, parseInt(raw.remindMinutes, 10) || 0),
      createdAt: Date.now(),
    });
    added++;
  });
  persist();
  closeModal('importDialog');
  $('importFile').value = '';
  pendingImport = null;
  $('importPreview').innerHTML = '';
  $('importConfirmBtn').disabled = true;
  renderChips();
  renderWeek();
  const msg = `成功导入 ${added} 条日程` + (warnings.length ? `（另有 ${warnings.length} 条提示）` : '');
  showToast(msg);
}

/* ================= 导出 ================= */
function exportJSON() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: state.categories,
    events: state.events,
  };
  download(`schedule-backup-${todayStr()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  showToast('已导出 JSON 备份');
}

function csvField(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCSV() {
  const header = ['日期', '开始', '结束', '标题', '分类', '备注', '提醒(分钟)'];
  const rows = state.events.map(e => [
    e.date,
    e.startTime || '',
    e.endTime || '',
    e.title,
    categoryName(e.category),
    e.notes || '',
    e.remindMinutes == null ? '' : e.remindMinutes,
  ]);
  const text = [header, ...rows].map(r => r.map(csvField).join(',')).join('\n');
  download(`schedule-${todayStr()}.csv`, '\ufeff' + text, 'text/csv;charset=utf-8');
  showToast('已导出 CSV');
}

/* ================= 通知提醒 ================= */
function updateNotifyUI() {
  const status = $('notifyStatus');
  const sw = $('notifySwitch');
  status.className = 'notify-status';
  if (!('Notification' in window)) {
    sw.disabled = true;
    sw.checked = false;
    status.textContent = '当前浏览器不支持系统通知，仍可使用页面内提醒。';
    status.classList.add('denied');
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    sw.disabled = false;
    sw.checked = state.notifyEnabled;
    if (state.notifyEnabled) {
      status.textContent = '系统通知已开启 ✓';
      status.classList.add('granted');
    } else {
      status.textContent = '已获得浏览器授权，但系统通知当前为关闭状态。';
    }
  } else if (perm === 'denied') {
    sw.disabled = true;
    sw.checked = false;
    status.textContent = '浏览器已拒绝通知权限，请在浏览器设置中重新授权。';
    status.classList.add('denied');
  } else {
    sw.disabled = false;
    sw.checked = false;
    status.textContent = '点击上方开关后将请求浏览器授权。';
  }
}

function checkReminders() {
  const now = Date.now();
  let changed = false;
  state.events.forEach(ev => {
    if (!ev.startTime || ev.remindMinutes == null || ev.remindMinutes === '') return;
    const key = `${ev.id}:${ev.date}`;
    if (state.notifiedKeys.includes(key)) return;
    const [h, m] = ev.startTime.split(':').map(Number);
    const start = parseDateStr(ev.date);
    start.setHours(h, m, 0, 0);
    const remindAt = start.getTime() - ev.remindMinutes * 60000;
    if (now >= remindAt && now < start.getTime() + 60000) {
      state.notifiedKeys.push(key);
      if (state.notifiedKeys.length > 500) state.notifiedKeys = state.notifiedKeys.slice(-300);
      changed = true;
      const msg = `「${ev.title}」将在 ${ev.startTime} 开始` + (ev.remindMinutes ? `（提前 ${ev.remindMinutes} 分钟提醒）` : '');
      showToast('🔔 ' + msg);
      if (state.notifyEnabled && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('日程提醒', { body: msg });
        } catch (e) { /* 忽略通知异常 */ }
      }
    }
  });
  if (changed) persist();
}

/* ================= 初始化 ================= */
function bindEvents() {
  $('backBtn').addEventListener('click', navBack);
  $('weekBtnTop').addEventListener('click', () => {
    renderWeek();
    navTo('week');
  });

  $('prevMonth').addEventListener('click', () => {
    view.monthCursor = new Date(view.monthCursor.getFullYear(), view.monthCursor.getMonth() - 1, 1);
    renderMonth();
  });
  $('nextMonth').addEventListener('click', () => {
    view.monthCursor = new Date(view.monthCursor.getFullYear(), view.monthCursor.getMonth() + 1, 1);
    renderMonth();
  });
  $('todayMonthBtn').addEventListener('click', () => {
    view.monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    renderMonth();
  });

  $('prevDay').addEventListener('click', () => {
    if (!view.selectedDate) return;
    openDay(toDateStr(addDays(parseDateStr(view.selectedDate), -1)));
  });
  $('nextDay').addEventListener('click', () => {
    if (!view.selectedDate) return;
    openDay(toDateStr(addDays(parseDateStr(view.selectedDate), 1)));
  });
  $('dayNewBtn').addEventListener('click', () => openEventModal(null, view.selectedDate || todayStr(), '09:00', '10:00'));

  $('prevWeek').addEventListener('click', () => {
    view.monday = addDays(view.monday, -7);
    renderWeek();
  });
  $('nextWeek').addEventListener('click', () => {
    view.monday = addDays(view.monday, 7);
    renderWeek();
  });
  $('todayBtn').addEventListener('click', () => {
    view.monday = mondayOf(new Date());
    renderWeek();
  });
  $('newEventBtn').addEventListener('click', () => openEventModal(null, todayStr(), '09:00', '10:00'));

  $('evCancelBtn').addEventListener('click', () => closeModal('eventModal'));
  $('evSaveBtn').addEventListener('click', saveEvent);
  $('evDeleteBtn').addEventListener('click', deleteEvent);
  $('evCopyBtn').addEventListener('click', () => {
    const ev = state.events.find(e => e.id === editingId);
    if (ev) openCopyDialog(ev.date, ev.id);
  });
  $('evAllDay').addEventListener('change', updateAllDayFields);

  $('copyCancelBtn').addEventListener('click', () => closeModal('copyDialog'));
  $('copyConfirmBtn').addEventListener('click', confirmCopy);

  $('importBtn').addEventListener('click', () => openModal('importDialog'));
  $('importCancelBtn').addEventListener('click', () => closeModal('importDialog'));
  $('importConfirmBtn').addEventListener('click', confirmImport);
  $('importFile').addEventListener('change', handleImportFile);
  const drop = $('importDrop');
  drop.addEventListener('click', () => $('importFile').click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) {
      const dt = new DataTransfer();
      dt.items.add(f);
      $('importFile').files = dt.files;
      $('importFile').dispatchEvent(new Event('change'));
    }
  });
  setupImportTabs();

  $('exportBtn').addEventListener('click', () => openModal('exportDialog'));
  $('exportCloseBtn').addEventListener('click', () => closeModal('exportDialog'));
  $('exportJsonBtn').addEventListener('click', exportJSON);
  $('exportCsvBtn').addEventListener('click', exportCSV);

  $('catCloseBtn').addEventListener('click', () => closeModal('catDialog'));
  $('addCatBtn').addEventListener('click', () => {
    const name = $('newCatName').value.trim();
    if (!name) return showToast('请输入分类名称');
    if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      return showToast('已存在同名分类');
    }
    state.categories.push({ id: uid(), name, color: $('newCatColor').value });
    $('newCatName').value = '';
    persist();
    renderCatList();
    renderChips();
    renderWeek();
  });

  $('notifyBtn').addEventListener('click', () => {
    updateNotifyUI();
    openModal('notifyDialog');
  });
  $('notifyCloseBtn').addEventListener('click', () => closeModal('notifyDialog'));
  $('notifySwitch').addEventListener('change', async () => {
    const sw = $('notifySwitch');
    if (sw.checked) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        state.notifyEnabled = true;
        persist();
        showToast('系统通知已开启');
      } else {
        sw.checked = false;
        showToast('未获得通知权限，仍可在页面内收到提醒');
      }
    } else {
      state.notifyEnabled = false;
      persist();
    }
    updateNotifyUI();
  });
  $('notifyTestBtn').addEventListener('click', () => {
    showToast('🔔 这是页面内测试提醒');
    if (state.notifyEnabled && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('日程提醒测试', { body: '如果你看到这条通知，说明系统通知正常。' });
      } catch (e) { /* 忽略 */ }
    } else {
      showToast('系统通知未开启，仅显示页面内提醒');
    }
  });
}

function renderAll() {
  renderChips();
  renderWeek();
}

function init() {
  bindEvents();
  renderAll();
  updateBackArea();
  checkReminders();
  setInterval(checkReminders, 30000);
}

init();
