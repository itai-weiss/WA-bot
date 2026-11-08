const $ = (sel) => document.querySelector(sel);

const statusDot = $('#status-dot');
const statusText = $('#status-text');
const clockEl = $('#clock');
const awakeNote = $('#awake-note');
const qrPanel = $('#qr-panel');
const startupTitle = $('#startup-title');
const startupNote = $('#startup-note');
const qrSteps = $('#qr-steps');
const qrFrame = $('#qr-frame');
const qrImg = $('#qr-img');

const timingPanel = $('#timing-panel');
const groupPick = $('#group-pick');
const loadingNotes = [$('#groups-loading'), $('#mg-loading')];
const groupSearch = $('#group-search');
const groupCountEl = $('#group-count');
const metagroupName = $('#metagroup-name');
const metagroupList = $('#metagroup-list');
const mgEmpty = $('#mg-empty');
const newMgBtn = $('#new-metagroup');
const mgDialog = $('#mg-dialog');
const mgForm = $('#mg-form');
const mgCancel = $('#mg-cancel');
const mgError = $('#mg-error');
const draftCount = $('#draft-count');
const messageStack = $('#message-stack');
const messageTemplate = $('#message-template');
const messageCountEl = $('#message-count');
const addMessageBtn = $('#add-message');
const scheduledAtEl = $('#scheduled-at');
const whenTime = $('#when-time');
const whenDate = $('#when-date');
const tzLabel = $('#tz-label');
const form = $('#timing-form');
const formError = $('#form-error');
const submitBtn = $('#timing-submit');
const timingList = $('#timing-list');
const doneTitle = $('#done-title');
const doneList = $('#done-list');

let lastReady = false;
let allGroups = [];
let groupsLoading = false; // /api/groups request in flight
let waSyncing = false; // WhatsApp still syncing after connecting
let syncPercent = null;
let selectedMg = new Set();
let draftIds = new Set();
let metagroups = [];
let messages = [];
const MAX_FILES_PER_MESSAGE = 10;
const MAX_MESSAGES = 10;
const DONE_WINDOW_MS = 24 * 60 * 60 * 1000;

