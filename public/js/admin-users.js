/**
 * Plezar admin - Users section: list and filters, verification queue, complaints,
 * reviews, login history, activity, and the full user profile page.
 * Depends on helpers from admin.js (adminFetch, escapeHTML, showAdminToast, switchTab, openModal...).
 */

const U = {
  sub: 'all',
  page: 1,
  detail: null, // { user, counts } for the open profile
  tab: 'overview',
  loaded: {},
  complaints: new Map(),
  reasonHandler: null
};

// ---------- Small helpers ----------

const takaFmt = n => `৳${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(n) || 0)}`;
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const E = escapeHTML;
const isMoneyAdmin = () => adminState.currentUser && ['admin', 'dev'].includes(adminState.currentUser.role);

const makeDebounce = (fn, ms = 300) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

const queryString = obj => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) p.set(k, v); });
  return p.toString();
};

const val = id => (document.getElementById(id) ? document.getElementById(id).value : '');

function tableMessage(tbodyId, cols, text, isError) {
  const tbody = document.getElementById(tbodyId);
  if (tbody) tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center; padding: 28px; color: ${isError ? 'var(--color-danger)' : 'var(--text-dim)'};">${E(text)}</td></tr>`;
}

function renderPager(id, meta, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!meta || !meta.total) { el.innerHTML = ''; return; }
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  el.innerHTML = `
    <span>${from}–${to} of ${new Intl.NumberFormat('en-US').format(meta.total)}</span>
    <div>
      <button class="btn btn-secondary btn-sm" ${meta.page <= 1 ? 'disabled' : ''} onclick="${fn}(${meta.page - 1})">← Previous</button>
      <span class="pager-page">Page ${meta.page} of ${meta.pages}</span>
      <button class="btn btn-secondary btn-sm" ${meta.page >= meta.pages ? 'disabled' : ''} onclick="${fn}(${meta.page + 1})">Next →</button>
    </div>`;
}

function avatarOf(name, size = 36) {
  return `<span class="user-cell-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${E((name || '?').charAt(0).toUpperCase())}</span>`;
}

function standingBadges(u) {
  const b = [];
  if (u.deleted) b.push('<span class="badge badge-admin">Deleted</span>');
  else if (u.status === 'suspended') b.push('<span class="badge badge-admin">Suspended</span>');
  else if (u.status === 'deactivated') b.push('<span class="badge badge-inactive">Deactivated</span>');
  else if (u.accountStatus === 'invited') b.push('<span class="badge badge-manager">Invited</span>');
  else b.push('<span class="badge badge-active">Active</span>');
  const r = u.restrictions || {};
  if (r.booking || r.reviews || r.messaging) b.push('<span class="badge badge-manager">Restricted</span>');
  const v = (u.verification || {}).status;
  if (v === 'approved') b.push('<span class="badge badge-active">ID verified</span>');
  else if (v === 'pending') b.push('<span class="badge badge-manager">ID pending</span>');
  else if (v === 'rejected') b.push('<span class="badge badge-admin">ID rejected</span>');
  return b.join(' ');
}

const BOOKING_BADGE = { pending: 'badge-manager', confirmed: 'badge-user', completed: 'badge-active', cancelled: 'badge-inactive' };
const PAY_LABEL = { unpaid: 'Unpaid', paid: 'Paid', partially_refunded: 'Part refunded', refunded: 'Refunded' };
const COMPLAINT_BADGE = { open: 'badge-manager', in_review: 'badge-user', resolved: 'badge-active', dismissed: 'badge-inactive' };
const PRIORITY_BADGE = { high: 'badge-admin', normal: 'badge-inactive', low: 'badge-inactive' };
const label = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const LOGIN_REASON = {
  wrong_password: 'Wrong password', unknown_email: 'No account with this email', invite_not_accepted: 'Invite not accepted',
  blocked_suspended: 'Blocked: suspended', blocked_deactivated: 'Blocked: deactivated', blocked_deleted: 'Blocked: deleted', agency_not_active: 'Agency not active'
};
const USER_DOC_LABELS = { nid: 'National ID', passport: 'Passport', driving_license: 'Driving license', selfie: 'Selfie' };

function shortAgent(ua) {
  const s = String(ua || '');
  if (!s) return '—';
  const browser = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : /okhttp|Dart|CFNetwork/i.test(s) ? 'Mobile app' : 'Other';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Mac OS X/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

// ---------- Sub-tabs ----------

const SUB_LOADERS = {
  all: () => loadUsers(U.page),
  verification: () => loadVerificationQueue(),
  complaints: () => loadComplaints(),
  reviews: () => loadReviews(),
  logins: () => loadLogins(),
  activity: () => loadActivity()
};

function switchSub(name) {
  U.sub = name;
  document.querySelectorAll('#tab-users .subtab').forEach(b => {
    const on = b.dataset.sub === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('#tab-users .subpane').forEach(p => p.classList.toggle('active', p.id === `sub-${name}`));
  if (SUB_LOADERS[name]) SUB_LOADERS[name]();
}

document.querySelectorAll('#tab-users .subtab').forEach(btn => {
  btn.addEventListener('click', () => switchSub(btn.dataset.sub));
});

// Re-fetch whatever Users screen is showing (called after create, role change and similar)
function refreshUsersViews() {
  loadUserSummary();
  if (document.getElementById('tab-userDetail').classList.contains('active') && U.detail) reloadUser();
  else if (SUB_LOADERS[U.sub]) SUB_LOADERS[U.sub]();
}

// ---------- Summary chips and sidebar badges ----------

async function loadUserSummary() {
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/users/summary');
    if (!ok) return;
    const s = data.data.summary;
    const chips = [
      ['total', 'All accounts', s.total], ['active', 'Active', s.active], ['suspended', 'Suspended', s.suspended],
      ['deactivated', 'Deactivated', s.deactivated], ['pendingVerification', 'Awaiting ID review', s.pendingVerification],
      ['restricted', 'Restricted', s.restricted], ['deleted', 'Deleted', s.deleted]
    ];
    const box = document.getElementById('userChips');
    if (box) {
      box.innerHTML = chips.map(([key, text, n]) => `<button type="button" class="chip" onclick="applyChip('${key}')"><strong>${new Intl.NumberFormat('en-US').format(n)}</strong> ${E(text)}</button>`).join('');
    }
    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = n; el.hidden = !n; }
    };
    setBadge('subVerifyCount', s.pendingVerification);
    setBadge('subComplaintCount', s.openComplaints);
    setBadge('usersAttentionCount', s.pendingVerification + s.openComplaints);
  } catch (e) { /* badges are informational */ }
}

