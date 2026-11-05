/**
 * Plejar agency panel
 */

const $ = id => document.getElementById(id);

const state = {
  token: (() => { try { return localStorage.getItem('plezar_token'); } catch (e) { return null; } })(),
  me: null,
  agency: null,
  stats: null,
  events: [],
  eventFilter: 'upcoming',
  team: [],
  verification: null,
  editing: null, // event being edited, or null for a new one
  removedPhotos: new Set(),
  announcements: [],
  editingAnnouncement: null,
  cancelling: null,
  audience: null,
  tempPassword: '',
  places: null,
  plan: { itinerary: [], spareDays: [] }
};

const isOwner = () => state.me && state.me.agencyRole === 'owner';

// ---------- Helpers ----------

function escapeHTML(value) {
  // Escape quotes too, so the result is safe inside HTML attributes as well as text
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

function showAlert(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(path, { method, headers, body: payload, credentials: 'include' });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const taka = n => `৳${Number(n || 0).toLocaleString('en-US')}`;
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const isoDay = d => (d ? new Date(d).toISOString().slice(0, 10) : '');
// Event dates are calendar days stored at midnight UTC, so show them in UTC to get the same day everywhere
const fmtDay = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// "12–14 Dec 2026", or one date for a day trip
function dateRange(start, end) {
  if (!start) return 'No date set';
  const a = new Date(start);
  const b = end ? new Date(end) : a;
  if (isoDay(a) === isoDay(b)) return fmtDay(a);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  if (sameMonth) return `${a.getUTCDate()}–${fmtDay(b)}`;
  return `${a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${fmtDay(b)}`;
}
const initials = name => String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label || 'Saving...';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

// ---------- Sign in / out ----------

function showLogin(notice) {
  $('panelView').hidden = true;
  $('passwordView').hidden = true;
  $('loginView').hidden = false;
  showAlert('loginNotice', notice);
}

// ---------- First sign-in: choose your own password ----------

function showPasswordStep() {
  $('loginView').hidden = true;
  $('panelView').hidden = true;
  $('passwordView').hidden = false;
  showAlert('passwordError', '');
  // Signed in just now with the temporary password: no need to type it again
  $('currentPasswordField').hidden = Boolean(state.tempPassword);
  $('pwCurrent').value = state.tempPassword;
  (state.tempPassword ? $('pwNew') : $('pwCurrent')).focus();
}

$('passwordForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('passwordError', '');
  const current = $('pwCurrent').value;
  const password = $('pwNew').value;
  if (!current) return showAlert('passwordError', 'Enter the temporary password from your email.');
  if (password.length < 8) return showAlert('passwordError', 'Use at least 8 characters.');
  if (password === current) return showAlert('passwordError', 'Choose a password different from the temporary one.');
  if (password !== $('pwConfirm').value) return showAlert('passwordError', "The two passwords don't match.");

  const btn = $('passwordSubmit');
  setBusy(btn, true);
  try {
    const data = await api('/api/v1/users/changePassword', { method: 'PATCH', body: { currentPassword: current, password, confirmPassword: password } });
    state.token = data.token;
    try { localStorage.setItem('plezar_token', data.token); } catch (err) { /* cookie still works */ }
    state.tempPassword = '';
    $('passwordForm').reset();
    toast('Password saved. Welcome to your vendor panel.');
    await boot();
  } catch (err) {
    showAlert('passwordError', err.status === 401 ? 'The temporary password is not right. Check the email from Plejar.' : err.message);
  } finally {
    setBusy(btn, false);
  }
});

$('passwordLogout').addEventListener('click', e => {
  e.preventDefault();
  $('logoutBtn').click();
});

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('loginError', '');
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) return showAlert('loginError', 'Enter your email and password.');

  const btn = $('loginSubmit');
  setBusy(btn, true, 'Signing in...');
  try {
    const data = await api('/api/v1/users/login', { method: 'POST', body: { email, password } });
    const roles = Array.isArray(data.data.roles) && data.data.roles.length ? data.data.roles : [data.data.role];
    if (!roles.includes('agent') || !data.data.agency) {
      showAlert('loginError', roles.includes('agent')
        ? "Your account has the Vendor role but isn't linked to an agency yet. Ask a Plejar admin to choose your agency under Users > Change roles."
        : 'This sign in is for tour agencies. Plejar staff use the admin console at /admin.');
      await api('/api/v1/users/logout').catch(() => {});
      return;
    }
    state.token = data.token;
    try { localStorage.setItem('plezar_token', data.token); } catch (err) { /* cookie still works */ }
    state.tempPassword = data.data.mustChangePassword ? password : '';
    await boot();
  } catch (err) {
    showAlert('loginError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

$('forgotLink').addEventListener('click', async e => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  if (!email) return showAlert('loginError', 'Enter your email above, then select "Forgot your password?" again.');
  showAlert('loginError', '');
  try {
    await api('/api/v1/users/forgotPassword', { method: 'POST', body: { email } });
    showAlert('loginNotice', `If ${email} has an account, a reset link is on its way.`);
  } catch (err) {
    showAlert('loginNotice', `If ${email} has an account, a reset link is on its way.`);
  }
});

$('logoutBtn').addEventListener('click', async () => {
  if (state.socket) state.socket.disconnect();
  state.socket = null;
  await api('/api/v1/users/logout').catch(() => {});
  state.token = null;
  try { localStorage.removeItem('plezar_token'); } catch (e) { /* ignore */ }
  showLogin('You have signed out.');
});

// ---------- Navigation ----------

function showView(view) {
  if (!isOwner() && (view === 'team' || view === 'verification')) view = 'overview';
  document.querySelectorAll('[data-view-pane]').forEach(p => { p.hidden = p.id !== `view-${view}`; });
  document.querySelectorAll('.side-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'events') loadEvents();
  if (view === 'registrations') loadRegistrationsView();
  if (view === 'announcements') loadAnnouncements();
  if (view === 'ads') loadAds();
  if (view === 'messages') loadConversations();
  if (view === 'guides') loadGuides();
  if (view === 'notifications') loadNotificationsView();
  if (view === 'wall') loadWall();
  if (view === 'team') loadTeam();
  if (view === 'verification') loadVerification();
  try { history.replaceState(null, '', `#${view}`); } catch (e) { /* ignore */ }
  window.scrollTo(0, 0);
}

document.querySelectorAll('.side-nav button').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

document.addEventListener('click', e => {
  const action = e.target.closest('[data-action]');
  if (!action) return;
  const { action: name, id } = action.dataset;
  if (name === 'new-event') openEventEditor(null);
  if (name === 'edit-event') openEventEditor(state.events.find(p => p._id === id));
  if (name === 'delete-event') deleteEvent(id);
  if (name === 'cancel-event') openCancelDialog(id);
  if (name === 'registrations') showRegistrationsFor(id);
  if (name === 'notify-event') notifyEvent(id);
  if (name === 'close-drawer') closeDrawers();
  if (name === 'add-place') openPlaceDialog({ kind: 'event' }, $('evPlace').value ? '' : $('evPlaceSearch').value.trim());
  if (name === 'close-place') closePlaceDialog();
  if (name === 'new-announcement') openAnnouncementEditor(null);
  if (name === 'new-ad') openAdEditor(null);
  if (name === 'edit-ad') openAdEditor(state.ads.find(a => a._id === id));
  if (name === 'remove-ad') removeAd(id);
  if (name === 'new-guide') openGuideEditor(null);
  if (name === 'edit-guide') openGuideEditor(state.guides.find(g => g._id === id));
  if (name === 'delete-guide') deleteGuide(id);
  if (name === 'open-conversation') openConversation(id);
  if (name === 'toggle-conversation') toggleConversation(id);
  if (name === 'edit-announcement') openAnnouncementEditor(state.announcements.find(a => a._id === id));
  if (name === 'delete-announcement') deleteAnnouncement(id);
  if (name === 'toggle-pin') togglePin(id);
  if (name === 'set-registration') setRegistration(id, action.dataset.status);
  if (name === 'go') showView(action.dataset.view);
  if (name === 'resend') resendInvite(id);
  if (name === 'remove-member') removeMember(id);
  if (name === 'copy') copyField(action.dataset.target);
  if (name.startsWith('wall-')) wallAction(name, action);
});

// ---------- Boot ----------

async function boot() {
  try {
    const { data } = await api('/api/v1/agency/me');
    state.me = data.me;
    state.agency = data.agency;
    state.stats = data.stats;
  } catch (err) {
    if (err.status === 401) return showLogin();
    if (err.status === 403) {
      await api('/api/v1/users/logout').catch(() => {});
      return showLogin(err.message);
    }
    return showLogin('Could not load your agency. Reload the page to try again.');
  }

  if (state.me.mustChangePassword) return showPasswordStep();

  $('loginView').hidden = true;
  $('passwordView').hidden = true;
  $('panelView').hidden = false;
  document.querySelectorAll('[data-owner-only]').forEach(el => { el.hidden = !isOwner(); });
  renderSide();
  renderOverview();
  renderProfileForm();

  const start = (window.location.hash || '#overview').slice(1);
  const views = ['overview', 'events', 'registrations', 'messages', 'guides', 'announcements', 'ads', 'notifications', 'wall', 'profile', 'team', 'verification'];
  refreshMessagesBadge();
  setInterval(refreshMessagesBadge, 60000);
  connectChatSocket();
  showView(views.includes(start) ? start : (start === 'packages' ? 'events' : 'overview'));
}

function logoHTML(agency, cls = '') {
  return agency.logo
    ? `<img class="${cls}" src="${escapeHTML(agency.logo)}" alt="">`
    : `<span class="avatar ${cls}">${escapeHTML(initials(agency.name))}</span>`;
}

function renderSide() {
  const a = state.agency;
  $('sideAgency').innerHTML = `
    ${logoHTML(a)}
    <div><strong>${escapeHTML(a.name)}</strong><small>${a.verified ? 'Verified vendor' : 'Not verified yet'}</small></div>
  `;
  $('sideUserName').textContent = state.me.name;
  $('sideUserRole').textContent = isOwner() ? 'Owner' : 'Team member';
}

// ---------- Overview ----------

function renderOverview() {
  const a = state.agency;
  const s = state.stats;
  $('overviewTitle').textContent = `Welcome, ${state.me.name.split(' ')[0]}`;
  $('statUpcoming').textContent = s.upcomingEvents;
  $('statRegistrations').textContent = s.openRegistrations;
  $('statAnnouncements').textContent = s.announcements;
  $('statTeam').textContent = s.teamSize;
  renderNextEvents();

  const v = a.verification || { status: 'none' };
  let callout = '';
  if (a.verified) {
    callout = '<div class="callout callout-ok"><div><strong>Your agency is verified</strong>Travelers see the verified mark on your profile and tour events.</div></div>';
  } else if (v.status === 'pending') {
    callout = '<div class="callout callout-warn"><div><strong>Verification in review</strong>Plejar is checking your documents. This usually takes 1 to 2 working days.</div></div>';
  } else if (v.status === 'rejected') {
    callout = `<div class="callout callout-error"><div><strong>Verification needs changes</strong>${escapeHTML(v.note || 'Check your documents and submit again.')}</div>${isOwner() ? '<button class="btn btn-quiet btn-sm" data-action="go" data-view="verification">Update documents</button>' : ''}</div>`;
  } else if (isOwner()) {
    callout = '<div class="callout callout-warn"><div><strong>Get the verified mark</strong>Upload your trade license and NID so travelers know your agency is real.</div><button class="btn btn-quiet btn-sm" data-action="go" data-view="verification">Start verification</button></div>';
  }
  $('overviewCallout').innerHTML = callout;

  const checks = [
    { done: Boolean(a.logo), label: 'Add a logo', view: 'profile' },
    { done: Boolean(a.cover), label: 'Add a cover photo', view: 'profile' },
    { done: Boolean(a.description && a.description.length >= 40), label: 'Describe your agency', view: 'profile' },
    { done: a.regions && a.regions.length > 0, label: 'List the places you run tours', view: 'profile' },
    { done: Boolean(a.phone), label: 'Add a phone number', view: 'profile' },
    { done: s.packages.published > 0, label: 'Publish your first tour event', view: 'events' }
  ];
  $('profileChecklist').innerHTML = checks.map(c => `
    <li>
      <span>${c.done ? '✓' : '○'} ${escapeHTML(c.label)}</span>
      ${c.done ? '<span class="badge badge-published">Done</span>' : `<button class="btn btn-quiet btn-sm" data-action="go" data-view="${c.view}">Do this</button>`}
    </li>`).join('');
}

// ---------- Profile ----------

function renderProfileForm() {
  const a = state.agency;
  const form = $('profileForm');
  form.name.value = a.name || '';
  form.tagline.value = a.tagline || '';
  form.address.value = a.address || '';
  form.description.value = a.description || '';
  form.querySelectorAll('[data-social]').forEach(el => { el.value = (a.socialLinks && a.socialLinks[el.dataset.social]) || ''; });
  state.removeCover = false;
  renderCoverPreview(a.cover);
  form.regions.value = (a.regions || []).join(', ');
  form.phone.value = a.phone || '';
  form.email.value = a.email || '';
  form.website.value = a.website || '';
  form.tradeLicenseNumber.value = a.tradeLicenseNumber || '';
  $('logoPreview').innerHTML = a.logo ? `<img src="${escapeHTML(a.logo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px">` : escapeHTML(initials(a.name));

  const readOnly = !isOwner();
  $('profileStaffNote').hidden = !readOnly;
  form.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = readOnly; });
}

function renderCoverPreview(url) {
  $('coverPreview').innerHTML = url ? `<img src="${escapeHTML(url)}" alt="">` : 'No cover photo yet';
  $('coverRemove').hidden = !url;
}

$('coverInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  state.removeCover = false;
  renderCoverPreview(URL.createObjectURL(file));
});

$('coverRemove').addEventListener('click', () => {
  $('coverInput').value = '';
  state.removeCover = true;
  renderCoverPreview('');
});

$('logoInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  $('logoPreview').innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:16px">`;
});

