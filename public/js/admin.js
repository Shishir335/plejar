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

// Accounts don't store a creation date, but every MongoDB ID starts with its creation time
function joinedDate(record) {
  if (record && record.createdAt) return new Date(record.createdAt);
  const hex = record && typeof record._id === 'string' ? record._id.slice(0, 8) : '';
  return /^[0-9a-f]{8}$/i.test(hex) ? new Date(parseInt(hex, 16) * 1000) : null;
}

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
      loadPendingAgencies();
      loadDashboard();
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

  renderMyProfile();
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
      loadPendingAgencies();
      loadDashboard();
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

async function handleAdminLogout() {
  // End the server session too, otherwise the login cookie signs you straight back in
  await adminFetch('/api/v1/users/logout').catch(() => {});
  try { localStorage.removeItem('plezar_token'); } catch (e) { /* ignore */ }
  adminState.token = null;
  adminState.currentUser = null;
  document.getElementById('adminLoginForm')?.reset();
  switchTab('dashboard');
  showForgotForm(false);
  showAdminToast('Signed out.', 'info');
  showLogin();
}

// Switch Sidebar Tabs
const TAB_TITLES = {
  dashboard: 'Dashboard', users: 'User Directory', subscribers: 'Newsletter Leads', agencies: 'Agencies',
  pendingAgencies: 'Pending Agencies', agentLeads: 'Agent Leads', system: 'System Status', profile: 'My profile', agencyDetail: 'Agency'
};