function applyChip(key) {
  ['uSearch', 'uRole', 'uStatus', 'uVerif', 'uDeleted'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('uRestricted').checked = false;
  if (key === 'active' || key === 'suspended' || key === 'deactivated') document.getElementById('uStatus').value = key;
  if (key === 'pendingVerification') document.getElementById('uVerif').value = 'pending';
  if (key === 'restricted') document.getElementById('uRestricted').checked = true;
  if (key === 'deleted') document.getElementById('uDeleted').value = 'only';
  loadUsers(1);
}

// ---------- All users ----------

const debouncedUsers = makeDebounce(() => loadUsers(1));

async function loadUsers(page = 1) {
  U.page = page;
  tableMessage('usersTableBody', 6, 'Loading accounts...');
  const q = queryString({
    search: val('uSearch').trim(), role: val('uRole'), status: val('uStatus'), verification: val('uVerif'),
    deleted: val('uDeleted'), sort: val('uSort'), restricted: document.getElementById('uRestricted')?.checked ? 'true' : '', page, limit: 20
  });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/users?${q}`);
    if (!ok) return tableMessage('usersTableBody', 6, data.message || 'Could not load users.', true);
    const { users } = data.data;
    renderPager('usersPager', data.data, 'loadUsers');
    if (!users.length) return tableMessage('usersTableBody', 6, 'No accounts match these filters.');

    document.getElementById('usersTableBody').innerHTML = users.map(u => `
      <tr class="${u.deleted ? 'row-muted' : ''}">
        <td><div class="user-cell">${avatarOf(u.name)}<div class="user-cell-info">
          <span class="user-cell-name">${E(u.name) || 'Unnamed'}</span>
          <span class="user-cell-email">${E(u.email)}${u.phone ? ` · ${E(u.phone)}` : ''}</span></div></div></td>
        <td><span class="badge badge-${E(u.role)}">${E(u.role)}${u.role === 'agent' && u.agencyRole ? ` · ${E(u.agencyRole)}` : ''}</span></td>
        <td class="standing">${standingBadges(u)}</td>
        <td style="color: var(--text-muted); font-size: 0.85rem;">${u.lastLoginAt ? E(fmtDate(u.lastLoginAt)) : 'Never'}</td>
        <td style="color: var(--text-muted); font-size: 0.85rem;">${E(fmtDate(u.joinedAt))}</td>
        <td style="text-align: right;"><button class="btn btn-secondary btn-sm" onclick="openUser('${E(u.id)}')">Open</button></td>
      </tr>`).join('');
  } catch (e) {
    tableMessage('usersTableBody', 6, 'Failed to load users.', true);
  }
  loadUserSummary();
}

// ---------- Verification queue ----------

async function loadVerificationQueue(page = 1) {
  tableMessage('verifyTableBody', 5, 'Loading...');
  const q = queryString({ verification: val('vStatus') || 'pending', sort: 'submitted', page, limit: 20 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/users?${q}`);
    if (!ok) return tableMessage('verifyTableBody', 5, data.message || 'Could not load the queue.', true);
    renderPager('verifyPager', data.data, 'loadVerificationQueue');
    if (!data.data.users.length) return tableMessage('verifyTableBody', 5, 'Nobody is waiting. Submitted documents will appear here.');
    document.getElementById('verifyTableBody').innerHTML = data.data.users.map(u => `
      <tr>
        <td><div class="user-cell">${avatarOf(u.name)}<div class="user-cell-info"><span class="user-cell-name">${E(u.name)}</span><span class="user-cell-email">${E(u.email)}</span></div></div></td>
        <td>${u.verification.documents.map(d => `<span class="badge badge-inactive" style="margin-right:4px">${E(USER_DOC_LABELS[d.kind] || d.kind)}</span>`).join('') || '—'}</td>
        <td>${E(fmtDate(u.verification.submittedAt))}</td>
        <td>${standingBadges(u)}</td>
        <td style="text-align: right;"><button class="btn btn-primary btn-sm" onclick="openUser('${E(u.id)}', 'documents')">Review</button></td>
      </tr>`).join('');
  } catch (e) {
    tableMessage('verifyTableBody', 5, 'Failed to load the queue.', true);
  }
}

// ---------- Complaints ----------

const debouncedComplaints = makeDebounce(() => loadComplaints(1));

