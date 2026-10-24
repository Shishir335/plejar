/**
 * Plezar Starter - Administration Console Controller
 */

const adminState = {
  currentUser: null,
  token: localStorage.getItem('plezar_token') || null,
  users: [],
  subscribers: [],
  agentLeads: [],
  filteredUsers: []
};

// Escape user-submitted text before inserting it as HTML
function escapeHTML(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

// Toast helper
function showAdminToast(msg, type = 'info') {
  const container = document.getElementById('adminToastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 250);
  }, 3500);
}

// Modal helper
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}

// API Fetcher with Auth
async function adminFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (adminState.token) {
    headers['Authorization'] = `Bearer ${adminState.token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include'
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// Verify Session
async function checkAdminAuth() {
  try {
    const { ok, data } = await adminFetch('/api/v1/users/me');
    // /me responds with { data: { user } }
    const me = data.data && (data.data.user || data.data);
    if (ok && me && ['admin', 'manager', 'dev'].includes(me.role)) {
      adminState.currentUser = me;
      showDashboard();
      loadUsers();
      loadSubscribers();
      loadAgentLeads();
      loadAgencies();
      updateStats();
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('adminLoginView').style.display = 'flex';
  document.getElementById('adminDashboardView').style.display = 'none';
}

function showDashboard() {
  document.getElementById('adminLoginView').style.display = 'none';
  document.getElementById('adminDashboardView').style.display = 'flex';

  const userBadge = document.getElementById('topbarUserName');
  if (userBadge && adminState.currentUser) {
    userBadge.textContent = adminState.currentUser.name;
  }
}

// Admin Login Handler
async function handleAdminLogin(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value;
  const password = form.password.value;
  const btn = form.querySelector('button');

  btn.disabled = true;
  btn.textContent = 'Verifying credentials...';

  try {
    const { ok, data } = await adminFetch('/api/v1/users/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (ok && data.token) {
      if (!['admin', 'manager', 'dev'].includes(data.data.role)) {
        showAdminToast('Access restricted: Administrator role required.', 'error');
        btn.disabled = false;
        btn.textContent = 'Sign In to Console';
        return;
      }

      adminState.token = data.token;
      adminState.currentUser = data.data;
      localStorage.setItem('plezar_token', data.token);
      showAdminToast(`Welcome, ${adminState.currentUser.name}!`, 'success');
      showDashboard();
      loadUsers();
      loadSubscribers();
      loadAgentLeads();
      loadAgencies();
      updateStats();
    } else {
      showAdminToast(data.message || 'Login failed.', 'error');
    }
  } catch (err) {
    showAdminToast('Network connection failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In to Console';
  }
}

function handleAdminLogout() {
  localStorage.removeItem('plezar_token');
  adminState.token = null;
  adminState.currentUser = null;
  showAdminToast('Signed out from console.', 'info');
  showLogin();
}

// Switch Sidebar Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link-btn').forEach(b => b.classList.remove('active'));

  const targetPane = document.getElementById(`tab-${tabId}`);
  const targetBtn = document.querySelector(`[data-tab="${tabId === 'agencyDetail' ? 'agencies' : tabId}"]`);

  if (targetPane) targetPane.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');
}

// Load Users
async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-dim);">Loading accounts...</td></tr>';

  try {
    const { ok, data } = await adminFetch('/api/v1/users');
    if (ok && Array.isArray(data.data)) {
      adminState.users = data.data;
      updateStats();
      filterUsers();
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--color-danger);">${escapeHTML(data.message || 'Could not load users')}</td></tr>`;
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--color-danger);">Failed to fetch user directory</td></tr>';
  }
}

// Update Stats Cards from the server
async function updateStats() {
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/stats');
    if (!ok) return;
    const s = data.data.stats;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('statAgencies', s.activeAgencies);
    set('statPendingVerification', s.pendingVerification);
    set('statNewLeads', s.newLeads);
    set('statPublishedPackages', s.publishedPackages);
    set('statSubscribers', s.subscribers);
    set('statTotalUsers', s.users);

    const pending = document.getElementById('agenciesPendingCount');
    if (pending) {
      pending.textContent = s.pendingVerification;
      pending.hidden = s.pendingVerification === 0;
    }
  } catch (e) {
    // Stats are informational; leave the last values in place
  }
}