function switchTab(tabId) {
  const title = document.getElementById('topbarTitle');
  if (title) title.textContent = TAB_TITLES[tabId] || 'Admin Console';
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

// Refresh the sidebar badge counts (the numbers themselves live on the Dashboard)
async function updateStats() {
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/stats');
    if (!ok) return;
    const pending = document.getElementById('agenciesPendingCount');
    if (pending) {
      pending.textContent = data.data.stats.pendingVerification;
      pending.hidden = data.data.stats.pendingVerification === 0;
    }
  } catch (e) {
    // Badges are informational; leave the last values in place
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
    const joined = joinedDate(user);
    const createdAt = joined ? joined.toLocaleDateString() : 'N/A';
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

// ---------- Forgot password (login screen) ----------

function showForgotForm(show) {
  const login = document.getElementById('adminLoginForm');
  const forgot = document.getElementById('adminForgotForm');
  if (!login || !forgot) return;
  login.hidden = show;
  forgot.hidden = !show;
  const msg = document.getElementById('forgotMessage');
  if (msg) msg.hidden = true;
  if (show) {
    const typed = login.elements.email.value;
    if (typed) forgot.elements.email.value = typed;
    forgot.elements.email.focus();
  }
}

async function handleAdminForgot(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.elements.email.value.trim();
  const msg = document.getElementById('forgotMessage');
  const btn = document.getElementById('forgotSubmit');
  const say = (text, isError) => {
    msg.textContent = text;
    msg.classList.toggle('is-error', Boolean(isError));
    msg.hidden = false;
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say('Enter a valid email address.', true);

  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const { status } = await adminFetch('/api/v1/users/forgotPassword', { method: 'POST', body: JSON.stringify({ email }) });
    // Same message whether or not the email exists, so this form can't be used to find admin accounts
    if (status === 200 || status === 404) {
      say(`If ${email} has an account, a reset link is on its way. Check your inbox and spam folder.`);
    } else {
      say("The reset email couldn't be sent right now. Try again later, or ask the site owner to reset your password.", true);
    }
  } catch (err) {
    say('Could not reach the server. Check your connection and try again.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send reset link';
  }
}

// ---------- My profile ----------

function renderMyProfile() {
  const me = adminState.currentUser;
  if (!me) return;
  const initial = (me.name || 'A').charAt(0).toUpperCase();
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('topbarUserName', me.name || 'My profile');
  set('sidebarUserName', me.name || 'My profile');
  set('topbarAvatar', initial);
  set('sidebarAvatar', initial);

  const form = document.getElementById('profileForm');
  if (form) {
    form.elements.name.value = me.name || '';
    form.elements.email.value = me.email || '';
    form.elements.phone.value = me.phone || '';
  }
  set('pfRole', me.role || 'admin');
  const joined = joinedDate(me);
  set('pfJoined', joined ? joined.toLocaleDateString() : 'date not recorded');
}

function showFormNote(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', Boolean(isError));
  el.hidden = !text;
}

async function saveMyProfile(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    name: form.elements.name.value.trim(),
    email: form.elements.email.value.trim(),
    phone: form.elements.phone.value.trim()
  };
  if (!body.name) return showFormNote('profileMessage', 'Enter your name.', true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return showFormNote('profileMessage', 'Enter a valid email address.', true);

  const btn = document.getElementById('profileSave');
  btn.disabled = true;
  try {
    const { ok, data } = await adminFetch('/api/v1/users/updateMe', { method: 'PATCH', body: JSON.stringify(body) });
    if (!ok) return showFormNote('profileMessage', data.message || 'Could not save your details.', true);
    adminState.currentUser = { ...adminState.currentUser, ...data.data };
    renderMyProfile();
    showFormNote('profileMessage', 'Details saved.');
  } catch (err) {
    showFormNote('profileMessage', 'Could not reach the server.', true);
  } finally {
    btn.disabled = false;
  }
}

async function changeMyPassword(e) {
  e.preventDefault();
  const form = e.target;
  const currentPassword = form.elements.currentPassword.value;
  const password = form.elements.password.value;
  const confirmPassword = form.elements.confirmPassword.value;
  if (!currentPassword) return showFormNote('passwordMessage', 'Enter your current password.', true);
  if (password.length < 8) return showFormNote('passwordMessage', 'Use at least 8 characters for the new password.', true);
  if (password !== confirmPassword) return showFormNote('passwordMessage', "The new passwords don't match.", true);
  if (password === currentPassword) return showFormNote('passwordMessage', 'Choose a password different from your current one.', true);

  const btn = document.getElementById('passwordSave');
  btn.disabled = true;
  btn.textContent = 'Changing...';
  try {
    const { ok, data } = await adminFetch('/api/v1/users/changePassword', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, password, confirmPassword })
    });
    if (!ok) return showFormNote('passwordMessage', data.message || 'Could not change your password.', true);
    // Changing the password invalidates older sessions, so keep the new token
    if (data.token) {
      adminState.token = data.token;
      try { localStorage.setItem('plezar_token', data.token); } catch (err) { /* cookie still works */ }
    }
    form.reset();
    showFormNote('passwordMessage', 'Password changed. Use the new password next time you sign in.');
  } catch (err) {
    showFormNote('passwordMessage', 'Could not reach the server.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Change password';
  }
}

// ---------- Pending agencies ----------

function pendingRowMessage(id, text) {
  const tbody = document.getElementById(id);
  if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--text-dim);">${escapeHTML(text)}</td></tr>`;
}

