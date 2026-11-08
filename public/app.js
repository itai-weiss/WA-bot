const $ = (sel) => document.querySelector(sel);

const statusDot = $('#status-dot');
const statusText = $('#status-text');
const clockEl = $('#clock');
const qrPanel = $('#qr-panel');
const startupKicker = $('#startup-kicker');
const startupTitle = $('#startup-title');
const startupNote = $('#startup-note');
const qrSteps = $('#qr-steps');
const qrFrame = $('#qr-frame');
const qrImg = $('#qr-img');

const timingPanel = $('#timing-panel');
const groupPick = $('#group-pick');
const groupSearch = $('#group-search');
const groupSearchClear = $('#group-search-clear');
const groupCountEl = $('#group-count');
const metagroupSelect = $('#metagroup-select');
const applyMetagroupBtn = $('#apply-metagroup');
const metagroupName = $('#metagroup-name');
const saveMetagroupBtn = $('#save-metagroup');
const metagroupList = $('#metagroup-list');
const messageEl = $('#message');
const charCountEl = $('#char-count');
const filesEl = $('#files');
const chipList = $('#chip-list');
const attachEmpty = $('#attach-empty');
const scheduledAtEl = $('#scheduled-at');
const tzLabel = $('#tz-label');
const form = $('#timing-form');
const formError = $('#form-error');
const submitBtn = $('#timing-submit');
const submitLabel = submitBtn.querySelector('.transmit-label');
const timingList = $('#timing-list');
const manualPopover = $('#manual-popover');
const manualTitle = $('#manual-title');
const manualBody = $('#manual-body');
const manualClose = $('#manual-close');

let lastReady = false;
let allGroups = [];
let selectedIds = new Set();
let metagroups = [];
let attached = [];
const MAX_FILES = 10;

const TEXT = {
  status: {
    ready: 'מחובר',
    awaiting_scan: 'ממתין לסריקה',
    starting: 'מכין חיבור',
    loading: 'טוען את WhatsApp',
    syncing: 'מסנכרן שיחות',
    error: 'נדרשת פעולה',
    offline: 'השרת לא זמין',
  },
  serverOffline: 'לא ניתן ליצור קשר עם השרת המקומי. יש לוודא שהאפליקציה פתוחה.',
  loadingGroups: 'טוען רשימת קבוצות…',
  noGroups: (n) => `לא נמצאו קבוצות. זוהו ${n} שיחות פרטיות בלבד.`,
  groupsFailed: (m) => `שגיאה בטעינת קבוצות: ${m}`,
  noGroupMatch: 'אין תוצאות לחיפוש.',
  noMetagroups: '— אין מטא-קבוצות שמורות —',
  charCount: (n) => `${n} תווים`,
  noTimings: '— אין תזמונים קרובים —',
  saving: 'שומר…',
  save: 'שמור תזמון',
  removeFile: 'הסר קובץ',
};

