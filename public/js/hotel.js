/**
 * Plejar hotel panel (/hotel): sign in, then the hotel's dashboard, stay requests, rooms and rates,
 * photos, details and policies, and account. API: /api/v1/hotel-panel, plus /api/v1/agency/me for the
 * business profile, team and verification it shares with tour agencies.
 */

const $ = id => document.getElementById(id);
const PANEL = '/api/v1/hotel-panel';

// The hotel panel keeps its own sign-in, apart from the tour panel's 'plezar_token',
// so a tour agency account and a hotel account can be signed in in the same browser.
const TOKEN_KEY = 'plejar_hotel_token';
const SHARED_TOKEN_KEY = 'plezar_token';
const readStored = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
const removeStored = key => { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } };

const state = {
  token: readStored(TOKEN_KEY),
  me: null,
  agency: null,
  hotel: null,
  counts: { pendingRequests: 0, upcomingStays: 0 },
  view: 'dashboard',
  requests: [],
  requestFilter: 'pending',
  requestPage: 1,
  requestPages: 1,
  editingRoom: null,
  roomFiles: [],
  removeRoomPhotos: new Set(),
  answering: null,
  tempPassword: ''
};

const STAY_LABEL = { hotel: 'Hotel', resort: 'Resort', cottage: 'Cottage', guest_house: 'Guest house', homestay: 'Homestay', eco_resort: 'Eco resort', houseboat: 'Houseboat' };
const AMENITIES = ['Free Wi-Fi', 'Air conditioning', 'Parking', 'Restaurant', 'Breakfast available', 'Room service', '24-hour front desk', 'Hot water', 'Generator backup', 'Swimming pool', 'Lake or sea view', 'Garden', 'Family rooms', 'Airport pickup', 'Laundry', 'Prayer room', 'Kids play area', 'Conference hall'];
const HOTEL_STATUS = {
  draft: { label: 'Being prepared', note: "Plejar's team is preparing your listing. Add your rooms, photos and policies now; it goes live in the app once our team publishes it.", tone: 'alert-warn' },
  published: { label: 'Live in the app', note: 'Travelers can find your hotel in the Plejar app. Changes you save show straight away.', tone: 'alert-ok' },
  hidden: { label: 'Hidden', note: 'Travelers cannot see your hotel right now. Contact Plejar to show it again.', tone: 'alert-warn' }
};
const REQUEST_LABEL = { pending: 'Waiting', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled by guest' };

const isOwner = () => state.me && state.me.agencyRole === 'owner';
const escapeHTML = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = escapeHTML;
const taka = n => `৳${Number(n || 0).toLocaleString('en-US')}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Stay dates are calendar days stored at midnight UTC
const fmtDay = (d, opts = {}) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC', ...opts }) : '');
const fmtTime = v => {
  if (!v) return '';
  const [h, m] = v.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

async function api(path, { method = 'GET', body, form } = {}) {
  // Tells the server to use the hotel when this account also runs a tour agency
  const headers = { 'X-Plejar-Panel': 'hotel' };
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
    const err = new Error(data.message || `Something went wrong (${res.status}). Try again.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' is-error' : ''}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function showAlert(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.dataset.label || button.textContent;
    button.textContent = label || 'Saving...';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function saveToken(token) {
  state.token = token;
  try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* kept in memory for this visit */ }
}

function clearToken() {
  state.token = null;
  removeStored(TOKEN_KEY);
}

// ---------- Sign in ----------

function showOnly(id) {
  ['loginView', 'passwordView', 'panelView'].forEach(v => { $(v).hidden = v !== id; });
}

function showLogin(notice) {
  showOnly('loginView');
  showAlert('loginNotice', notice);
}

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
      await api('/api/v1/users/logout').catch(() => {});
      return showAlert('loginError', 'This sign in is for hotels on Plejar. Travelers use the Plejar app.');
    }
    saveToken(data.token);
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
  await api('/api/v1/users/forgotPassword', { method: 'POST', body: { email } }).catch(() => {});
  showAlert('loginNotice', `If ${email} has an account, a reset link is on its way.`);
});