async function loadPendingAgencies() {
  pendingRowMessage('pendingReviewBody', 'Loading...');
  pendingRowMessage('pendingInviteBody', 'Loading...');
  const result = document.getElementById('pendingInviteResult');
  if (result) result.innerHTML = '';

  try {
    const { ok, data } = await adminFetch('/api/v1/admin/agencies');
    if (!ok) {
      pendingRowMessage('pendingReviewBody', data.message || 'Could not load agencies.');
      pendingRowMessage('pendingInviteBody', '');
      return;
    }
    const all = data.data.agencies;
    const fmt = d => (d ? new Date(d).toLocaleDateString() : '—');
    const ownerCell = a => (a.owner
      ? `<span class="lead-main">${escapeHTML(a.owner.name)}</span><span class="lead-sub">${escapeHTML(a.owner.email)}</span>`
      : '—');
    const agencyCell = a => `
      <div class="user-cell">${agencyLogo(a)}<div class="user-cell-info">
        <span class="user-cell-name">${escapeHTML(a.name)}</span>
        <span class="user-cell-email">${escapeHTML((a.regions || []).join(', ')) || '—'}</span>
      </div></div>`;

    const review = all.filter(a => a.verificationStatus === 'pending');
    const invited = all.filter(a => a.owner && a.owner.accountStatus === 'invited');

    const reviewBody = document.getElementById('pendingReviewBody');
    if (!review.length) pendingRowMessage('pendingReviewBody', 'Nothing to review. New document submissions will appear here.');
    else {
      reviewBody.innerHTML = review.map(a => `
        <tr>
          <td>${agencyCell(a)}</td>
          <td>${ownerCell(a)}</td>
          <td>${escapeHTML(fmt(a.verificationSubmittedAt))}</td>
          <td style="text-align:right;"><button class="btn btn-primary btn-sm" onclick="openAgency('${escapeHTML(a.id)}')">Review documents</button></td>
        </tr>`).join('');
    }

    const inviteBody = document.getElementById('pendingInviteBody');
    if (!invited.length) pendingRowMessage('pendingInviteBody', 'Every invited owner has signed up.');
    else {
      inviteBody.innerHTML = invited.map(a => `
        <tr>
          <td>${agencyCell(a)}</td>
          <td>${ownerCell(a)}</td>
          <td>${escapeHTML(fmt(a.createdAt))}</td>
          <td style="text-align:right;">
            <button class="btn btn-secondary btn-sm" onclick="resendOwnerInvite('${escapeHTML(a.id)}', '${escapeHTML(a.owner.id)}')">Resend invite</button>
            <button class="btn btn-secondary btn-sm" onclick="openAgency('${escapeHTML(a.id)}')">Open</button>
          </td>
        </tr>`).join('');
    }

    const badge = document.getElementById('agenciesPendingCount');
    if (badge) {
      badge.textContent = review.length;
      badge.hidden = review.length === 0;
    }
  } catch (err) {
    pendingRowMessage('pendingReviewBody', 'Failed to load agencies.');
    pendingRowMessage('pendingInviteBody', '');
  }
}

async function resendOwnerInvite(agencyId, userId) {
  const { ok, data } = await adminFetch(`/api/v1/admin/agencies/${agencyId}/members/${userId}/resend`, { method: 'POST' });
  if (!ok) return showAdminToast(data.message || 'Could not resend the invite.', 'error');
  if (data.data.emailSent) showAdminToast(data.message, 'success');
  else document.getElementById('pendingInviteResult').innerHTML = inviteLinkBox(data.data.inviteURL, 'Email is not set up. Send this new link to the owner yourself (works for 7 days):');
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

// ---------- Theme (light / dark) ----------

const THEME_KEY = 'plezar_admin_theme';
const systemLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

function savedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch (e) {
    return 'system';
  }
}

function effectiveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemLight && systemLight.matches ? 'light' : 'dark';
}

// pref: 'light' | 'dark' | 'system'
function setTheme(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch (e) { /* storage blocked: the choice lasts until reload */ }
  applyTheme(pref);
}

function applyTheme(pref) {
  const theme = effectiveTheme(pref);
  document.documentElement.setAttribute('data-theme', theme);
  const next = theme === 'dark' ? 'light' : 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    btn.setAttribute('aria-label', `Switch to ${next} theme`);
    btn.title = `Switch to ${next} theme`;
  });
  document.querySelectorAll('[data-theme-choice]').forEach(btn => {
    btn.setAttribute('aria-checked', String(btn.dataset.themeChoice === pref));
  });
}

document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
  btn.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
});
document.querySelectorAll('[data-theme-choice]').forEach(btn => {
  btn.addEventListener('click', () => setTheme(btn.dataset.themeChoice));
});
if (systemLight && systemLight.addEventListener) {
  systemLight.addEventListener('change', () => {
    if (savedTheme() === 'system') applyTheme('system');
  });
}
applyTheme(savedTheme());

// ---------- Dashboard ----------

const nf = new Intl.NumberFormat('en-US');
const shortDate = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const when = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;

function kpiTile(label, value, note, weekGain) {
  const gain = weekGain > 0
    ? `<span class="up">+${nf.format(weekGain)}</span> in the last 7 days`
    : (weekGain === 0 ? 'None in the last 7 days' : '');
  return `
    <div class="kpi">
      <div class="kpi-label">${escapeHTML(label)}</div>
      <div class="kpi-value">${nf.format(value)}</div>
      <div class="kpi-note">${note ? `${escapeHTML(note)}${gain ? ' · ' : ''}` : ''}${gain}</div>
    </div>`;
}