const TEXT = {
  status: {
    ready: 'מחובר',
    loadingGroups: 'טוען קבוצות…',
    awaiting_scan: 'ממתין לסריקה',
    starting: 'מכין חיבור',
    loading: 'טוען את WhatsApp',
    syncing: 'מסנכרן שיחות',
    error: 'נדרשת פעולה',
    offline: 'השרת לא זמין',
  },
  serverOffline: 'לא ניתן ליצור קשר עם השרת המקומי. יש לוודא שהאפליקציה פתוחה.',
  loadingGroups: 'טוען רשימת קבוצות…',
  groupsStillLoading: (pct) =>
    `רשימת הקבוצות עדיין נטענת מ-WhatsApp${pct === null ? '' : ` (${pct}%)`}. ייתכן שחלק מהקבוצות עוד לא מופיעות. הרשימה תתעדכן לבד כשהטעינה תסתיים.`,
  searchGroups: (n) => `חפש מתוך ${n} קבוצות…`,
  noGroups: (n) => `לא נמצאו קבוצות. זוהו ${n} שיחות פרטיות בלבד.`,
  groupsFailed: (m) => `שגיאה בטעינת קבוצות: ${m}`,
  noGroupMatch: 'אין תוצאות לחיפוש.',
  charCount: (n) => `${n} תווים`,
  noTimings: '— אין תזמונים קרובים —',
  saving: 'שומר…',
  save: 'שמור תזמון',
  removeFile: 'הסר קובץ',
  messageCount: (n) => (n === 1 ? 'הודעה אחת' : `${n} הודעות`),
  messageNo: (n) => `הודעה ${n}`,
  awake: (time) =>
    `המחשב יישאר ער עד השליחה הבאה (${time}). אפשר לכבות את המסך, אבל לא לסגור את המכסה או לכבות את המחשב.`,
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function tickClock() {
  const d = new Date();
  clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDay(date) {
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(date, today)) return 'היום';
  if (same(date, tomorrow)) return 'מחר';
  return date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function setStatus(kind, label) {
  statusDot.className = `dot ${kind}`;
  statusText.textContent = label;
}

function startupView(data) {
  if (data.error?.message) {
    return { title: 'החיבור ל-WhatsApp נעצר.', note: data.error.message, showSteps: false, showQr: false };
  }

  switch (data.phase) {
    case 'awaiting_scan':
      return {
        title: 'סרוק את קוד ה-QR.',
        note: 'צריך לחבר את החשבון מהטלפון לפני שניתן להפעיל תזמונים.',
        showSteps: true,
        showQr: Boolean(data.qr),
      };
    case 'loading':
      return { title: 'החיבור נבנה עכשיו.', note: 'המערכת פותחת את WhatsApp Web ומחכה שייטען לגמרי.' };
    case 'syncing':
      return { title: 'עוד רגע אפשר לתזמן.', note: 'החשבון כבר מחובר. עכשיו נטענות הקבוצות למערכת.' };
    case 'offline':
      return { title: 'לא הצלחנו להגיע לאפליקציה.', note: TEXT.serverOffline };
    default:
      return { title: 'מפעיל את WhatsApp Web.', note: 'בדרך כלל זה לוקח כמה שניות.' };
  }
}

function updateStartupPanel(data) {
  const view = startupView(data);
  startupTitle.textContent = view.title;
  startupNote.textContent = view.note;
  qrSteps.hidden = !view.showSteps;
  qrFrame.hidden = !view.showQr;
  if (view.showQr && data.qr && qrImg.src !== data.qr) qrImg.src = data.qr;
  if (!view.showQr) qrImg.removeAttribute('src');
}

function updateAwakeNote(data) {
  if (!data.ready || !data.keepAwake || !data.nextAt) {
    awakeNote.hidden = true;
    return;
  }
  const next = new Date(data.nextAt);
  awakeNote.textContent = TEXT.awake(`${formatDay(next)} ${formatTime(next)}`);
  awakeNote.hidden = false;
}

function setDefaultScheduleTime() {
  const d = new Date(Date.now() + 10 * 60 * 1000);
  d.setSeconds(0, 0);
  scheduledAtEl.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  renderWhen();
}

function renderWhen() {
  const d = scheduledAtEl.value ? new Date(scheduledAtEl.value) : null;
  if (!d || Number.isNaN(d.getTime())) {
    whenTime.textContent = '--:--';
    whenDate.textContent = 'בחרו תאריך ושעה';
    return;
  }
  whenTime.textContent = formatTime(d);
  whenDate.textContent = formatDay(d);
}

async function poll() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    tzLabel.textContent = data.tz || 'Asia/Jerusalem';
    updateAwakeNote(data);

    if (data.ready) {
      qrPanel.hidden = true;
      timingPanel.hidden = false;
      const wasSyncing = waSyncing;
      waSyncing = Boolean(data.syncing);
      syncPercent = data.syncPercent ?? null;
      if (!lastReady) {
        lastReady = true;
        setDefaultScheduleTime();
        loadGroups();
        loadMetagroups();
        loadTimings();
      } else if (wasSyncing && !waSyncing) {
        loadGroups(); // sync finished: fetch the complete list
      }
      renderLoadingState();
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
    awakeNote.hidden = true;
    setStatus('error', TEXT.status.offline);
    updateStartupPanel({ phase: 'offline', error: { message: TEXT.serverOffline } });
  }
}

/* ── Groups (only inside the "new metagroup" dialog) ── */

function emptyLine(text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

// Amber "loading" header and notes until both the groups request and WhatsApp's
// own post-connect sync are done, so a partial list never looks final.
function renderLoadingState() {
  if (!lastReady) return; // disconnected meanwhile: poll() owns the header
  const busy = groupsLoading || waSyncing;
  const pct = waSyncing ? syncPercent : null;
  setStatus(busy ? 'pending busy' : 'ready', busy ? TEXT.status.loadingGroups : TEXT.status.ready);
  for (const note of loadingNotes) {
    note.textContent = busy ? TEXT.groupsStillLoading(pct) : '';
    note.hidden = !busy;
  }
}

async function loadGroups() {
  // Keep showing the current list during a refresh; only an empty list gets the placeholder.
  if (!allGroups.length) groupPick.replaceChildren(emptyLine(TEXT.loadingGroups));
  groupsLoading = true;
  renderLoadingState();

  try {
    const res = await fetch('/api/groups');
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.statusText);

    allGroups = payload.groups || [];
    groupSearch.placeholder = TEXT.searchGroups(allGroups.length);
    if (!allGroups.length) {
      groupPick.replaceChildren(emptyLine(TEXT.noGroups(payload.totalChats || 0)));
      return;
    }
    renderGroupPick();
    renderMetagroups();
  } catch (err) {
    groupPick.replaceChildren(emptyLine(TEXT.groupsFailed(err.message)));
  } finally {
    groupsLoading = false;
    renderLoadingState();
  }
}

function renderGroupPick() {
  if (!allGroups.length) return;
  const q = groupSearch.value.trim().toLowerCase();
  const visible = q ? allGroups.filter((group) => group.name.toLowerCase().includes(q)) : allGroups;

  if (!visible.length) {
    groupPick.replaceChildren(emptyLine(TEXT.noGroupMatch));
    return;
  }

  const frag = document.createDocumentFragment();
  for (const group of visible) {
    const label = document.createElement('label');
    label.className = 'group';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = group.id;
    cb.checked = draftIds.has(group.id);
    cb.addEventListener('change', () => {
      if (cb.checked) draftIds.add(group.id);
      else draftIds.delete(group.id);
      updateDraftCount();
    });
    const name = document.createElement('span');
    name.textContent = group.name;
    label.append(cb, name);
    frag.appendChild(label);
  }
  groupPick.replaceChildren(frag);
}

function updateDraftCount() {
  draftCount.textContent = `${draftIds.size} נבחרו`;
}

/* ── Metagroups: the only way to pick recipients ── */

async function loadMetagroups() {
  try {
    const res = await fetch('/api/metagroups');
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.statusText);
    metagroups = payload || [];
    renderMetagroups();
  } catch (_) {}
}