async function loadComplaints(page = 1) {
  tableMessage('complaintsTableBody', 7, 'Loading...');
  const q = queryString({ status: val('cStatus'), category: val('cCategory'), priority: val('cPriority'), search: val('cSearch').trim(), page, limit: 20 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/complaints?${q}`);
    if (!ok) return tableMessage('complaintsTableBody', 7, data.message || 'Could not load complaints.', true);
    renderPager('complaintsPager', data.data, 'loadComplaints');
    data.data.complaints.forEach(c => U.complaints.set(c._id, c));
    if (!data.data.complaints.length) return tableMessage('complaintsTableBody', 7, 'No complaints match these filters.');
    document.getElementById('complaintsTableBody').innerHTML = data.data.complaints.map(c => `
      <tr>
        <td><span class="lead-main">${E(c.subject)}</span><span class="lead-sub">${E(label(c.category))} · ${E(c.message.slice(0, 80))}${c.message.length > 80 ? '…' : ''}</span></td>
        <td>${c.reporter ? `<a href="#" onclick="event.preventDefault(); openUser('${E(c.reporter._id)}')">${E(c.reporter.name)}</a><span class="lead-sub">${E(c.reporter.email)}</span>` : '—'}</td>
        <td>${c.againstAgency ? E(c.againstAgency.name) : (c.againstUser ? E(c.againstUser.name) : '—')}${c.booking ? `<span class="lead-sub">${E(c.booking.reference)}</span>` : ''}</td>
        <td><span class="badge ${PRIORITY_BADGE[c.priority]}">${E(c.priority)}</span></td>
        <td><span class="badge ${COMPLAINT_BADGE[c.status]}">${E(label(c.status))}</span></td>
        <td style="white-space: nowrap;">${E(fmtDate(c.createdAt))}</td>
        <td style="text-align: right;"><button class="btn btn-secondary btn-sm" onclick="openComplaint('${E(c._id)}')">Open</button></td>
      </tr>`).join('');
  } catch (e) {
    tableMessage('complaintsTableBody', 7, 'Failed to load complaints.', true);
  }
}

function openComplaint(id) {
  const c = U.complaints.get(id);
  if (!c) return;
  const reporter = c.reporter || {};
  document.getElementById('complaintBody').innerHTML = `
    <div class="complaint-meta">
      <span class="badge ${COMPLAINT_BADGE[c.status]}">${E(label(c.status))}</span>
      <span class="badge ${PRIORITY_BADGE[c.priority]}">${E(c.priority)} priority</span>
      <span class="badge badge-inactive">${E(label(c.category))}</span>
    </div>
    <h4 class="complaint-subject">${E(c.subject)}</h4>
    <p class="complaint-text">${E(c.message)}</p>
    <dl class="complaint-facts">
      <div><dt>Reported by</dt><dd>${reporter._id ? `<a href="#" onclick="event.preventDefault(); closeModal('complaintModal'); openUser('${E(reporter._id)}')">${E(reporter.name)}</a> (${E(reporter.email || '')})` : '—'}</dd></div>
      <div><dt>About</dt><dd>${c.againstAgency ? E(c.againstAgency.name) : (c.againstUser ? E(c.againstUser.name) : '—')}</dd></div>
      <div><dt>Booking</dt><dd>${c.booking ? `${E(c.booking.reference)} · ${E(c.booking.packageTitle || '')}` : '—'}</dd></div>
      <div><dt>Received</dt><dd>${E(fmtDateTime(c.createdAt))}</dd></div>
    </dl>
    <form onsubmit="saveComplaint(event, '${E(c._id)}')" novalidate>
      <div class="detail-two">
        <div class="form-group"><label class="form-label" for="cmStatus">Status</label>
          <select id="cmStatus" class="form-select">${['open', 'in_review', 'resolved', 'dismissed'].map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="cmPriority">Priority</label>
          <select id="cmPriority" class="form-select">${['low', 'normal', 'high'].map(s => `<option value="${s}" ${c.priority === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label class="form-label" for="cmResolution">Resolution (shown to the traveler; required to resolve or dismiss)</label>
        <textarea id="cmResolution" class="form-input" rows="3" maxlength="1000">${E(c.resolution)}</textarea></div>
      <div class="form-group"><label class="form-label" for="cmNote">Internal note (only admins see this)</label>
        <textarea id="cmNote" class="form-input" rows="2" maxlength="1000">${E(c.internalNote)}</textarea></div>
      <div class="form-error-box" id="complaintError" role="alert" hidden></div>
      <button type="submit" class="btn btn-primary" id="complaintSave">Save changes</button>
    </form>`;
  openModal('complaintModal');
}

async function saveComplaint(e, id) {
  e.preventDefault();
  const err = document.getElementById('complaintError');
  err.hidden = true;
  const btn = document.getElementById('complaintSave');
  btn.disabled = true;
  try {
    const body = { status: val('cmStatus'), priority: val('cmPriority'), resolution: val('cmResolution'), internalNote: val('cmNote') };
    const { ok, data } = await adminFetch(`/api/v1/admin/complaints/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!ok) { err.textContent = data.message || 'Could not save.'; err.hidden = false; return; }
    closeModal('complaintModal');
    showAdminToast('Complaint updated.', 'success');
    refreshUsersViews();
  } catch (x) {
    err.textContent = 'Could not reach the server.'; err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

// ---------- Reviews ----------

const debouncedReviews = makeDebounce(() => loadReviews(1));

function reviewRows(reviews, withUser = true) {
  return reviews.map(r => `
    <tr class="${r.status === 'hidden' ? 'row-muted' : ''}">
      ${withUser ? `<td>${r.user ? `<a href="#" onclick="event.preventDefault(); openUser('${E(r.user._id)}')">${E(r.user.name)}</a><span class="lead-sub">${E(r.user.email)}</span>` : '—'}</td>` : ''}
      <td>${r.agency ? E(r.agency.name) : '—'}<span class="lead-sub">${r.booking ? `${E(r.booking.packageTitle || '')} · ${E(r.booking.reference || '')}` : ''}</span></td>
      <td><span class="stars" aria-label="${r.rating} out of 5">${stars(r.rating)}</span></td>
      <td><div class="lead-message">${E(r.comment) || '—'}</div>${r.status === 'hidden' ? `<span class="lead-sub">Hidden: ${E(r.hiddenReason)}</span>` : ''}</td>
      <td style="white-space: nowrap;">${E(fmtDate(r.createdAt))}</td>
      <td style="text-align: right;">${r.status === 'hidden'
        ? `<button class="btn btn-secondary btn-sm" onclick="restoreReview('${E(r._id)}')">Make visible</button>`
        : `<button class="btn btn-danger btn-sm" onclick="hideReview('${E(r._id)}')">Hide</button>`}</td>
    </tr>`).join('');
}

async function loadReviews(page = 1) {
  tableMessage('reviewsTableBody', 6, 'Loading...');
  const q = queryString({ status: val('rStatus'), rating: val('rRating'), search: val('rSearch').trim(), page, limit: 20 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/reviews?${q}`);
    if (!ok) return tableMessage('reviewsTableBody', 6, data.message || 'Could not load reviews.', true);
    renderPager('reviewsPager', data.data, 'loadReviews');
    if (!data.data.reviews.length) return tableMessage('reviewsTableBody', 6, 'No reviews match these filters.');
    document.getElementById('reviewsTableBody').innerHTML = reviewRows(data.data.reviews);
  } catch (e) {
    tableMessage('reviewsTableBody', 6, 'Failed to load reviews.', true);
  }
}

function hideReview(id) {
  askReason({
    title: 'Hide this review', lead: 'Hidden reviews no longer count towards the agency rating or show to travelers.',
    label: 'Reason', confirmLabel: 'Hide review',
    onSubmit: async reason => {
      const { ok, data } = await adminFetch(`/api/v1/admin/reviews/${id}`, { method: 'PATCH', body: JSON.stringify({ hidden: true, reason }) });
      if (!ok) throw new Error(data.message || 'Could not hide the review.');
      showAdminToast('Review hidden.', 'info');
      refreshAfterReview();
    }
  });
}

async function restoreReview(id) {
  const { ok, data } = await adminFetch(`/api/v1/admin/reviews/${id}`, { method: 'PATCH', body: JSON.stringify({ hidden: false }) });
  if (!ok) return showAdminToast(data.message || 'Could not restore the review.', 'error');
  showAdminToast('Review is visible again.', 'success');
  refreshAfterReview();
}

function refreshAfterReview() {
  if (typeof refreshVendorReviews === 'function') refreshVendorReviews();
  if (document.getElementById('tab-userDetail').classList.contains('active') && U.tab === 'reviews') renderUserTab('reviews');
  if (document.getElementById('sub-reviews').classList.contains('active')) loadReviews();
}

// ---------- Login history and activity (all users) ----------

const debouncedLogins = makeDebounce(() => loadLogins(1));
const debouncedActivity = makeDebounce(() => loadActivity(1));

function loginRows(events, withAccount = true) {
  return events.map(ev => `
    <tr>
      <td style="white-space: nowrap;">${E(fmtDateTime(ev.createdAt))}</td>
      ${withAccount ? `<td>${ev.user ? `<a href="#" onclick="event.preventDefault(); openUser('${E(ev.user._id)}')">${E(ev.user.name)}</a><span class="lead-sub">${E(ev.email)}</span>` : `<span class="lead-main">${E(ev.email) || 'Unknown'}</span><span class="lead-sub">No matching account</span>`}</td>` : ''}
      <td>${ev.success ? '<span class="badge badge-active">Signed in</span>' : `<span class="badge badge-admin">Failed</span><span class="lead-sub">${E(LOGIN_REASON[ev.reason] || ev.reason || '')}</span>`}</td>
      <td>${E(label(ev.method))}</td>
      <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem;">${E(ev.ip) || '—'}</td>
      <td>${E(shortAgent(ev.userAgent))}</td>
    </tr>`).join('');
}

async function loadLogins(page = 1) {
  tableMessage('loginsTableBody', 6, 'Loading...');
  const q = queryString({ success: val('lSuccess'), search: val('lSearch').trim(), page, limit: 30 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/logins?${q}`);
    if (!ok) return tableMessage('loginsTableBody', 6, data.message || 'Could not load sign-ins.', true);
    renderPager('loginsPager', data.data, 'loadLogins');
    if (!data.data.events.length) return tableMessage('loginsTableBody', 6, 'No sign-ins match these filters.');
    document.getElementById('loginsTableBody').innerHTML = loginRows(data.data.events);
  } catch (e) {
    tableMessage('loginsTableBody', 6, 'Failed to load sign-ins.', true);
  }
}

async function loadActivity(page = 1) {
  tableMessage('activityTableBody', 5, 'Loading...');
  const q = queryString({ search: val('aSearch').trim(), page, limit: 30 });
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/activity?${q}`);
    if (!ok) return tableMessage('activityTableBody', 5, data.message || 'Could not load activity.', true);
    renderPager('activityPager', data.data, 'loadActivity');
    if (!data.data.entries.length) return tableMessage('activityTableBody', 5, 'No activity recorded yet.');
    document.getElementById('activityTableBody').innerHTML = data.data.entries.map(a => `
      <tr>
        <td style="white-space: nowrap;">${E(fmtDateTime(a.createdAt))}</td>
        <td>${E(a.summary)}</td>
        <td>${a.user ? `<a href="#" onclick="event.preventDefault(); openUser('${E(a.user._id)}')">${E(a.user.name)}</a>` : '—'}</td>
        <td>${a.agency ? E(a.agency.name) : '—'}</td>
        <td>${E(a.actorName) || 'System'}${a.actorRole ? `<span class="lead-sub">${E(a.actorRole)}</span>` : ''}</td>
      </tr>`).join('');
  } catch (e) {
    tableMessage('activityTableBody', 5, 'Failed to load activity.', true);
  }
}

// ---------- User profile ----------

async function openUser(id, tab = 'overview') {
  switchTab('userDetail');
  const box = document.getElementById('userDetail');
  box.innerHTML = '<p style="color: var(--text-dim); padding: 24px;">Loading profile...</p>';
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/users/${id}`);
    if (!ok) {
      box.innerHTML = `<p style="color: var(--color-danger); padding: 24px;">${E(data.message || 'Could not load this user.')}</p>`;
      return;
    }
    U.detail = data.data;
    U.loaded = {};
    renderUserDetail(tab);
  } catch (e) {
    box.innerHTML = '<p style="color: var(--color-danger); padding: 24px;">Failed to load this user.</p>';
  }
}

async function reloadUser() {
  if (!U.detail) return;
  const tab = U.tab;
  const { ok, data } = await adminFetch(`/api/v1/admin/users/${U.detail.user.id}`);
  if (!ok) return;
  U.detail = data.data;
  U.loaded = {};
  renderUserDetail(tab);
}

function userActionButtons(u) {
  const me = adminState.currentUser || {};
  const self = String(me._id || me.id) === String(u.id);
  const managerBlocked = me.role === 'manager' && u.role !== 'user';
  if (self || managerBlocked) return '<span class="detail-muted" style="margin:0">You can view this account but not change it.</span>';

  const id = E(u.id);
  if (u.deleted) {
    return `<button class="btn btn-primary" onclick="restoreUser('${id}')">Restore account</button>
      ${isMoneyAdmin() ? `<button class="btn btn-danger" onclick="permanentlyDeleteUser('${id}')">Delete permanently</button>` : ''}`;
  }
  const status = u.status === 'active'
    ? '<button class="btn btn-danger" onclick="openStatusModal()">Suspend or deactivate</button>'
    : '<button class="btn btn-primary" onclick="reactivateUser()">Reactivate</button>';
  return `${status}
    <button class="btn btn-secondary" onclick="openRestrictModal()">Restrictions</button>
    ${u.role !== 'agent' ? '<button class="btn btn-secondary" onclick="openRoleForOpenUser()">Change role</button>' : ''}
    <button class="btn btn-secondary" onclick="openResetForOpenUser()">Reset password</button>
    ${u.role !== 'agent' ? '<button class="btn btn-danger" onclick="openDeleteModal()">Delete account</button>' : ''}`;
}

const USER_TABS = [
  ['overview', 'Overview'], ['bookings', 'Bookings'], ['wallet', 'Wallet'], ['documents', 'Documents'],
  ['reviews', 'Reviews'], ['complaints', 'Complaints'], ['activity', 'Activity'], ['logins', 'Login history']
];

function renderUserDetail(tab = 'overview') {
  const { user: u, counts } = U.detail;
  document.getElementById('userDetail').innerHTML = `
    <div class="profile-head">
      <button class="btn btn-secondary btn-sm" onclick="switchTab('users'); refreshUsersViews();">&larr; All users</button>
      <div class="profile-id">
        ${avatarOf(u.name, 56)}
        <div>
          <h2>${E(u.name)}</h2>
          <p>${E(u.email)}${u.phone ? ` · ${E(u.phone)}` : ''}</p>
          <p class="profile-badges"><span class="badge badge-${E(u.role)}">${E(u.role)}${u.agencyRole ? ` · ${E(u.agencyRole)}` : ''}</span> ${standingBadges(u)}</p>
        </div>
      </div>
      <div class="profile-actions">${userActionButtons(u)}</div>
    </div>
    <div class="subtabs" role="tablist" aria-label="User profile sections">
      ${USER_TABS.map(([key, text]) => `<button type="button" role="tab" class="subtab ${key === tab ? 'active' : ''}" data-utab="${key}" aria-selected="${key === tab}" onclick="renderUserTab('${key}')">${text}${key === 'bookings' && counts.bookings ? ` <span class="mini-count">${counts.bookings}</span>` : ''}${key === 'documents' && u.verification.status === 'pending' ? ' <span class="mini-count">1</span>' : ''}${key === 'complaints' && (counts.complaintsMade + counts.complaintsAgainst) ? ` <span class="mini-count">${counts.complaintsMade + counts.complaintsAgainst}</span>` : ''}</button>`).join('')}
    </div>
    <div id="userTabBody"></div>`;
  renderUserTab(tab);
}

async function renderUserTab(tab) {
  U.tab = tab;
  document.querySelectorAll('#userDetail [data-utab]').forEach(b => {
    const on = b.dataset.utab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  const body = document.getElementById('userTabBody');
  if (!body || !U.detail) return;
  body.innerHTML = '<p style="color: var(--text-dim); padding: 16px;">Loading...</p>';
  const id = U.detail.user.id;
  const fail = text => { body.innerHTML = `<p style="color: var(--color-danger); padding: 16px;">${E(text)}</p>`; };
  try {
    if (tab === 'overview') return void (body.innerHTML = overviewPanel());
    if (tab === 'documents') return void (body.innerHTML = documentsPanel());
    if (tab === 'bookings') return void loadUserBookings(1);
    if (tab === 'wallet') {
      const { ok, data } = await adminFetch(`/api/v1/admin/users/${id}/wallet`);
      return ok ? void (body.innerHTML = walletPanel(data.data)) : fail(data.message);
    }
    if (tab === 'reviews') {
      const { ok, data } = await adminFetch(`/api/v1/admin/users/${id}/reviews`);
      if (!ok) return fail(data.message);
      return void (body.innerHTML = data.data.reviews.length
        ? `<div class="table-container"><table class="admin-table lead-table"><thead><tr><th>Agency and trip</th><th>Rating</th><th>Review</th><th>Date</th><th style="text-align:right;">Actions</th></tr></thead><tbody>${reviewRows(data.data.reviews, false)}</tbody></table></div>`
        : '<p class="empty-note">This user has not written any reviews.</p>');
    }
    if (tab === 'complaints') {
      const { ok, data } = await adminFetch(`/api/v1/admin/users/${id}/complaints`);
      if (!ok) return fail(data.message);
      data.data.complaints.forEach(c => U.complaints.set(c._id, c));
      return void (body.innerHTML = data.data.complaints.length
        ? `<div class="table-container"><table class="admin-table lead-table"><thead><tr><th>Complaint</th><th>Relation</th><th>Priority</th><th>Status</th><th>Received</th><th style="text-align:right;">Actions</th></tr></thead><tbody>${data.data.complaints.map(c => `
          <tr><td><span class="lead-main">${E(c.subject)}</span><span class="lead-sub">${E(label(c.category))}</span></td>
          <td>${c.relation === 'filed' ? 'Filed by this user' : 'About this user'}</td>
          <td><span class="badge ${PRIORITY_BADGE[c.priority]}">${E(c.priority)}</span></td>
          <td><span class="badge ${COMPLAINT_BADGE[c.status]}">${E(label(c.status))}</span></td>
          <td>${E(fmtDate(c.createdAt))}</td>
          <td style="text-align:right;"><button class="btn btn-secondary btn-sm" onclick="openComplaint('${E(c._id)}')">Open</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="empty-note">No complaints filed by or about this user.</p>');
    }
    if (tab === 'activity') {
      const { ok, data } = await adminFetch(`/api/v1/admin/users/${id}/activity`);
      if (!ok) return fail(data.message);
      return void (body.innerHTML = data.data.activity.length
        ? `<ul class="timeline">${data.data.activity.map(a => `<li><span class="timeline-when">${E(fmtDateTime(a.at))}</span><span class="timeline-what">${E(a.summary)}</span><span class="timeline-by">${E([a.by ? `by ${a.by}` : '', a.ip].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>`
        : '<p class="empty-note">No activity recorded for this user yet.</p>');
    }
    if (tab === 'logins') return void loadUserLogins(1);
  } catch (e) {
    fail('Could not load this section.');
  }
}

function overviewPanel() {
  const { user: u, counts } = U.detail;
  const r = u.restrictions;
  const restricted = [r.booking && 'booking', r.reviews && 'reviews', r.messaging && 'messaging'].filter(Boolean);
  return `
    <div class="kpi-grid" style="margin-bottom: 18px;">
      <div class="kpi"><div class="kpi-label">Bookings</div><div class="kpi-value">${counts.bookings}</div><div class="kpi-note">${takaFmt(counts.spent)} paid</div></div>
      <div class="kpi"><div class="kpi-label">Wallet balance</div><div class="kpi-value">${takaFmt(u.walletBalance)}</div><div class="kpi-note">Prepaid credit</div></div>
      <div class="kpi"><div class="kpi-label">Reviews written</div><div class="kpi-value">${counts.reviews}</div><div class="kpi-note">${counts.averageRating ? `${counts.averageRating} out of 5 on average` : 'None yet'}</div></div>
      <div class="kpi"><div class="kpi-label">Complaints</div><div class="kpi-value">${counts.complaintsMade + counts.complaintsAgainst}</div><div class="kpi-note">${counts.complaintsMade} filed · ${counts.complaintsAgainst} about this user</div></div>
      <div class="kpi"><div class="kpi-label">Sign-ins</div><div class="kpi-value">${counts.logins}</div><div class="kpi-note">Last: ${u.lastLoginAt ? E(fmtDateTime(u.lastLoginAt)) : 'never'}</div></div>
    </div>
    <div class="detail-grid">
      <form class="detail-card" onsubmit="saveUserDetails(event)" novalidate>
        <h3>Profile details</h3>
        <div class="form-group"><label class="form-label" for="udName">Name</label><input id="udName" class="form-input" value="${E(u.name)}" maxlength="80" required></div>
        <div class="form-group"><label class="form-label" for="udEmail">Email</label><input id="udEmail" class="form-input" type="email" value="${E(u.email)}" required></div>
        <div class="detail-two">
          <div class="form-group"><label class="form-label" for="udPhone">Phone</label><input id="udPhone" class="form-input" value="${E(u.phone)}" maxlength="20"></div>
          <div class="form-group"><label class="form-label" for="udAddress">Address</label><input id="udAddress" class="form-input" value="${E(u.address)}"></div>
        </div>
        <p class="detail-muted">Joined ${E(fmtDate(u.joinedAt))} · Signs in with ${u.authProvider === 'google' ? 'Google' : 'email and password'}</p>
        <div class="form-note-box is-error" id="udError" role="alert" hidden></div>
        <button type="submit" class="btn btn-primary" id="udSave">Save details</button>
      </form>
      <div>
        <div class="detail-card">
          <h3>Account standing</h3>
          <p>${standingBadges(u)}</p>
          ${u.deleted ? `<p class="detail-note">Deleted ${E(fmtDate(u.deletedAt))}: ${E(u.deletedReason)}</p>` : ''}
          ${!u.deleted && u.status !== 'active' ? `<p class="detail-note">${E(label(u.status))}: ${E(u.statusReason)}${u.statusUntil ? ` (until ${E(fmtDate(u.statusUntil))})` : ''}</p>` : ''}
          <p class="detail-muted" style="margin-top: 10px;">Restrictions: ${restricted.length ? `<strong>${E(restricted.join(', '))}</strong>${r.until ? ` until ${E(fmtDate(r.until))}` : ''}${r.reason ? `. ${E(r.reason)}` : ''}` : 'none'}</p>
          <p class="detail-muted">ID verification: <strong>${E(label(u.verification.status === 'none' ? 'not submitted' : u.verification.status))}</strong>${u.verification.note ? `. ${E(u.verification.note)}` : ''}</p>
        </div>
      </div>
    </div>`;
}

async function saveUserDetails(e) {
  e.preventDefault();
  const err = document.getElementById('udError');
  err.hidden = true;
  const body = { name: val('udName').trim(), email: val('udEmail').trim(), phone: val('udPhone').trim(), address: val('udAddress').trim() };
  if (!body.name) { err.textContent = 'Enter a name.'; err.hidden = false; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; return; }
  const btn = document.getElementById('udSave');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/users/${U.detail.user.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!ok) { err.textContent = data.message || 'Could not save.'; err.hidden = false; return; }
    showAdminToast('Details saved.', 'success');
    reloadUser();
  } catch (x) {
    err.textContent = 'Could not reach the server.'; err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function loadUserBookings(page) {
  const body = document.getElementById('userTabBody');
  const { ok, data } = await adminFetch(`/api/v1/admin/users/${U.detail.user.id}/bookings?${queryString({ page, limit: 15 })}`);
  if (!ok) { body.innerHTML = `<p style="color: var(--color-danger); padding: 16px;">${E(data.message)}</p>`; return; }
  const rows = data.data.bookings;
  body.innerHTML = rows.length ? `
    <div class="table-container"><table class="admin-table lead-table">
      <thead><tr><th>Booking</th><th>Agency</th><th>Travel date</th><th>Travelers</th><th>Amount</th><th>Status</th><th>Payment</th></tr></thead>
      <tbody>${rows.map(b => `<tr>
        <td><span class="lead-main">${E(b.packageTitle)}</span><span class="lead-sub">${E(b.reference)} · booked ${E(fmtDate(b.createdAt))}</span></td>
        <td>${b.agency ? E(b.agency.name) : '—'}</td>
        <td style="white-space: nowrap;">${E(fmtDate(b.travelDate))}</td>
        <td>${b.travelers}</td>
        <td style="white-space: nowrap;">${takaFmt(b.amount)}</td>
        <td><span class="badge ${BOOKING_BADGE[b.status]}">${E(label(b.status))}</span></td>
        <td>${E(PAY_LABEL[b.paymentStatus] || b.paymentStatus)}</td></tr>`).join('')}</tbody></table></div>
    <div class="pager" id="userBookingsPager"></div>` : '<p class="empty-note">This user has not made any bookings.</p>';
  renderPager('userBookingsPager', data.data, 'loadUserBookings');
}

async function loadUserLogins(page) {
  const body = document.getElementById('userTabBody');
  const { ok, data } = await adminFetch(`/api/v1/admin/users/${U.detail.user.id}/logins?${queryString({ page, limit: 20 })}`);
  if (!ok) { body.innerHTML = `<p style="color: var(--color-danger); padding: 16px;">${E(data.message)}</p>`; return; }
  body.innerHTML = data.data.events.length ? `
    <div class="table-container"><table class="admin-table"><thead><tr><th>Time</th><th>Result</th><th>Method</th><th>IP address</th><th>Device</th></tr></thead>
    <tbody>${loginRows(data.data.events, false)}</tbody></table></div><div class="pager" id="userLoginsPager"></div>` : '<p class="empty-note">No sign-ins recorded yet.</p>';
  renderPager('userLoginsPager', data.data, 'loadUserLogins');
}

function walletPanel(w) {
  return `
    <div class="wallet-top">
      <div><div class="kpi-label">Current balance</div><div class="wallet-balance">${takaFmt(w.balance)}</div></div>
      ${isMoneyAdmin() && !U.detail.user.deleted ? '<button class="btn btn-primary" onclick="openWalletModal()">Adjust balance</button>' : '<span class="detail-muted" style="margin:0">Only administrators can change wallet balances.</span>'}
    </div>
    ${w.transactions.length ? `<div class="table-container"><table class="admin-table"><thead><tr><th>Date</th><th>Change</th><th>Balance after</th><th>Reason</th><th>By</th></tr></thead><tbody>
      ${w.transactions.map(t => `<tr><td style="white-space:nowrap;">${E(fmtDateTime(t.createdAt))}</td>
        <td class="${t.type === 'credit' ? 'money-in' : 'money-out'}">${t.type === 'credit' ? '+' : '−'}${takaFmt(t.amount)}</td>
        <td>${takaFmt(t.balanceAfter)}</td><td>${E(label(t.reason))}${t.note ? `<span class="lead-sub">${E(t.note)}</span>` : ''}</td>
        <td>${t.createdBy ? E(t.createdBy.name) : 'System'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-note">No wallet activity yet.</p>'}`;
}

function documentsPanel() {
  const u = U.detail.user;
  const v = u.verification;
  const banners = {
    approved: ['callout-ok', 'Identity verified', `Reviewed ${E(fmtDate(v.reviewedAt))}.`],
    pending: ['callout-warn', 'Waiting for your review', `Submitted ${E(fmtDate(v.submittedAt))}.`],
    rejected: ['callout-error', 'Rejected', E(v.note || '')],
    none: ['', 'No verification submitted', 'The user has not uploaded identity documents.']
  };
  const [cls, title, text] = banners[v.status] || banners.none;
  const canAct = !u.deleted && !(adminState.currentUser.role === 'manager' && u.role !== 'user') && String(adminState.currentUser._id || adminState.currentUser.id) !== String(u.id);
  return `
    <div class="callout ${cls}"><div><strong>${E(title)}</strong>${text}</div></div>
    <ul class="detail-docs">
      ${v.documents.length ? v.documents.map(d => `<li><span>${E(USER_DOC_LABELS[d.kind] || d.kind)}<span class="lead-sub">${E(d.originalName)} · uploaded ${E(fmtDate(d.uploadedAt))}</span></span>
        <a class="btn btn-secondary btn-sm" href="/api/v1/admin/users/${E(u.id)}/documents/${E(d.id)}" target="_blank" rel="noopener">View</a></li>`).join('') : '<li><span>No documents uploaded.</span></li>'}
    </ul>
    ${canAct && v.documents.length ? `<div class="profile-actions">
      ${v.status !== 'approved' ? '<button class="btn btn-primary" onclick="verifyUserDecision(\'approve\')">Approve identity</button>' : ''}
      ${v.status !== 'rejected' ? '<button class="btn btn-danger" onclick="verifyUserDecision(\'reject\')">Reject</button>' : ''}
      ${v.status !== 'none' ? '<button class="btn btn-secondary" onclick="verifyUserDecision(\'reset\')">Reset to not submitted</button>' : ''}</div>` : ''}`;
}

async function verifyUserDecision(decision) {
  const id = U.detail.user.id;
  const send = async note => {
    const { ok, data } = await adminFetch(`/api/v1/admin/users/${id}/verify`, { method: 'POST', body: JSON.stringify({ decision, note }) });
    if (!ok) throw new Error(data.message || 'Could not update verification.');
    showAdminToast({ approve: 'Identity verified.', reject: 'Rejected. The user will see your note.', reset: 'Verification reset.' }[decision], 'success');
    refreshUsersViews();
  };
  if (decision === 'reject') {
    return askReason({ title: 'Reject verification', lead: 'Tell the user what to fix. They see this note.', label: 'Note to the user', confirmLabel: 'Reject', onSubmit: send });
  }
  if (!confirm(decision === 'approve' ? 'Approve this identity?' : 'Reset verification to "not submitted"?')) return;
  try { await send(''); } catch (e) { showAdminToast(e.message, 'error'); }
}

// ---------- Actions: status, restrictions, delete, restore, wallet ----------

function formError(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

function syncStatusForm() {
  document.getElementById('stUntilGroup').hidden = val('stStatus') !== 'suspended';
}

// The role and password dialogs live in admin.js; names come from the open profile, never from HTML
function openRoleForOpenUser() {
  const u = U.detail.user;
  openEditRoleModal(u.id, u.name, u.role);
}

function openResetForOpenUser() {
  const u = U.detail.user;
  openResetPasswordModal(u.id, u.name, u.email);
}

function openStatusModal() {
  const u = U.detail.user;
  document.getElementById('statusLead').textContent = `${u.name} will be signed out and unable to sign in until you reactivate the account.`;
  document.getElementById('stStatus').value = 'suspended';
  document.getElementById('stReason').value = '';
  document.getElementById('stUntil').value = '';
  document.getElementById('stUntil').min = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  formError('statusError');
  syncStatusForm();
  openModal('statusModal');
}

async function submitStatus(e) {
  e.preventDefault();
  const status = val('stStatus');
  const reason = val('stReason').trim();
  if (reason.length < 3) return formError('statusError', 'Add a reason. The user sees it when they try to sign in.');
  const body = { status, reason };
  if (status === 'suspended' && val('stUntil')) body.until = new Date(`${val('stUntil')}T23:59:59`).toISOString();
  const btn = document.getElementById('statusSubmit');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/users/${U.detail.user.id}/status`, { method: 'POST', body: JSON.stringify(body) });
    if (!ok) return formError('statusError', data.message || 'Could not change the status.');
    closeModal('statusModal');
    showAdminToast(`Account ${status}.`, 'success');
    refreshUsersViews();
  } catch (x) {
    formError('statusError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

async function reactivateUser() {
  const u = U.detail.user;
  if (!confirm(`Reactivate ${u.name}? They will be able to sign in again.`)) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/users/${u.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'active' }) });
  if (!ok) return showAdminToast(data.message || 'Could not reactivate.', 'error');
  showAdminToast('Account reactivated.', 'success');
  refreshUsersViews();
}

function openRestrictModal() {
  const r = U.detail.user.restrictions;
  document.getElementById('rsBooking').checked = r.booking;
  document.getElementById('rsReviews').checked = r.reviews;
  document.getElementById('rsMessaging').checked = r.messaging;
  document.getElementById('rsReason').value = r.reason || '';
  document.getElementById('rsUntil').value = r.until ? String(r.until).slice(0, 10) : '';
  document.getElementById('rsUntil').min = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  formError('restrictError');
  openModal('restrictModal');
}

async function submitRestrictions(e) {
  e.preventDefault();
  const body = {
    booking: document.getElementById('rsBooking').checked, reviews: document.getElementById('rsReviews').checked,
    messaging: document.getElementById('rsMessaging').checked, reason: val('rsReason').trim()
  };
  if ((body.booking || body.reviews || body.messaging) && body.reason.length < 3) return formError('restrictError', 'Add a reason for the restriction.');
  if (val('rsUntil')) body.until = new Date(`${val('rsUntil')}T23:59:59`).toISOString();
  const btn = document.getElementById('restrictSubmit');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/users/${U.detail.user.id}/restrictions`, { method: 'POST', body: JSON.stringify(body) });
    if (!ok) return formError('restrictError', data.message || 'Could not save the restrictions.');
    closeModal('restrictModal');
    showAdminToast('Restrictions saved.', 'success');
    refreshUsersViews();
  } catch (x) {
    formError('restrictError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}

// One reusable "type a reason" dialog
function askReason({ title, lead, label: fieldLabel, confirmLabel, onSubmit, danger = true, maxLength = 500 }) {
  U.reasonHandler = onSubmit;
  document.getElementById('reasonSubmit').className = `btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block`;
  document.getElementById('reasonText').maxLength = maxLength;
  document.getElementById('reasonTitle').textContent = title;
  document.getElementById('reasonLead').textContent = lead || '';
  document.getElementById('reasonLabel').textContent = fieldLabel || 'Reason';
  document.getElementById('reasonSubmit').textContent = confirmLabel || 'Confirm';
  document.getElementById('reasonText').value = '';
  formError('reasonError');
  openModal('reasonModal');
  document.getElementById('reasonText').focus();
}

async function submitReason(e) {
  e.preventDefault();
  const text = val('reasonText').trim();
  if (text.length < 3) return formError('reasonError', 'Write a short reason (at least 3 characters).');
  const btn = document.getElementById('reasonSubmit');
  btn.disabled = true;
  try {
    await U.reasonHandler(text);
    closeModal('reasonModal');
  } catch (err) {
    formError('reasonError', err.message || 'Something went wrong.');
  } finally {
    btn.disabled = false;
  }
}

function openDeleteModal() {
  const u = U.detail.user;
  askReason({
    title: `Delete ${u.name}?`,
    lead: 'The account is hidden and can no longer sign in. Bookings, reviews and history are kept, and you can restore the account later.',
    label: 'Reason for deleting', confirmLabel: 'Delete account',
    onSubmit: async reason => {
      const { ok, data } = await adminFetch(`/api/v1/admin/users/${u.id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      if (!ok) throw new Error(data.message || 'Could not delete the account.');
      showAdminToast('Account deleted. You can restore it from the Deleted filter.', 'info');
      refreshUsersViews();
    }
  });
}

async function restoreUser(id) {
  if (!confirm('Restore this account? The user will be able to sign in again.')) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/users/${id}/restore`, { method: 'POST' });
  if (!ok) return showAdminToast(data.message || 'Could not restore the account.', 'error');
  showAdminToast('Account restored.', 'success');
  refreshUsersViews();
}

async function permanentlyDeleteUser(id) {
  const u = U.detail.user;
  if (!confirm(`Permanently remove ${u.email}? Their sign-in history, activity and documents are erased. This cannot be undone.`)) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/users/${id}/permanent`, { method: 'DELETE' });
  if (!ok) return showAdminToast(data.message || 'Could not remove the account.', 'error');
  showAdminToast('Account removed permanently.', 'info');
  U.detail = null;
  switchTab('users');
  refreshUsersViews();
}

function openWalletModal() {
  const u = U.detail.user;
  document.getElementById('walletLead').textContent = `${u.name} has ${takaFmt(u.walletBalance)} in their wallet.`;
  document.getElementById('wType').value = 'credit';
  document.getElementById('wAmount').value = '';
  document.getElementById('wNote').value = '';
  formError('walletError');
  openModal('walletModal');
}

async function submitWallet(e) {
  e.preventDefault();
  const amount = Number(val('wAmount'));
  const note = val('wNote').trim();
  if (!(amount > 0)) return formError('walletError', 'Enter an amount greater than zero.');
  if (note.length < 3) return formError('walletError', 'Add a note explaining the change.');
  const btn = document.getElementById('walletSubmit');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/users/${U.detail.user.id}/wallet`, { method: 'POST', body: JSON.stringify({ type: val('wType'), amount, note }) });
    if (!ok) return formError('walletError', data.message || 'Could not change the wallet.');
    closeModal('walletModal');
    showAdminToast('Wallet updated.', 'success');
    reloadUser();
  } catch (x) {
    formError('walletError', 'Could not reach the server.');
  } finally {
    btn.disabled = false;
  }
}