// 30 columns, one series. Hover or focus a column for its value; the table button lists every value.
function columnChart(id, title, noun, dates, values) {
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);
  const cols = values.map((v, i) => {
    const label = `${shortDate(dates[i])}: ${plural(v, noun[0], noun[1])}`;
    return `<div class="col ${v === 0 ? 'is-zero' : ''}" tabindex="0" role="img" aria-label="${escapeHTML(label)}" data-date="${escapeHTML(shortDate(dates[i]))}" data-value="${v}" data-noun="${escapeHTML(v === 1 ? noun[0] : noun[1])}"><i style="height:${(v / max) * 100}%"></i></div>`;
  }).join('');
  const rows = dates.map((d, i) => `<tr><td>${escapeHTML(shortDate(d))}</td><td>${values[i]}</td></tr>`).join('');
  return `
    <div class="chart-card">
      <div class="chart-head">
        <div>
          <div class="chart-title">${escapeHTML(title)}</div>
          <div class="chart-total"><strong>${nf.format(total)}</strong>in the last 30 days</div>
        </div>
        <button class="link-btn" type="button" onclick="toggleChartTable('${id}', this)" aria-expanded="false" aria-controls="${id}-table">Show table</button>
      </div>
      <div class="chart-wrap">
        <span class="axis-max">${nf.format(max)}</span>
        <div class="cols">${cols}</div>
      </div>
      <div class="axis"><span>${escapeHTML(shortDate(dates[0]))}</span><span>${escapeHTML(shortDate(dates[Math.floor(dates.length / 2)]))}</span><span>${escapeHTML(shortDate(dates[dates.length - 1]))}</span></div>
      <div class="chart-table-wrap" id="${id}-table" hidden>
        <table class="chart-table"><thead><tr><th>Date</th><th>${escapeHTML(noun[1][0].toUpperCase() + noun[1].slice(1))}</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </div>`;
}

function toggleChartTable(id, btn) {
  const box = document.getElementById(`${id}-table`);
  const show = box.hidden;
  box.hidden = !show;
  btn.textContent = show ? 'Hide table' : 'Show table';
  btn.setAttribute('aria-expanded', String(show));
}

// Ranked horizontal bars, one hue; the label names the category and the count sits at the bar tip
function barList(items) {
  const max = Math.max(...items.map(i => i.count), 1);
  return `<div class="bars">${items.map(i => `
    <div class="bar-row">
      <span>${escapeHTML(i.label)}</span>
      <div class="bar-track"><span class="bar-fill" style="width:${(i.count / max) * 100}%"></span></div>
      <span class="bar-count">${nf.format(i.count)}</span>
    </div>`).join('')}</div>`;
}

function recentCard(title, linkLabel, onClick, items, render) {
  return `
    <div class="recent-card">
      <div class="chart-head" style="margin-bottom: 6px;">
        <div class="chart-title">${escapeHTML(title)}</div>
        <button class="link-btn" type="button" onclick="${onClick}">${escapeHTML(linkLabel)}</button>
      </div>
      ${items.length ? `<ul class="recent-list">${items.map(render).join('')}</ul>` : '<p class="recent-empty">Nothing here yet.</p>'}
    </div>`;
}

const ROLE_LABELS = { user: 'Travelers', agent: 'Agency accounts', manager: 'Managers', admin: 'Administrators', dev: 'Developers' };
const VERIFY_KEY_LABELS = { verified: 'Verified', pending: 'Awaiting review', rejected: 'Changes requested', none: 'Not submitted' };