function groupName(id) {
  return (allGroups.find((group) => group.id === id) || {}).name || id;
}

function targetGroupIds() {
  const ids = new Set();
  for (const metagroup of metagroups) {
    if (selectedMg.has(metagroup.id)) metagroup.groupIds.forEach((id) => ids.add(id));
  }
  return ids;
}

function updateTargetCount() {
  const groups = targetGroupIds().size;
  const groupsText = groups === 1 ? 'קבוצה אחת' : `${groups} קבוצות`;
  const mgText = selectedMg.size === 1 ? 'מטא-קבוצה אחת' : `${selectedMg.size} מטא-קבוצות`;
  groupCountEl.textContent = selectedMg.size ? `${mgText} (${groupsText})` : 'לא נבחרה מטא-קבוצה';
  groupCountEl.classList.toggle('on', selectedMg.size > 0);
}

function renderMetagroups() {
  // Drop selections whose metagroup was deleted.
  selectedMg = new Set([...selectedMg].filter((id) => metagroups.some((m) => m.id === id)));
  metagroupList.replaceChildren();
  mgEmpty.hidden = metagroups.length > 0;

  for (const metagroup of metagroups) {
    const li = document.createElement('li');
    li.className = 'mg';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'mg-apply';
    pick.setAttribute('aria-pressed', String(selectedMg.has(metagroup.id)));
    pick.title = metagroup.groupIds.map(groupName).join(', ');
    pick.textContent = metagroup.name;
    const count = document.createElement('span');
    count.className = 'mg-count';
    count.textContent = metagroup.groupIds.length;
    pick.appendChild(count);
    pick.addEventListener('click', () => {
      if (selectedMg.has(metagroup.id)) selectedMg.delete(metagroup.id);
      else selectedMg.add(metagroup.id);
      renderMetagroups();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mg-delete';
    del.setAttribute('aria-label', `מחק את ${metagroup.name}`);
    del.textContent = '×';
    del.addEventListener('click', () => deleteMetagroup(metagroup.id));

    li.append(pick, del);
    metagroupList.appendChild(li);
  }
  updateTargetCount();
}

async function deleteMetagroup(id) {
  const metagroup = metagroups.find((item) => item.id === id);
  if (metagroup && !confirm(`למחוק את המטא-קבוצה "${metagroup.name}"? הקבוצות עצמן לא יימחקו, ותזמונים שכבר נשמרו יישלחו כרגיל.`)) return;
  try {
    await fetch(`/api/metagroups/${id}`, { method: 'DELETE' });
    metagroups = metagroups.filter((item) => item.id !== id);
    renderMetagroups();
  } catch (_) {}
}

function openMetagroupDialog() {
  draftIds = new Set();
  metagroupName.value = '';
  groupSearch.value = '';
  showMgError('');
  updateDraftCount();
  renderGroupPick();
  mgDialog.showModal();
  metagroupName.focus();
}

function showMgError(message) {
  mgError.textContent = message;
  mgError.hidden = !message;
}

async function saveMetagroup(ev) {
  ev.preventDefault();
  const name = metagroupName.value.trim();
  if (!name) return showMgError('כתוב שם למטא-קבוצה.');
  if (!draftIds.size) return showMgError('בחר לפחות קבוצה אחת לפני שמירה.');

  try {
    const res = await fetch('/api/metagroups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, groupIds: [...draftIds] }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.statusText);
    metagroups.push(payload);
    selectedMg.add(payload.id);
    renderMetagroups();
    mgDialog.close();
  } catch (err) {
    showMgError(err.message);
  }
}

/* ── Messages ── */

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function addMessage(focus = false) {
  if (messages.length >= MAX_MESSAGES) return;
  messages.push({ text: '', files: [] });
  renderMessages();
  if (focus) messageStack.lastElementChild.querySelector('textarea').focus();
}

function renderMessages() {
  messageStack.replaceChildren();
  messages.forEach((message, index) => {
    const node = messageTemplate.content.firstElementChild.cloneNode(true);
    const textarea = node.querySelector('textarea');
    const charCount = node.querySelector('.char-count');
    const fileInput = node.querySelector('input[type=file]');
    const chips = node.querySelector('.chip-list');
    const remove = node.querySelector('.message-remove');

    node.querySelector('.message-no').textContent = TEXT.messageNo(index + 1);
    textarea.value = message.text;
    textarea.setAttribute('aria-label', TEXT.messageNo(index + 1));
    charCount.textContent = TEXT.charCount(message.text.length);
    textarea.addEventListener('input', () => {
      message.text = textarea.value;
      charCount.textContent = TEXT.charCount(textarea.value.length);
    });

    remove.hidden = messages.length === 1;
    remove.addEventListener('click', () => {
      messages.splice(index, 1);
      renderMessages();
    });

    fileInput.addEventListener('change', () => {
      for (const file of fileInput.files) {
        if (message.files.length >= MAX_FILES_PER_MESSAGE) break;
        message.files.push(file);
      }
      renderMessages();
    });

    message.files.forEach((file, fileIndex) => {
      const li = document.createElement('li');
      li.className = 'chip';
      const name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = file.name;
      const size = document.createElement('span');
      size.className = 'chip-size';
      size.textContent = formatBytes(file.size);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.setAttribute('aria-label', `${TEXT.removeFile} ${file.name}`);
      x.textContent = '×';
      x.addEventListener('click', () => {
        message.files.splice(fileIndex, 1);
        renderMessages();
      });
      li.append(name, size, x);
      chips.appendChild(li);
    });

    messageStack.appendChild(node);
  });

  messageCountEl.textContent = TEXT.messageCount(messages.length);
  addMessageBtn.hidden = messages.length >= MAX_MESSAGES;
}

/* ── Queue ── */

async function loadTimings() {
  try {
    const res = await fetch('/api/timings');
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || res.statusText);
    renderTimings(items);
  } catch (err) {
    timingList.replaceChildren(emptyLine(err.message));
  }
}

function messageSummary(timing) {
  const first = timing.messages.find((m) => m.text) || timing.messages[0];
  const files = timing.messages.reduce((n, m) => n + (m.attachments || []).length, 0);
  const parts = [TEXT.messageCount(timing.messages.length)];
  if (files) parts.push(files === 1 ? 'קובץ אחד' : `${files} קבצים`);
  return { preview: first?.text || '', meta: parts.join(', ') };
}

function timingItem(timing, kind) {
  const when = new Date(timing.scheduledAt);
  const li = document.createElement('li');
  li.className = `timing ${kind}`;

  const head = document.createElement('div');
  head.className = 'timing-head';
  const time = document.createElement('span');
  time.className = 'timing-time';
  time.textContent = formatTime(when);
  const day = document.createElement('span');
  day.className = 'timing-day';
  day.textContent = formatDay(when);
  head.append(time, day);

  if (kind !== 'pending') {
    const tag = document.createElement('span');
    tag.className = 'tag';
    const failed = timing.failedGroups || [];
    if (kind === 'missed') tag.textContent = 'לא נשלח בזמן';
    else if (failed.length) tag.textContent = failed.length === 1 ? 'נכשל בקבוצה אחת' : `נכשל ב-${failed.length} קבוצות`;
    else tag.textContent = timing.lastTrigger === 'late' ? 'נשלח באיחור' : 'נשלח';
    tag.classList.add(kind === 'missed' || failed.length ? 'bad' : 'good');
    head.appendChild(tag);
  }

  const groups = document.createElement('p');
  groups.className = 'timing-groups';
  groups.textContent = (timing.metagroupNames?.length ? timing.metagroupNames : timing.groupNames || timing.groupIds).join(', ');

  const { preview, meta } = messageSummary(timing);
  const text = document.createElement('p');
  text.className = 'timing-text';
  text.textContent = preview;
  text.hidden = !preview;

  const foot = document.createElement('div');
  foot.className = 'timing-foot';
  const metaEl = document.createElement('span');
  metaEl.textContent = `${timing.groupIds.length === 1 ? 'קבוצה אחת' : `${timing.groupIds.length} קבוצות`}, ${meta}`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-link';
  btn.textContent = kind === 'pending' ? 'בטל' : 'הסר מהרשימה';
  btn.addEventListener('click', async () => {
    if (kind === 'pending' && !confirm('לבטל את התזמון? ההודעות לא יישלחו.')) return;
    await fetch(`/api/timings/${timing.id}`, { method: 'DELETE' });
    loadTimings();
  });
  foot.append(metaEl, btn);

  li.append(head, groups, text, foot);
  return li;
}

function renderTimings(items) {
  const byTime = (a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt);
  const pending = items.filter((t) => t.enabled && !t.firedAt && !t.missedAt).sort(byTime);
  const done = items
    .filter((t) => t.missedAt || (t.firedAt && Date.now() - new Date(t.firedAt) < DONE_WINDOW_MS))
    .sort((a, b) => byTime(b, a));

  timingList.replaceChildren(...(pending.length ? pending.map((t) => timingItem(t, 'pending')) : [emptyLine(TEXT.noTimings)]));
  doneTitle.hidden = !done.length;
  doneList.replaceChildren(...done.map((t) => timingItem(t, t.missedAt ? 'missed' : 'sent')));
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  showError('');

  const metagroupIds = [...selectedMg];
  const scheduledAt = scheduledAtEl.value ? new Date(scheduledAtEl.value).toISOString() : '';
  const emptyIndex = messages.findIndex((m) => !m.text.trim() && !m.files.length);

  if (!metagroupIds.length) return showError('בחר לפחות מטא-קבוצה אחת.');
  if (emptyIndex !== -1) return showError(`${TEXT.messageNo(emptyIndex + 1)} ריקה. כתוב הודעה או צרף לפחות קובץ אחד.`);
  if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) return showError('בחר מועד שליחה תקין.');
  if (new Date(scheduledAt).getTime() <= Date.now()) return showError('מועד השליחה חייב להיות בעתיד.');

  submitBtn.disabled = true;
  submitBtn.textContent = TEXT.saving;

  try {
    const fd = new FormData();
    for (const id of metagroupIds) fd.append('metagroupIds', id);
    fd.append('scheduledAt', scheduledAt);
    fd.append('messages', JSON.stringify(messages.map((m) => ({ text: m.text.trim() }))));
    messages.forEach((m, i) => m.files.forEach((file) => fd.append(`files_${i}`, file)));

    const res = await fetch('/api/timings', { method: 'POST', body: fd });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || res.statusText);

    messages = [];
    addMessage();
    setDefaultScheduleTime();
    await loadTimings();
    poll();
  } catch (err) {
    showError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = TEXT.save;
  }
});

groupSearch.addEventListener('input', renderGroupPick);
newMgBtn.addEventListener('click', openMetagroupDialog);
mgForm.addEventListener('submit', saveMetagroup);
mgCancel.addEventListener('click', () => mgDialog.close());
addMessageBtn.addEventListener('click', () => addMessage(true));

const helpDialog = $('#help-dialog');
document.querySelectorAll('[data-help]').forEach((button) => {
  button.addEventListener('click', () => {
    helpDialog.showModal();
    $(`#help-${button.dataset.help}`).scrollIntoView({ block: 'start' });
  });
});
$('#help-close').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (ev) => {
  if (ev.target === helpDialog) helpDialog.close();
});
scheduledAtEl.addEventListener('input', renderWhen);

tickClock();
setInterval(tickClock, 1000);
poll();
setInterval(poll, 2000);
setInterval(() => lastReady && loadTimings(), 30000);
addMessage();
