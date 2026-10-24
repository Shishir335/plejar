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
  const targetBtn = document.querySelector(`[data-tab="${tabId}"]`);

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
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--color-danger);">${data.message || 'Could not load users'}</td></tr>`;
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--color-danger);">Failed to fetch user directory</td></tr>';
  }
}

// Update Stats Cards
function updateStats() {
  const total = adminState.users.length;
  const admins = adminState.users.filter(u => u.role === 'admin' || u.role === 'manager').length;
  const regulars = adminState.users.filter(u => u.role === 'user').length;

  document.getElementById('statTotalUsers').textContent = total;
  document.getElementById('statAdminUsers').textContent = admins;
  document.getElementById('statStandardUsers').textContent = regulars;
  document.getElementById('statSubscribers').textContent = adminState.subscribers.length;
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
    const initial = (user.name || 'U').charAt(0).toUpperCase();
    const roleBadge = `<span class="badge badge-${user.role || 'user'}">${user.role || 'user'}</span>`;
    const createdAt = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A';
    const isSelf = adminState.currentUser && adminState.currentUser._id === user._id;

    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${initial}</div>
            <div class="user-cell-info">
              <span class="user-cell-name">${user.name || 'Unnamed'}</span>
              <span class="user-cell-email">${user.email}</span>
            </div>
          </div>
        </td>
        <td>${roleBadge}</td>
        <td style="color: var(--text-muted); font-size: 0.85rem;">${createdAt}</td>
        <td>
          <span class="badge badge-active">Active</span>
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" onclick="openEditRoleModal('${user._id}', '${user.name}', '${user.role}')">Role</button>
            <button class="btn btn-secondary btn-sm" onclick="openResetPasswordModal('${user._id}', '${user.name}', '${user.email}')">Reset Pwd</button>
            ${!isSelf ? `
              <button class="btn btn-danger btn-sm" onclick="handleDeleteUser('${user._id}', '${user.email}')">Delete</button>
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
        <td style="font-weight: 600;">${sub.email}</td>
        <td><span class="badge badge-active">${sub.status || 'active'}</span></td>
        <td style="color: var(--text-muted);">${sub.source || 'newsletter'}</td>
        <td style="color: var(--text-muted);">${date}</td>
        <td style="text-align: right;">
          <button class="btn btn-danger btn-sm" onclick="handleDeleteSubscriber('${sub._id}')">Remove</button>
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
    if (status !== 'contacted') actions.push(`<button class="btn btn-primary btn-sm" onclick="setAgentLeadStatus('${id}', 'contacted')">Mark contacted</button>`);
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

// Init
window.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
});