const MANUALS = {
  overview: {
    title: 'איך בונים תזמון',
    body: 'בחר יעד אחד או יותר, כתוב הודעה או צרף קובץ, קבע מועד עתידי ולחץ שמור תזמון. השליחה מתבצעת אוטומטית בזמן שנקבע.',
  },
  targets: {
    title: 'יעדים ומטא-קבוצות',
    body: 'סמן קבוצות מהרשימה. אם יש שילוב שחוזר על עצמו, תן לו שם ושמור כמטא-קבוצה. בפעם הבאה בחר אותה מהרשימה כדי לסמן את כל הקבוצות יחד.',
  },
  message: {
    title: 'תוכן ההודעה',
    body: 'הטקסט יישלח לכל היעדים שנבחרו. אם צורפו קבצים, הטקסט יופיע ככיתוב של הקובץ הראשון.',
  },
  attachments: {
    title: 'קבצים מצורפים',
    body: 'אפשר לצרף עד 10 קבצים, עד 16MB לכל קובץ. הקבצים נשמרים מקומית עד מועד השליחה או עד ביטול התזמון.',
  },
  time: {
    title: 'מועד שליחה',
    body: 'בחר תאריך ושעה בעתיד. השעה מפורשת לפי אזור הזמן שמופיע ליד השדה.',
  },
  queue: {
    title: 'תזמונים קרובים',
    body: 'כאן מופיעים התזמונים שעדיין לא נשלחו. אפשר לבטל תזמון לפני מועד השליחה; ביטול מוחק גם קבצים שמורים שלו.',
  },
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function tickClock() {
  const d = new Date();
  clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function setStatus(kind, label) {
  statusDot.className = `dot ${kind}`;
  statusText.textContent = label;
}

function startupView(data) {
  if (data.error?.message) {
    return {
      kicker: 'נדרשת פעולה',
      title: 'החיבור ל-WhatsApp נעצר.',
      note: data.error.message,
      showSteps: false,
      showQr: false,
    };
  }

  switch (data.phase) {
    case 'awaiting_scan':
      return {
        kicker: 'חיבור WhatsApp',
        title: 'סרוק את קוד ה-QR.',
        note: 'צריך לחבר את החשבון מהטלפון לפני שניתן להפעיל תזמונים.',
        showSteps: true,
        showQr: Boolean(data.qr),
      };
    case 'loading':
      return {
        kicker: 'טוען את WhatsApp',
        title: 'החיבור נבנה עכשיו.',
        note: 'המערכת פותחת את WhatsApp Web ומחכה שייטען לגמרי.',
        showSteps: false,
        showQr: false,
      };
    case 'syncing':
      return {
        kicker: 'מסנכרן שיחות',
        title: 'עוד רגע אפשר לתזמן.',
        note: 'החשבון כבר מחובר. עכשיו נטענות הקבוצות למערכת.',
        showSteps: false,
        showQr: false,
      };
    case 'offline':
      return {
        kicker: 'השרת לא זמין',
        title: 'לא הצלחנו להגיע לאפליקציה.',
        note: TEXT.serverOffline,
        showSteps: false,
        showQr: false,
      };
    default:
      return {
        kicker: 'מכין את החיבור',
        title: 'מפעיל את WhatsApp Web.',
        note: 'בדרך כלל זה לוקח כמה שניות.',
        showSteps: false,
        showQr: false,
      };
  }
}

function updateStartupPanel(data) {
  const view = startupView(data);
  startupKicker.textContent = view.kicker;
  startupTitle.textContent = view.title;
  startupNote.textContent = view.note;
  startupNote.hidden = !view.note;
  qrSteps.hidden = !view.showSteps;
  qrFrame.hidden = !view.showQr;
  if (view.showQr && data.qr && qrImg.src !== data.qr) qrImg.src = data.qr;
  if (!view.showQr) qrImg.removeAttribute('src');
}

function setDefaultScheduleTime() {
  const d = new Date(Date.now() + 10 * 60 * 1000);
  d.setSeconds(0, 0);
  scheduledAtEl.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function poll() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    tzLabel.textContent = data.tz || 'Asia/Jerusalem';

    if (data.ready) {
      setStatus('ready', TEXT.status.ready);
      qrPanel.hidden = true;
      timingPanel.hidden = false;
      if (!lastReady) {
        lastReady = true;
        setDefaultScheduleTime();
        loadGroups();
        loadMetagroups();
        loadTimings();
      }
      return;
    }

    lastReady = false;
    timingPanel.hidden = true;
    qrPanel.hidden = false;
    setStatus(data.error ? 'error' : 'pending', data.error ? TEXT.status.error : (TEXT.status[data.phase] || TEXT.status.starting));
    updateStartupPanel(data);
  } catch (_) {
    lastReady = false;
    timingPanel.hidden = true;
    qrPanel.hidden = false;
    setStatus('error', TEXT.status.offline);
    updateStartupPanel({ phase: 'offline', error: { message: TEXT.serverOffline } });
  }
}

async function loadGroups() {
  groupPick.innerHTML = `<div class="group-pick-empty mono">${TEXT.loadingGroups}</div>`;

  try {
    const res = await fetch('/api/groups');
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.statusText);

    allGroups = payload.groups || [];
    if (!allGroups.length) {
      groupPick.innerHTML = `<div class="group-pick-empty mono">${TEXT.noGroups(payload.totalChats || 0)}</div>`;
      return;
    }
    renderGroupPick();
  } catch (err) {
    groupPick.innerHTML = `<div class="group-pick-empty mono">${TEXT.groupsFailed(err.message)}</div>`;
  }
}

function renderGroupPick(filter) {
  const q = (filter || groupSearch.value || '').trim().toLowerCase();
  const visible = q ? allGroups.filter((group) => group.name.toLowerCase().includes(q)) : allGroups;

  groupPick.innerHTML = '';

  if (!visible.length) {
    groupPick.innerHTML = `<div class="group-pick-nomatch mono">${TEXT.noGroupMatch}</div>`;
    return;
  }

  for (const group of visible) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    const nameSpan = document.createElement('span');

    cb.type = 'checkbox';
    cb.value = group.id;
    cb.checked = selectedIds.has(group.id);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(group.id);
      else selectedIds.delete(group.id);
      updateGroupCount();
    });

    nameSpan.textContent = group.name;
    label.appendChild(cb);
    label.appendChild(nameSpan);
    groupPick.appendChild(label);
  }

  updateGroupCount();
}