function renderDashboard(d) {
  const t = d.totals;
  const a = d.attention;
  const attention = [];
  if (a.newLeads) attention.push(`<div class="attention-card"><div><strong>${nf.format(a.newLeads)}</strong><span>new agent ${a.newLeads === 1 ? 'lead' : 'leads'} to follow up</span></div><button class="btn btn-secondary btn-sm" onclick="switchTab('agentLeads')">Open leads</button></div>`);
  if (a.pendingVerification) attention.push(`<div class="attention-card"><div><strong>${nf.format(a.pendingVerification)}</strong><span>${a.pendingVerification === 1 ? 'agency is' : 'agencies are'} waiting for verification</span></div><button class="btn btn-secondary btn-sm" onclick="switchTab('pendingAgencies'); loadPendingAgencies();">Review</button></div>`);
  if (a.invitedOwners) attention.push(`<div class="attention-card"><div><strong>${nf.format(a.invitedOwners)}</strong><span>${a.invitedOwners === 1 ? 'owner has' : 'owners have'} not accepted their invite</span></div><button class="btn btn-secondary btn-sm" onclick="switchTab('pendingAgencies'); loadPendingAgencies();">View</button></div>`);

  const s = d.series;
  const bd = d.breakdowns;

  document.getElementById('dashboardBody').innerHTML = `
    <section class="dash-section">
      <h3 class="dash-title">Needs your attention</h3>
      ${attention.length ? `<div class="attention">${attention.join('')}</div>` : '<div class="attention-clear">All caught up. No leads, reviews or invites are waiting.</div>'}
    </section>

    <section class="dash-section">
      <h3 class="dash-title">At a glance</h3>
      <div class="kpi-grid">
        ${kpiTile('Accounts', t.users.total, '', t.users.week)}
        ${kpiTile('Agencies', t.agencies.total, `${nf.format(t.agencies.active)} active · ${nf.format(t.agencies.verified)} verified`, t.agencies.week)}
        ${kpiTile('Published packages', t.packages.published, `${plural(t.packages.draft, 'draft', 'drafts')} · ${nf.format(t.packages.hidden)} hidden`)}
        ${kpiTile('Agent leads', t.leads.total, `${nf.format(t.leads.new)} new`, t.leads.week)}
        ${kpiTile('Newsletter subscribers', t.subscribers.active, `${nf.format(t.subscribers.total)} ever signed up`, t.subscribers.week)}
        ${kpiTile('Suspended agencies', t.agencies.suspended, t.agencies.suspended ? 'Locked out of the agency panel' : 'None')}
      </div>
    </section>

    <section class="dash-section">
      <h3 class="dash-title">Activity <span class="dash-sub">last 30 days, Dhaka time</span></h3>
      <div class="chart-grid">
        ${columnChart('chartUsers', 'New accounts', ['account', 'accounts'], s.dates, s.users)}
        ${columnChart('chartLeads', 'Agent leads', ['lead', 'leads'], s.dates, s.leads)}
        ${columnChart('chartSubs', 'Newsletter signups', ['signup', 'signups'], s.dates, s.subscribers)}
        ${columnChart('chartAgencies', 'New agencies', ['agency', 'agencies'], s.dates, s.agencies)}
      </div>
    </section>

    <section class="dash-section">
      <h3 class="dash-title">Breakdowns</h3>
      <div class="chart-grid">
        <div class="chart-card"><div class="chart-head"><div class="chart-title">Accounts by type</div></div>${barList(bd.userRoles.map(r => ({ label: ROLE_LABELS[r.role] || r.role, count: r.count })))}</div>
        <div class="chart-card"><div class="chart-head"><div class="chart-title">Agency verification</div></div>${barList(bd.verification.map(r => ({ label: VERIFY_KEY_LABELS[r.key], count: r.count })))}</div>
        <div class="chart-card"><div class="chart-head"><div class="chart-title">Tour packages</div></div>${barList(bd.packageStatus.map(r => ({ label: r.status[0].toUpperCase() + r.status.slice(1), count: r.count })))}</div>
        <div class="chart-card"><div class="chart-head"><div class="chart-title">Agent leads by status</div></div>${barList(bd.leadStatus.map(r => ({ label: r.status[0].toUpperCase() + r.status.slice(1), count: r.count })))}</div>
      </div>
    </section>

    <section class="dash-section">
      <h3 class="dash-title">Latest activity</h3>
      <div class="recent-grid">
        ${recentCard('Latest agent leads', 'View all', "switchTab('agentLeads')", d.recent.leads, l => `
          <li><div class="recent-main"><strong>${escapeHTML(l.agencyName)}</strong><span>${escapeHTML(l.contactName)} · ${escapeHTML(l.phone)}</span></div>
          <div class="recent-side"><span class="badge ${l.status === 'new' ? 'badge-manager' : (l.status === 'contacted' ? 'badge-active' : 'badge-inactive')}">${escapeHTML(l.status)}</span>${escapeHTML(when(l.createdAt))}</div></li>`)}
        ${recentCard('Latest agencies', 'View all', "switchTab('agencies')", d.recent.agencies, ag => `
          <li><div class="recent-main"><strong>${escapeHTML(ag.name)}</strong><span>${escapeHTML((ag.regions || []).join(', ')) || 'No areas listed'}</span></div>
          <div class="recent-side"><span class="badge ${ag.verified ? 'badge-active' : 'badge-inactive'}">${ag.verified ? 'verified' : escapeHTML(ag.status)}</span>${escapeHTML(when(ag.createdAt))}</div></li>`)}
        ${recentCard('Latest accounts', 'View all', "switchTab('users')", d.recent.users, u => `
          <li><div class="recent-main"><strong>${escapeHTML(u.name)}</strong><span>${escapeHTML(u.email)}</span></div>
          <div class="recent-side"><span class="badge badge-${escapeHTML(u.role)}">${escapeHTML(u.role)}</span>${escapeHTML(when(u.createdAt))}</div></li>`)}
        ${recentCard('Latest newsletter signups', 'View all', "switchTab('subscribers')", d.recent.subscribers, sub => `
          <li><div class="recent-main"><strong>${escapeHTML(sub.email)}</strong><span>${escapeHTML(sub.source || 'newsletter')}</span></div>
          <div class="recent-side"><span class="badge ${sub.status === 'active' ? 'badge-active' : 'badge-inactive'}">${escapeHTML(sub.status)}</span>${escapeHTML(when(sub.createdAt))}</div></li>`)}
        ${recentCard('Top agencies by published packages', 'View agencies', "switchTab('agencies')", d.topAgencies, ag => `
          <li><div class="recent-main"><strong>${escapeHTML(ag.name)}</strong><span>${ag.verified ? 'Verified agency' : 'Not verified'}</span></div>
          <div class="recent-side"><strong style="font-size:1rem;color:var(--text-primary)">${nf.format(ag.publishedPackages)}</strong>published</div></li>`)}
      </div>
    </section>`;

  document.getElementById('dashUpdated').textContent = `Updated ${new Date(d.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

async function loadDashboard() {
  const body = document.getElementById('dashboardBody');
  if (!body) return;
  body.classList.add('dash-loading'); // keep the previous render visible while refreshing
  try {
    const { ok, data } = await adminFetch('/api/v1/admin/dashboard');
    if (!ok) {
      body.innerHTML = `<p class="recent-empty">${escapeHTML(data.message || 'Could not load the dashboard.')}</p>`;
      return;
    }
    renderDashboard(data.data);
  } catch (e) {
    body.innerHTML = '<p class="recent-empty">Could not reach the server. Check your connection and refresh.</p>';
  } finally {
    body.classList.remove('dash-loading');
  }
}

// One shared tooltip for every column chart (hover or keyboard focus)
(function initChartTooltip() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.appendChild(tip);

  const show = col => {
    const r = col.getBoundingClientRect();
    tip.replaceChildren();
    const value = document.createElement('strong');
    value.textContent = `${col.dataset.value} ${col.dataset.noun}`;
    const day = document.createElement('span');
    day.textContent = col.dataset.date;
    tip.append(value, day);
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(r.left + r.width / 2, 60), window.innerWidth - 60)}px`;
    tip.style.top = `${r.top - 6}px`;
  };
  const hide = () => { tip.hidden = true; };

  document.addEventListener('pointerover', e => { const c = e.target.closest('.col'); if (c) show(c); });
  document.addEventListener('pointerout', e => { if (e.target.closest('.col')) hide(); });
  document.addEventListener('focusin', e => { const c = e.target.closest('.col'); if (c) show(c); });
  document.addEventListener('focusout', e => { if (e.target.closest('.col')) hide(); });
  window.addEventListener('scroll', hide, { passive: true, capture: true });
})();

// Init
window.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
});