function showPasswordStep() {
  showOnly('passwordView');
  showAlert('passwordError', '');
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
    saveToken(data.token);
    state.tempPassword = '';
    $('passwordForm').reset();
    toast('Password saved. Welcome to your hotel panel.');
    await boot();
  } catch (err) {
    showAlert('passwordError', err.status === 401 ? 'The temporary password is not right. Check the email from Plejar.' : err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function logout() {
  await api('/api/v1/users/logout').catch(() => {});
  clearToken();
  showLogin('You have signed out.');
}

// ---------- Boot ----------

async function boot() {
  // Never fall back to the shared cookie: it may belong to a tour account signed in elsewhere.
  // Hotels signed in before the panels were split have their token under the shared key;
  // take it over only if it turns out to be a hotel account.
  let shared = false;
  if (!state.token) {
    state.token = readStored(SHARED_TOKEN_KEY);
    shared = Boolean(state.token);
    if (!shared) return showLogin();
  }
  let account;
  try {
    account = (await api('/api/v1/agency/me')).data;
  } catch (err) {
    if (shared) state.token = null; else if (err.status === 401 || err.status === 403) clearToken();
    if (err.status === 401 || shared) return showLogin();
    if (err.status === 403) return showLogin(err.message);
    return showLogin('Could not load your hotel. Reload the page to try again.');
  }
  if (account.agency.kind !== 'hotel') {
    // A tour agency account: leave its sign-in alone for the tour panel.
    if (shared) { state.token = null; return showLogin(); }
    clearToken();
    return showLogin('That is a tour agency account. Sign in to it at /agent, or sign in with your hotel account here.');
  }
  if (shared) {
    saveToken(state.token);
    // Leave it for the tour panel when the same account runs a tour agency too
    if (!account.me.otherVendor) removeStored(SHARED_TOKEN_KEY);
  }
  // Same account runs a tour agency too: one sign-in opens both panels
  if (account.me.otherVendor && !readStored(SHARED_TOKEN_KEY)) {
    try { localStorage.setItem(SHARED_TOKEN_KEY, state.token); } catch (e) { /* they sign in at /agent */ }
  }
  state.me = account.me;
  if (state.me.mustChangePassword) return showPasswordStep();

  try {
    await loadPanel();
  } catch (err) {
    return showLogin(err.message);
  }
  showOnly('panelView');
  const start = (window.location.hash || '#dashboard').slice(1);
  showView(['dashboard', 'requests', 'rooms', 'photos', 'details', 'account'].includes(start) ? start : 'dashboard');
}

async function loadPanel() {
  const { data } = await api(`${PANEL}/me`);
  // Keep what only /agency/me knows (the tour agency this account may also run)
  state.me = { ...data.me, otherVendor: state.me ? state.me.otherVendor : null };
  state.agency = data.agency;
  state.hotel = data.hotel;
  state.counts = data.counts;
  renderTop();
}

function renderTop() {
  const h = state.hotel;
  $('topHotel').textContent = h ? h.name : state.agency.name;
  $('topStatus').innerHTML = h ? `<span class="pill pill-${E(h.status)}">${E(HOTEL_STATUS[h.status].label)}</span>` : '';
  $('topUser').textContent = `${state.me.name} · ${isOwner() ? 'Owner' : 'Team'}`;
  // The same account also runs a tour agency
  const other = state.me.otherVendor;
  $('otherPanel').hidden = !other;
  if (other) $('otherPanel').title = `Open ${other.name} in the tour agency panel`;
  const pending = state.counts.pendingRequests || 0;
  $('pendingCount').textContent = pending;
  $('pendingCount').hidden = !pending;
  $('noHotel').hidden = Boolean(h);
}

// ---------- Navigation ----------

function showView(view) {
  // Without a listing only the account works
  if (!state.hotel && view !== 'account') view = state.hotel === null ? 'account' : view;
  state.view = view;
  document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== view; });
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  if (view === 'dashboard') renderDashboard();
  if (view === 'requests') loadRequests(1);
  if (view === 'rooms') renderRooms();
  if (view === 'photos') renderPhotos();
  if (view === 'details') renderDetails();
  if (view === 'account') loadAccount();
  try { history.replaceState(null, '', `#${view}`); } catch (e) { /* ignore */ }
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === 'logout') { e.preventDefault(); logout(); }
  if (action === 'go') {
    if (el.dataset.filter) setRequestFilter(el.dataset.filter, false);
    showView(el.dataset.view);
  }
  if (action === 'new-room') openRoom(null);
  if (action === 'edit-room') openRoom(id);
  if (action === 'toggle-room') toggleRoom(id);
  if (action === 'copy-room') copyRoom(id, el);
  if (action === 'close-dialog') el.closest('dialog').close();
  if (action === 'accept') openAnswer(id, 'accept');
  if (action === 'decline') openAnswer(id, 'decline');
  if (action === 'cover') makeCover(el.dataset.url);
  if (action === 'remove-photo') removePhoto(el.dataset.url);
  if (action === 'room-photo-x') toggleRoomPhoto(el.dataset.url);
  if (action === 'remove-member') removeMember(id);
  if (action === 'resend') resendInvite(id);
});

// After any change to the listing the server sends the whole hotel back
function setHotel(hotel) {
  state.hotel = hotel;
  renderTop();
}

// ---------- Dashboard ----------

// A description long enough to tell guests something about the stay
const MIN_DESCRIPTION = 80;
const descriptionLength = text => String(text || '').trim().length;

// "30 of 80 characters" under the description while it is too short
function showDescriptionCount() {
  const n = descriptionLength($('dDescription').value);
  $('dDescriptionCount').textContent = n >= MIN_DESCRIPTION
    ? `${n} characters.`
    : `${n} of at least ${MIN_DESCRIPTION} characters. A fuller description gets more stay requests.`;
}
$('dDescription').addEventListener('input', showDescriptionCount);

function setupSteps(h) {
  const p = h.policies || {};
  return [
    { done: h.photos.length >= 5, text: `Add at least 5 photos of the property (${h.photos.length} so far)`, view: 'photos' },
    { done: h.roomTypes.some(r => r.active), text: 'Add your room types and their prices', view: 'rooms' },
    { done: h.roomTypes.some(r => r.photos.length), text: 'Add photos to your rooms', view: 'rooms' },
    { done: descriptionLength(h.description) >= MIN_DESCRIPTION, text: `Describe the hotel in at least ${MIN_DESCRIPTION} characters (${descriptionLength(h.description)} so far)`, view: 'details' },
    { done: h.amenities.length >= 3, text: 'Tick your amenities', view: 'details' },
    { done: Boolean(h.checkIn && h.checkOut), text: 'Set check-in and check-out times', view: 'details' },
    { done: Boolean(p.cancellation), text: 'Write your cancellation policy', view: 'details' },
    { done: h.status === 'published', text: 'Plejar publishes your listing', view: null }
  ];
}