function updateGroupCount() {
  groupCountEl.textContent = `${selectedIds.size} נבחרו`;
}

async function loadMetagroups() {
  try {
    const res = await fetch('/api/metagroups');
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.statusText);
    metagroups = payload || [];
    renderMetagroups();
  } catch (_) {}
}

function renderMetagroups() {
  metagroupSelect.innerHTML = '<option value="">בחר מטא-קבוצה…</option>';
  metagroupList.innerHTML = '';

  if (!metagroups.length) {
    metagroupList.innerHTML = `<li class="metagroup-empty mono">${TEXT.noMetagroups}</li>`;
    return;
  }

  for (const metagroup of metagroups) {
    const opt = document.createElement('option');
    opt.value = metagroup.id;
    opt.textContent = `${metagroup.name} (${metagroup.groupIds.length})`;
    metagroupSelect.appendChild(opt);

    const names = metagroup.groupIds.map((id) => (allGroups.find((group) => group.id === id) || {}).name || id);
    const li = document.createElement('li');
    li.className = 'metagroup-item';
    li.innerHTML = `
      <div class="metagroup-item-head">
        <span class="metagroup-item-name"></span>
        <span class="metagroup-item-count mono"></span>
      </div>
      <div class="metagroup-item-groups mono"></div>
      <div class="metagroup-item-actions">
        <button type="button" class="metagroup-apply-btn ghost-btn mono">בחר</button>
        <button type="button" class="metagroup-delete-btn ghost-btn mono delete">מחק</button>
      </div>
    `;
    li.querySelector('.metagroup-item-name').textContent = metagroup.name;
    li.querySelector('.metagroup-item-count').textContent = `${metagroup.groupIds.length} קבוצות`;
    li.querySelector('.metagroup-item-groups').textContent = names.join(' · ');
    li.querySelector('.metagroup-apply-btn').addEventListener('click', () => applyMetagroup(metagroup.id));
    li.querySelector('.metagroup-delete-btn').addEventListener('click', () => deleteMetagroup(metagroup.id));
    metagroupList.appendChild(li);
  }
}

function applyMetagroup(id) {
  const metagroup = metagroups.find((item) => item.id === id);
  if (!metagroup) return;
  selectedIds = new Set(metagroup.groupIds);
  metagroupSelect.value = id;
  renderGroupPick();
  updateGroupCount();
}

async function deleteMetagroup(id) {
  try {
    await fetch(`/api/metagroups/${id}`, { method: 'DELETE' });
    metagroups = metagroups.filter((item) => item.id !== id);
    if (metagroupSelect.value === id) metagroupSelect.value = '';
    renderMetagroups();
  } catch (_) {}
}