// Row actions in the user directory look the user up by ID
function userAction(kind, userId) {
  const user = adminState.users.find(u => u._id === userId);
  if (!user) return;
  if (kind === 'role') openEditRoleModal(user._id, user.name, user.role);
  if (kind === 'reset') openResetPasswordModal(user._id, user.name, user.email);
  if (kind === 'delete') handleDeleteUser(user._id, user.email);
}

// Filter Users in Table
function filterUsers() {
  const search = (document.getElementById('userSearchInput')?.value || '').toLowerCase().trim();
  const roleFilter = document.getElementById('userRoleFilter')?.value || 'all';

  adminState.filteredUsers = adminState.users.filter(user => {
    const matchSearch = (user.name || '').toLowerCase().includes(search) || 
                        (user.email || '').toLowerCase().includes(search) ||
                        (user._id || '').toLowerCase().includes(search);
    const matchRole = roleFilter === 'all' || user.role === roleFilter;
    return matchSearch && matchRole;
  });

  renderUsersTable();
}

function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (adminState.filteredUsers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 32px; color: var(--text-dim);">No accounts matching current criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = adminState.filteredUsers.map(user => {
    const id = escapeHTML(user._id);
    const role = escapeHTML(user.role || 'user');
    const initial = escapeHTML((user.name || 'U').charAt(0).toUpperCase());
    const createdAt = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
    const isSelf = adminState.currentUser && adminState.currentUser._id === user._id;
    const invited = user.accountStatus === 'invited';

    // Buttons pass only the ID; names are looked up in userAction() so user text never reaches inline JS
    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${initial}</div>
            <div class="user-cell-info">
              <span class="user-cell-name">${escapeHTML(user.name) || 'Unnamed'}</span>
              <span class="user-cell-email">${escapeHTML(user.email)}</span>
            </div>
          </div>
        </td>
        <td><span class="badge badge-${role}">${role}${user.role === 'agent' && user.agencyRole ? ` · ${escapeHTML(user.agencyRole)}` : ''}</span></td>
        <td style="color: var(--text-muted); font-size: 0.85rem;">${escapeHTML(createdAt)}</td>
        <td>
          <span class="badge ${invited ? 'badge-manager' : 'badge-active'}">${invited ? 'Invited' : 'Active'}</span>
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 8px;">
            ${user.role !== 'agent' ? `<button class="btn btn-secondary btn-sm" onclick="userAction('role', '${id}')">Role</button>` : ''}
            <button class="btn btn-secondary btn-sm" onclick="userAction('reset', '${id}')">Reset Pwd</button>
            ${!isSelf ? `
              <button class="btn btn-danger btn-sm" onclick="userAction('delete', '${id}')">Delete</button>
            ` : '<span style="color:var(--text-dim); font-size:0.75rem; padding: 6px;">(You)</span>'}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Create User
async function handleCreateUser(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value;
  const email = form.email.value;
  const role = form.role.value;
  const password = form.password.value;
  const confirmPassword = form.confirmPassword.value;
  const btn = form.querySelector('button[type="submit"]');

  if (password !== confirmPassword) {
    showAdminToast('Passwords do not match.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    const { ok, data } = await adminFetch('/api/v1/users', {
      method: 'POST',
      body: JSON.stringify({ name, email, role, password, confirmPassword })
    });

    if (ok) {
      showAdminToast(`User ${name} created successfully!`, 'success');
      closeModal('createUserModal');
      form.reset();
      loadUsers();
    } else {
      showAdminToast(data.message || 'Creation failed.', 'error');
    }
  } catch (err) {
    showAdminToast('Network error.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

// Edit Role Modal
function openEditRoleModal(userId, name, currentRole) {
  document.getElementById('editRoleId').value = userId;
  document.getElementById('editRoleUserName').textContent = name;
  document.getElementById('editRoleSelect').value = currentRole;
  openModal('editRoleModal');
}

async function handleUpdateRole(e) {
  e.preventDefault();
  const userId = document.getElementById('editRoleId').value;
  const newRole = document.getElementById('editRoleSelect').value;

  try {
    const { ok, data } = await adminFetch(`/api/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: newRole })
    });

    if (ok) {
      showAdminToast('User role updated successfully!', 'success');
      closeModal('editRoleModal');
      loadUsers();
    } else {
      showAdminToast(data.message || 'Could not update role.', 'error');
    }
  } catch (err) {
    showAdminToast('Network error.', 'error');
  }
}

// Reset Password Modal
function openResetPasswordModal(userId, name, email) {
  document.getElementById('resetTargetUserId').value = userId;
  document.getElementById('resetTargetUserName').textContent = `${name} (${email})`;
  document.getElementById('newAdminSetPassword').value = '';
  openModal('adminResetModal');
}

async function handleAdminDirectPasswordReset(e) {
  e.preventDefault();
  const userId = document.getElementById('resetTargetUserId').value;
  const password = document.getElementById('newAdminSetPassword').value;

  try {
    const { ok, data } = await adminFetch(`/api/v1/users/${userId}/reset-password`, {
      method: 'PATCH',
      body: JSON.stringify({ password, confirmPassword: password })
    });

    if (ok) {
      showAdminToast('Password updated directly for user!', 'success');
      closeModal('adminResetModal');
    } else {
      showAdminToast(data.message || 'Could not update password.', 'error');
    }
  } catch (err) {
    showAdminToast('Network error.', 'error');
  }
}

async function handleSendResetLink() {
  const userId = document.getElementById('resetTargetUserId').value;
  try {
    const { ok, data } = await adminFetch(`/api/v1/users/${userId}/send-reset-link`, {
      method: 'POST'
    });

    if (ok) {
      showAdminToast('Reset link dispatched via email / generated!', 'success');
      closeModal('adminResetModal');
    } else {
      showAdminToast(data.message || 'Could not generate reset link.', 'error');
    }
  } catch (err) {
    showAdminToast('Network error.', 'error');
  }
}

// Delete User
async function handleDeleteUser(userId, email) {
  if (!confirm(`Are you sure you want to permanently delete account: ${email}? This cannot be undone.`)) {
    return;
  }

  try {
    const { ok, data } = await adminFetch(`/api/v1/users/${userId}`, {
      method: 'DELETE'
    });

    if (ok) {
      showAdminToast(`Account ${email} purged.`, 'success');
      loadUsers();
    } else {
      showAdminToast(data.message || 'Could not delete user.', 'error');
    }
  } catch (err) {
    showAdminToast('Network error.', 'error');
  }
}

// Load Subscribers
async function loadSubscribers() {
  const tbody = document.getElementById('subscribersTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--text-dim);">Loading subscribers...</td></tr>';

  try {
    const { ok, data } = await adminFetch('/api/v1/subscribers');
    if (ok && Array.isArray(data.data?.subscribers)) {
      adminState.subscribers = data.data.subscribers;
      updateStats();
      renderSubscribersTable();
    } else {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--text-dim);">No subscribers registered yet.</td></tr>';
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--color-danger);">Failed to load subscribers.</td></tr>';
  }
}

function renderSubscribersTable() {
  const tbody = document.getElementById('subscribersTableBody');
  if (!tbody) return;

  if (adminState.subscribers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 24px; color: var(--text-dim);">No newsletter subscribers yet.</td></tr>';
    return;
  }

  tbody.innerHTML = adminState.subscribers.map(sub => {
    const date = sub.createdAt ? new Date(sub.createdAt).toLocaleDateString() : 'N/A';
    return `
      <tr>
        <td style="font-weight: 600;">${escapeHTML(sub.email)}</td>
        <td><span class="badge badge-active">${escapeHTML(sub.status || 'active')}</span></td>
        <td style="color: var(--text-muted);">${escapeHTML(sub.source || 'newsletter')}</td>
        <td style="color: var(--text-muted);">${date}</td>
        <td style="text-align: right;">
          <button class="btn btn-danger btn-sm" onclick="handleDeleteSubscriber('${escapeHTML(sub._id)}')">Remove</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function handleDeleteSubscriber(subId) {
  if (!confirm('Remove this email from subscribers list?')) return;
  try {
    const { ok } = await adminFetch(`/api/v1/subscribers/${subId}`, { method: 'DELETE' });
    if (ok) {
      showAdminToast('Subscriber removed.', 'info');
      loadSubscribers();
    }
  } catch (e) {
    showAdminToast('Failed to remove subscriber.', 'error');
  }
}

// Export CSV
function exportSubscribersCSV() {
  window.open('/api/v1/subscribers/export', '_blank');
}

// Agent Leads
const LEAD_BADGES = { new: 'badge-manager', contacted: 'badge-active', archived: 'badge-inactive' };

function agentLeadsMessage(text, color = 'var(--text-dim)') {
  const tbody = document.getElementById('agentLeadsTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: ${color};">${escapeHTML(text)}</td></tr>`;
}

async function loadAgentLeads() {
  agentLeadsMessage('Loading agent leads...');

  try {
    const { ok, data } = await adminFetch('/api/v1/agent-leads');
    if (ok && Array.isArray(data.data?.leads)) {
      adminState.agentLeads = data.data.leads;
      updateAgentLeadsCount();
      renderAgentLeadsTable();
    } else {
      agentLeadsMessage(data.message || 'Could not load agent leads.', 'var(--color-danger)');
    }
  } catch (err) {
    agentLeadsMessage('Failed to load agent leads.', 'var(--color-danger)');
  }
}

function updateAgentLeadsCount() {
  const badge = document.getElementById('agentLeadsNewCount');
  if (!badge) return;
  const count = adminState.agentLeads.filter(l => l.status === 'new').length;
  badge.textContent = count;
  badge.hidden = count === 0;
}

// Only link websites that are plain http(s) URLs or bare domains
function leadLink(website) {
  if (!website) return '';
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return escapeHTML(website);
    return `<a href="${escapeHTML(parsed.href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(website)}</a>`;
  } catch (e) {
    return escapeHTML(website);
  }
}

function renderAgentLeadsTable() {
  const tbody = document.getElementById('agentLeadsTableBody');
  if (!tbody) return;

  const filter = document.getElementById('agentLeadStatusFilter')?.value || 'all';
  const leads = filter === 'all'
    ? adminState.agentLeads
    : adminState.agentLeads.filter(l => l.status === filter);

  if (leads.length === 0) {
    agentLeadsMessage(filter === 'all'
      ? 'No agent leads yet. They appear here when agents send the form on the website.'
      : `No ${filter} leads.`);
    return;
  }

  tbody.innerHTML = leads.map(lead => {
    const id = escapeHTML(lead._id);
    const date = lead.createdAt ? new Date(lead.createdAt).toLocaleString() : 'N/A';
    const status = LEAD_BADGES[lead.status] ? lead.status : 'new';
    const actions = [];
    if (status !== 'archived') actions.push(`<button class="btn btn-primary btn-sm" onclick="inviteFromLead('${id}')">Approve &amp; invite</button>`);
    if (status !== 'contacted') actions.push(`<button class="btn btn-secondary btn-sm" onclick="setAgentLeadStatus('${id}', 'contacted')">Mark contacted</button>`);
    if (status !== 'new') actions.push(`<button class="btn btn-secondary btn-sm" onclick="setAgentLeadStatus('${id}', 'new')">Mark new</button>`);
    if (status !== 'archived') actions.push(`<button class="btn btn-secondary btn-sm" onclick="setAgentLeadStatus('${id}', 'archived')">Archive</button>`);
    actions.push(`<button class="btn btn-danger btn-sm" onclick="deleteAgentLead('${id}')">Delete</button>`);

    return `
      <tr>
        <td><span class="lead-main">${escapeHTML(lead.agencyName)}</span><span class="lead-sub">${escapeHTML(lead.contactName)}</span></td>
        <td><a class="lead-main" href="tel:${escapeHTML(lead.phone)}">${escapeHTML(lead.phone)}</a><span class="lead-sub"><a href="mailto:${escapeHTML(lead.email)}">${escapeHTML(lead.email)}</a></span></td>
        <td><span class="lead-sub" style="margin-top:0">${escapeHTML(lead.regions) || '—'}</span><span class="lead-sub">${leadLink(lead.website)}</span></td>
        <td><div class="lead-message">${escapeHTML(lead.message) || '—'}</div></td>
        <td style="color: var(--text-muted); white-space: nowrap;">${escapeHTML(date)}</td>
        <td><span class="badge ${LEAD_BADGES[status]}">${status}</span></td>
        <td><div class="lead-actions">${actions.join('')}</div></td>
      </tr>
    `;
  }).join('');
}

async function setAgentLeadStatus(leadId, status) {
  try {
    const { ok, data } = await adminFetch(`/api/v1/agent-leads/${leadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    if (ok) {
      const lead = adminState.agentLeads.find(l => l._id === leadId);
      if (lead) lead.status = status;
      updateAgentLeadsCount();
      renderAgentLeadsTable();
      showAdminToast(`Lead marked as ${status}.`, 'success');
    } else {
      showAdminToast(data.message || 'Could not update the lead.', 'error');
    }
  } catch (e) {
    showAdminToast('Could not update the lead.', 'error');
  }
}

async function deleteAgentLead(leadId) {
  const lead = adminState.agentLeads.find(l => l._id === leadId);
  const name = lead ? lead.agencyName : 'this lead';
  if (!confirm(`Delete ${name}? This can't be undone.`)) return;

  try {
    const { ok, status, data } = await adminFetch(`/api/v1/agent-leads/${leadId}`, { method: 'DELETE' });
    if (ok || status === 204) {
      adminState.agentLeads = adminState.agentLeads.filter(l => l._id !== leadId);
      updateAgentLeadsCount();
      renderAgentLeadsTable();
      showAdminToast(`Deleted ${name}.`, 'info');
    } else {
      showAdminToast(data.message || 'Could not delete the lead.', 'error');
    }
  } catch (e) {
    showAdminToast('Could not delete the lead.', 'error');
  }
}

// ---------- Agencies ----------

const VERIFY_BADGES = { approved: 'badge-active', pending: 'badge-manager', rejected: 'badge-admin', none: 'badge-inactive' };
const VERIFY_LABELS = { approved: 'Verified', pending: 'Awaiting review', rejected: 'Changes requested', none: 'Not submitted' };
const DOC_LABELS = { trade_license: 'Trade license', nid: "Owner's national ID" };
adminState.agencies = [];
adminState.agencyDetail = null;

function agenciesMessage(text, color = 'var(--text-dim)') {
  const tbody = document.getElementById('agenciesTableBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: ${color};">${escapeHTML(text)}</td></tr>`;
}

async function loadAgencies() {
  agenciesMessage('Loading agencies...');
  const params = new URLSearchParams();
  const status = document.getElementById('agencyStatusFilter')?.value;
  const verification = document.getElementById('agencyVerificationFilter')?.value;
  if (status) params.set('status', status);
  if (verification) params.set('verification', verification);

  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/agencies?${params}`);
    if (!ok) return agenciesMessage(data.message || 'Could not load agencies.', 'var(--color-danger)');
    adminState.agencies = data.data.agencies;
    renderAgenciesTable();
  } catch (e) {
    agenciesMessage('Failed to load agencies.', 'var(--color-danger)');
  }
}

function agencyLogo(a, size = 36) {
  return a.logo
    ? `<img src="${escapeHTML(a.logo)}" alt="" style="width:${size}px;height:${size}px;border-radius:8px;object-fit:cover;flex-shrink:0">`
    : `<span class="user-cell-avatar" style="width:${size}px;height:${size}px;border-radius:8px">${escapeHTML((a.name || '?').charAt(0).toUpperCase())}</span>`;
}

function renderAgenciesTable() {
  const tbody = document.getElementById('agenciesTableBody');
  if (!tbody) return;
  if (!adminState.agencies.length) {
    return agenciesMessage('No agencies match these filters. Invite one, or approve an agent lead.');
  }

  tbody.innerHTML = adminState.agencies.map(a => {
    const id = escapeHTML(a.id);
    const v = VERIFY_BADGES[a.verificationStatus] ? a.verificationStatus : 'none';
    return `
      <tr>
        <td>
          <div class="user-cell">
            ${agencyLogo(a)}
            <div class="user-cell-info">
              <span class="user-cell-name">${escapeHTML(a.name)}</span>
              <span class="user-cell-email">${escapeHTML((a.regions || []).join(', ')) || '—'}</span>
            </div>
          </div>
        </td>
        <td>${a.owner ? `<span class="lead-main">${escapeHTML(a.owner.name)}</span><span class="lead-sub">${escapeHTML(a.owner.email)}${a.owner.accountStatus === 'invited' ? ' · invite pending' : ''}</span>` : '—'}</td>
        <td>${a.publishedPackages} published<span class="lead-sub">${a.packages} total</span></td>
        <td>${a.members}</td>
        <td><span class="badge ${VERIFY_BADGES[v]}">${VERIFY_LABELS[v]}</span></td>
        <td><span class="badge ${a.status === 'active' ? 'badge-active' : 'badge-admin'}">${escapeHTML(a.status)}</span></td>
        <td style="text-align: right;"><button class="btn btn-secondary btn-sm" onclick="openAgency('${id}')">Open</button></td>
      </tr>`;
  }).join('');
}

async function openAgency(agencyId) {
  switchTab('agencyDetail');
  const box = document.getElementById('agencyDetail');
  box.innerHTML = '<p style="color: var(--text-dim); padding: 24px;">Loading agency...</p>';
  try {
    const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${agencyId}`);
    if (!ok) {
      box.innerHTML = `<p style="color: var(--color-danger); padding: 24px;">${escapeHTML(data.message || 'Could not load agency.')}</p>`;
      return;
    }
    adminState.agencyDetail = data.data;
    renderAgencyDetail();
  } catch (e) {
    box.innerHTML = '<p style="color: var(--color-danger); padding: 24px;">Failed to load agency.</p>';
  }
}

function renderAgencyDetail() {
  const { agency: a, verification: v, members, packages } = adminState.agencyDetail;
  const id = escapeHTML(a._id);
  const vStatus = v.verified ? 'approved' : (VERIFY_BADGES[v.status] ? v.status : 'none');
  const fmt = d => (d ? new Date(d).toLocaleString() : '');

  document.getElementById('agencyDetail').innerHTML = `
    <div class="control-bar">
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" onclick="switchTab('agencies'); loadAgencies();">&larr; All agencies</button>
        ${agencyLogo(a, 44)}
        <div>
          <h2 style="font-size: 1.2rem; font-weight: 700;">${escapeHTML(a.name)}</h2>
          <span class="badge ${a.status === 'active' ? 'badge-active' : 'badge-admin'}">${escapeHTML(a.status)}</span>
          <span class="badge ${VERIFY_BADGES[vStatus]}">${VERIFY_LABELS[vStatus]}</span>
        </div>
      </div>
      <div>
        ${a.status === 'active'
          ? `<button class="btn btn-danger" onclick="setAgencyStatus('${id}', 'suspended')">Suspend agency</button>`
          : `<button class="btn btn-primary" onclick="setAgencyStatus('${id}', 'active')">Reactivate agency</button>`}
      </div>
    </div>

    <div class="detail-grid">
      <form class="detail-card" id="agencyProfileForm" onsubmit="saveAgencyProfile(event, '${id}')">
        <h3>Profile</h3>
        <div class="form-group"><label class="form-label">Agency name</label><input class="form-input" name="name" value="${escapeHTML(a.name)}" maxlength="120" required></div>
        <div class="form-group"><label class="form-label">Description</label><textarea class="form-input" name="description" rows="4" maxlength="1500">${escapeHTML(a.description)}</textarea></div>
        <div class="form-group"><label class="form-label">Regions (comma separated)</label><input class="form-input" name="regions" value="${escapeHTML((a.regions || []).join(', '))}"></div>
        <div class="detail-two">
          <div class="form-group"><label class="form-label">Phone</label><input class="form-input" name="phone" value="${escapeHTML(a.phone)}" maxlength="20"></div>
          <div class="form-group"><label class="form-label">Public email</label><input class="form-input" name="email" value="${escapeHTML(a.email)}"></div>
        </div>
        <div class="detail-two">
          <div class="form-group"><label class="form-label">Facebook page or website</label><input class="form-input" name="website" value="${escapeHTML(a.website)}" maxlength="200"></div>
          <div class="form-group"><label class="form-label">Trade license number</label><input class="form-input" name="tradeLicenseNumber" value="${escapeHTML(a.tradeLicenseNumber)}" maxlength="60"></div>
        </div>
        <button type="submit" class="btn btn-primary">Save profile</button>
      </form>

      <div class="detail-card">
        <h3>Verification</h3>
        <p class="detail-muted">${v.submittedAt ? `Submitted ${escapeHTML(fmt(v.submittedAt))}` : 'No documents submitted yet.'}${v.reviewedAt ? `<br>Last reviewed ${escapeHTML(fmt(v.reviewedAt))}` : ''}</p>
        ${v.note ? `<p class="detail-note">Note to agency: ${escapeHTML(v.note)}</p>` : ''}
        <p class="detail-muted">Trade license number: <strong>${escapeHTML(v.tradeLicenseNumber) || '—'}</strong></p>
        <ul class="detail-docs">
          ${v.documents.length ? v.documents.map(d => `
            <li><span>${escapeHTML(DOC_LABELS[d.kind] || d.kind)}<span class="lead-sub">${escapeHTML(d.originalName)}</span></span>
            <a class="btn btn-secondary btn-sm" href="/api/v1/admin/agencies/${id}/documents/${escapeHTML(d.id)}" target="_blank" rel="noopener">View</a></li>`).join('') : '<li><span>No documents.</span></li>'}
        </ul>
        <div class="form-group"><label class="form-label" for="verifyNote">Note to the agency (required when requesting changes)</label><textarea class="form-input" id="verifyNote" rows="2" maxlength="500" placeholder="For example: the trade license photo is blurry, upload a clearer one"></textarea></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${v.documents.length >= 2 && !v.verified ? `<button class="btn btn-primary btn-sm" onclick="reviewVerification('${id}', 'approve')">Approve and verify</button>` : ''}
          ${v.documents.length ? `<button class="btn btn-secondary btn-sm" onclick="reviewVerification('${id}', 'reject')">Request changes</button>` : ''}
          ${v.verified ? `<button class="btn btn-danger btn-sm" onclick="reviewVerification('${id}', 'revoke')">Remove verified mark</button>` : ''}
        </div>
      </div>

      <div class="detail-card">
        <h3>Team</h3>
        <table class="admin-table lead-table">
          <tbody>
            ${members.map(m => `
              <tr>
                <td><span class="lead-main">${escapeHTML(m.name)}</span><span class="lead-sub">${escapeHTML(m.email)}</span></td>
                <td>${m.agencyRole === 'owner' ? 'Owner' : 'Staff'}</td>
                <td><span class="badge ${m.accountStatus === 'invited' ? 'badge-manager' : 'badge-active'}">${m.accountStatus === 'invited' ? 'Invite pending' : 'Active'}</span></td>
                <td style="text-align:right;">${m.accountStatus === 'invited' ? `<button class="btn btn-secondary btn-sm" onclick="resendMemberInvite('${id}', '${escapeHTML(m.id)}')">Resend invite</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div id="memberInviteResult"></div>
      </div>

      <div class="detail-card detail-wide">
        <h3>Tour packages</h3>
        ${packages.length ? `
        <table class="admin-table lead-table">
          <thead><tr><th>Package</th><th>Duration</th><th>Price from</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
          <tbody>
            ${packages.map(p => `
              <tr>
                <td><span class="lead-main">${escapeHTML(p.title)}</span><span class="lead-sub">${escapeHTML(p.destination)} · ${p.photos.length} photo${p.photos.length === 1 ? '' : 's'}</span></td>
                <td>${Number(p.durationDays)}D / ${Number(p.durationNights || 0)}N</td>
                <td>৳${Number(p.priceFrom).toLocaleString('en-US')}</td>
                <td><span class="badge ${p.status === 'published' ? 'badge-active' : (p.status === 'draft' ? 'badge-manager' : 'badge-inactive')}">${escapeHTML(p.status)}</span>${p.hiddenByAdmin ? '<span class="lead-sub">Hidden by Plezar</span>' : ''}</td>
                <td style="text-align:right;">${p.hiddenByAdmin
                  ? `<button class="btn btn-secondary btn-sm" onclick="moderatePackage('${id}', '${escapeHTML(p._id)}', false)">Allow again</button>`
                  : `<button class="btn btn-danger btn-sm" onclick="moderatePackage('${id}', '${escapeHTML(p._id)}', true)">Hide</button>`}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p class="detail-muted">This agency has not added any packages yet.</p>'}
      </div>
    </div>`;
}

async function saveAgencyProfile(e, agencyId) {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${agencyId}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!ok) return showAdminToast(data.message || 'Could not save the profile.', 'error');
  showAdminToast('Agency profile saved.', 'success');
  openAgency(agencyId);
}

async function setAgencyStatus(agencyId, status) {
  const name = adminState.agencyDetail ? adminState.agencyDetail.agency.name : 'this agency';
  const question = status === 'suspended'
    ? `Suspend ${name}? Everyone in this agency will be signed out of the agency panel until you reactivate it.`
    : `Reactivate ${name}? Its team will be able to sign in again.`;
  if (!confirm(question)) return;

  const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${agencyId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  if (!ok) return showAdminToast(data.message || 'Could not change the status.', 'error');
  showAdminToast(status === 'suspended' ? `${name} suspended.` : `${name} reactivated.`, 'success');
  openAgency(agencyId);
  updateStats();
}

async function reviewVerification(agencyId, decision) {
  const note = (document.getElementById('verifyNote')?.value || '').trim();
  if (decision === 'reject' && !note) {
    showAdminToast('Add a note telling the agency what to fix.', 'error');
    document.getElementById('verifyNote')?.focus();
    return;
  }
  if (decision === 'revoke' && !confirm('Remove the verified mark from this agency?')) return;

  const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${agencyId}/verify`, { method: 'POST', body: JSON.stringify({ decision, note }) });
  if (!ok) return showAdminToast(data.message || 'Could not update verification.', 'error');
  const messages = { approve: 'Agency verified.', reject: 'Changes requested. The agency will see your note.', revoke: 'Verified mark removed.' };
  showAdminToast(messages[decision], 'success');
  openAgency(agencyId);
  updateStats();
}

async function moderatePackage(agencyId, packageId, hidden) {
  if (hidden && !confirm('Hide this package? The agency will not be able to publish it again until you allow it.')) return;
  const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${agencyId}/packages/${packageId}`, { method: 'PATCH', body: JSON.stringify({ hidden }) });
  if (!ok) return showAdminToast(data.message || 'Could not update the package.', 'error');
  showAdminToast(hidden ? 'Package hidden.' : 'Package allowed again. The agency can republish it.', 'success');
  openAgency(agencyId);
  updateStats();
}

function inviteLinkBox(url, message) {
  return `
    <div class="invite-box">
      <p>${escapeHTML(message)}</p>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input class="form-input" value="${escapeHTML(url)}" readonly onclick="this.select()">
        <button type="button" class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(() => showAdminToast('Link copied.', 'success'))">Copy</button>
      </div>
    </div>`;
}

async function resendMemberInvite(agencyId, userId) {
  const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${agencyId}/members/${userId}/resend`, { method: 'POST' });
  if (!ok) return showAdminToast(data.message || 'Could not resend the invite.', 'error');
  if (data.data.emailSent) showAdminToast(data.message, 'success');
  else document.getElementById('memberInviteResult').innerHTML = inviteLinkBox(data.data.inviteURL, 'Email is not set up. Send this link to them yourself:');
}

function openInviteAgency(prefill = {}) {
  const form = document.getElementById('inviteAgencyForm');
  form.reset();
  form.hidden = false;
  document.getElementById('inviteAgencyResult').hidden = true;
  document.getElementById('inviteAgencyError').hidden = true;
  ['leadId', 'agencyName', 'contactName', 'email', 'phone', 'regions', 'website'].forEach(field => {
    form.elements[field].value = prefill[field] || '';
  });
  openModal('inviteAgencyModal');
  form.elements.agencyName.focus();
}

function inviteFromLead(leadId) {
  const lead = adminState.agentLeads.find(l => l._id === leadId);
  if (!lead) return;
  openInviteAgency({
    leadId: lead._id,
    agencyName: lead.agencyName,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    regions: lead.regions,
    website: lead.website
  });
}

async function handleInviteAgency(e) {
  e.preventDefault();
  const form = e.target;
  const errorBox = document.getElementById('inviteAgencyError');
  const body = Object.fromEntries(new FormData(form).entries());
  Object.keys(body).forEach(k => { body[k] = body[k].trim(); });
  if (!body.leadId) delete body.leadId;

  const fail = message => {
    errorBox.textContent = message;
    errorBox.hidden = false;
  };
  if (!body.agencyName) return fail('Enter the agency name.');
  if (!body.contactName) return fail("Enter the owner's name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return fail("Enter the owner's email address.");

  const btn = document.getElementById('inviteAgencySubmit');
  btn.disabled = true;
  btn.textContent = 'Creating agency...';
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/agencies', { method: 'POST', body: JSON.stringify(body) });
    if (!ok) return fail(data.message || 'Could not create the agency.');

    form.hidden = true;
    const result = document.getElementById('inviteAgencyResult');
    result.hidden = false;
    result.innerHTML = `
      <p style="margin-bottom: 12px;">${escapeHTML(data.message)}</p>
      ${data.data.emailSent ? '' : inviteLinkBox(data.data.inviteURL, 'Invite link (works for 7 days):')}
      <div style="display:flex; gap:8px; margin-top: 16px;">
        <button class="btn btn-primary" onclick="closeModal('inviteAgencyModal'); openAgency('${escapeHTML(data.data.agency._id)}')">Open agency</button>
        <button class="btn btn-secondary" onclick="closeModal('inviteAgencyModal')">Done</button>
      </div>`;
    loadAgencies();
    loadAgentLeads();
    updateStats();
  } catch (err) {
    fail('Could not reach the server.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create agency and send invite';
  }
}

// Init
window.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
});