async function renderDashboard() {
  const h = state.hotel;
  if (!h) return;
  const st = HOTEL_STATUS[h.status] || HOTEL_STATUS.draft;
  const cover = h.photos[0];
  $('hero').innerHTML = `
    <div class="hero-photo" ${cover ? `style="background-image:url('${E(cover)}')"` : ''}>${cover ? '' : '<button class="btn btn-ghost btn-sm" data-action="go" data-view="photos">Add a cover photo</button>'}</div>
    <div class="hero-body">
      <span class="pill pill-${E(h.status)}">${E(st.label)}</span>
      <h1>${E(h.name)}</h1>
      <p class="hero-meta">${E(STAY_LABEL[h.type] || 'Hotel')}${h.starRating ? ` · ${'★'.repeat(h.starRating)}` : ''} · from ${taka(h.pricePerNight)} a night${h.address ? ` · ${E(h.address)}` : ''}</p>
      <div class="hero-note alert ${st.tone}">${E(st.note)}</div>
    </div>`;
  $('statPending').textContent = state.counts.pendingRequests || 0;
  $('statUpcoming').textContent = state.counts.upcomingStays || 0;
  $('statRooms').textContent = h.roomTypes.filter(r => r.active).length;
  $('statPhotos').textContent = h.photos.length;
  $('setupSteps').innerHTML = setupSteps(h).map(s => `
    <li class="${s.done ? 'done' : ''}">
      <span class="tick">${s.done ? '✓' : ''}</span><span class="text">${E(s.text)}</span>
      ${!s.done && s.view ? `<button class="btn btn-ghost btn-sm" data-action="go" data-view="${s.view}">Do this</button>` : ''}
    </li>`).join('');

  const box = $('nextArrivals');
  box.innerHTML = '<li class="muted">Loading...</li>';
  try {
    const { data } = await api(`${PANEL}/requests?status=upcoming&limit=5`);
    box.innerHTML = data.requests.length ? data.requests.map(r => `
      <li><span><strong>${E(r.guestName || 'Guest')}</strong><span class="sub">${E(roomsText(r))} · ${plural(r.guests, 'guest')}</span></span>
      <span style="text-align:right;white-space:nowrap">${E(fmtDay(r.checkIn))}<span class="sub">${plural(r.nights, 'night')}</span></span></li>`).join('')
      : '<li class="muted">No accepted stays coming up.</li>';
  } catch (err) {
    box.innerHTML = `<li class="muted">${E(err.message)}</li>`;
  }
}

// ---------- Stay requests ----------

function setRequestFilter(filter, load = true) {
  state.requestFilter = filter;
  document.querySelectorAll('#requestFilter button').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  if (load) loadRequests(1);
}

document.querySelectorAll('#requestFilter button').forEach(b => b.addEventListener('click', () => setRequestFilter(b.dataset.filter)));
$('moreRequests').addEventListener('click', () => loadRequests(state.requestPage + 1));