async function saveMetagroup() {
  const name = metagroupName.value.trim();
  if (!name) return showError('כתוב שם למטא-קבוצה.');
  if (!selectedIds.size) return showError('בחר לפחות קבוצה אחת לפני שמירה.');

  try {
    const res = await fetch('/api/metagroups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, groupIds: [...selectedIds] }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.statusText);
    metagroups.push(payload);
    metagroupName.value = '';
    showError('');
    renderMetagroups();
    metagroupSelect.value = payload.id;
  } catch (err) {
    showError(err.message);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderChips() {
  chipList.innerHTML = '';
  attachEmpty.style.display = attached.length ? 'none' : '';

  attached.forEach((file, index) => {
    const li = document.createElement('li');
    li.className = 'chip';
    li.innerHTML = `
      <span class="chip-name"></span>
      <span class="chip-size"></span>
      <button type="button" class="chip-x" aria-label="${TEXT.removeFile}">×</button>
    `;
    li.querySelector('.chip-name').textContent = file.name;
    li.querySelector('.chip-size').textContent = formatBytes(file.size);
    li.querySelector('.chip-x').addEventListener('click', () => {
      attached.splice(index, 1);
      renderChips();
    });
    chipList.appendChild(li);
  });
}

async function loadTimings() {
  try {
    const res = await fetch('/api/timings');
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || res.statusText);
    renderTimings(items.filter((item) => !item.firedAt && item.enabled));
  } catch (err) {
    timingList.innerHTML = `<li class="timing-empty mono">${err.message}</li>`;
  }
}

function renderTimings(items) {
  timingList.innerHTML = '';

  if (!items.length) {
    timingList.innerHTML = `<li class="timing-empty mono">${TEXT.noTimings}</li>`;
    return;
  }

  const sorted = items.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  for (const timing of sorted) {
    const when = new Date(timing.scheduledAt).toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    });

    const li = document.createElement('li');
    li.className = 'timing-item';
    li.innerHTML = `
      <div class="timing-item-head">
        <span class="timing-item-name"></span>
        <span class="timing-item-count mono"></span>
      </div>
      <div class="timing-item-groups mono"></div>
      <div class="timing-item-files mono"></div>
      <p class="timing-message"></p>
      <div class="timing-item-actions">
        <button type="button" class="timing-delete-btn ghost-btn mono delete">בטל</button>
      </div>
    `;

    li.querySelector('.timing-item-name').textContent = when;
    li.querySelector('.timing-item-count').textContent = `${timing.groupIds.length} קבוצות`;
    li.querySelector('.timing-item-groups').textContent = (timing.groupNames || timing.groupIds).join(' · ');
    li.querySelector('.timing-item-files').textContent = (timing.attachments || []).length
      ? (timing.attachments || []).map((file) => file.originalName).join(' · ')
      : 'ללא קבצים מצורפים';
    li.querySelector('.timing-message').textContent = timing.message;
    li.querySelector('.timing-delete-btn').addEventListener('click', async () => {
      await fetch(`/api/timings/${timing.id}`, { method: 'DELETE' });
      loadTimings();
    });

    timingList.appendChild(li);
  }
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

function openManual(key) {
  const manual = MANUALS[key];
  if (!manual) return;
  manualTitle.textContent = manual.title;
  manualBody.textContent = manual.body;
  manualPopover.hidden = false;
}

function closeManual() {
  manualPopover.hidden = true;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  showError('');

  const groupIds = [...selectedIds];
  const message = messageEl.value.trim();
  const scheduledAt = scheduledAtEl.value ? new Date(scheduledAtEl.value).toISOString() : '';

  if (!groupIds.length) return showError('בחר לפחות קבוצה אחת.');
  if (!message && attached.length === 0) return showError('כתוב הודעה או צרף לפחות קובץ אחד.');
  if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) return showError('בחר מועד שליחה תקין.');
  if (new Date(scheduledAt).getTime() <= Date.now()) return showError('מועד השליחה חייב להיות בעתיד.');

  submitBtn.disabled = true;
  submitLabel.textContent = TEXT.saving;

  try {
    const fd = new FormData();
    for (const id of groupIds) fd.append('groupIds', id);
    fd.append('message', message);
    fd.append('scheduledAt', scheduledAt);
    for (const file of attached) fd.append('files', file);

    const res = await fetch('/api/timings', {
      method: 'POST',
      body: fd,
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.statusText);

    messageEl.value = '';
    charCountEl.textContent = TEXT.charCount(0);
    attached = [];
    renderChips();
    setDefaultScheduleTime();
    await loadTimings();
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitLabel.textContent = TEXT.save;
  }
});

groupSearch.addEventListener('input', () => renderGroupPick(groupSearch.value));
groupSearchClear.addEventListener('click', () => {
  groupSearch.value = '';
  renderGroupPick();
});
metagroupSelect.addEventListener('change', () => {
  if (metagroupSelect.value) applyMetagroup(metagroupSelect.value);
});
applyMetagroupBtn.addEventListener('click', () => {
  if (metagroupSelect.value) applyMetagroup(metagroupSelect.value);
});
saveMetagroupBtn.addEventListener('click', saveMetagroup);
document.querySelectorAll('.manual-btn').forEach((button) => {
  button.addEventListener('click', () => openManual(button.dataset.manual));
});
manualClose.addEventListener('click', closeManual);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeManual();
});
messageEl.addEventListener('input', () => {
  charCountEl.textContent = TEXT.charCount(messageEl.value.length);
});
filesEl.addEventListener('change', (ev) => {
  for (const file of ev.target.files) {
    if (attached.length >= MAX_FILES) break;
    attached.push(file);
  }
  ev.target.value = '';
  renderChips();
});

tickClock();
setInterval(tickClock, 1000);
poll();
setInterval(poll, 2000);
charCountEl.textContent = TEXT.charCount(0);
renderChips();
