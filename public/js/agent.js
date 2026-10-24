/**
 * Plezar agency panel
 */

const $ = id => document.getElementById(id);

const state = {
  token: (() => { try { return localStorage.getItem('plezar_token'); } catch (e) { return null; } })(),
  me: null,
  agency: null,
  stats: null,
  packages: [],
  team: [],
  verification: null,
  editing: null, // package being edited, or null for a new one
  removedPhotos: new Set()
};

const isOwner = () => state.me && state.me.agencyRole === 'owner';

// ---------- Helpers ----------

function escapeHTML(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
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
  $('loginView').hidden = false;
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
    if (data.data.role !== 'agent') {
      showAlert('loginError', 'This sign in is for tour agencies. Plezar staff use the admin console at /admin.');
      await api('/api/v1/users/logout').catch(() => {});
      return;
    }
    state.token = data.token;
    try { localStorage.setItem('plezar_token', data.token); } catch (err) { /* cookie still works */ }
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
  if (view === 'packages') loadPackages();
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
  if (name === 'new-package') openPackageEditor(null);
  if (name === 'edit-package') openPackageEditor(state.packages.find(p => p._id === id));
  if (name === 'delete-package') deletePackage(id);
  if (name === 'close-drawer') closePackageEditor();
  if (name === 'go') showView(action.dataset.view);
  if (name === 'resend') resendInvite(id);
  if (name === 'remove-member') removeMember(id);
  if (name === 'copy') copyField(action.dataset.target);
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

  $('loginView').hidden = true;
  $('panelView').hidden = false;
  document.querySelectorAll('[data-owner-only]').forEach(el => { el.hidden = !isOwner(); });
  renderSide();
  renderOverview();
  renderProfileForm();

  const start = (window.location.hash || '#overview').slice(1);
  showView(['overview', 'profile', 'packages', 'team', 'verification'].includes(start) ? start : 'overview');
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
    <div><strong>${escapeHTML(a.name)}</strong><small>${a.verified ? 'Verified agency' : 'Not verified yet'}</small></div>
  `;
  $('sideUserName').textContent = state.me.name;
  $('sideUserRole').textContent = isOwner() ? 'Owner' : 'Team member';
}

// ---------- Overview ----------

function renderOverview() {
  const a = state.agency;
  const s = state.stats;
  $('overviewTitle').textContent = `Welcome, ${state.me.name.split(' ')[0]}`;
  $('statPublished').textContent = s.packages.published;
  $('statDraft').textContent = s.packages.draft;
  $('statHidden').textContent = s.packages.hidden;
  $('statTeam').textContent = s.teamSize;

  const v = a.verification || { status: 'none' };
  let callout = '';
  if (a.verified) {
    callout = '<div class="callout callout-ok"><div><strong>Your agency is verified</strong>Travelers see the verified mark on your profile and packages.</div></div>';
  } else if (v.status === 'pending') {
    callout = '<div class="callout callout-warn"><div><strong>Verification in review</strong>Plezar is checking your documents. This usually takes 1 to 2 working days.</div></div>';
  } else if (v.status === 'rejected') {
    callout = `<div class="callout callout-error"><div><strong>Verification needs changes</strong>${escapeHTML(v.note || 'Check your documents and submit again.')}</div>${isOwner() ? '<button class="btn btn-quiet btn-sm" data-action="go" data-view="verification">Update documents</button>' : ''}</div>`;
  } else if (isOwner()) {
    callout = '<div class="callout callout-warn"><div><strong>Get the verified mark</strong>Upload your trade license and NID so travelers know your agency is real.</div><button class="btn btn-quiet btn-sm" data-action="go" data-view="verification">Start verification</button></div>';
  }
  $('overviewCallout').innerHTML = callout;

  const checks = [
    { done: Boolean(a.logo), label: 'Add a logo', view: 'profile' },
    { done: Boolean(a.description && a.description.length >= 40), label: 'Describe your agency', view: 'profile' },
    { done: a.regions && a.regions.length > 0, label: 'List the places you run tours', view: 'profile' },
    { done: Boolean(a.phone), label: 'Add a phone number', view: 'profile' },
    { done: s.packages.published > 0, label: 'Publish your first tour package', view: 'packages' }
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
  form.description.value = a.description || '';
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

  const btn = $('profileSave');
  setBusy(btn, true);
  try {
    const { data } = await api('/api/v1/agency/me', { method: 'PATCH', form: fd });
    state.agency = data.agency;
    form.logo.value = '';
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

// ---------- Packages ----------

async function refreshStats() {
  try {
    const { data } = await api('/api/v1/agency/me');
    state.stats = data.stats;
    renderOverview();
  } catch (e) { /* stats refresh is best effort */ }
}

async function loadPackages() {
  $('packageList').innerHTML = '<p class="muted">Loading packages...</p>';
  try {
    const { data } = await api('/api/v1/agency/me/packages');
    state.packages = data.packages;
    renderPackages();
  } catch (err) {
    $('packageList').innerHTML = `<div class="alert alert-error">${escapeHTML(err.message)}</div>`;
  }
}

function renderPackages() {
  if (!state.packages.length) {
    $('packageList').innerHTML = `
      <div class="empty">
        <strong>No tour packages yet</strong>
        Add your first package with photos, price and what's included.
        <div style="margin-top: 14px;"><button class="btn btn-primary" data-action="new-package">Add a tour package</button></div>
      </div>`;
    return;
  }

  $('packageList').innerHTML = `<div class="pkg-grid">${state.packages.map(p => `
    <article class="pkg">
      ${p.photos[0] ? `<img class="pkg-photo" src="${escapeHTML(p.photos[0])}" alt="" loading="lazy">` : '<div class="pkg-photo pkg-photo-empty">No photo yet</div>'}
      <div class="pkg-body">
        <div class="pkg-top"><h3>${escapeHTML(p.title)}</h3><span class="badge badge-${escapeHTML(p.status)}">${escapeHTML(p.status)}</span></div>
        <div class="pkg-meta">${escapeHTML(p.destination)}, ${p.durationDays} day${p.durationDays === 1 ? '' : 's'}${p.durationNights ? ` ${p.durationNights} night${p.durationNights === 1 ? '' : 's'}` : ''}</div>
        <div class="pkg-price">From ${taka(p.priceFrom)}</div>
        ${p.hiddenByAdmin ? '<div class="pkg-note">Hidden by Plezar</div>' : ''}
        <div class="pkg-actions">
          <button class="btn btn-quiet btn-sm" data-action="edit-package" data-id="${escapeHTML(p._id)}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="delete-package" data-id="${escapeHTML(p._id)}">Delete</button>
        </div>
      </div>
    </article>`).join('')}</div>`;
}

function renderEditorPhotos() {
  const pkg = state.editing;
  const photos = pkg ? pkg.photos : [];
  $('pkPhotos').innerHTML = photos.map(url => `
    <div class="photo-thumb ${state.removedPhotos.has(url) ? 'is-removed' : ''}">
      <img src="${escapeHTML(url)}" alt="">
      <button type="button" data-photo="${escapeHTML(url)}" aria-label="${state.removedPhotos.has(url) ? 'Keep photo' : 'Remove photo'}">${state.removedPhotos.has(url) ? '↺' : '×'}</button>
    </div>`).join('');
}

$('pkPhotos').addEventListener('click', e => {
  const btn = e.target.closest('[data-photo]');
  if (!btn) return;
  const url = btn.dataset.photo;
  if (state.removedPhotos.has(url)) state.removedPhotos.delete(url);
  else state.removedPhotos.add(url);
  renderEditorPhotos();
});

function openPackageEditor(pkg) {
  state.editing = pkg || null;
  state.removedPhotos = new Set();
  const form = $('packageForm');
  form.reset();
  showAlert('packageError', '');
  $('packageFormTitle').textContent = pkg ? 'Edit tour package' : 'New tour package';
  $('packageHiddenNote').hidden = !(pkg && pkg.hiddenByAdmin);
  if (pkg) {
    form.title.value = pkg.title;
    form.destination.value = pkg.destination;
    form.durationDays.value = pkg.durationDays;
    form.durationNights.value = pkg.durationNights || 0;
    form.priceFrom.value = pkg.priceFrom;
    form.description.value = pkg.description || '';
    form.included.value = (pkg.included || []).join('\n');
    form.status.value = pkg.status;
  } else {
    form.durationDays.value = 2;
    form.durationNights.value = 1;
    form.status.value = 'draft';
  }
  form.status.querySelector('option[value="published"]').disabled = Boolean(pkg && pkg.hiddenByAdmin);
  renderEditorPhotos();
  $('packageDrawer').hidden = false;
  form.title.focus();
}

function closePackageEditor() {
  $('packageDrawer').hidden = true;
  state.editing = null;
}

$('packageDrawer').addEventListener('click', e => {
  if (e.target === $('packageDrawer')) closePackageEditor();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('packageDrawer').hidden) closePackageEditor();
});

$('packageForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  showAlert('packageError', '');

  if (!form.title.value.trim()) return showAlert('packageError', 'Enter a title.');
  if (!form.destination.value.trim()) return showAlert('packageError', 'Enter the destination.');
  if (!(Number(form.durationDays.value) >= 1)) return showAlert('packageError', 'Enter how many days the trip lasts.');
  if (form.priceFrom.value === '' || Number(form.priceFrom.value) < 0) return showAlert('packageError', 'Enter the starting price in taka.');

  const newFiles = Array.from($('pkPhotoInput').files);
  const kept = state.editing ? state.editing.photos.filter(p => !state.removedPhotos.has(p)).length : 0;
  if (kept + newFiles.length > 6) return showAlert('packageError', `A package can have 6 photos. Remove ${kept + newFiles.length - 6} and try again.`);

  const fd = new FormData();
  ['title', 'destination', 'durationDays', 'durationNights', 'priceFrom', 'description', 'status'].forEach(f => fd.append(f, form[f].value.trim()));
  fd.append('included', form.included.value.split('\n').map(s => s.trim()).filter(Boolean).join('\n'));
  newFiles.forEach(f => fd.append('photos', f));
  if (state.editing && state.removedPhotos.size) fd.append('removePhotos', Array.from(state.removedPhotos).join(','));

  const btn = $('packageSave');
  setBusy(btn, true);
  try {
    if (state.editing) {
      await api(`/api/v1/agency/me/packages/${state.editing._id}`, { method: 'PATCH', form: fd });
      toast('Package saved.');
    } else {
      await api('/api/v1/agency/me/packages', { method: 'POST', form: fd });
      toast('Package added.');
    }
    closePackageEditor();
    await loadPackages();
    refreshStats();
    if ($('view-packages').hidden) showView('packages');
  } catch (err) {
    showAlert('packageError', err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function deletePackage(id) {
  const pkg = state.packages.find(p => p._id === id);
  if (!pkg || !window.confirm(`Delete "${pkg.title}"? Its photos will be deleted too. This can't be undone.`)) return;
  try {
    await api(`/api/v1/agency/me/packages/${id}`, { method: 'DELETE' });
    toast('Package deleted.');
    await loadPackages();
    refreshStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

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
    pending: `<div class="callout callout-warn"><div><strong>In review</strong>Submitted ${escapeHTML(fmtDate(v.submittedAt))}. Plezar usually reviews documents within 1 to 2 working days.</div></div>`,
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

boot();