async function loadRequests(page) {
  const box = $('requestList');
  if (page === 1) box.innerHTML = '<div class="card empty">Loading requests...</div>';
  try {
    const { data } = await api(`${PANEL}/requests?status=${state.requestFilter}&page=${page}&limit=20`);
    state.requests = page === 1 ? data.requests : [...state.requests, ...data.requests];
    state.requestPage = data.page || page;
    state.requestPages = data.pages || 1;
    state.counts.pendingRequests = data.counts.pending;
    state.counts.upcomingStays = data.counts.upcoming;
    $('segPending').textContent = data.counts.pending ? `(${data.counts.pending})` : '';
    $('segUpcoming').textContent = data.counts.upcoming ? `(${data.counts.upcoming})` : '';
    renderTop();
    renderRequests();
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${E(err.message)}</div>`;
  }
}

const EMPTY_REQUESTS = {
  pending: ['No requests waiting', 'When a traveler asks for a room, it shows here.'],
  upcoming: ['No upcoming stays', 'Stays you accept show here until the guest checks out.'],
  past: ['Nothing here yet', 'Declined, cancelled and finished stays show here.'],
  all: ['No stay requests yet', 'Travelers ask for a room from your page in the Plejar app once your listing is live.']
};

// The rooms in a request: one line per room type ("2 × Deluxe"); older requests have just one
const requestItems = r => (r.items && r.items.length ? r.items : [{ roomName: r.roomName, quantity: r.rooms || 1, pricePerNight: r.pricePerNight }]);
const roomsText = r => requestItems(r).map(i => `${i.quantity} × ${i.roomName || 'Room'}`).join(', ');

function requestCard(r) {
  const checkIn = new Date(r.checkIn);
  return `
    <div class="card req">
      <div class="req-date">
        <b>${checkIn.getUTCDate()}</b><span>${E(fmtDay(r.checkIn, { day: undefined, month: 'short' }))}</span>
        <small>${plural(r.nights, 'night')}</small>
      </div>
      <div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3>${E(r.guestName || 'Guest')}</h3><span class="pill pill-${E(r.status)}">${E(REQUEST_LABEL[r.status] || r.status)}</span></div>
        <div class="req-facts">
          <span>${E(fmtDay(r.checkIn, { weekday: 'short' }))} → ${E(fmtDay(r.checkOut, { weekday: 'short' }))}</span>
          <span>${plural(r.rooms, 'room')}, ${plural(r.guests, 'guest')}</span>
          <span>About ${taka(r.estimatedTotal)} (${taka(r.nightlyTotal || r.pricePerNight * r.rooms)} a night)</span>
        </div>
        <ul class="req-rooms">${requestItems(r).map(i => `<li><strong>${Number(i.quantity)} × ${E(i.roomName || 'Room')}</strong> <span>${taka(i.pricePerNight)} a night each</span></li>`).join('')}</ul>
        <div class="req-facts">
          ${r.phone ? `<a href="tel:${E(r.phone)}">${E(r.phone)}</a>` : ''}
          ${r.email ? `<a href="mailto:${E(r.email)}">${E(r.email)}</a>` : ''}
          <span>Asked ${E(new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>
        </div>
        ${r.note ? `<div class="req-note">${E(r.note)}</div>` : ''}
        ${r.hotelNote ? `<div class="req-note" style="border-left-color:var(--accent)"><strong>Your reply:</strong> ${E(r.hotelNote)}</div>` : ''}
      </div>
      <div class="req-actions">
        ${r.status === 'pending' ? `
          <button class="btn btn-ok" data-action="accept" data-id="${E(r._id)}">Accept</button>
          <button class="btn btn-danger" data-action="decline" data-id="${E(r._id)}">Decline</button>` : ''}
      </div>
    </div>`;
}

function renderRequests() {
  const box = $('requestList');
  if (!state.requests.length) {
    const [title, text] = EMPTY_REQUESTS[state.requestFilter];
    box.innerHTML = `<div class="card empty"><strong>${E(title)}</strong>${E(text)}</div>`;
  } else box.innerHTML = state.requests.map(requestCard).join('');
  $('moreRequests').hidden = state.requestPage >= state.requestPages;
}

function openAnswer(id, decision) {
  const r = state.requests.find(x => x._id === id);
  if (!r) return;
  state.answering = { id, decision };
  const accept = decision === 'accept';
  $('answerTitle').textContent = accept ? 'Accept this stay' : 'Decline this stay';
  $('answerSummary').textContent = `${r.guestName || 'Guest'}: ${roomsText(r)}, ${fmtDay(r.checkIn)} to ${fmtDay(r.checkOut)} (${plural(r.nights, 'night')}), ${plural(r.guests, 'guest')}.`;
  $('answerNoteLabel').textContent = accept ? 'Message to the guest (optional)' : 'Why are you declining? *';
  $('answerHint').textContent = accept ? 'For example how to pay an advance, or directions.' : 'The guest sees this, for example "Fully booked on those dates".';
  $('answerNote').value = '';
  $('answerNote').placeholder = accept ? 'Please send a 30% advance by bKash to 01712345678 to confirm.' : 'Sorry, we are fully booked on those dates.';
  $('answerSubmit').textContent = accept ? 'Accept' : 'Decline';
  $('answerSubmit').className = `btn ${accept ? 'btn-ok' : 'btn-primary'}`;
  delete $('answerSubmit').dataset.label;
  showAlert('answerError', '');
  $('answerDialog').showModal();
  $('answerNote').focus();
}

$('answerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const { id, decision } = state.answering || {};
  const note = $('answerNote').value.trim();
  if (decision === 'decline' && !note) return showAlert('answerError', 'Tell the guest why, so they can look elsewhere.');
  const btn = $('answerSubmit');
  setBusy(btn, true, decision === 'accept' ? 'Accepting...' : 'Declining...');
  try {
    await api(`${PANEL}/requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: { decision, note } });
    $('answerDialog').close();
    toast(decision === 'accept' ? 'Stay accepted. The guest has been told.' : 'Request declined. The guest has been told.');
    await loadRequests(1);
  } catch (err) {
    showAlert('answerError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------- Rooms & rates ----------

const ROOM_BENEFITS = [
  ['breakfast', 'Breakfast included'], ['free_cancellation', 'Free cancellation'], ['pay_at_hotel', 'Pay at the hotel'],
  ['free_wifi', 'Free Wi-Fi'], ['free_parking', 'Free parking'], ['airport_pickup', 'Airport pickup'],
  ['late_checkout', 'Late check-out'], ['welcome_drink', 'Welcome drink']
];
const benefitLabel = key => (ROOM_BENEFITS.find(([k]) => k === key) || [key, key])[1];

function renderRoomBenefits(chosen = []) {
  const on = new Set(chosen);
  $('roomBenefits').innerHTML = ROOM_BENEFITS.map(([v, l]) => `<label class="chip"><input type="checkbox" value="${v}" ${on.has(v) ? 'checked' : ''}><span>${l}</span></label>`).join('');
}

function renderRooms() {
  const rooms = state.hotel ? state.hotel.roomTypes : [];
  $('roomList').innerHTML = rooms.length ? rooms.map(r => `
    <article class="room ${r.active ? '' : 'is-off'}">
      <div class="room-photo" ${r.photos[0] ? `style="background-image:url('${E(r.photos[0])}')"` : ''}>
        ${r.active ? '' : '<span class="pill pill-off">Not taking requests</span>'}
      </div>
      <div class="room-body">
        <h3>${E(r.name)}</h3>
        <div class="room-price">${taka(r.pricePerNight)}${r.regularPrice ? `<s>${taka(r.regularPrice)}</s>` : ''} <small>a night</small></div>
        <div class="room-facts">${plural(r.maxGuests, 'guest')} a room${r.beds ? ` · ${E(r.beds)}` : ''}${r.sizeSqft ? ` · ${r.sizeSqft} sq ft` : ''}</div>
        <div class="room-facts">Quantity: <strong>${plural(r.count, 'room')}</strong>${r.photos.length ? ` · ${plural(r.photos.length, 'photo')}` : ' · no photos yet'}</div>
        ${(r.benefits || []).length ? `<div class="room-facts">${r.benefits.map(b => `✓ ${E(benefitLabel(b))}`).join(' · ')}</div>` : ''}
        <div class="room-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit-room" data-id="${E(r._id)}">Edit</button>
          <button class="btn btn-ghost btn-sm" data-action="copy-room" data-id="${E(r._id)}" title="Make a new room type with the same details and photos">Copy</button>
          <button class="btn btn-ghost btn-sm" data-action="toggle-room" data-id="${E(r._id)}">${r.active ? 'Pause' : 'Take requests'}</button>
        </div>
      </div>
    </article>`).join('')
    : '<div class="card empty" style="grid-column:1/-1"><strong>No room types yet</strong>Add each kind of room you have, with its price per night, so travelers can ask for it.<div style="margin-top:14px"><button class="btn btn-primary" data-action="new-room">Add a room type</button></div></div>';
}

function renderRoomThumbs() {
  const room = state.editingRoom;
  const existing = room ? room.photos.map(url => `
    <div class="thumb ${state.removeRoomPhotos.has(url) ? 'is-removed' : ''}"><img src="${E(url)}" alt=""><button type="button" data-action="room-photo-x" data-url="${E(url)}" aria-label="${state.removeRoomPhotos.has(url) ? 'Keep' : 'Remove'} photo">${state.removeRoomPhotos.has(url) ? '↺' : '×'}</button></div>`).join('') : '';
  const fresh = state.roomFiles.map(f => `<div class="thumb"><img src="${E(URL.createObjectURL(f))}" alt=""></div>`).join('');
  $('roomThumbs').innerHTML = existing + fresh;
}

function toggleRoomPhoto(url) {
  if (state.removeRoomPhotos.has(url)) state.removeRoomPhotos.delete(url);
  else state.removeRoomPhotos.add(url);
  renderRoomThumbs();
}

function openRoom(id) {
  const room = id ? state.hotel.roomTypes.find(r => r._id === id) : null;
  state.editingRoom = room;
  state.roomFiles = [];
  state.removeRoomPhotos = new Set();
  const f = $('roomForm');
  f.reset();
  $('roomTitle').textContent = room ? `Edit ${room.name}` : 'Add a room type';
  if (room) {
    f.name.value = room.name;
    f.pricePerNight.value = room.pricePerNight;
    f.regularPrice.value = room.regularPrice || '';
    f.maxGuests.value = room.maxGuests;
    f.count.value = room.count;
    f.sizeSqft.value = room.sizeSqft || '';
    f.beds.value = room.beds || '';
    f.description.value = room.description || '';
    f.amenities.value = (room.amenities || []).join(', ');
  }
  renderRoomBenefits(room ? room.benefits : []);
  $('rActive').checked = room ? room.active : true;
  $('roomDelete').hidden = !room;
  $('rPhotos').value = '';
  renderRoomThumbs();
  showAlert('roomError', '');
  $('roomDialog').showModal();
  f.name.focus();
}

$('rPhotos').addEventListener('change', e => {
  const room = state.editingRoom;
  const kept = room ? room.photos.filter(p => !state.removeRoomPhotos.has(p)).length : 0;
  const files = [...e.target.files].filter(f => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { toast(`${f.name}: use a JPG, PNG or WebP photo.`, 'error'); return false; }
    if (f.size > 12 * 1024 * 1024) { toast(`${f.name} is over 12 MB.`, 'error'); return false; }
    return true;
  });
  state.roomFiles = [...state.roomFiles, ...files].slice(0, Math.max(0, 6 - kept));
  e.target.value = '';
  renderRoomThumbs();
});

$('roomForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  showAlert('roomError', '');
  if (!f.name.value.trim()) return showAlert('roomError', 'Name the room type, for example "Deluxe double".');
  if (!/^\d+$/.test(f.pricePerNight.value.trim())) return showAlert('roomError', 'Enter the price per night in taka, for example 3500.');
  const fd = new FormData();
  ['name', 'pricePerNight', 'regularPrice', 'maxGuests', 'count', 'sizeSqft', 'beds', 'description', 'amenities'].forEach(k => fd.append(k, f[k].value.trim()));
  fd.append('benefits', [...$('roomBenefits').querySelectorAll('input:checked')].map(i => i.value).join(','));
  fd.append('active', $('rActive').checked ? 'true' : 'false');
  state.roomFiles.forEach(file => fd.append('photos', file, file.name));
  if (state.removeRoomPhotos.size) fd.append('removePhotos', [...state.removeRoomPhotos].join(','));
  const room = state.editingRoom;
  const btn = $('roomSave');
  setBusy(btn, true);
  try {
    const { data } = await api(room ? `${PANEL}/hotel/rooms/${room._id}` : `${PANEL}/hotel/rooms`, { method: room ? 'PATCH' : 'POST', form: fd });
    setHotel(data.hotel);
    $('roomDialog').close();
    renderRooms();
    toast(room ? 'Room type saved.' : 'Room type added.');
  } catch (err) {
    showAlert('roomError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

$('roomDelete').addEventListener('click', async () => {
  const room = state.editingRoom;
  if (!room || !window.confirm(`Remove "${room.name}"? Travelers won't see it any more. Requests already made for it stay as they are.`)) return;
  try {
    const { data } = await api(`${PANEL}/hotel/rooms/${room._id}`, { method: 'DELETE' });
    setHotel(data.hotel);
    $('roomDialog').close();
    renderRooms();
    toast('Room type removed.');
  } catch (err) {
    showAlert('roomError', err.message);
  }
});

// Copy a room type with its details and photos, then open the copy to edit. It starts paused.
async function copyRoom(id, button) {
  const room = state.hotel.roomTypes.find(r => r._id === id);
  if (!room || button.disabled) return;
  button.disabled = true;
  button.textContent = 'Copying...';
  try {
    const { data } = await api(`${PANEL}/hotel/rooms/${id}/copy`, { method: 'POST' });
    setHotel(data.hotel);
    renderRooms();
    toast(`Copied ${room.name}. Edit the copy, then choose "Take requests" when it's ready.${data.photosLeftOut ? ` ${plural(data.photosLeftOut, 'photo')} couldn't be copied.` : ''}`);
    openRoom(data.roomId);
  } catch (err) {
    toast(err.message, 'error');
    button.disabled = false;
    button.textContent = 'Copy';
  }
}

async function toggleRoom(id) {
  const room = state.hotel.roomTypes.find(r => r._id === id);
  if (!room) return;
  try {
    const { data } = await api(`${PANEL}/hotel/rooms/${id}`, { method: 'PATCH', body: { active: !room.active } });
    setHotel(data.hotel);
    renderRooms();
    toast(room.active ? `${room.name} paused. Travelers can't request it.` : `${room.name} is taking requests again.`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Photos ----------

function renderPhotos() {
  const photos = state.hotel ? state.hotel.photos : [];
  $('photoGrid').innerHTML = photos.length ? photos.map((url, i) => `
    <figure class="photo">
      <img src="${E(url)}" alt="" loading="lazy">
      ${i === 0 ? '<span class="pill">Cover</span>' : ''}
      <div class="photo-actions">
        ${i === 0 ? '' : `<button class="btn btn-sm" data-action="cover" data-url="${E(url)}">Make cover</button>`}
        <button class="btn btn-sm btn-danger" data-action="remove-photo" data-url="${E(url)}">Remove</button>
      </div>
    </figure>`).join('')
    : '<div class="card empty" style="grid-column:1/-1"><strong>No photos yet</strong>Good photos of the outside, the lobby, the view and the food bring more requests.</div>';
  $('photoDrop').hidden = photos.length >= 12;
}

async function uploadPhotos(fileList) {
  const room = 12 - state.hotel.photos.length;
  const files = [...fileList].filter(f => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { toast(`${f.name}: use a JPG, PNG or WebP photo.`, 'error'); return false; }
    if (f.size > 12 * 1024 * 1024) { toast(`${f.name} is over 12 MB.`, 'error'); return false; }
    return true;
  }).slice(0, Math.min(6, room));
  if (!files.length) return;
  const fd = new FormData();
  files.forEach(f => fd.append('photos', f, f.name));
  const drop = $('photoDrop');
  const label = drop.querySelector('strong');
  label.textContent = `Uploading ${plural(files.length, 'photo')}...`;
  try {
    const { data } = await api(`${PANEL}/hotel/photos`, { method: 'POST', form: fd });
    setHotel(data.hotel);
    renderPhotos();
    toast(`${plural(files.length, 'photo')} added.`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    label.textContent = 'Add photos';
  }
}

$('photoInput').addEventListener('change', e => { uploadPhotos(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach(t => $('photoDrop').addEventListener(t, e => { e.preventDefault(); $('photoDrop').classList.add('is-over'); }));
['dragleave', 'drop'].forEach(t => $('photoDrop').addEventListener(t, () => $('photoDrop').classList.remove('is-over')));
$('photoDrop').addEventListener('drop', e => { e.preventDefault(); uploadPhotos(e.dataTransfer.files); });

async function makeCover(url) {
  try {
    const { data } = await api(`${PANEL}/hotel/photos/order`, { method: 'PUT', body: { photos: [url, ...state.hotel.photos.filter(p => p !== url)] } });
    setHotel(data.hotel);
    renderPhotos();
    toast('Cover photo changed.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removePhoto(url) {
  if (!window.confirm('Remove this photo from your listing?')) return;
  try {
    const { data } = await api(`${PANEL}/hotel/photos`, { method: 'DELETE', body: { url } });
    setHotel(data.hotel);
    renderPhotos();
    toast('Photo removed.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Details & policies ----------

function renderDetails() {
  const h = state.hotel;
  if (!h) return;
  const f = $('detailsForm');
  f.description.value = h.description || '';
  showDescriptionCount();
  f.highlights.value = (h.highlights || []).join('\n');
  f.phone.value = h.phone || '';
  f.website.value = h.website || '';
  f.address.value = h.address || '';
  f.checkIn.value = h.checkIn || '';
  f.checkOut.value = h.checkOut || '';
  f.rooms.value = h.rooms || '';
  f.pricePerNight.value = h.pricePerNight || '';
  $('basePriceField').hidden = h.roomTypes.some(r => r.active);
  const chosen = new Set(h.amenities || []);
  $('amenityChips').innerHTML = AMENITIES.map(a => `<label class="chip"><input type="checkbox" value="${E(a)}" ${chosen.has(a) ? 'checked' : ''}><span>${E(a)}</span></label>`).join('');
  $('dAmenityOther').value = (h.amenities || []).filter(a => !AMENITIES.includes(a)).join(', ');
  const p = h.policies || {};
  ['cancellation', 'children', 'pets', 'smoking', 'other'].forEach(k => { f[k].value = p[k] || ''; });
  renderDining(h);
  showAlert('detailsError', '');
}

// ---------- Food & drink, and around the hotel ----------

const MEALS = [['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks'], ['room_service', 'Room service']];
const NEARBY_KINDS = [['restaurant', 'Restaurant'], ['cafe', 'Cafe or bar'], ['grocery', 'Supermarket or grocery'], ['attraction', 'Sight or attraction'], ['transport', 'Bus, train or airport']];

function nearbyRow(n = {}) {
  const row = document.createElement('div');
  row.className = 'row row-3 nearby-row';
  row.innerHTML = `
    <div class="field"><label>What it is</label><select data-k="category">${NEARBY_KINDS.map(([v, l]) => `<option value="${v}" ${n.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Name</label><input data-k="name" type="text" maxlength="80" value="${E(n.name || '')}" placeholder="Tre Coffee"></div>
    <div class="field"><label>Distance (metres)</label><div style="display:flex;gap:8px"><input data-k="distance" type="number" min="0" max="100000" inputmode="numeric" value="${n.distance == null ? '' : E(n.distance)}" placeholder="150"><button type="button" class="btn" data-remove aria-label="Remove this place">Remove</button></div></div>`;
  row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
  return row;
}

function renderDining(h) {
  const d = h.dining || {};
  $('dBreakfast').value = d.breakfast || '';
  const photos = h.photos || [];
  $('breakfastPhotos').innerHTML = photos.length
    ? [['', 'None']].concat(photos.map(p => [p, ''])).map(([url, label]) => `<label class="chip"><input type="radio" name="breakfastPhoto" value="${E(url)}" ${(d.breakfastPhoto || '') === url ? 'checked' : ''}>${url ? `<img src="${E(url)}" alt="" style="width:56px;height:40px;object-fit:cover;border-radius:6px">` : `<span>${label}</span>`}</label>`).join('')
    : '<span class="muted">No photos yet.</span>';
  const meals = new Set(d.meals || []);
  $('mealChips').innerHTML = MEALS.map(([v, l]) => `<label class="chip"><input type="checkbox" value="${v}" ${meals.has(v) ? 'checked' : ''}><span>${l}</span></label>`).join('');
  $('dFoodFacilities').value = (d.facilities || []).join('\n');
  $('dCentre').value = h.centreDistanceKm == null ? '' : h.centreDistanceKm;
  $('nearbyRows').replaceChildren(...(h.nearby || []).map(nearbyRow));
}

$('nearbyAdd').addEventListener('click', () => {
  const row = nearbyRow();
  $('nearbyRows').append(row);
  row.querySelector('[data-k="name"]').focus();
});

function diningBody() {
  const picked = document.querySelector('#breakfastPhotos input:checked');
  return {
    dining: {
      breakfast: $('dBreakfast').value,
      breakfastPhoto: picked ? picked.value : '',
      meals: [...document.querySelectorAll('#mealChips input:checked')].map(i => i.value),
      facilities: $('dFoodFacilities').value.split('\n').map(s => s.trim()).filter(Boolean)
    },
    centreDistanceKm: $('dCentre').value.trim(),
    nearby: [...document.querySelectorAll('#nearbyRows .nearby-row')]
      .map(r => ({ category: r.querySelector('[data-k="category"]').value, name: r.querySelector('[data-k="name"]').value.trim(), distance: r.querySelector('[data-k="distance"]').value.trim() }))
      .filter(n => n.name)
  };
}

$('detailsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  showAlert('detailsError', '');
  const rooms = f.rooms.value.trim();
  if (rooms && !/^\d+$/.test(rooms)) return showAlert('detailsError', 'Enter the number of rooms as a whole number, for example 24.');
  const amenities = [
    ...[...document.querySelectorAll('#amenityChips input:checked')].map(i => i.value),
    ...$('dAmenityOther').value.split(',').map(s => s.trim()).filter(Boolean)
  ];
  const body = {
    description: f.description.value.trim(),
    highlights: f.highlights.value.split('\n').map(s => s.trim()).filter(Boolean),
    phone: f.phone.value.trim(),
    website: f.website.value.trim(),
    address: f.address.value.trim(),
    checkIn: f.checkIn.value,
    checkOut: f.checkOut.value,
    rooms,
    amenities,
    policies: Object.fromEntries(['cancellation', 'children', 'pets', 'smoking', 'other'].map(k => [k, f[k].value.trim()])),
    ...diningBody()
  };
  if (!$('basePriceField').hidden) body.pricePerNight = f.pricePerNight.value.trim();
  const btn = $('detailsSave');
  setBusy(btn, true);
  try {
    const { data } = await api(`${PANEL}/hotel`, { method: 'PATCH', body });
    setHotel(data.hotel);
    renderDetails();
    toast(state.hotel.status === 'published' ? 'Saved. Guests see the changes now.' : 'Saved.');
  } catch (err) {
    showAlert('detailsError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

// ---------- Account ----------

function loadAccount() {
  const a = state.agency;
  const f = $('profileForm');
  f.name.value = a.name || '';
  f.phone.value = a.phone || '';
  f.email.value = a.email || '';
  f.tradeLicenseNumber.value = a.tradeLicenseNumber || '';
  f.logo.value = '';
  $('logoBox').innerHTML = a.logo ? `<img src="${E(a.logo)}" alt="">` : E(initials(a.name));
  const readOnly = !isOwner();
  $('profileNote').textContent = readOnly ? 'Only the owner can change these.' : 'How Plejar knows your business. Guests see your hotel listing, not this.';
  f.querySelectorAll('input, button').forEach(el => { el.disabled = readOnly; });
  $('inviteForm').hidden = readOnly;
  $('verificationCard').hidden = readOnly;
  loadTeam();
  if (!readOnly) loadVerification();
}

$('logoInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) $('logoBox').innerHTML = `<img src="${E(URL.createObjectURL(file))}" alt="">`;
});

$('profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  showAlert('profileError', '');
  if (!f.name.value.trim()) return showAlert('profileError', 'Enter your business name.');
  const fd = new FormData();
  ['name', 'phone', 'email', 'tradeLicenseNumber'].forEach(k => fd.append(k, f[k].value.trim()));
  if (f.logo.files.length) fd.append('logo', f.logo.files[0]);
  const btn = $('profileSave');
  setBusy(btn, true);
  try {
    const { data } = await api('/api/v1/agency/me', { method: 'PATCH', form: fd });
    Object.assign(state.agency, { name: data.agency.name, logo: data.agency.logo, phone: data.agency.phone, email: data.agency.email, tradeLicenseNumber: data.agency.tradeLicenseNumber });
    renderTop();
    loadAccount();
    toast('Profile saved.');
  } catch (err) {
    showAlert('profileError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function loadTeam() {
  const body = $('teamBody');
  body.innerHTML = '<tr><td colspan="3" class="muted">Loading team...</td></tr>';
  try {
    const { data } = await api('/api/v1/agency/me/team');
    state.team = data.members;
    body.innerHTML = data.members.map(m => `
      <tr>
        <td><strong>${E(m.name)}</strong><span class="sub">${E(m.email)}</span></td>
        <td>${m.agencyRole === 'owner' ? 'Owner' : 'Team member'}${m.accountStatus === 'invited' ? '<span class="sub">Invite sent</span>' : ''}</td>
        <td>${isOwner() && m.agencyRole !== 'owner' ? `
          ${m.accountStatus === 'invited' ? `<button class="btn btn-ghost btn-sm" data-action="resend" data-id="${E(m.id)}">Resend invite</button>` : ''}
          <button class="btn btn-danger btn-sm" data-action="remove-member" data-id="${E(m.id)}">Remove</button>` : ''}</td>
      </tr>`).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="3" class="muted">${E(err.message)}</td></tr>`;
  }
}

function inviteLink(url, message) {
  return `<div class="alert alert-ok">${E(message)}<input type="text" readonly value="${E(url)}" style="margin-top:8px" onclick="this.select()"></div>`;
}

$('inviteForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  showAlert('inviteError', '');
  $('inviteResult').innerHTML = '';
  const name = f.name.value.trim();
  const email = f.email.value.trim();
  if (!name) return showAlert('inviteError', 'Enter their name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAlert('inviteError', 'Enter a valid email address.');
  const btn = $('inviteSubmit');
  setBusy(btn, true, 'Sending invite...');
  try {
    const { data, message } = await api('/api/v1/agency/me/team', { method: 'POST', body: { name, email } });
    f.reset();
    if (data.emailSent) toast(message);
    else $('inviteResult').innerHTML = inviteLink(data.inviteURL, message);
    loadTeam();
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
    else $('inviteResult').innerHTML = inviteLink(data.inviteURL, 'New invite link created. Share it with them:');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeMember(id) {
  const m = (state.team || []).find(x => x.id === id);
  if (!m || !window.confirm(`Remove ${m.name}? They will lose access to this panel.`)) return;
  try {
    await api(`/api/v1/agency/me/team/${id}`, { method: 'DELETE' });
    toast(`${m.name} removed.`);
    loadTeam();
  } catch (err) {
    toast(err.message, 'error');
  }
}

const DOC_LABELS = { trade_license: 'Trade license', nid: "Owner's national ID" };

async function loadVerification() {
  const box = $('verificationBox');
  try {
    const { data } = await api('/api/v1/agency/me/verification');
    const v = data.verification;
    const status = v.verified ? 'approved' : (v.status || 'none');
    const text = {
      approved: 'Verified. Plejar has checked your trade license and the owner\'s national ID.',
      pending: 'Plejar is checking your documents.',
      rejected: v.note || 'Plejar needs new documents. Contact us.',
      none: 'No documents on file yet. Contact Plejar to add them.'
    }[status];
    box.innerHTML = `
      <p><span class="pill pill-${E(status)}">${E({ approved: 'Verified', pending: 'In review', rejected: 'Changes needed', none: 'Not verified' }[status])}</span></p>
      <p class="muted" style="margin:10px 0">${E(text)}</p>
      <ul class="list-plain">${(v.documents || []).map(d => `
        <li><span>${E(DOC_LABELS[d.kind] || d.kind)}<span class="sub">${E(d.originalName || 'file')}</span></span><a href="/api/v1/agency/me/documents/${E(d.id)}?panel=hotel" target="_blank" rel="noopener">View</a></li>`).join('')}</ul>`;
  } catch (err) {
    box.innerHTML = `<p class="muted">${E(err.message)}</p>`;
  }
}

boot();