$('profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  showAlert('profileError', '');
  if (!form.name.value.trim()) return showAlert('profileError', 'Enter your agency name.');

  const fd = new FormData(form);
  if (!form.logo.files.length) fd.delete('logo');
  if (!form.cover.files.length) fd.delete('cover');
  if (state.removeCover) fd.set('removeCover', 'true');
  const links = {};
  form.querySelectorAll('[data-social]').forEach(el => { links[el.dataset.social] = el.value.trim(); });
  fd.set('socialLinks', JSON.stringify(links));

  const btn = $('profileSave');
  setBusy(btn, true);
  try {
    const { data } = await api('/api/v1/agency/me', { method: 'PATCH', form: fd });
    state.agency = data.agency;
    form.logo.value = '';
    form.cover.value = '';
    renderSide();
    renderOverview();
    renderProfileForm();
    toast('Profile saved.');
  } catch (err) {
    showAlert('profileError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------- Tour events ----------

async function refreshStats() {
  try {
    const { data } = await api('/api/v1/agency/me');
    state.stats = data.stats;
    renderOverview();
  } catch (e) { /* stats refresh is best effort */ }
}

async function fetchEvents() {
  const { data } = await api('/api/v1/agency/me/packages');
  state.events = data.packages;
  return state.events;
}

const isPast = e => e.startDate && isoDay(e.endDate || e.startDate) < isoDay(new Date());

function eventPhase(e) {
  if (e.status === 'cancelled') return 'cancelled';
  if (isPast(e)) return 'past';
  if (e.status !== 'published') return 'drafts';
  return 'upcoming';
}

const STATUS_TEXT = { published: 'Published', draft: 'Draft', hidden: 'Hidden', cancelled: 'Cancelled' };

async function renderNextEvents() {
  const box = $('nextEvents');
  if (!box) return;
  try {
    const events = state.events.length ? state.events : await fetchEvents();
    const next = events.filter(e => eventPhase(e) === 'upcoming').slice(0, 4);
    box.innerHTML = next.length ? next.map(e => `
      <li>
        <span><strong>${escapeHTML(e.title)}</strong><span class="cell-sub">${escapeHTML(dateRange(e.startDate, e.endDate))}, ${escapeHTML(plural(e.stats.seatsTaken, 'seat'))} of ${e.seats || '—'} taken</span></span>
        <button class="btn btn-quiet btn-sm" data-action="registrations" data-id="${escapeHTML(e._id)}">Registrations</button>
      </li>`).join('')
      : '<li><span>No upcoming published events.</span><button class="btn btn-quiet btn-sm" data-action="new-event">Create one</button></li>';
  } catch (e) {
    box.innerHTML = '';
  }
}

async function loadEvents() {
  $('eventList').innerHTML = '<p class="muted">Loading tour events...</p>';
  try {
    await fetchEvents();
    renderEvents();
  } catch (err) {
    $('eventList').innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

document.querySelectorAll('[data-event-filter]').forEach(btn => btn.addEventListener('click', () => {
  state.eventFilter = btn.dataset.eventFilter;
  document.querySelectorAll('[data-event-filter]').forEach(b => b.classList.toggle('active', b === btn));
  renderEvents();
}));

function seatBar(e) {
  if (!e.seats) return '';
  const pct = Math.min(100, Math.round((e.stats.seatsTaken / e.seats) * 100));
  return `<div class="seats"><div class="seats-bar"><span style="width:${pct}%"></span></div>
    <span>${e.stats.seatsTaken} of ${e.seats} seats taken${e.seatsLeft === 0 ? ', full' : ''}</span></div>`;
}

function renderEvents() {
  const list = state.eventFilter === 'all' ? state.events : state.events.filter(e => eventPhase(e) === state.eventFilter);
  if (!state.events.length) {
    $('eventList').innerHTML = `
      <div class="empty">
        <strong>No tour events yet</strong>
        Create your first event with dates, seats and price. Once published, travelers can register in the Plejar app.
        <div style="margin-top: 14px;"><button class="btn btn-primary" data-action="new-event">Create a tour event</button></div>
      </div>`;
    return;
  }
  if (!list.length) {
    $('eventList').innerHTML = '<div class="empty"><strong>Nothing here</strong>No events match this filter.</div>';
    return;
  }

  $('eventList').innerHTML = `<div class="pkg-grid">${list.map(e => {
    const id = escapeHTML(e._id);
    const regs = e.stats.registrations;
    const canCancel = e.status !== 'cancelled' && !isPast(e) && regs > 0;
    const closes = e.registrationDeadline && !isPast(e) && e.status !== 'cancelled' ? `<div class="pkg-meta">Registration closes ${escapeHTML(fmtDate(e.registrationDeadline))}</div>` : '';
    return `
    <article class="pkg ${e.status === 'cancelled' ? 'is-cancelled' : ''}">
      ${e.photos[0] ? `<img class="pkg-photo" src="${escapeHTML(e.photos[0])}" alt="" loading="lazy">` : '<div class="pkg-photo pkg-photo-empty">No photo yet</div>'}
      <div class="pkg-body">
        <div class="pkg-top"><h3>${escapeHTML(e.title)}</h3><span class="badge badge-${escapeHTML(e.status)}">${escapeHTML(isPast(e) && e.status !== 'cancelled' ? 'Finished' : STATUS_TEXT[e.status])}</span></div>
        <div class="pkg-date">${escapeHTML(dateRange(e.startDate, e.endDate))}</div>
        <div class="pkg-meta">${e.destinationRef ? `📍 ${escapeHTML(e.destinationRef.name)}` : escapeHTML(e.destination)}, ${plural(e.durationDays, 'day')}${e.durationNights ? ` ${plural(e.durationNights, 'night')}` : ''}</div>
        <div class="pkg-price">${taka(e.priceFrom)} <span class="muted">per person</span></div>
        ${seatBar(e)}
        ${closes}
        ${e.status === 'cancelled' ? `<div class="pkg-note">Cancelled: ${escapeHTML(e.cancelReason)}</div>` : ''}
        ${e.hiddenByAdmin ? '<div class="pkg-note">Hidden by Plejar</div>' : ''}
        ${e.status !== 'cancelled' && !e.planComplete ? `<div class="pkg-plan-missing">Tour plan missing ${plural(e.planMissing.length, 'thing')}. Edit to finish it before publishing.</div>` : ''}
        <div class="pkg-actions">
          <button class="btn btn-quiet btn-sm" data-action="registrations" data-id="${id}">Registrations${regs ? ` (${regs})` : ''}</button>
          ${e.status !== 'cancelled' ? `<button class="btn btn-quiet btn-sm" data-action="edit-event" data-id="${id}">Edit</button>` : ''}
          ${canCancel ? `<button class="btn btn-danger btn-sm" data-action="cancel-event" data-id="${id}">Cancel event</button>` : ''}
          ${regs === 0 && e.stats.cancelled === 0 ? `<button class="btn btn-danger btn-sm" data-action="delete-event" data-id="${id}">Delete</button>` : ''}
        </div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderEditorPhotos() {
  const ev = state.editing;
  const photos = ev ? ev.photos : [];
  $('evPhotos').innerHTML = photos.map(url => `
    <div class="photo-thumb ${state.removedPhotos.has(url) ? 'is-removed' : ''}">
      <img src="${escapeHTML(url)}" alt="">
      <button type="button" data-photo="${escapeHTML(url)}" aria-label="${state.removedPhotos.has(url) ? 'Keep photo' : 'Remove photo'}">${state.removedPhotos.has(url) ? '↺' : '×'}</button>
    </div>`).join('');
}

$('evPhotos').addEventListener('click', e => {
  const btn = e.target.closest('[data-photo]');
  if (!btn) return;
  const url = btn.dataset.photo;
  if (state.removedPhotos.has(url)) state.removedPhotos.delete(url);
  else state.removedPhotos.add(url);
  renderEditorPhotos();
});

// ---------- Tour plan editor ----------

const STOP_KINDS = { departure: 'Departure', stop: 'Stop', activity: 'Activity', meal: 'Meal', stay: 'Check in', return: 'Return' };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const linesOf = value => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);

// Days and nights from the date fields (null until a valid range is chosen)
function tripLength() {
  const form = $('eventForm');
  const start = form.startDate.value;
  const end = form.endDate.value || start;
  if (!start || end < start) return null;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  return { days, nights: days - 1, start };
}

function updateDurationHint() {
  const len = tripLength();
  $('evDuration').textContent = len ? `${plural(len.days, 'day')}, ${plural(len.nights, 'night')}.` : '';
  $('evStayRequired').hidden = !(len && len.nights > 0);
}

const blankDay = n => ({ day: n, title: '', description: '', stops: [], stay: '', meals: { breakfast: false, lunch: false, dinner: false } });
const blankStop = kind => ({ time: '', place: '', kind: kind || 'stop', note: '', destinationRef: '' });

// Keep one card per day of the tour; days beyond the new length are set aside, not lost
function syncItineraryDays() {
  const len = tripLength();
  if (!len) return renderItinerary();
  const all = state.plan.itinerary.concat(state.plan.spareDays || []);
  state.plan.itinerary = Array.from({ length: Math.min(len.days, 60) }, (_, i) => ({ ...(all[i] || blankDay(i + 1)), day: i + 1 }));
  state.plan.spareDays = all.slice(len.days);
  if (len.days >= 1 && !state.plan.itinerary[0].stops.length) {
    state.plan.itinerary[0].stops.push({ ...blankStop('departure'), time: $('evDeparture').value, place: $('evMeeting').value.trim() });
  }
  renderItinerary();
}

function dayDate(i) {
  const len = tripLength();
  if (!len) return '';
  const d = new Date(Date.parse(len.start) + i * 86400000);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function renderItinerary() {
  const box = $('evItinerary');
  const len = tripLength();
  const days = state.plan.itinerary;
  $('evItineraryHint').textContent = len
    ? 'Add every stop in order: where you leave from, where you stop to eat or visit, where you sleep and when you head back. Times help travelers plan.'
    : 'Choose the dates first. One card appears for each day of the tour.';
  if (!len) { box.innerHTML = ''; return; }
  box.innerHTML = days.map((d, i) => `
    <article class="day-card" data-day="${i}">
      <header class="day-head">
        <span class="day-no">Day ${i + 1}</span><span class="day-date">${escapeHTML(dayDate(i))}</span>
        <input class="day-title" data-field="title" maxlength="120" placeholder="Short title, e.g. Dhaka to Sajek" value="${escapeHTML(d.title)}" aria-label="Day ${i + 1} title">
      </header>
      <textarea class="day-description" data-field="description" rows="2" maxlength="1000" placeholder="What the day is like (travelers see this when they open the day in the app)" aria-label="Day ${i + 1} description">${escapeHTML(d.description || '')}</textarea>
      <ol class="stop-list">
        ${d.stops.map((st, j) => `
          <li class="stop-row" data-stop="${j}">
            <input type="time" data-field="time" value="${escapeHTML(st.time)}" aria-label="Time">
            <select data-field="kind" aria-label="Kind of stop">${Object.entries(STOP_KINDS).map(([k, t]) => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <input data-field="place" list="placeOptions" maxlength="120" placeholder="Place *" value="${escapeHTML(st.place)}" aria-label="Place" class="${st.destinationRef ? 'is-linked' : ''}">
            <input data-field="note" maxlength="300" placeholder="What happens here" value="${escapeHTML(st.note)}" aria-label="Note">
            <div class="stop-actions">
              <button type="button" class="icon-btn add" data-stop-addplace title="Add this place to Plejar's destinations" aria-label="Add this place to Plejar" ${st.place.trim() && !st.destinationRef ? '' : 'hidden'}>+</button>
              <button type="button" class="icon-btn" data-stop-move="-1" ${j === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
              <button type="button" class="icon-btn" data-stop-move="1" ${j === d.stops.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
              <button type="button" class="icon-btn danger" data-stop-remove aria-label="Remove stop">×</button>
            </div>
          </li>`).join('')}
      </ol>
      <button type="button" class="btn btn-quiet btn-sm" data-stop-add>+ Add stop</button>
      <div class="day-foot">
        <span class="label">Meals included</span>
        ${['breakfast', 'lunch', 'dinner'].map(m => `<label class="meal"><input type="checkbox" data-meal="${m}" ${d.meals[m] ? 'checked' : ''}> ${m[0].toUpperCase() + m.slice(1)}</label>`).join('')}
        ${i < len.nights ? `<input class="day-stay" data-field="stay" maxlength="120" placeholder="Where travelers sleep tonight *" value="${escapeHTML(d.stay)}" aria-label="Night ${i + 1} stay">` : ''}
      </div>
    </article>`).join('');
  updatePlanCheck();
}

// One listener handles every input in the day cards
$('evItinerary').addEventListener('input', e => {
  const card = e.target.closest('[data-day]');
  if (!card) return;
  const day = state.plan.itinerary[Number(card.dataset.day)];
  const row = e.target.closest('[data-stop]');
  const field = e.target.dataset.field;
  if (e.target.dataset.meal) day.meals[e.target.dataset.meal] = e.target.checked;
  else if (row) {
    const stop = day.stops[Number(row.dataset.stop)];
    stop[field] = e.target.value;
    if (field === 'place') {
      // Typing a Plejar destination's name links the stop to it
      const match = (state.places || []).find(p => p.name.toLowerCase() === e.target.value.trim().toLowerCase());
      stop.destinationRef = match ? match._id : '';
      e.target.classList.toggle('is-linked', Boolean(match));
      row.querySelector('[data-stop-addplace]').hidden = Boolean(match) || !e.target.value.trim();
    }
  } else if (field) day[field] = e.target.value;
  updatePlanCheck();
});

$('evItinerary').addEventListener('click', e => {
  const card = e.target.closest('[data-day]');
  if (!card) return;
  const day = state.plan.itinerary[Number(card.dataset.day)];
  const row = e.target.closest('[data-stop]');
  if (e.target.closest('[data-stop-add]')) {
    const last = day.stops[day.stops.length - 1];
    day.stops.push(blankStop(last && last.kind === 'departure' ? 'stop' : 'stop'));
    renderItinerary();
    const rows = $('evItinerary').querySelectorAll(`[data-day="${card.dataset.day}"] [data-field="place"]`);
    if (rows.length) rows[rows.length - 1].focus();
  } else if (row && e.target.closest('[data-stop-addplace]')) {
    openPlaceDialog({ kind: 'stop', day: Number(card.dataset.day), stop: Number(row.dataset.stop) }, day.stops[Number(row.dataset.stop)].place.trim());
  } else if (row && e.target.closest('[data-stop-remove]')) {
    day.stops.splice(Number(row.dataset.stop), 1);
    renderItinerary();
  } else if (row && e.target.closest('[data-stop-move]')) {
    const j = Number(row.dataset.stop);
    const k = j + Number(e.target.closest('[data-stop-move]').dataset.stopMove);
    [day.stops[j], day.stops[k]] = [day.stops[k], day.stops[j]];
    renderItinerary();
  }
});

// The same checks the server makes before publishing, so vendors see what's left as they go
function planMissing() {
  const form = $('eventForm');
  const len = tripLength();
  const missing = [];
  const val = id => $(id).value.trim();
  if (!val('evPlace')) missing.push('the destination');
  if (!len) missing.push('the dates');
  if (!form.seats.value) missing.push('the number of seats');
  if (form.priceFrom.value === '') missing.push('the price per person');
  if (val('evAdvance') === '') missing.push('the booking advance (0 if none)');
  else if (form.priceFrom.value !== '' && Number(val('evAdvance')) > Number(form.priceFrom.value)) missing.push('a booking advance no higher than the price');
  if (val('evRegularPrice') !== '' && form.priceFrom.value !== '' && Number(val('evRegularPrice')) < Number(form.priceFrom.value)) missing.push('a regular price no lower than the price (or leave it empty when there is no sale)');
  if (!val('evMeeting')) missing.push('the meeting point');
  if (!val('evDeparture')) missing.push('the departure time');
  if (!val('evReturn')) missing.push('when and where the tour ends');
  if (!val('evTransport')) missing.push('the transport');
  if (len && len.nights > 0 && (!val('evStay') || val('evStay') === 'none')) missing.push('where travelers stay');
  if (len) {
    state.plan.itinerary.forEach((d, i) => {
      const named = d.stops.filter(s => s.place.trim());
      if (!named.length) missing.push(`stops for day ${i + 1}`);
      if (d.stops.some(s => !s.place.trim() && (s.note.trim() || s.time))) missing.push(`a place for every stop on day ${i + 1}`);
      if (i < len.nights && !d.stay.trim()) missing.push(`where travelers sleep on night ${i + 1}`);
    });
    const total = state.plan.itinerary.reduce((n, d) => n + d.stops.filter(s => s.place.trim()).length, 0);
    if (total === 1) missing.push('at least 2 stops in the plan');
  }
  if (!linesOf($('evIncluded').value).length) missing.push("what's included");
  if (!linesOf($('evExcluded').value).length) missing.push("what's not included");
  if (!val('evDifficulty')) missing.push('the difficulty');
  if (val('evPolicy').length < 20) missing.push('the cancellation and refund policy');
  return missing;
}

function updatePlanCheck() {
  const missing = planMissing();
  const box = $('evPlanCheck');
  box.className = `plan-check ${missing.length ? '' : 'is-complete'}`;
  box.innerHTML = missing.length
    ? `<strong>Before you can publish, add ${plural(missing.length, 'thing')}:</strong><ul>${missing.map(m => `<li>${escapeHTML(m)}</li>`).join('')}</ul>`
    : '<strong>The plan is complete.</strong> You can publish this event.';
}

$('eventForm').addEventListener('input', e => { if (!e.target.closest('#evItinerary')) updatePlanCheck(); });
$('eventForm').addEventListener('change', e => { if (!e.target.closest('#evItinerary')) updatePlanCheck(); });

['startDate', 'endDate'].forEach(name => $('eventForm')[name].addEventListener('change', () => {
  const form = $('eventForm');
  if (name === 'startDate' && (!form.endDate.value || form.endDate.value < form.startDate.value)) form.endDate.value = form.startDate.value;
  form.endDate.min = form.startDate.value;
  form.registrationDeadline.max = form.startDate.value;
  updateDurationHint();
  syncItineraryDays();
}));

// ---------- Shared destinations: pick one, or add a missing place ----------

// "Sajek Valley (Rangamati, Chattogram)"
const placeLabel = p => `${p.name}${p.path && p.path.length > 1 ? ` (${p.path.slice(1).reverse().join(', ')})` : ''}`;

async function loadPlaces(force) {
  if (state.places && !force) return state.places;
  try {
    const { data } = await api('/api/v1/agency/me/destinations');
    state.places = data.destinations.filter(d => d.type !== 'country');
  } catch (err) {
    // Don't remember a failed load: the next editor opening tries again
    return state.places || [];
  }
  return state.places;
}

async function fillPlaceSelect(selected) {
  const places = await loadPlaces();
  $('destinationOptions').innerHTML = places.map(p => `<option value="${escapeHTML(placeLabel(p))}">`).join('');
  $('placeOptions').innerHTML = places.map(p => `<option value="${escapeHTML(p.name)}">`).join('');
  if (selected !== undefined) setEventPlace(selected);
}

// Link the event to a destination by ID ('' to clear) and show it in the search box
function setEventPlace(id) {
  const place = id ? (state.places || []).find(p => p._id === String(id)) : null;
  $('evPlace').value = place ? place._id : '';
  $('evPlaceSearch').value = place ? placeLabel(place) : '';
  updatePlaceHint();
}

function updatePlaceHint() {
  const place = state.places && state.places.find(p => p._id === $('evPlace').value);
  const typed = $('evPlaceSearch').value.trim();
  const hint = $('evPlaceHint');
  hint.classList.remove('hint-warn', 'hint-ok');
  if (place) {
    hint.textContent = place.status === 'draft'
      ? `Linked to ${place.name}. It's waiting for Plejar's review; travelers see the destination once it's approved.`
      : `Linked to ${place.name} on Plejar.`;
    hint.classList.add('hint-ok');
  } else if (typed) {
    hint.textContent = 'Not in the list yet. Choose one of the suggestions, or add it as a new destination.';
    hint.classList.add('hint-warn');
  } else {
    hint.textContent = "Pick from the list. Can't find it? Add it, and it's saved to Plejar's destinations for everyone.";
  }
}

$('evPlaceSearch').addEventListener('input', () => {
  const typed = $('evPlaceSearch').value.trim().toLowerCase();
  const list = state.places || [];
  // An exact label, or a name only one destination has
  const byLabel = list.find(p => placeLabel(p).toLowerCase() === typed);
  const byName = list.filter(p => p.name.toLowerCase() === typed);
  const match = byLabel || (byName.length === 1 ? byName[0] : null);
  $('evPlace').value = match ? match._id : '';
  updatePlaceHint();
  updatePlanCheck();
});

// The add-destination dialog, for the event itself or for one stop in the plan
async function openPlaceDialog(target, name) {
  state.placeTarget = target;
  const form = $('placeForm');
  form.reset();
  showAlert('placeError', '');
  $('plName').value = name || '';
  if (!state.geo) {
    try {
      const { data } = await api('/api/v1/agency/me/destination-geography');
      state.geo = data.divisions;
    } catch (err) {
      state.geo = [];
    }
  }
  $('plDivision').innerHTML = '<option value="">Choose a division</option>' + state.geo.map(d => `<option value="${escapeHTML(d.code)}">${escapeHTML(d.name)} (${escapeHTML(d.nameBn)})</option>`).join('');
  fillPlDistricts();
  $('placeDialog').hidden = false;
  $('plDivision').focus();
}

function plType() { return (document.querySelector('input[name="plType"]:checked') || {}).value || 'attraction'; }

function fillPlDistricts() {
  const division = state.geo.find(d => d.code === $('plDivision').value);
  const select = $('plDistrict');
  const town = plType() === 'city';
  $('plDistrictLabel').textContent = town ? 'District' : 'District *';
  if (!division) {
    select.innerHTML = '<option value="">Choose the division first</option>';
    select.disabled = true;
    return;
  }
  const keep = select.value;
  select.disabled = false;
  select.innerHTML = `<option value="">${town ? 'A town that is not a district' : 'Choose a district'}</option>` + division.districts.map(d => `<option value="${escapeHTML(d.code)}">${escapeHTML(d.name)} (${escapeHTML(d.nameBn)})</option>`).join('');
  select.value = keep;
}

$('plDivision').addEventListener('change', fillPlDistricts);
document.querySelectorAll('input[name="plType"]').forEach(r => r.addEventListener('change', fillPlDistricts));
// Choosing a district as the "town" fills in its name
$('plDistrict').addEventListener('change', () => {
  if (plType() !== 'city') return;
  const division = state.geo.find(d => d.code === $('plDivision').value);
  const district = division && division.districts.find(d => d.code === $('plDistrict').value);
  if (district) { $('plName').value = district.name; $('plNameBn').value = district.nameBn; }
});

function closePlaceDialog() {
  $('placeDialog').hidden = true;
  state.placeTarget = null;
}

$('placeDialog').addEventListener('click', e => { if (e.target === $('placeDialog')) closePlaceDialog(); });

$('placeForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('placeError', '');
  const type = plType();
  const name = $('plName').value.trim();
  const lat = $('plLat').value.trim();
  const lng = $('plLng').value.trim();
  if (!$('plDivision').value) return showAlert('placeError', 'Choose the division.');
  if (type === 'attraction' && !$('plDistrict').value) return showAlert('placeError', 'Choose the district the place is in.');
  if (!name && !(type === 'city' && $('plDistrict').value)) return showAlert('placeError', 'Enter the name of the place.');
  if ((lat === '') !== (lng === '')) return showAlert('placeError', 'Enter both latitude and longitude, or leave both empty.');
  const photo = $('plPhoto').files[0];
  if (photo && (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 5 * 1024 * 1024)) return showAlert('placeError', 'Use a JPG, PNG or WebP photo under 5 MB.');

  const fd = new FormData();
  Object.entries({ type, name, nameBn: $('plNameBn').value.trim(), division: $('plDivision').value, district: $('plDistrict').value, lat, lng, summary: $('plSummary').value.trim() })
    .forEach(([k, v]) => fd.append(k, v));
  if (photo) fd.append('photo', photo);

  const btn = $('placeSubmit');
  setBusy(btn, true);
  try {
    const { data, message } = await api('/api/v1/agency/me/destinations', { method: 'POST', form: fd });
    await loadPlaces(true);
    await fillPlaceSelect();
    const target = state.placeTarget;
    if (target && target.kind === 'stop') {
      const stop = state.plan.itinerary[target.day] && state.plan.itinerary[target.day].stops[target.stop];
      if (stop) { stop.place = data.destination.name; stop.destinationRef = data.destination._id; }
      renderItinerary();
    } else {
      setEventPlace(data.destination._id);
      updatePlanCheck();
    }
    closePlaceDialog();
    toast(message);
  } catch (err) {
    showAlert('placeError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

function openEventEditor(ev) {
  state.editing = ev || null;
  state.removedPhotos = new Set();
  const form = $('eventForm');
  form.reset();
  showAlert('eventError', '');
  $('eventFormTitle').textContent = ev ? 'Edit tour event' : 'New tour event';
  $('eventHiddenNote').hidden = !(ev && ev.hiddenByAdmin);
  const regs = ev ? ev.stats.registrations : 0;
  $('eventRegisteredNote').hidden = !(ev && ev.stats.seatsTaken);
  $('eventRegisteredNote').textContent = ev ? `${plural(regs, 'person has', 'people have')} registered. If you change the start date, their registration moves to the new date and they get a notification.` : '';
  const today = isoDay(new Date());
  form.startDate.min = today;
  const set = (id, value) => { $(id).value = value == null ? '' : value; };
  if (ev) {
    form.title.value = ev.title;
    form.startDate.value = isoDay(ev.startDate);
    form.endDate.value = isoDay(ev.endDate || ev.startDate);
    form.registrationDeadline.value = isoDay(ev.registrationDeadline);
    form.seats.value = ev.seats || '';
    form.seats.min = Math.max(1, ev.stats.seatsTaken);
    form.priceFrom.value = ev.priceFrom;
    form.meetingPoint.value = ev.meetingPoint || '';
    form.description.value = ev.description || '';
    form.included.value = (ev.included || []).join('\n');
    form.status.value = ev.status;
    if (ev.startDate && isoDay(ev.startDate) < today) form.startDate.min = '';
  } else {
    form.status.value = 'draft';
    form.seats.min = 1;
  }
  set('evChildPrice', ev && ev.childPrice);
  set('evAdvance', ev && ev.advanceAmount);
  set('evExcluded', ev ? (ev.excluded || []).join('\n') : '');
  set('evDeparture', ev && ev.departureTime);
  set('evTransport', ev && ev.transport && ev.transport.mode);
  set('evTransportDetails', ev && ev.transport && ev.transport.details);
  set('evStay', ev && ev.accommodation && ev.accommodation.type);
  set('evStayDetails', ev && ev.accommodation && ev.accommodation.details);
  set('evReturn', ev && ev.returnInfo);
  set('evDifficulty', ev && ev.difficulty);
  set('evBring', ev ? (ev.whatToBring || []).join('\n') : '');
  set('evPolicy', ev && ev.cancellationPolicy);
  set('evTourType', (ev && ev.tourType) || 'group');
  set('evRegularPrice', ev && ev.regularPrice);
  set('evGroupMin', ev && ev.groupSize && ev.groupSize.min);
  set('evGroupMax', ev && ev.groupSize && ev.groupSize.max);
  set('evHighlights', ev ? (ev.highlights || []).join('\n') : '');
  $('evFlexible').checked = Boolean(ev && ev.flexibleDates);
  const tags = new Set((ev && ev.tags) || []);
  document.querySelectorAll('#evTags input').forEach(i => { i.checked = tags.has(i.value); });
  fillGuideSelect(ev && ev.guide ? String(ev.guide._id || ev.guide) : '');
  state.plan = {
    itinerary: ev && ev.itinerary ? ev.itinerary.map(d => ({
      day: d.day,
      title: d.title || '',
      description: d.description || '',
      stay: d.stay || '',
      meals: { breakfast: Boolean(d.meals && d.meals.breakfast), lunch: Boolean(d.meals && d.meals.lunch), dinner: Boolean(d.meals && d.meals.dinner) },
      stops: (d.stops || []).map(st => ({ time: st.time || '', place: st.place || '', kind: st.kind || 'stop', note: st.note || '', destinationRef: st.destinationRef ? String(st.destinationRef._id || st.destinationRef) : '' }))
    })) : [],
    spareDays: []
  };
  form.endDate.min = form.startDate.value || today;
  form.registrationDeadline.max = form.startDate.value;
  form.status.querySelector('option[value="published"]').disabled = Boolean(ev && ev.hiddenByAdmin);
  updateDurationHint();
  renderEditorPhotos();
  $('evPlace').value = '';
  $('evPlaceSearch').value = ev && !ev.destinationRef ? ev.destination || '' : '';
  updatePlaceHint();
  fillPlaceSelect(ev && ev.destinationRef ? String(ev.destinationRef._id || ev.destinationRef) : undefined).then(() => { syncItineraryDays(); updatePlaceHint(); });
  syncItineraryDays();
  $('eventDrawer').hidden = false;
  $('eventForm').scrollTop = 0;
  form.title.focus();
}

function closeDrawers() {
  ['eventDrawer', 'announcementDrawer', 'adDrawer', 'guideDrawer', 'wallDrawer', 'cancelDialog'].forEach(id => { $(id).hidden = true; });
  state.wall.editing = null;
  state.editingAd = null;
  state.editingGuide = null;
  state.editing = null;
  state.editingAnnouncement = null;
  state.cancelling = null;
}

['eventDrawer', 'announcementDrawer', 'wallDrawer', 'cancelDialog'].forEach(id => $(id).addEventListener('click', e => {
  if (e.target === $(id)) closeDrawers();
}));

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // Close the add-destination dialog on its own, without losing the tour being edited
  if (!$('placeDialog').hidden) closePlaceDialog();
  else closeDrawers();
});

// The plan as the server expects it
function planPayload() {
  const val = id => $(id).value.trim();
  return {
    departureTime: val('evDeparture'),
    returnInfo: val('evReturn'),
    childPrice: val('evChildPrice'),
    advanceAmount: val('evAdvance'),
    excluded: linesOf($('evExcluded').value),
    whatToBring: linesOf($('evBring').value),
    difficulty: val('evDifficulty'),
    cancellationPolicy: val('evPolicy'),
    tourType: val('evTourType') || 'group',
    regularPrice: val('evRegularPrice'),
    groupSize: { min: val('evGroupMin'), max: val('evGroupMax') },
    highlights: linesOf($('evHighlights').value).slice(0, 6),
    flexibleDates: $('evFlexible').checked,
    guide: val('evGuide'),
    tags: [...document.querySelectorAll('#evTags input:checked')].map(i => i.value),
    transport: { mode: val('evTransport'), details: val('evTransportDetails') },
    accommodation: { type: val('evStay'), details: val('evStayDetails') },
    itinerary: state.plan.itinerary.map(d => ({
      title: d.title.trim(),
      description: (d.description || '').trim(),
      stay: d.stay.trim(),
      meals: d.meals,
      stops: d.stops.filter(s => s.place.trim() || s.note.trim() || s.time).map(s => ({ time: s.time, place: s.place.trim(), kind: s.kind, note: s.note.trim(), destinationRef: s.destinationRef || undefined }))
    }))
  };
}

$('eventForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  showAlert('eventError', '');
  const v = name => form[name].value.trim();

  if (!v('title')) return showAlert('eventError', 'Enter a title.');
  if ($('evPlaceSearch').value.trim() && !$('evPlace').value) return showAlert('eventError', 'Choose the destination from the suggestions, or add it as a new destination.');
  if (!v('startDate')) return showAlert('eventError', 'Choose the start date.');
  if (!state.editing && v('startDate') <= isoDay(new Date())) return showAlert('eventError', 'Choose a start date after today.');
  if (v('endDate') && v('endDate') < v('startDate')) return showAlert('eventError', 'The tour cannot end before it starts.');
  if (v('registrationDeadline') && v('registrationDeadline') > v('startDate')) return showAlert('eventError', 'Registration must close on or before the start date.');
  const seats = Number(v('seats'));
  if (!Number.isInteger(seats) || seats < 1) return showAlert('eventError', 'Enter how many seats the tour has.');
  if (state.editing && seats < state.editing.stats.seatsTaken) return showAlert('eventError', `${state.editing.stats.seatsTaken} seats are already taken, so you need at least that many.`);
  if (v('priceFrom') === '' || Number(v('priceFrom')) < 0) return showAlert('eventError', 'Enter the price per person in taka.');
  const badTime = state.plan.itinerary.flatMap(d => d.stops).find(s => s.time && !TIME_RE.test(s.time));
  if (badTime) return showAlert('eventError', `Enter times like 06:30 (at ${badTime.place || 'a stop'}).`);
  if (v('status') === 'published') {
    const missing = planMissing();
    if (missing.length) {
      $('evPlanCheck').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return showAlert('eventError', `Finish the tour plan before publishing, or save it as a draft. Still missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.`);
    }
  }

  const newFiles = Array.from($('evPhotoInput').files);
  const kept = state.editing ? state.editing.photos.filter(p => !state.removedPhotos.has(p)).length : 0;
  if (kept + newFiles.length > 6) return showAlert('eventError', `An event can have 6 photos. Remove ${kept + newFiles.length - 6} and try again.`);

  const fd = new FormData();
  ['title', 'startDate', 'endDate', 'registrationDeadline', 'seats', 'priceFrom', 'meetingPoint', 'description', 'status', 'destinationRef'].forEach(f => fd.append(f, v(f)));
  fd.append('included', linesOf(form.included.value).join('\n'));
  fd.append('plan', JSON.stringify(planPayload()));
  newFiles.forEach(f => fd.append('photos', f));
  if (state.editing && state.removedPhotos.size) fd.append('removePhotos', Array.from(state.removedPhotos).join(','));

  const btn = $('eventSave');
  setBusy(btn, true);
  try {
    if (state.editing) {
      const { data } = await api(`/api/v1/agency/me/packages/${state.editing._id}`, { method: 'PATCH', form: fd });
      toast(data.notified ? `Event saved. ${plural(data.notified, 'registered traveler was', 'registered travelers were')} told about the new date.` : 'Event saved.');
    } else {
      const { data } = await api('/api/v1/agency/me/packages', { method: 'POST', form: fd });
      toast(data.package.status === 'published' ? 'Event published. Travelers can register now.' : 'Event saved as a draft.');
    }
    closeDrawers();
    await loadEvents();
    refreshStats();
    if ($('view-events').hidden) showView('events');
  } catch (err) {
    showAlert('eventError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function deleteEvent(id) {
  const ev = state.events.find(p => p._id === id);
  if (!ev || !window.confirm(`Delete "${ev.title}"? Its photos will be deleted too. This can't be undone.`)) return;
  try {
    await api(`/api/v1/agency/me/packages/${id}`, { method: 'DELETE' });
    toast('Event deleted.');
    await loadEvents();
    refreshStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openCancelDialog(id) {
  const ev = state.events.find(p => p._id === id);
  if (!ev) return;
  state.cancelling = ev;
  $('cancelTitle').textContent = `Cancel ${ev.title}?`;
  $('cancelLead').textContent = `${plural(ev.stats.registrations, 'registration')} will be cancelled and those travelers get a notification with your reason. If anyone has paid, arrange their refund with Plejar support. This can't be undone.`;
  $('cancelReason').value = '';
  showAlert('cancelError', '');
  $('cancelDialog').hidden = false;
  $('cancelReason').focus();
}

$('cancelForm').addEventListener('submit', async e => {
  e.preventDefault();
  const reason = $('cancelReason').value.trim();
  if (reason.length < 3) return showAlert('cancelError', 'Tell travelers why the event is cancelled.');
  const btn = $('cancelSubmit');
  setBusy(btn, true, 'Cancelling...');
  try {
    const { message } = await api(`/api/v1/agency/me/packages/${state.cancelling._id}/cancel`, { method: 'POST', body: { reason } });
    closeDrawers();
    toast(message);
    await loadEvents();
    refreshStats();
  } catch (err) {
    showAlert('cancelError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------- Registrations ----------

const REG_TEXT = { pending: 'Waiting for you', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
const PAY_TEXT = { unpaid: 'Not paid', paid: 'Paid', partially_refunded: 'Part refunded', refunded: 'Refunded' };

function showRegistrationsFor(id) {
  state.regEvent = id;
  showView('registrations');
}

async function loadRegistrationsView() {
  const select = $('regEvent');
  try {
    const events = (await fetchEvents()).filter(e => e.startDate);
    if (!events.length) {
      select.innerHTML = '<option value="">No tour events yet</option>';
      $('regSummary').innerHTML = '';
      $('regBody').innerHTML = '<tr><td colspan="6">Create a tour event first. Registrations show up here as travelers sign up in the app.</td></tr>';
      $('regCsv').hidden = true;
      return;
    }
    select.innerHTML = events.map(e => `<option value="${escapeHTML(e._id)}">${escapeHTML(e.title)}, ${escapeHTML(dateRange(e.startDate, e.endDate))}${e.stats.registrations ? ` (${e.stats.registrations})` : ''}</option>`).join('');
    if (!state.regEvent || !events.some(e => e._id === state.regEvent)) {
      state.regEvent = (events.find(e => eventPhase(e) === 'upcoming') || events[0])._id;
    }
    select.value = state.regEvent;
    $('regCsv').hidden = false;
    loadRegistrations();
  } catch (err) {
    $('regBody').innerHTML = `<tr><td colspan="6">${escapeHTML(err.message)}</td></tr>`;
  }
}

$('regEvent').addEventListener('change', e => { state.regEvent = e.target.value; loadRegistrations(); });
$('regStatus').addEventListener('change', () => loadRegistrations());

async function loadRegistrations() {
  if (!state.regEvent) return;
  const status = $('regStatus').value;
  $('regCsv').href = `/api/v1/agency/me/packages/${encodeURIComponent(state.regEvent)}/registrations?format=csv`;
  $('regBody').innerHTML = '<tr><td colspan="6">Loading registrations...</td></tr>';
  try {
    const { data } = await api(`/api/v1/agency/me/packages/${state.regEvent}/registrations${status ? `?status=${status}` : ''}`);
    const e = data.event;
    const s = e.stats;
    $('regSummary').innerHTML = `
      <dl class="stats stats-tight">
        <div class="stat"><dt>Seats taken</dt><dd>${s.seatsTaken}${e.seats ? `<small> / ${e.seats}</small>` : ''}</dd></div>
        <div class="stat"><dt>Waiting for you</dt><dd>${s.pending}</dd></div>
        <div class="stat"><dt>Confirmed</dt><dd>${s.confirmed}</dd></div>
        <div class="stat"><dt>Cancelled</dt><dd>${s.cancelled}</dd></div>
      </dl>
      ${e.status === 'cancelled' ? `<div class="callout callout-error"><div><strong>This event was cancelled</strong>${escapeHTML(e.cancelReason)}</div></div>` : ''}
      <div class="reg-meta">
        <span class="muted">${e.meetingPoint ? `Meeting point: ${escapeHTML(e.meetingPoint)}` : ''}</span>
        ${s.registrations && e.status !== 'cancelled' ? `<button class="btn btn-quiet btn-sm" data-action="notify-event" data-id="${escapeHTML(e._id)}">Send these travelers a notification</button>` : ''}
      </div>`;

    const rows = data.registrations;
    $('regBody').innerHTML = rows.length ? rows.map(r => {
      const u = r.user || {};
      const id = escapeHTML(r._id);
      const actions = [];
      if (r.status === 'pending') actions.push(`<button class="btn btn-primary btn-sm" data-action="set-registration" data-status="confirmed" data-id="${id}">Confirm</button>`);
      if (r.status === 'confirmed' && isPast(e)) actions.push(`<button class="btn btn-quiet btn-sm" data-action="set-registration" data-status="completed" data-id="${id}">Mark trip done</button>`);
      if (['pending', 'confirmed'].includes(r.status)) actions.push(`<button class="btn btn-danger btn-sm" data-action="set-registration" data-status="cancelled" data-id="${id}">Cancel</button>`);
      return `
        <tr>
          <td><strong>${escapeHTML(u.name || 'Deleted account')}</strong>
            <span class="cell-sub">${u.phone ? `<a href="tel:${escapeHTML(u.phone)}">${escapeHTML(u.phone)}</a>` : ''}${u.phone && u.email ? ', ' : ''}${u.email ? `<a href="mailto:${escapeHTML(u.email)}">${escapeHTML(u.email)}</a>` : ''}</span>
            ${r.note ? `<span class="cell-sub">Note: ${escapeHTML(r.note)}</span>` : ''}</td>
          <td>${r.travelers}</td>
          <td>${taka(r.amount)}<span class="cell-sub">${escapeHTML(PAY_TEXT[r.paymentStatus] || r.paymentStatus)}</span></td>
          <td>${escapeHTML(fmtDate(r.createdAt))}<span class="cell-sub">${escapeHTML(r.reference)}</span></td>
          <td><span class="badge badge-${escapeHTML(r.status)}">${escapeHTML(REG_TEXT[r.status])}</span>${r.status === 'cancelled' && r.cancelReason ? `<span class="cell-sub">${escapeHTML(r.cancelReason)}</span>` : ''}</td>
          <td class="actions">${actions.join('')}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="6">${status ? 'No registrations with this status.' : 'Nobody has registered yet. Published events show in the Plejar app, where travelers register.'}</td></tr>`;
  } catch (err) {
    $('regBody').innerHTML = `<tr><td colspan="6">${escapeHTML(err.message)}</td></tr>`;
  }
}

async function setRegistration(id, status) {
  let reason = '';
  if (status === 'cancelled') {
    reason = window.prompt('Why are you cancelling this registration? The traveler sees this.');
    if (reason === null) return;
    if (reason.trim().length < 3) return toast('Write a short reason to cancel the registration.', 'error');
  }
  try {
    await api(`/api/v1/agency/me/bookings/${id}`, { method: 'PATCH', body: { status, reason: reason.trim() } });
    toast({ confirmed: 'Registration confirmed.', completed: 'Marked as done.', cancelled: 'Registration cancelled.' }[status]);
    loadRegistrations();
    refreshStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function notifyEvent(id) {
  state.notifyEvent = id;
  showView('notifications');
}

// ---------- Announcements ----------

async function loadAnnouncements() {
  $('announcementList').innerHTML = '<p class="muted">Loading announcements...</p>';
  try {
    const { data } = await api('/api/v1/agency/me/announcements');
    state.announcements = data.announcements;
    renderAnnouncements();
  } catch (err) {
    $('announcementList').innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

function renderAnnouncements() {
  if (!state.announcements.length) {
    $('announcementList').innerHTML = `
      <div class="empty">
        <strong>No announcements yet</strong>
        Share news with travelers: a new trip, a winter schedule, an early-bird price.
        <div style="margin-top: 14px;"><button class="btn btn-primary" data-action="new-announcement">Write an announcement</button></div>
      </div>`;
    return;
  }
  $('announcementList').innerHTML = `<div class="ann-list">${state.announcements.map(a => {
    const id = escapeHTML(a._id);
    return `
    <article class="ann ${a.pinned ? 'is-pinned' : ''}">
      <div class="ann-top">
        <h3>${escapeHTML(a.title)}</h3>
        <div class="ann-badges">${a.pinned ? '<span class="badge badge-pinned">Pinned</span>' : ''}<span class="badge badge-${a.status}">${a.status === 'published' ? 'Published' : 'Draft'}</span></div>
      </div>
      <p class="ann-body">${escapeHTML(a.body)}</p>
      <div class="ann-meta">${a.status === 'published' ? `Published ${escapeHTML(fmtDateTime(a.publishedAt))}` : `Last edited ${escapeHTML(fmtDateTime(a.updatedAt))}`}${a.event ? `, about ${escapeHTML(a.event.title)}` : ''}${a.notifiedAt ? ', travelers notified' : ''}</div>
      <div class="pkg-actions">
        <button class="btn btn-quiet btn-sm" data-action="edit-announcement" data-id="${id}">Edit</button>
        <button class="btn btn-quiet btn-sm" data-action="toggle-pin" data-id="${id}">${a.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="btn btn-danger btn-sm" data-action="delete-announcement" data-id="${id}">Delete</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

async function fillEventSelect(select, { blank, withCounts } = {}) {
  const events = (state.events.length ? state.events : await fetchEvents()).filter(e => e.startDate && e.status !== 'cancelled');
  select.innerHTML = (blank ? `<option value="">${escapeHTML(blank)}</option>` : '') + events.map(e => `<option value="${escapeHTML(e._id)}">${escapeHTML(e.title)}, ${escapeHTML(dateRange(e.startDate, e.endDate))}${withCounts ? ` (${plural(e.stats.registrations, 'registered', 'registered')})` : ''}</option>`).join('');
  return events;
}

function syncNotifyField() {
  const published = $('anStatus').value === 'published';
  const already = state.editingAnnouncement && state.editingAnnouncement.notifiedAt;
  $('anNotifyField').hidden = !published || Boolean(already);
  $('anNotify').querySelector('option[value="event"]').disabled = !$('anEvent').value;
  if (!$('anEvent').value && $('anNotify').value === 'event') $('anNotify').value = 'none';
}
$('anStatus').addEventListener('change', syncNotifyField);
$('anEvent').addEventListener('change', syncNotifyField);

async function openAnnouncementEditor(item) {
  state.editingAnnouncement = item || null;
  $('announcementForm').reset();
  showAlert('announcementError', '');
  $('announcementFormTitle').textContent = item ? 'Edit announcement' : 'New announcement';
  try { await fillEventSelect($('anEvent'), { blank: 'Not about a specific event' }); } catch (e) { /* the event link is optional */ }
  if (item) {
    $('anTitle').value = item.title;
    $('anBody').value = item.body;
    $('anEvent').value = item.event ? item.event._id : '';
    $('anPinned').checked = item.pinned;
    $('anStatus').value = item.status;
  }
  $('anNotify').value = 'none';
  syncNotifyField();
  $('announcementDrawer').hidden = false;
  $('anTitle').focus();
}

$('announcementForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('announcementError', '');
  const title = $('anTitle').value.trim();
  const body = $('anBody').value.trim();
  if (!title) return showAlert('announcementError', 'Give the announcement a title.');
  if (!body) return showAlert('announcementError', 'Write the announcement.');

  const payload = { title, body, event: $('anEvent').value || '', pinned: $('anPinned').checked, status: $('anStatus').value };
  if (!$('anNotifyField').hidden) payload.notify = $('anNotify').value;
  const item = state.editingAnnouncement;
  const btn = $('announcementSave');
  setBusy(btn, true);
  try {
    const { message } = item
      ? await api(`/api/v1/agency/me/announcements/${item._id}`, { method: 'PATCH', body: payload })
      : await api('/api/v1/agency/me/announcements', { method: 'POST', body: payload });
    closeDrawers();
    toast(message);
    await loadAnnouncements();
    refreshStats();
  } catch (err) {
    showAlert('announcementError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function togglePin(id) {
  const item = state.announcements.find(a => a._id === id);
  if (!item) return;
  try {
    await api(`/api/v1/agency/me/announcements/${id}`, { method: 'PATCH', body: { pinned: !item.pinned } });
    toast(item.pinned ? 'Unpinned.' : 'Pinned to the top of your agency page.');
    loadAnnouncements();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteAnnouncement(id) {
  const item = state.announcements.find(a => a._id === id);
  if (!item || !window.confirm(`Delete "${item.title}"? Travelers won't see it any more.`)) return;
  try {
    await api(`/api/v1/agency/me/announcements/${id}`, { method: 'DELETE' });
    toast('Announcement deleted.');
    await loadAnnouncements();
    refreshStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Tour ads ----------

state.ads = [];
state.editingAd = null;

const AD_STATES = {
  pending: ['badge-pending', 'Waiting for review'],
  live: ['badge-published', 'Showing in the app'],
  scheduled: ['badge-confirmed', 'Accepted, starts soon'],
  ended: ['badge-hidden', 'Ended'],
  stopped: ['badge-hidden', 'Stopped'],
  rejected: ['badge-rejected', 'Not accepted']
};

// The slide as travelers see it
function adSlideHTML({ title, subtitle, highlight, ctaLabel, image }) {
  const sub = escapeHTML(subtitle || '');
  const mark = escapeHTML(highlight || '');
  return `
    <div class="ad-slide" ${image ? `style="background-image: url('${escapeHTML(image)}')"` : ''}>
      <strong>${escapeHTML(title || 'Your ad title')}</strong>
      <span>${mark && sub.includes(mark) ? sub.replace(mark, `<em>${mark}</em>`) : sub}</span>
      <span class="ad-slide-cta">${escapeHTML(ctaLabel || 'Explore Now')}</span>
    </div>`;
}

async function loadAds() {
  $('adList').innerHTML = '<p class="muted">Loading ads...</p>';
  try {
    const { data } = await api('/api/v1/agency/me/ads');
    state.ads = data.ads;
    renderAds();
  } catch (err) {
    $('adList').innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

function renderAds() {
  if (!state.ads.length) {
    $('adList').innerHTML = `
      <div class="empty">
        <strong>No ads yet</strong>
        Put one of your published tours in front of travelers on the Tours screen.
        <div style="margin-top: 14px;"><button class="btn btn-primary" data-action="new-ad">Apply for an ad</button></div>
      </div>`;
    return;
  }
  $('adList').innerHTML = `<div class="ad-grid">${state.ads.map(a => {
    const id = escapeHTML(a._id);
    const [badge, label] = AD_STATES[a.state] || AD_STATES.pending;
    const canEdit = a.state === 'pending' || a.state === 'rejected';
    const canStop = a.state === 'live' || a.state === 'scheduled';
    return `
    <article class="ad-card">
      ${adSlideHTML(a)}
      <div class="ann-top" style="margin-top: 12px;">
        <h3>${escapeHTML(a.tour && a.tour.title ? a.tour.title : 'Tour')}</h3>
        <span class="badge ${badge}">${label}</span>
      </div>
      ${a.state === 'rejected' && a.rejectedReason ? `<div class="alert alert-error" style="margin-top: 10px;">Plejar's note: ${escapeHTML(a.rejectedReason)}</div>` : ''}
      <div class="ann-meta">${a.startsAt ? `${escapeHTML(fmtDate(a.startsAt))} to ` : 'Until '}${escapeHTML(fmtDate(a.endsAt))}${a.state === 'pending' ? '' : ` · ${Number(a.clicks)} ${a.clicks === 1 ? 'tap' : 'taps'}`}</div>
      <div class="pkg-actions">
        ${canEdit ? `<button class="btn btn-quiet btn-sm" data-action="edit-ad" data-id="${id}">${a.state === 'rejected' ? 'Fix and send again' : 'Edit'}</button>` : ''}
        ${canEdit ? `<button class="btn btn-quiet btn-sm" data-action="remove-ad" data-id="${id}">Delete</button>` : ''}
        ${canStop ? `<button class="btn btn-quiet btn-sm" data-action="remove-ad" data-id="${id}">Stop ad</button>` : ''}
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderAdPreview() {
  const file = $('adImage').files[0];
  const current = state.editingAd ? state.editingAd.image : '';
  if (state.adPreviewUrl) URL.revokeObjectURL(state.adPreviewUrl);
  state.adPreviewUrl = file ? URL.createObjectURL(file) : '';
  $('adPreview').innerHTML = adSlideHTML({
    title: $('adTitle').value.trim(),
    subtitle: $('adSubtitle').value.trim(),
    highlight: $('adHighlight').value.trim(),
    ctaLabel: $('adCta').value.trim(),
    image: state.adPreviewUrl || current
  });
}
['adTitle', 'adSubtitle', 'adHighlight', 'adCta'].forEach(id => $(id).addEventListener('input', renderAdPreview));
$('adImage').addEventListener('change', renderAdPreview);

async function openAdEditor(ad) {
  state.editingAd = ad || null;
  $('adForm').reset();
  showAlert('adError', '');
  $('adFormTitle').textContent = ad ? 'Change your ad' : 'Apply for an ad';
  $('adImageLabel').textContent = ad ? 'Picture (choose one to replace it)' : 'Picture *';
  const today = new Date().toISOString().slice(0, 10);
  try {
    const events = (await fetchEvents()).filter(e => e.status === 'published' && e.startDate && isoDay(e.startDate) >= today);
    $('adTour').innerHTML = `<option value="">${events.length ? 'Choose a tour' : 'No published upcoming tours yet'}</option>${events.map(e => `<option value="${escapeHTML(e._id)}">${escapeHTML(e.title)}, ${escapeHTML(dateRange(e.startDate, e.endDate))}</option>`).join('')}`;
  } catch (err) {
    showAlert('adError', err.message);
  }
  if (ad) {
    $('adTour').value = ad.tour && ad.tour._id ? ad.tour._id : '';
    $('adTitle').value = ad.title;
    $('adSubtitle').value = ad.subtitle || '';
    $('adHighlight').value = ad.highlight || '';
    $('adCta').value = ad.ctaLabel || '';
    // Stored in Bangladesh time
    const day = d => (d ? new Date(new Date(d).getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10) : '');
    $('adStarts').value = day(ad.startsAt);
    $('adEnds').value = day(ad.endsAt);
  }
  $('adSubmit').textContent = ad && ad.state === 'pending' ? 'Save changes' : 'Send for review';
  renderAdPreview();
  $('adDrawer').hidden = false;
}

$('adForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('adError', '');
  const form = new FormData();
  form.append('tour', $('adTour').value);
  form.append('title', $('adTitle').value.trim());
  form.append('subtitle', $('adSubtitle').value.trim());
  form.append('highlight', $('adHighlight').value.trim());
  form.append('ctaLabel', $('adCta').value.trim());
  form.append('startsAt', $('adStarts').value);
  form.append('endsAt', $('adEnds').value);
  if ($('adImage').files[0]) form.append('image', $('adImage').files[0]);
  const btn = $('adSubmit');
  setBusy(btn, true);
  try {
    const editing = state.editingAd;
    const { message } = await api(editing ? `/api/v1/agency/me/ads/${editing._id}` : '/api/v1/agency/me/ads', { method: editing ? 'PATCH' : 'POST', form });
    closeDrawers();
    toast(message);
    await loadAds();
  } catch (err) {
    showAlert('adError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function removeAd(id) {
  const ad = state.ads.find(a => a._id === id);
  if (!ad) return;
  const running = ad.state === 'live' || ad.state === 'scheduled';
  if (!window.confirm(running ? `Stop "${ad.title}"? It leaves the app right away, and you'd need to apply again to bring it back.` : `Delete "${ad.title}"?`)) return;
  try {
    await api(`/api/v1/agency/me/ads/${id}`, { method: 'DELETE' });
    toast(running ? 'Ad stopped.' : 'Ad deleted.');
    await loadAds();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Notifications ----------

function syncAudience() {
  const audience = $('broadcastForm').querySelector('input[name="audience"]:checked').value;
  $('audienceEventField').hidden = audience !== 'event';
}
$('broadcastForm').querySelectorAll('input[name="audience"]').forEach(r => r.addEventListener('change', syncAudience));
$('bcBody').addEventListener('input', () => { $('bcCount').textContent = `${$('bcBody').value.length} / 1000`; });

async function loadNotificationsView() {
  $('broadcastList').innerHTML = '<li class="muted">Loading...</li>';
  try {
    const [{ data: audience }, { data: sent }] = await Promise.all([
      api('/api/v1/agency/me/audience'),
      api('/api/v1/agency/me/broadcasts')
    ]);
    state.audience = audience;
    // Upcoming events first (soonest at the top), then past ones; start on the next event people registered for
    const today = isoDay(new Date());
    const upcoming = audience.events.filter(e => e.status !== 'cancelled' && isoDay(e.startDate) >= today).reverse();
    const past = audience.events.filter(e => e.status !== 'cancelled' && isoDay(e.startDate) < today);
    const events = [...upcoming, ...past];
    $('bcEvent').innerHTML = events.length
      ? events.map(e => `<option value="${escapeHTML(e._id)}">${escapeHTML(e.title)}, ${escapeHTML(fmtDay(e.startDate))} (${plural(e.registered, 'person', 'people')})</option>`).join('')
      : '<option value="">No tour events yet</option>';
    const first = events.find(e => e.registered);
    if (state.notifyEvent && events.some(e => e._id === state.notifyEvent)) $('bcEvent').value = state.notifyEvent;
    else if (first) $('bcEvent').value = first._id;
    state.notifyEvent = null;
    $('audienceFollowers').textContent = `(${plural(audience.followers || 0, 'follower', 'followers')})`;
    $('audienceAllUsers').textContent = `(${plural(audience.allUsers || 0, 'traveler', 'travelers')})`;
    $('audienceTravelers').textContent = `(${plural(audience.travelers, 'person', 'people')})`;
    $('broadcastLimit').textContent = audience.left
      ? `You can send ${plural(audience.left, 'more notification')} today (up to ${audience.limit} in 24 hours).`
      : `You've sent ${audience.limit} notifications in the last 24 hours. You can send more later.`;
    $('broadcastSubmit').disabled = !audience.left;
    syncAudience();

    $('broadcastList').innerHTML = sent.broadcasts.length ? sent.broadcasts.map(b => {
      let audDesc = 'everyone who booked with you';
      if (b.audience === 'followers') audDesc = 'your followers';
      else if (b.audience === 'all_users') audDesc = 'all app travelers';
      else if (b.audience === 'event') audDesc = `registered for ${escapeHTML(b.eventTitle)}`;

      return `
      <li>
        <div class="sent-top"><strong>${escapeHTML(b.title)}</strong><span class="muted">${escapeHTML(fmtDateTime(b.createdAt))}</span></div>
        ${b.body ? `<p>${escapeHTML(b.body)}</p>` : ''}
        <span class="cell-sub">To ${escapeHTML(plural(b.recipientCount, 'person', 'people'))} (${audDesc})${b.announcement ? ', with an announcement' : ''}. Sent by ${escapeHTML(b.sentByName || 'Agency')}.</span>
      </li>`;
    }).join('') : '<li class="muted">Nothing sent yet.</li>';
  } catch (err) {
    $('broadcastList').innerHTML = `<li class="alert alert-error">${escapeHTML(err.message)}</li>`;
  }
}

$('broadcastForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('broadcastError', '');
  const audience = $('broadcastForm').querySelector('input[name="audience"]:checked').value;
  const title = $('bcTitle').value.trim();
  const body = $('bcBody').value.trim();
  const eventId = $('bcEvent').value;
  if (audience === 'event' && !eventId) return showAlert('broadcastError', 'Choose the tour event.');
  if (!title) return showAlert('broadcastError', 'Write a short title.');

  const a = state.audience || {};
  let count = 0;
  if (audience === 'event') count = (a.events && a.events.find(x => x._id === eventId) || {}).registered || 0;
  else if (audience === 'followers') count = a.followers || 0;
  else if (audience === 'all_users') count = a.allUsers || 0;
  else count = a.travelers || 0;

  if (!count) {
    let emptyMsg = 'Nobody is in this audience yet.';
    if (audience === 'followers') emptyMsg = 'You do not have any followers yet.';
    else if (audience === 'all_users') emptyMsg = 'No active app users found.';
    else if (audience === 'event') emptyMsg = 'Nobody is registered for this event yet.';
    else emptyMsg = 'Nobody has booked with you yet.';
    return showAlert('broadcastError', emptyMsg);
  }

  let audName = 'people';
  if (audience === 'followers') audName = 'followers';
  else if (audience === 'all_users') audName = 'app travelers';
  if (!window.confirm(`Send "${title}" to ${plural(count, audName === 'followers' ? 'follower' : 'person', audName)}? This can't be undone.`)) return;

  const btn = $('broadcastSubmit');
  setBusy(btn, true, 'Sending...');
  try {
    const { message } = await api('/api/v1/agency/me/broadcasts', { method: 'POST', body: { audience, eventId, title, body } });
    $('bcTitle').value = '';
    $('bcBody').value = '';
    $('bcCount').textContent = '0 / 1000';
    toast(message);
    loadNotificationsView();
  } catch (err) {
    showAlert('broadcastError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------- Team ----------

async function loadTeam() {
  $('teamBody').innerHTML = '<tr><td colspan="4">Loading team...</td></tr>';
  try {
    const { data } = await api('/api/v1/agency/me/team');
    state.team = data.members;
    renderTeam();
  } catch (err) {
    $('teamBody').innerHTML = `<tr><td colspan="4">${escapeHTML(err.message)}</td></tr>`;
  }
}

function renderTeam() {
  $('teamBody').innerHTML = state.team.map(m => `
    <tr>
      <td><strong>${escapeHTML(m.name)}</strong><span class="cell-sub">${escapeHTML(m.email)}</span></td>
      <td>${m.agencyRole === 'owner' ? 'Owner' : 'Team member'}</td>
      <td><span class="badge badge-${escapeHTML(m.accountStatus)}">${m.accountStatus === 'invited' ? 'Invite sent' : 'Active'}</span></td>
      <td class="actions">
        ${m.accountStatus === 'invited' ? `<button class="btn btn-quiet btn-sm" data-action="resend" data-id="${escapeHTML(m.id)}">Resend invite</button>` : ''}
        ${m.agencyRole !== 'owner' ? `<button class="btn btn-danger btn-sm" data-action="remove-member" data-id="${escapeHTML(m.id)}">Remove</button>` : ''}
      </td>
    </tr>`).join('');
}

function inviteLinkHTML(url, message) {
  return `
    <div class="alert alert-ok" style="margin-top: 14px;">
      ${escapeHTML(message)}
      <div class="invite-link"><input id="inviteLinkField" value="${escapeHTML(url)}" readonly><button type="button" class="btn btn-quiet btn-sm" data-action="copy" data-target="inviteLinkField">Copy link</button></div>
    </div>`;
}

function copyField(id) {
  const field = $(id);
  if (!field) return;
  field.select();
  navigator.clipboard.writeText(field.value).then(() => toast('Link copied.')).catch(() => document.execCommand('copy'));
}

$('inviteForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  showAlert('inviteError', '');
  $('inviteResult').innerHTML = '';
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  if (!name) return showAlert('inviteError', 'Enter their name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAlert('inviteError', 'Enter a valid email address.');

  const btn = $('inviteSubmit');
  setBusy(btn, true, 'Sending invite...');
  try {
    const { data, message } = await api('/api/v1/agency/me/team', { method: 'POST', body: { name, email } });
    form.reset();
    if (data.emailSent) toast(message);
    else $('inviteResult').innerHTML = inviteLinkHTML(data.inviteURL, message);
    await loadTeam();
    refreshStats();
  } catch (err) {
    showAlert('inviteError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function resendInvite(id) {
  try {
    const { data, message } = await api(`/api/v1/agency/me/team/${id}/resend`, { method: 'POST' });
    if (data.emailSent) toast(message);
    else $('inviteResult').innerHTML = inviteLinkHTML(data.inviteURL, 'New invite link created. Share it with them:');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeMember(id) {
  const m = state.team.find(x => x.id === id);
  if (!m || !window.confirm(`Remove ${m.name} from your agency? They will lose access to this panel.`)) return;
  try {
    await api(`/api/v1/agency/me/team/${id}`, { method: 'DELETE' });
    toast(`${m.name} removed.`);
    await loadTeam();
    refreshStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Verification ----------

const DOC_LABELS = { trade_license: 'Trade license', nid: "Owner's national ID" };

async function loadVerification() {
  try {
    const { data } = await api('/api/v1/agency/me/verification');
    state.verification = data.verification;
    renderVerification();
  } catch (err) {
    $('verificationStatus').innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

function renderVerification() {
  const v = state.verification;
  const banners = {
    approved: '<div class="callout callout-ok"><div><strong>Verified</strong>Your agency has the verified mark. Upload new documents only if your license changes.</div></div>',
    pending: `<div class="callout callout-warn"><div><strong>In review</strong>Submitted ${escapeHTML(fmtDate(v.submittedAt))}. Plejar usually reviews documents within 1 to 2 working days.</div></div>`,
    rejected: `<div class="callout callout-error"><div><strong>Changes needed</strong>${escapeHTML(v.note || 'Check your documents and submit again.')}</div></div>`,
    none: ''
  };
  $('verificationStatus').innerHTML = banners[v.verified ? 'approved' : v.status] || '';

  $('docList').innerHTML = v.documents.length
    ? v.documents.map(d => `
        <li>
          <span><strong>${escapeHTML(DOC_LABELS[d.kind] || d.kind)}</strong><span class="cell-sub">${escapeHTML(d.originalName)}, uploaded ${escapeHTML(fmtDate(d.uploadedAt))}</span></span>
          <a class="btn btn-quiet btn-sm" href="/api/v1/agency/me/documents/${escapeHTML(d.id)}" target="_blank" rel="noopener">View</a>
        </li>`).join('')
    : '<li><span>No documents uploaded yet.</span></li>';

  $('verificationForm').tradeLicenseNumber.value = v.tradeLicenseNumber || '';
}

$('verificationForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  showAlert('verificationError', '');
  if (!form.tradeLicenseNumber.value.trim()) return showAlert('verificationError', 'Enter your trade license number.');

  const has = kind => state.verification && state.verification.documents.some(d => d.kind === kind);
  if (!form.tradeLicense.files.length && !has('trade_license')) return showAlert('verificationError', 'Upload your trade license.');
  if (!form.nid.files.length && !has('nid')) return showAlert('verificationError', "Upload the owner's national ID.");

  const fd = new FormData();
  fd.append('tradeLicenseNumber', form.tradeLicenseNumber.value.trim());
  if (form.tradeLicense.files[0]) fd.append('tradeLicense', form.tradeLicense.files[0]);
  if (form.nid.files[0]) fd.append('nid', form.nid.files[0]);

  const btn = $('verificationSubmit');
  setBusy(btn, true, 'Uploading...');
  try {
    const { data, message } = await api('/api/v1/agency/me/verification', { method: 'POST', form: fd });
    state.verification = data.verification;
    state.agency.verification.status = data.verification.status;
    state.agency.tradeLicenseNumber = data.verification.tradeLicenseNumber;
    form.tradeLicense.value = '';
    form.nid.value = '';
    renderVerification();
    renderOverview();
    toast(message);
  } catch (err) {
    showAlert('verificationError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------- Guides ----------

async function fetchGuides() {
  const { data } = await api('/api/v1/agency/me/guides');
  state.guides = data.guides;
  return state.guides;
}

// The guide picker on the tour form
async function fillGuideSelect(selected) {
  const select = $('evGuide');
  try {
    const guides = await fetchGuides();
    select.innerHTML = '<option value="">No guide shown</option>' + guides
      .filter(g => g.active || String(g._id) === selected)
      .map(g => `<option value="${escapeHTML(g._id)}">${escapeHTML(g.name)}${g.languages.length ? ` (${escapeHTML(g.languages.join(', '))})` : ''}</option>`).join('');
    select.value = selected || '';
  } catch (e) { /* the guide is optional */ }
}

async function loadGuides() {
  $('guideList').innerHTML = '<p class="muted">Loading guides...</p>';
  try {
    await fetchGuides();
    renderGuides();
  } catch (err) {
    $('guideList').innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
  loadGuideBookings();
}

// Destinations for "Works in" (published places only)
async function fillGuideDestinations(selected) {
  const select = $('gdDestination');
  try {
    if (!state.guidePlaces) {
      const { data } = await api('/api/v1/destinations?limit=200');
      state.guidePlaces = data.destinations || [];
    }
    select.innerHTML = '<option value="">Choose a destination</option>' + state.guidePlaces
      .map(p => `<option value="${escapeHTML(p._id)}">${escapeHTML(p.name)}</option>`).join('');
    select.value = selected || '';
  } catch (e) { /* optional */ }
}

const GUIDE_NEXT = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'], completed: [], cancelled: [] };

async function loadGuideBookings() {
  const box = $('guideBookingList');
  box.innerHTML = '<p class="muted">Loading...</p>';
  try {
    const { data } = await api('/api/v1/agency/me/bookings?kind=guide&limit=50');
    state.guideBookings = data.bookings;
    if (!data.bookings.length) {
      box.innerHTML = '<p class="muted">No guide bookings yet. Tick "Travelers can hire this guide" on a guide and set a price per day.</p>';
      return;
    }
    box.innerHTML = `<div class="ann-list">${data.bookings.map(b => `
      <article class="ann">
        <div class="ann-top">
          <h3>${escapeHTML(b.guide ? b.guide.name : b.packageTitle)} · ${escapeHTML(dateRange(b.travelDate, b.endDate || b.travelDate))}</h3>
          <span class="badge badge-${escapeHTML(b.status)}">${escapeHTML(b.status)}</span>
        </div>
        <p class="ann-meta">${escapeHTML(b.user ? b.user.name : 'Traveler')}${b.user && b.user.phone ? ` · ${escapeHTML(b.user.phone)}` : ''} · ${plural(b.travelers, 'traveler')} · ${plural(b.units || 1, 'day')} · ${taka(b.amount)} · ${escapeHTML(b.reference)}</p>
        <div class="pkg-actions">${GUIDE_NEXT[b.status].map(st => `<button class="btn ${st === 'cancelled' ? 'btn-danger' : 'btn-quiet'} btn-sm" data-guide-booking="${escapeHTML(b._id)}" data-to="${st}">${st === 'confirmed' ? 'Confirm' : st === 'completed' ? 'Mark completed' : 'Cancel'}</button>`).join('')}</div>
      </article>`).join('')}</div>`;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

$('guideBookingList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-guide-booking]');
  if (!btn) return;
  const status = btn.dataset.to;
  let reason = '';
  if (status === 'cancelled') {
    reason = window.prompt('Why are you cancelling? The traveler will see this.') || '';
    if (reason.trim().length < 3) return;
  }
  try {
    await api(`/api/v1/agency/me/bookings/${btn.dataset.guideBooking}`, { method: 'PATCH', body: { status, reason } });
    toast(status === 'confirmed' ? 'Confirmed. The traveler gets a notification.' : 'Booking updated.');
    loadGuideBookings();
  } catch (err) {
    toast(err.message, 'error');
  }
});

function renderGuides() {
  if (!state.guides.length) {
    $('guideList').innerHTML = `
      <div class="empty">
        <strong>No guides yet</strong>
        Travelers like to know who leads the trip. Add your guides, then pick one on each tour event.
        <div style="margin-top: 14px;"><button class="btn btn-primary" data-action="new-guide">Add a guide</button></div>
      </div>`;
    return;
  }
  $('guideList').innerHTML = `<div class="guide-grid">${state.guides.map(g => {
    const id = escapeHTML(g._id);
    return `
    <article class="guide-card ${g.active ? '' : 'is-off'}">
      ${g.photo ? `<img src="${escapeHTML(g.photo)}" alt="">` : `<div class="guide-initial">${escapeHTML(g.name.charAt(0).toUpperCase())}</div>`}
      <div class="guide-info">
        <h3>${escapeHTML(g.name)}${g.active ? '' : ' <span class="badge badge-draft">Not available</span>'}</h3>
        <p class="muted">${[g.location, g.experienceYears != null ? `${g.experienceYears} years' experience` : '', g.languages.join(', ')].filter(Boolean).map(escapeHTML).join(' · ')}</p>
        <p class="muted">${g.upcomingTours ? `Leads ${plural(g.upcomingTours, 'upcoming tour', 'upcoming tours')}` : 'No upcoming tours'}${g.bookable && g.pricePerDay != null ? ` · Hireable in the app, ${taka(g.pricePerDay)} a day` : ''}</p>
        <div class="pkg-actions">
          <button class="btn btn-quiet btn-sm" data-action="edit-guide" data-id="${id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="delete-guide" data-id="${id}">Remove</button>
        </div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function openGuideEditor(guide) {
  state.editingGuide = guide || null;
  $('guideForm').reset();
  showAlert('guideError', '');
  $('guideFormTitle').textContent = guide ? 'Edit guide' : 'Add a guide';
  $('gdName').value = guide ? guide.name : '';
  $('gdLocation').value = guide ? guide.location : '';
  $('gdLanguages').value = guide ? guide.languages.join(', ') : '';
  $('gdExperience').value = guide && guide.experienceYears != null ? guide.experienceYears : '';
  $('gdBio').value = guide ? guide.bio : '';
  $('gdPhone').value = guide ? guide.phone : '';
  $('gdActive').checked = guide ? guide.active : true;
  $('gdBookable').checked = Boolean(guide && guide.bookable);
  $('gdTitle').value = guide ? guide.title || '' : '';
  $('gdPrice').value = guide && guide.pricePerDay != null ? guide.pricePerDay : '';
  $('gdRegular').value = guide && guide.regularPrice != null ? guide.regularPrice : '';
  $('gdLat').value = guide && guide.mapLocation && guide.mapLocation.coordinates ? guide.mapLocation.coordinates[1] : '';
  $('gdLng').value = guide && guide.mapLocation && guide.mapLocation.coordinates ? guide.mapLocation.coordinates[0] : '';
  fillGuideDestinations(guide && guide.destination ? String(guide.destination) : '');
  $('gdPhotoPreview').hidden = !(guide && guide.photo);
  if (guide && guide.photo) $('gdPhotoPreview').src = guide.photo;
  $('guideDrawer').hidden = false;
  $('gdName').focus();
}

$('gdPhoto').addEventListener('change', () => {
  const file = $('gdPhoto').files[0];
  if (!file) return;
  $('gdPhotoPreview').src = URL.createObjectURL(file);
  $('gdPhotoPreview').hidden = false;
});

$('guideForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('guideError', '');
  if (!$('gdName').value.trim()) return showAlert('guideError', "Enter the guide's name.");
  const fd = new FormData();
  fd.append('name', $('gdName').value.trim());
  fd.append('location', $('gdLocation').value.trim());
  fd.append('languages', $('gdLanguages').value);
  fd.append('experienceYears', $('gdExperience').value);
  fd.append('bio', $('gdBio').value.trim());
  fd.append('phone', $('gdPhone').value.trim());
  fd.append('active', $('gdActive').checked);
  fd.append('bookable', $('gdBookable').checked);
  fd.append('title', $('gdTitle').value.trim());
  fd.append('pricePerDay', $('gdPrice').value);
  fd.append('regularPrice', $('gdRegular').value);
  fd.append('destination', $('gdDestination').value);
  fd.append('lat', $('gdLat').value.trim());
  fd.append('lng', $('gdLng').value.trim());
  if ($('gdPhoto').files[0]) fd.append('photo', $('gdPhoto').files[0]);
  const guide = state.editingGuide;
  const btn = $('guideSave');
  setBusy(btn, true);
  try {
    await api(guide ? `/api/v1/agency/me/guides/${guide._id}` : '/api/v1/agency/me/guides', { method: guide ? 'PATCH' : 'POST', form: fd });
    closeDrawers();
    toast(guide ? 'Guide saved.' : 'Guide added. Pick them on your tour events.');
    await loadGuides();
  } catch (err) {
    showAlert('guideError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function deleteGuide(id) {
  const guide = state.guides.find(g => g._id === id);
  if (!guide) return;
  const note = guide.upcomingTours ? ` They will be taken off ${plural(guide.upcomingTours, 'upcoming tour', 'upcoming tours')}.` : '';
  if (!window.confirm(`Remove ${guide.name}?${note}`)) return;
  try {
    await api(`/api/v1/agency/me/guides/${id}`, { method: 'DELETE' });
    toast('Guide removed.');
    await loadGuides();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Messages: group chats and direct chats ----------

state.guides = [];
state.messageFilter = '';
state.chats = [];
state.openChat = null; // { chat, latestId }
state.chatPoll = null;

const CHAT_API = '/api/v1/agency/me/chats';

async function refreshMessagesBadge() {
  try {
    const { data } = await api(`${CHAT_API}/unread`);
    $('messagesBadge').textContent = data.chats;
    $('messagesBadge').hidden = !data.chats;
  } catch (e) { /* the badge is optional */ }
}

document.querySelectorAll('[data-msg-filter]').forEach(btn => btn.addEventListener('click', () => {
  state.messageFilter = btn.dataset.msgFilter;
  document.querySelectorAll('[data-msg-filter]').forEach(b => b.classList.toggle('active', b === btn));
  loadConversations();
}));

const chatQuery = () => ({ unread: 'unread=true', group: 'kind=group', direct: 'kind=direct', closed: 'status=closed' }[state.messageFilter] || '');

async function loadConversations() {
  if (!state.chats.length) $('conversationList').innerHTML = '<p class="muted" style="padding: 14px;">Loading...</p>';
  try {
    const { data } = await api(`${CHAT_API}?${chatQuery()}`);
    state.chats = data.chats;
    $('messagesBadge').textContent = data.unread.chats;
    $('messagesBadge').hidden = !data.unread.chats;
    renderConversationList();
  } catch (err) {
    $('conversationList').innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

function renderConversationList() {
  if (!state.chats.length) {
    $('conversationList').innerHTML = `<p class="muted" style="padding: 18px;">${state.messageFilter ? 'Nothing here.' : 'No chats yet. A tour gets its group chat when you confirm the first booking, and travelers can message your guides from your tour pages.'}</p>`;
    return;
  }
  const openId = state.openChat && state.openChat.chat._id;
  $('conversationList').innerHTML = state.chats.map(c => `
    <button type="button" class="inbox-item ${openId === c._id ? 'is-open' : ''} ${c.unread ? 'is-unread' : ''}" data-action="open-conversation" data-id="${escapeHTML(c._id)}">
      ${chatPicHTML(c.title, c.photo)}
      <span class="inbox-body">
        <span class="inbox-top"><strong>${escapeHTML(c.title)}</strong><span class="muted">${escapeHTML(fmtDateTime(c.lastMessageAt))}</span></span>
        <span class="inbox-tour">${escapeHTML(c.subtitle || '')}${c.kind === 'tour_group' ? ` · ${Number(c.participantCount)} participants` : ''}${c.status === 'closed' ? ' · Closed' : ''}</span>
        <span class="inbox-preview">${c.lastMessage ? `${c.lastMessage.mine ? 'You: ' : ''}${escapeHTML(c.lastMessage.text)}` : ''}</span>
      </span>
      ${c.unread ? `<span class="nav-badge">${Number(c.unread)}</span>` : ''}
    </button>`).join('');
}

// A round picture in chat, or the person's initials when there is none (the server's default photo counts as none)
function chatPicHTML(name, photo) {
  const letters = escapeHTML(initials(name));
  if (!photo || photo.endsWith('/img/users/profile.png')) return `<span class="avatar chat-pic">${letters}</span>`;
  return `<img class="chat-pic" src="${escapeHTML(photo)}" alt="" loading="lazy" data-initials="${letters}">`;
}

// A picture that no longer loads shows the initials instead (error events don't bubble, so listen on the way down)
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.classList.contains('chat-pic')) img.outerHTML = `<span class="avatar chat-pic">${escapeHTML(img.dataset.initials || '?')}</span>`;
}, true);

function bubbleHTML(m) {
  if (m.type === 'system') return `<div class="bubble is-system"><p>${escapeHTML(m.text)}</p></div>`;
  const files = (m.attachments || []).map(a => (a.kind === 'image'
    ? `<a href="${escapeHTML(a.url)}" target="_blank" rel="noopener"><img class="bubble-photo" src="${escapeHTML(a.url)}" alt="${escapeHTML(a.name || 'Photo')}" loading="lazy"></a>`
    : `<a class="bubble-file" href="${escapeHTML(a.url)}" target="_blank" rel="noopener">📄 ${escapeHTML(a.name || 'File')}</a>`)).join('');
  const side = m.mine ? 'is-agency' : 'is-traveler';
  return `
    <div class="bubble-row ${side}" data-message-id="${escapeHTML(m._id)}">
      ${chatPicHTML(m.sender && m.sender.name, m.sender && m.sender.photo)}
      <div class="bubble ${side}">
        ${m.about ? `<span class="bubble-about">About: ${escapeHTML(m.about.title)}</span>` : ''}
        ${m.text ? `<p class="${m.deleted ? 'muted' : ''}">${escapeHTML(m.text)}</p>` : ''}
        ${files}
        <span class="muted">${m.sender ? `${escapeHTML(m.sender.name)}, ` : ''}${escapeHTML(fmtDateTime(m.createdAt))}${m.mine && m.seen ? ' · Seen' : ''}</span>
      </div>
    </div>`;
}

async function openConversation(id) {
  const chat = state.chats.find(c => c._id === id) || (state.openChat && state.openChat.chat._id === id ? state.openChat.chat : null);
  if (!chat) return;
  state.openChat = { chat, latestId: null };
  renderConversationList();
  const box = $('conversationThread');
  box.innerHTML = '<p class="muted" style="padding: 18px;">Loading...</p>';
  try {
    const [{ data }, guides] = await Promise.all([
      api(`${CHAT_API}/${id}/messages`),
      chat.kind === 'tour_group' ? fetchGuides() : Promise.resolve([])
    ]);
    state.openChat.latestId = data.latestId;
    const direct = chat.kind === 'guide' || chat.kind === 'agency';
    const postAs = chat.kind === 'tour_group' && guides.length ? `
      <select id="replyAs" aria-label="Post as" class="reply-as">
        <option value="">Post as ${escapeHTML(state.agency ? state.agency.name : 'your agency')}</option>
        ${guides.filter(g => g.active !== false).map(g => `<option value="${escapeHTML(g._id)}">Post as ${escapeHTML(g.name)} (guide)</option>`).join('')}
      </select>` : '';
    box.innerHTML = `
      <header class="thread-head">
        <div class="thread-who">${chatPicHTML(chat.title, chat.photo)}
          <div><strong>${escapeHTML(chat.title)}</strong>
            <div class="muted">${escapeHTML(chat.subtitle || '')}${chat.kind === 'tour_group' ? ` · ${Number(chat.participantCount)} participants` : ''}</div></div></div>
        ${direct ? `<button type="button" class="btn btn-quiet btn-sm" data-action="toggle-conversation" data-id="${escapeHTML(chat._id)}">${chat.status === 'closed' ? 'Reopen' : 'Mark done'}</button>` : ''}
      </header>
      <div class="thread-messages" id="threadMessages">${data.messages.map(bubbleHTML).join('')}</div>
      ${chat.canSend ? `<form class="thread-reply" id="replyForm">
        ${postAs}
        <textarea id="replyText" rows="2" maxlength="4000" placeholder="Write a message" aria-label="Message"></textarea>
        <label class="btn btn-quiet btn-sm reply-attach" title="Add photos or PDFs">📎<input type="file" id="replyFiles" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden></label>
        <button type="submit" class="btn btn-primary" id="replySend">Send</button>
      </form>` : '<p class="muted" style="padding: 12px 16px;">This chat is read-only.</p>'}`;
    const list = $('threadMessages');
    list.scrollTop = list.scrollHeight;
    if ($('replyForm')) $('replyForm').addEventListener('submit', sendReply);
    if (chat.unread) {
      chat.unread = 0;
      renderConversationList();
      refreshMessagesBadge();
    }
    startChatPolling();
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

// Messages arrive over the socket; while it's down, ask for new ones every few seconds instead
function startChatPolling() {
  clearInterval(state.chatPoll);
  state.chatPoll = setInterval(async () => {
    const open = state.openChat;
    if (!open || $('view-messages').hidden || document.hidden || (state.socket && state.socket.connected)) return;
    try {
      const { data } = await api(`${CHAT_API}/${open.chat._id}/messages${open.latestId ? `?after=${open.latestId}` : ''}`);
      if (!data.messages.length || state.openChat !== open) return;
      const list = $('threadMessages');
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      data.messages.filter(m => !list.querySelector(`[data-message-id="${m._id}"]`)).forEach(m => list.insertAdjacentHTML('beforeend', bubbleHTML(m)));
      open.latestId = data.latestId;
      if (atBottom) list.scrollTop = list.scrollHeight;
      loadConversations();
    } catch (e) { /* try again next time */ }
  }, 8000);
}

async function sendReply(e) {
  e.preventDefault();
  const text = $('replyText').value.trim();
  const files = $('replyFiles').files;
  if (!text && !files.length) return;
  const form = new FormData();
  form.append('text', text);
  [...files].slice(0, 4).forEach(f => form.append('files', f));
  if ($('replyAs') && $('replyAs').value) form.append('asGuide', $('replyAs').value);
  const btn = $('replySend');
  setBusy(btn, true);
  try {
    const { data } = await api(`${CHAT_API}/${state.openChat.chat._id}/messages`, { method: 'POST', form });
    // The live connection often delivers it before this answer arrives: never show it twice
    appendMessage(data.message);
    $('threadMessages').scrollTop = $('threadMessages').scrollHeight;
    state.openChat.latestId = data.message._id;
    $('replyText').value = '';
    $('replyFiles').value = '';
    loadConversations();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false);
  }
}

async function toggleConversation(id) {
  const row = state.chats.find(c => c._id === id) || (state.openChat && state.openChat.chat);
  const status = row && row.status === 'closed' ? 'active' : 'closed';
  try {
    const { data } = await api(`${CHAT_API}/${id}`, { method: 'PATCH', body: { status } });
    // With a filter on, the chat may have just left the list; it stays open with its new state
    if (state.openChat && state.openChat.chat._id === id) state.openChat.chat = data.chat;
    await loadConversations();
    openConversation(id);
  } catch (err) {
    toast(err.message, 'error');
  }
}


// ---------- Live chat (Socket.IO) ----------

function appendMessage(message) {
  const list = $('threadMessages');
  if (!list || list.querySelector(`[data-message-id="${message._id}"]`)) return;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.insertAdjacentHTML('beforeend', bubbleHTML(message));
  if (atBottom || message.mine) list.scrollTop = list.scrollHeight;
}

let typingTimer = null;
function showTyping(name, typing) {
  const head = document.querySelector('#conversationThread .thread-head .muted');
  if (!head) return;
  if (!head.dataset.base) head.dataset.base = head.textContent;
  head.textContent = typing ? `${name} is typing…` : head.dataset.base;
  clearTimeout(typingTimer);
  if (typing) typingTimer = setTimeout(() => showTyping(name, false), 5000);
}

// Fill the gap after a reconnect: anything sent while the socket was down
async function catchUpOpenChat() {
  const open = state.openChat;
  if (!open || !open.latestId) return;
  try {
    const { data } = await api(`${CHAT_API}/${open.chat._id}/messages?after=${open.latestId}`);
    if (state.openChat !== open) return;
    data.messages.forEach(appendMessage);
    open.latestId = data.latestId;
  } catch (e) { /* the next event or poll catches up */ }
}

function connectChatSocket() {
  if (typeof io !== 'function' || state.socket) return; // socket script missing: polling keeps working
  // This panel is the agency's inbox: the same person's own traveler chats belong in the app
  const socket = io({ auth: { token: state.token || undefined, side: 'agency' }, withCredentials: true });
  state.socket = socket;
  socket.on('connect', () => {
    catchUpOpenChat();
    if (!$('view-messages').hidden) loadConversations();
  });
  socket.on('connect_error', err => {
    if (/Sign in/.test(err.message)) socket.disconnect(); // an expired login: polling until they sign in again
  });
  socket.on('chat:message', ({ chatId, message, chat }) => {
    const open = state.openChat;
    if (open && open.chat._id === chatId) {
      appendMessage(message);
      open.latestId = message._id;
      showTyping('', false);
      // Reading it here counts as read
      if (!message.mine && !$('view-messages').hidden && !document.hidden) api(`${CHAT_API}/${chatId}/read`, { method: 'POST' }).catch(() => {});
    }
    if ($('view-messages').hidden) return;
    // With a filter on, let the server decide what belongs in the list
    if (state.messageFilter) return loadConversations();
    const i = state.chats.findIndex(c => c._id === chatId);
    if (i >= 0) state.chats.splice(i, 1);
    state.chats.unshift(open && open.chat._id === chatId ? { ...chat, unread: 0 } : chat);
    renderConversationList();
  });
  socket.on('chat:unread', ({ chats }) => {
    $('messagesBadge').textContent = chats;
    $('messagesBadge').hidden = !chats;
  });
  socket.on('chat:updated', ({ chat }) => {
    const i = state.chats.findIndex(c => c._id === chat._id);
    if (i >= 0) state.chats[i] = chat;
    if (state.openChat && state.openChat.chat._id === chat._id) {
      state.openChat.chat = chat;
      // A traveler's message can reopen a chat while it's on screen
      const toggle = document.querySelector('#conversationThread [data-action="toggle-conversation"]');
      if (toggle) toggle.textContent = chat.status === 'closed' ? 'Reopen' : 'Mark done';
    }
    if (!$('view-messages').hidden) renderConversationList();
  });
  socket.on('chat:deleted', ({ chatId, messageId }) => {
    if (!state.openChat || state.openChat.chat._id !== chatId) return;
    // Keeps who sent it and when; only what it said goes
    const bubble = document.querySelector(`[data-message-id="${messageId}"] .bubble`);
    if (bubble) {
      const stamp = bubble.querySelector(':scope > .muted');
      bubble.innerHTML = '<p class="muted">This message was deleted.</p>';
      if (stamp) bubble.append(stamp);
    }
  });
  socket.on('chat:read', ({ chatId }) => {
    if (!state.openChat || state.openChat.chat._id !== chatId || state.openChat.chat.type !== 'direct') return;
    document.querySelectorAll('#threadMessages .bubble.is-agency > .muted').forEach(el => {
      if (!/Seen$/.test(el.textContent)) el.textContent += ' · Seen';
    });
  });
  socket.on('chat:typing', ({ chatId, name, typing }) => {
    if (state.openChat && state.openChat.chat._id === chatId) showTyping(name, typing);
  });
}

// Tell the traveler we're typing (at most once a second; the server checks it too)
let typingSentAt = 0;
document.addEventListener('input', e => {
  if (e.target.id !== 'replyText' || !state.socket || !state.socket.connected || !state.openChat) return;
  if (Date.now() - typingSentAt < 1500) return;
  typingSentAt = Date.now();
  state.socket.emit('chat:typing', { chatId: state.openChat.chat._id, typing: true });
});

// ---------- Wall ----------

state.wall = { filter: 'posts', posts: [], cursor: null, loadId: 0, files: [], cursors: {}, editing: null, editFiles: [], editRemove: new Set() };

const WALL_MAX_MEDIA = 10;
const WALL_MAX_PHOTO = 10 * 1024 * 1024;
const WALL_MAX_VIDEO = 100 * 1024 * 1024;
const isVideoFile = file => file.type.startsWith('video/');

// Fetch can't report upload progress, and a video can take minutes on a slow connection
function uploadWithProgress(path, method, form, button) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    xhr.withCredentials = true;
    if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return;
      const percent = Math.round((e.loaded / e.total) * 100);
      button.textContent = percent < 100 ? `Uploading ${percent}%` : 'Saving...';
    };
    xhr.onerror = () => reject(new Error('The upload stopped. Check your connection and try again.'));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* the status below still decides */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.message || `Request failed (${xhr.status}).`));
    };
    xhr.send(form);
  });
}

// Adds what fits to `list`, or says why it can't. `kept` is what's already on the post.
function addWallFiles(input, list, kept, errorId) {
  const incoming = [...input.files];
  input.value = '';
  showAlert(errorId, '');
  const videos = [...list.filter(isVideoFile), ...kept.filter(m => m.type === 'video'), ...incoming.filter(isVideoFile)];
  if (kept.length + list.length + incoming.length > WALL_MAX_MEDIA) return showAlert(errorId, `A post can have up to ${WALL_MAX_MEDIA} photos or videos.`);
  if (videos.length > 1) return showAlert(errorId, 'A post can have one video.');
  if (incoming.some(f => !isVideoFile(f) && f.size > WALL_MAX_PHOTO)) return showAlert(errorId, 'Each photo must be under 10 MB.');
  if (incoming.some(f => isVideoFile(f) && f.size > WALL_MAX_VIDEO)) return showAlert(errorId, 'A video can be up to 100 MB.');
  incoming.forEach(file => { file.previewUrl = URL.createObjectURL(file); list.push(file); });
}

function clearWallFiles(list) {
  list.forEach(file => URL.revokeObjectURL(file.previewUrl));
  list.length = 0;
}

const thumbHTML = (kind, src, attrs) => `
  <div class="photo-thumb">
    ${kind === 'video' ? `<video src="${escapeHTML(src)}" preload="metadata" muted playsinline></video><span class="thumb-tag">Video</span>` : `<img src="${escapeHTML(src)}" alt="">`}
    <button type="button" ${attrs} aria-label="Remove">&times;</button>
  </div>`;

const newFilesHTML = (list, attr) => list.map((file, i) => thumbHTML(isVideoFile(file) ? 'video' : 'image', file.previewUrl, `${attr}="${i}"`)).join('');

async function fillWallTours(select, current) {
  let tours = [];
  try { tours = (await fetchEvents()).filter(e => e.status === 'published'); } catch (e) { /* the tour tag is optional */ }
  const options = tours.map(e => `<option value="${escapeHTML(e._id)}">${escapeHTML(e.title)}</option>`);
  // A tour that has since finished or closed stays selectable on the post it's tagged in
  if (current && !tours.some(e => e._id === current._id)) options.push(`<option value="${escapeHTML(current._id)}">${escapeHTML(current.title)}</option>`);
  select.innerHTML = `<option value="">No tour</option>${options.join('')}`;
  select.value = current ? current._id : '';
}

// ----- The profile at the top of the page -----

async function renderWallProfile() {
  const a = state.agency;
  let pub = null;
  try { pub = (await api(`/api/v1/agencies/${a._id}`)).data.agency; } catch (e) { /* the numbers are left out */ }
  const links = Object.entries(a.socialLinks || {}).filter(([, url]) => url);
  const siteName = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };
  const numbers = pub ? [plural(pub.counts.posts, 'post'), plural(pub.counts.photos, 'photo'), plural(pub.counts.videos, 'video'), plural(pub.followers, 'follower')] : [];
  $('wallProfile').innerHTML = `
    <div class="wall-cover">${a.cover ? `<img src="${escapeHTML(a.cover)}" alt="">` : ''}</div>
    <div class="wall-identity">
      <div class="wall-logo">${logoHTML(a)}</div>
      <div class="wall-names">
        <h2>${escapeHTML(a.name)}${a.verified ? ' <span class="badge badge-published">Verified</span>' : ''}</h2>
        ${a.tagline ? `<p>${escapeHTML(a.tagline)}</p>` : ''}
      </div>
      ${isOwner() ? '<button class="btn btn-quiet btn-sm" data-action="go" data-view="profile">Edit profile</button>' : ''}
    </div>
    ${numbers.length ? `<p class="wall-numbers">${numbers.map(escapeHTML).join(' · ')}</p>` : ''}
    ${a.address ? `<p class="wall-about">${escapeHTML(a.address)}</p>` : ''}
    ${links.length ? `<p class="wall-links">${links.map(([site, url]) => `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(siteName[site] || site)}</a>`).join('')}</p>` : ''}`;
}

// ----- The post box -----

function renderComposerFiles() {
  $('wallFilesPreview').innerHTML = newFilesHTML(state.wall.files, 'data-wall-file');
  $('wallFilesPreview').hidden = !state.wall.files.length;
}

$('wallFiles').addEventListener('change', e => {
  addWallFiles(e.target, state.wall.files, [], 'wallError');
  renderComposerFiles();
});

$('wallFilesPreview').addEventListener('click', e => {
  const btn = e.target.closest('[data-wall-file]');
  if (!btn) return;
  const [gone] = state.wall.files.splice(Number(btn.dataset.wallFile), 1);
  URL.revokeObjectURL(gone.previewUrl);
  renderComposerFiles();
});

$('wallForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('wallError', '');
  const text = $('wallText').value.trim();
  if (!text && !state.wall.files.length) return showAlert('wallError', 'Write something or add a photo or video.');
  const fd = new FormData();
  fd.append('text', text);
  fd.append('placeName', $('wallPlace').value.trim());
  fd.append('allowComments', String($('wallAllowComments').checked));
  if ($('wallTour').value) fd.append('event', $('wallTour').value);
  state.wall.files.forEach(file => fd.append('media', file));
  const btn = $('wallPost');
  setBusy(btn, true, 'Posting...');
  try {
    await uploadWithProgress('/api/v1/agency/me/posts', 'POST', fd, btn);
    e.target.reset();
    clearWallFiles(state.wall.files);
    renderComposerFiles();
    toast('Posted to your wall.');
    setWallFilter('posts');
    renderWallProfile();
  } catch (err) {
    showAlert('wallError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ----- The posts -----

function wallMediaHTML(media) {
  if (!media.length) return '';
  const items = media.map(m => (m.type === 'video'
    ? `<video src="${escapeHTML(m.url)}" controls playsinline preload="${m.poster ? 'none' : 'metadata'}"${m.poster ? ` poster="${escapeHTML(m.poster)}"` : ''}></video>`
    : `<a href="${escapeHTML(m.url)}" target="_blank" rel="noopener"><img src="${escapeHTML(m.url)}" alt="" loading="lazy"></a>`));
  return `<div class="wall-media wall-media-${Math.min(media.length, 3)}">${items.join('')}</div>`;
}

function wallPostHTML(p) {
  const id = escapeHTML(p._id);
  const tags = [p.event ? `Tour: ${p.event.title}` : '', p.place ? `At ${p.place.name}` : ''].filter(Boolean);
  const counts = [plural(p.counts.reactions, 'reaction'), plural(p.counts.comments, 'comment'), plural(p.counts.shares, 'share')];
  const live = p.status === 'active';
  return `
  <article class="ann wall-post ${p.pinned ? 'is-pinned' : ''}" id="wall-post-${id}">
    <div class="wall-post-head">
      ${chatPicHTML(p.author.name, p.author.photo)}
      <div class="wall-post-who">
        <strong>${escapeHTML(p.author.name)}</strong>
        <span class="muted">${escapeHTML(fmtDateTime(p.createdAt))}${p.editedAt ? ', edited' : ''}${p.postedBy ? `, by ${escapeHTML(p.postedBy.name)}` : ''}</span>
      </div>
      <div class="ann-badges">${p.pinned ? '<span class="badge badge-pinned">Pinned</span>' : ''}${live ? '' : '<span class="badge badge-suspended">Hidden by Plejar</span>'}</div>
    </div>
    ${live ? '' : `<div class="alert alert-error wall-hidden-note">Travelers can't see this post.${p.moderationNote ? ` Reason: ${escapeHTML(p.moderationNote)}` : ''}</div>`}
    ${p.text ? `<p class="wall-text">${escapeHTML(p.text)}</p>` : ''}
    ${tags.length ? `<p class="wall-tags">${tags.map(escapeHTML).join(' · ')}</p>` : ''}
    ${wallMediaHTML(p.media)}
    <p class="ann-meta wall-counts" id="wall-counts-${id}">${counts.map(escapeHTML).join(' · ')}${p.allowComments ? '' : ' · Comments off'}</p>
    <div class="pkg-actions">
      <button class="btn btn-quiet btn-sm" data-action="wall-comments" data-id="${id}">Comments</button>
      ${live ? `<button class="btn btn-quiet btn-sm" data-action="wall-edit" data-id="${id}">Edit</button>
      <button class="btn btn-quiet btn-sm" data-action="wall-pin" data-id="${id}">${p.pinned ? 'Unpin' : 'Pin to top'}</button>` : ''}
      <button class="btn btn-danger btn-sm" data-action="wall-delete" data-id="${id}">Delete</button>
    </div>
    <div class="wall-comments" id="wall-comments-${id}" hidden>
      <div class="wall-c-list"></div>
      <button class="btn btn-quiet btn-sm" data-action="wall-more" data-kind="comments" data-id="${id}" data-post="${id}" hidden>More comments</button>
      ${live ? `<form class="wall-comment-form" data-post="${id}">
        <input type="text" maxlength="2000" placeholder="Comment as ${escapeHTML(state.agency.name)}" aria-label="Write a comment">
        <button class="btn btn-primary btn-sm" type="submit">Send</button>
      </form>` : ''}
    </div>
  </article>`;
}

function setWallFilter(filter) {
  state.wall.filter = filter;
  document.querySelectorAll('[data-wall-filter]').forEach(c => c.classList.toggle('active', c.dataset.wallFilter === filter));
  loadWallList();
}

const WALL_EMPTY = {
  posts: ['No posts yet', 'Share your trips with travelers: a photo from your last tour, a video, or news about the next one.'],
  hidden: ['Nothing hidden', "If Plejar hides one of your posts, it will show here with the reason."],
  image: ['No photos yet', 'Photos you post will collect here.'],
  video: ['No videos yet', 'Videos you post will collect here.']
};

async function loadWallList(more) {
  const { filter } = state.wall;
  const loadId = ++state.wall.loadId;
  const list = $('wallList');
  if (!more) {
    state.wall.posts = [];
    state.wall.cursor = null;
    list.innerHTML = '<p class="muted">Loading...</p>';
  }
  $('wallMore').hidden = true;
  const isGrid = filter === 'image' || filter === 'video';
  const cursor = more && state.wall.cursor ? `&cursor=${encodeURIComponent(state.wall.cursor)}` : '';
  const url = isGrid
    ? `/api/v1/agencies/${state.agency._id}/media?type=${filter}&limit=20${cursor}`
    : `/api/v1/agency/me/posts?limit=15${filter === 'hidden' ? '&status=hidden' : ''}${cursor}`;
  try {
    const { data } = await api(url);
    if (loadId !== state.wall.loadId) return;
    state.wall.cursor = data.nextCursor;
    $('wallMore').hidden = !data.nextCursor;
    const rows = isGrid ? data.media : data.posts;
    if (!more && !rows.length) {
      const [title, body] = WALL_EMPTY[filter];
      list.innerHTML = `<div class="empty"><strong>${escapeHTML(title)}</strong>${escapeHTML(body)}</div>`;
      return;
    }
    if (isGrid) {
      const html = rows.map(wallGridItemHTML).join('');
      if (more) list.querySelector('.wall-grid').insertAdjacentHTML('beforeend', html);
      else list.innerHTML = `<div class="wall-grid">${html}</div>`;
      return;
    }
    state.wall.posts.push(...rows);
    const html = rows.map(wallPostHTML).join('');
    if (more) list.querySelector('.wall-posts').insertAdjacentHTML('beforeend', html);
    else list.innerHTML = `<div class="ann-list wall-posts">${html}</div>`;
  } catch (err) {
    if (loadId === state.wall.loadId) list.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

const wallGridItemHTML = m => (m.type === 'video'
  ? `<video src="${escapeHTML(m.url)}" controls playsinline preload="${m.poster ? 'none' : 'metadata'}"${m.poster ? ` poster="${escapeHTML(m.poster)}"` : ''}></video>`
  : `<a href="${escapeHTML(m.url)}" target="_blank" rel="noopener" title="${escapeHTML(m.caption)}"><img src="${escapeHTML(m.url)}" alt="${escapeHTML(m.caption)}" loading="lazy"></a>`);

function loadWall() {
  renderWallProfile();
  fillWallTours($('wallTour'), null);
  setWallFilter(state.wall.filter);
}

document.querySelectorAll('[data-wall-filter]').forEach(chip => chip.addEventListener('click', () => setWallFilter(chip.dataset.wallFilter)));
$('wallMore').addEventListener('click', () => loadWallList(true));

async function refreshWallCounts(postId) {
  try {
    const { data } = await api(`/api/v1/agency/me/posts/${postId}`);
    const p = data.post;
    const counts = [plural(p.counts.reactions, 'reaction'), plural(p.counts.comments, 'comment'), plural(p.counts.shares, 'share')];
    $(`wall-counts-${postId}`).textContent = `${counts.join(' · ')}${p.allowComments ? '' : ' · Comments off'}`;
  } catch (e) { /* the numbers catch up on the next load */ }
}

async function wallPin(post) {
  try {
    await api(`/api/v1/agency/me/posts/${post._id}/pin`, { method: post.pinned ? 'DELETE' : 'POST' });
    toast(post.pinned ? 'Unpinned.' : 'Pinned to the top of your wall.');
    loadWallList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function wallDelete(post) {
  if (!window.confirm("Delete this post? Its photos and videos are deleted too, and this can't be undone.")) return;
  try {
    await api(`/api/v1/agency/me/posts/${post._id}`, { method: 'DELETE' });
    toast('Post deleted.');
    loadWallList();
    renderWallProfile();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ----- Comments -----

function wallCommentHTML(c, postId) {
  const id = escapeHTML(c._id);
  if (c.removed) return `<div class="wall-comment"><p class="muted">This comment was removed.</p></div>`;
  const thread = escapeHTML(c.parent || c._id);
  const post = escapeHTML(postId);
  const name = c.author ? c.author.name : 'Plejar member';
  return `
  <div class="wall-comment">
    ${chatPicHTML(name, c.author && c.author.photo)}
    <div class="wall-comment-body">
      <div class="bubble ${c.postedAs === 'agency' ? 'is-agency' : 'is-traveler'}">
        <strong>${escapeHTML(name)}</strong>
        <p>${c.replyTo ? `<span class="bubble-about">@${escapeHTML(c.replyTo.name)}</span> ` : ''}${escapeHTML(c.text)}</p>
      </div>
      <div class="wall-comment-meta">
        <span class="muted">${escapeHTML(fmtDateTime(c.createdAt))}</span>
        <button type="button" data-action="wall-reply" data-id="${id}">Reply</button>
        ${!c.parent && c.counts.replies ? `<button type="button" data-action="wall-replies" data-id="${id}" data-post="${post}">${escapeHTML(plural(c.counts.replies, 'reply', 'replies'))}</button>` : ''}
        <button type="button" class="is-danger" data-action="wall-remove-comment" data-id="${id}" data-post="${post}" ${c.parent ? `data-thread="${thread}"` : ''}>Remove</button>
      </div>
      <form class="wall-comment-form" id="wall-reply-${id}" data-post="${post}" data-parent="${id}" data-thread="${thread}" hidden>
        <input type="text" maxlength="2000" placeholder="Reply as ${escapeHTML(state.agency.name)}" aria-label="Write a reply">
        <button class="btn btn-primary btn-sm" type="submit">Send</button>
      </form>
      ${c.parent ? '' : `<div class="wall-replies" id="wall-replies-${id}" hidden>
        <div class="wall-c-list"></div>
        <button class="btn btn-quiet btn-sm" data-action="wall-more" data-kind="replies" data-id="${id}" data-post="${post}" hidden>More replies</button>
      </div>`}
    </div>
  </div>`;
}

async function fillWallComments(kind, id, postId, more) {
  const box = $(`wall-${kind}-${id}`);
  if (!box) return;
  box.hidden = false;
  const list = box.querySelector('.wall-c-list');
  const moreBtn = box.querySelector(':scope > [data-action="wall-more"]');
  const base = kind === 'comments' ? `/api/v1/agency/me/posts/${id}/comments` : `/api/v1/agency/me/comments/${id}/replies`;
  const cursor = more && state.wall.cursors[id] ? `&cursor=${encodeURIComponent(state.wall.cursors[id])}` : '';
  try {
    const { data } = await api(`${base}?limit=30${cursor}`);
    const html = data.comments.map(c => wallCommentHTML(c, postId)).join('');
    if (more) list.insertAdjacentHTML('beforeend', html);
    else list.innerHTML = html || (kind === 'comments' ? '<p class="muted">No comments yet.</p>' : '');
    state.wall.cursors[id] = data.nextCursor;
    moreBtn.hidden = !data.nextCursor;
  } catch (err) {
    list.innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

document.addEventListener('submit', async e => {
  const form = e.target.closest('.wall-comment-form');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  const { post, parent, thread } = form.dataset;
  const btn = form.querySelector('button');
  setBusy(btn, true, 'Sending...');
  try {
    await api(`/api/v1/agency/me/posts/${post}/comments`, { method: 'POST', body: { text, ...(parent ? { parent } : {}) } });
    input.value = '';
    if (parent) {
      form.hidden = true;
      await fillWallComments('replies', thread, post);
    } else {
      await fillWallComments('comments', post, post);
    }
    refreshWallCounts(post);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setBusy(btn, false);
  }
});

async function wallRemoveComment({ id, post, thread }) {
  if (!window.confirm('Remove this comment? Any replies to it are removed too.')) return;
  try {
    await api(`/api/v1/agency/me/comments/${id}`, { method: 'DELETE' });
    toast('Comment removed.');
    if (thread) await fillWallComments('replies', thread, post);
    else await fillWallComments('comments', post, post);
    refreshWallCounts(post);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function wallAction(name, action) {
  const { id, kind, post: postId, thread } = action.dataset;
  const post = state.wall.posts.find(p => p._id === id);
  if (name === 'wall-comments') {
    const box = $(`wall-comments-${id}`);
    if (box.hidden) fillWallComments('comments', id, id);
    else box.hidden = true;
  }
  if (name === 'wall-more') fillWallComments(kind, id, postId, true);
  if (name === 'wall-replies') {
    const box = $(`wall-replies-${id}`);
    if (box.hidden) fillWallComments('replies', id, postId);
    else box.hidden = true;
  }
  if (name === 'wall-reply') {
    const form = $(`wall-reply-${id}`);
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input').focus();
  }
  if (name === 'wall-remove-comment') wallRemoveComment({ id, post: postId, thread });
  if (name === 'wall-edit' && post) openWallEditor(post);
  if (name === 'wall-pin' && post) wallPin(post);
  if (name === 'wall-delete' && post) wallDelete(post);
}

// ----- Editing a post -----

const wallKept = () => state.wall.editing.media.filter(m => !state.wall.editRemove.has(m.url));

function renderWallEditMedia() {
  const kept = wallKept().map(m => thumbHTML(m.type, m.url, `data-wall-remove="${escapeHTML(m.url)}"`)).join('');
  $('wallEditMedia').innerHTML = kept + newFilesHTML(state.wall.editFiles, 'data-wall-edit-file');
  $('wallEditMedia').hidden = !$('wallEditMedia').innerHTML.trim();
}

async function openWallEditor(post) {
  state.wall.editing = post;
  state.wall.editRemove = new Set();
  clearWallFiles(state.wall.editFiles);
  showAlert('wallEditError', '');
  $('wallEditText').value = post.text;
  $('wallEditPlace').value = post.place ? post.place.name : '';
  $('wallEditComments').checked = post.allowComments;
  renderWallEditMedia();
  $('wallDrawer').hidden = false;
  await fillWallTours($('wallEditTour'), post.event);
}

$('wallEditFiles').addEventListener('change', e => {
  addWallFiles(e.target, state.wall.editFiles, wallKept(), 'wallEditError');
  renderWallEditMedia();
});

$('wallEditMedia').addEventListener('click', e => {
  const kept = e.target.closest('[data-wall-remove]');
  const added = e.target.closest('[data-wall-edit-file]');
  if (kept) state.wall.editRemove.add(kept.dataset.wallRemove);
  if (added) {
    const [gone] = state.wall.editFiles.splice(Number(added.dataset.wallEditFile), 1);
    URL.revokeObjectURL(gone.previewUrl);
  }
  if (kept || added) renderWallEditMedia();
});

$('wallEditForm').addEventListener('submit', async e => {
  e.preventDefault();
  showAlert('wallEditError', '');
  const post = state.wall.editing;
  const text = $('wallEditText').value.trim();
  if (!text && !wallKept().length && !state.wall.editFiles.length) return showAlert('wallEditError', 'A post needs some text, a photo or a video.');
  const fd = new FormData();
  fd.append('text', text);
  fd.append('placeName', $('wallEditPlace').value.trim());
  fd.append('event', $('wallEditTour').value);
  fd.append('allowComments', String($('wallEditComments').checked));
  state.wall.editRemove.forEach(url => fd.append('removeMedia', url));
  state.wall.editFiles.forEach(file => fd.append('media', file));
  const btn = $('wallEditSave');
  setBusy(btn, true);
  try {
    await uploadWithProgress(`/api/v1/agency/me/posts/${post._id}`, 'PATCH', fd, btn);
    closeDrawers();
    toast('Post updated.');
    loadWallList();
    renderWallProfile();
  } catch (err) {
    showAlert('wallEditError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

boot();
