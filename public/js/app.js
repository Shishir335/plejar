/**
 * Plezar Starter Application - Core Frontend Logic
 */

// Application State
const state = {
  user: null,
  token: localStorage.getItem('plezar_token') || null,
  health: null
};

// UI Elements
const dom = {
  healthPill: document.getElementById('healthStatusPill'),
  navAuthArea: document.getElementById('navAuthArea'),
  userHeroSection: document.getElementById('userHeroSection'),
  guestHeroSection: document.getElementById('guestHeroSection'),
  apiConsoleOutput: document.getElementById('apiConsoleOutput'),
  apiConsoleStatus: document.getElementById('apiConsoleStatus'),
  toastContainer: document.getElementById('toastContainer')
};

// Toast notification helper
function showToast(message, type = 'info') {
  if (!dom.toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;">&times;</button>
  `;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Modal management
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

// Fetch helper with auth header
async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include' // include httpOnly cookies
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// Check Backend Health
async function checkHealth() {
  try {
    const { ok, status, data } = await apiRequest('/api/v1/health');
    state.health = data;
    if (dom.healthPill) {
      if (ok && data.status === 'success') {
        dom.healthPill.innerHTML = `<span class="status-dot"></span> API Operational (${data.environment})`;
        dom.healthPill.className = 'status-pill';
      } else {
        dom.healthPill.innerHTML = `<span class="status-dot" style="background:#ef4444;"></span> Status: ${status}`;
        dom.healthPill.style.background = 'rgba(239, 68, 68, 0.15)';
        dom.healthPill.style.color = '#ef4444';
      }
    }
  } catch (err) {
    if (dom.healthPill) {
      dom.healthPill.innerHTML = `<span class="status-dot" style="background:#ef4444;"></span> Backend Offline`;
      dom.healthPill.style.background = 'rgba(239, 68, 68, 0.15)';
      dom.healthPill.style.color = '#ef4444';
    }
  }
}

// Load Authenticated User Profile
async function loadCurrentUser() {
  try {
    const { ok, data } = await apiRequest('/api/v1/users/me');
    if (ok && data.data) {
      state.user = data.data;
      renderAuthUI();
    } else {
      state.user = null;
      renderAuthUI();
    }
  } catch (err) {
    state.user = null;
    renderAuthUI();
  }
}

// Render Navigation & Hero depending on Auth State
function renderAuthUI() {
  if (!dom.navAuthArea) return;

  if (state.user) {
    const roleClass = `role-${state.user.role || 'user'}`;
    const initial = (state.user.name || 'U').charAt(0).toUpperCase();

    dom.navAuthArea.innerHTML = `
      <div class="user-menu-pill" onclick="openProfileModal()">
        <div class="user-avatar">${initial}</div>
        <span class="user-name">${state.user.name || 'User'}</span>
        <span class="role-badge ${roleClass}">${state.user.role || 'user'}</span>
      </div>
      ${['admin', 'manager', 'dev'].includes(state.user.role) ? `
        <a href="/admin" class="btn btn-outline btn-sm">Admin Console &rarr;</a>
      ` : ''}
      <button class="btn btn-secondary btn-sm" onclick="handleLogout()">Logout</button>
    `;

    if (dom.guestHeroSection) dom.guestHeroSection.style.display = 'none';
    if (dom.userHeroSection) {
      dom.userHeroSection.style.display = 'block';
      const welcomeName = document.getElementById('userWelcomeName');
      if (welcomeName) welcomeName.textContent = state.user.name;
    }
  } else {
    dom.navAuthArea.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="openModal('loginModal')">Sign In</button>
      <button class="btn btn-primary btn-sm" onclick="openModal('signupModal')">Create Account</button>
    `;

    if (dom.guestHeroSection) dom.guestHeroSection.style.display = 'block';
    if (dom.userHeroSection) dom.userHeroSection.style.display = 'none';
  }
}

// Authentication Handlers
async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value;
  const password = form.password.value;
  const submitBtn = form.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Authenticating...';

  try {
    const { ok, status, data } = await apiRequest('/api/v1/users/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (ok && data.token) {
      state.token = data.token;
      state.user = data.data;
      localStorage.setItem('plezar_token', data.token);
      showToast(`Welcome back, ${state.user.name}!`, 'success');
      closeModal('loginModal');
      renderAuthUI();
      form.reset();
    } else {
      showToast(data.message || 'Login failed. Check your credentials.', 'error');
    }
  } catch (err) {
    showToast('Network error during login.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value;
  const email = form.email.value;
  const password = form.password.value;
  const confirmPassword = form.confirmPassword.value;
  const submitBtn = form.querySelector('button[type="submit"]');

  if (password !== confirmPassword) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account...';

  try {
    const { ok, status, data } = await apiRequest('/api/v1/users/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, confirmPassword })
    });

    if (ok && data.token) {
      state.token = data.token;
      state.user = data.data;
      localStorage.setItem('plezar_token', data.token);
      showToast('Account created successfully!', 'success');
      closeModal('signupModal');
      renderAuthUI();
      form.reset();
    } else {
      showToast(data.message || 'Signup failed.', 'error');
    }
  } catch (err) {
    showToast('Network error during signup.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
}

async function handleLogout() {
  try {
    await apiRequest('/api/v1/users/logout');
  } catch (e) {}

  state.token = null;
  state.user = null;
  localStorage.removeItem('plezar_token');
  showToast('Logged out successfully.', 'info');
  renderAuthUI();
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value;
  const submitBtn = form.querySelector('button[type="submit"]');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending reset link...';

  try {
    const { ok, data } = await apiRequest('/api/v1/users/forgotPassword', {
      method: 'POST',
      body: JSON.stringify({ email })
    });

    if (ok) {
      showToast(data.message || 'Reset link sent to your email!', 'success');
      closeModal('forgotModal');
      form.reset();
    } else {
      showToast(data.message || 'Could not send reset link.', 'error');
    }
  } catch (err) {
    showToast('Network error.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Reset Link';
  }
}

// Newsletter Subscription Handler
async function handleSubscribe(e) {
  e.preventDefault();
  const form = e.target;
  const emailInput = form.querySelector('input[type="email"]');
  const email = emailInput?.value;
  if (!email) return;

  try {
    const { ok, data } = await apiRequest('/api/v1/subscribers', {
      method: 'POST',
      body: JSON.stringify({ email, source: 'starter_landing' })
    });

    if (ok) {
      showToast(data.message || 'Subscribed successfully!', 'success');
      emailInput.value = '';
    } else {
      showToast(data.message || 'Subscription failed.', 'error');
    }
  } catch (err) {
    showToast('Error subscribing to newsletter.', 'error');
  }
}

// Interactive API Explorer Runner
const apiEndpoints = {
  health: {
    name: 'Health Check',
    method: 'GET',
    url: '/api/v1/health',
    body: null
  },
  me: {
    name: 'Current User Profile',
    method: 'GET',
    url: '/api/v1/users/me',
    body: null
  },
  usersList: {
    name: 'List Users (Admin)',
    method: 'GET',
    url: '/api/v1/users',
    body: null
  },
  subscribe: {
    name: 'Newsletter Subscribe',
    method: 'POST',
    url: '/api/v1/subscribers',
    body: { email: 'dev@example.com', source: 'api_explorer' }
  }
};

async function testEndpoint(key) {
  const ep = apiEndpoints[key];
  if (!ep) return;

  // Update tabs active state
  document.querySelectorAll('.endpoint-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`[data-endpoint="${key}"]`);
  if (activeTab) activeTab.classList.add('active');

  if (dom.apiConsoleOutput) {
    dom.apiConsoleOutput.textContent = `// Sending ${ep.method} ${ep.url}...\n// Awaiting response...`;
  }
  if (dom.apiConsoleStatus) {
    dom.apiConsoleStatus.textContent = 'Status: Pending';
    dom.apiConsoleStatus.style.color = '#94a3b8';
  }

  const startTime = performance.now();
  try {
    const opts = { method: ep.method };
    if (ep.body) opts.body = JSON.stringify(ep.body);

    const { status, ok, data } = await apiRequest(ep.url, opts);
    const duration = Math.round(performance.now() - startTime);

    if (dom.apiConsoleStatus) {
      dom.apiConsoleStatus.textContent = `HTTP ${status} (${duration}ms)`;
      dom.apiConsoleStatus.style.color = ok ? '#10b981' : '#ef4444';
    }

    if (dom.apiConsoleOutput) {
      dom.apiConsoleOutput.textContent = JSON.stringify(data, null, 2);
    }
  } catch (err) {
    if (dom.apiConsoleStatus) {
      dom.apiConsoleStatus.textContent = 'Error: Failed to fetch';
      dom.apiConsoleStatus.style.color = '#ef4444';
    }
    if (dom.apiConsoleOutput) {
      dom.apiConsoleOutput.textContent = `// Exception caught:\n${err.message}`;
    }
  }
}

// Profile Modal Details
function openProfileModal() {
  if (!state.user) return;
  const modal = document.getElementById('profileModal');
  if (!modal) return;

  const nameEl = document.getElementById('profileName');
  const emailEl = document.getElementById('profileEmail');
  const roleEl = document.getElementById('profileRole');
  const createdEl = document.getElementById('profileCreatedAt');

  if (nameEl) nameEl.textContent = state.user.name || 'User';
  if (emailEl) emailEl.textContent = state.user.email || '';
  if (roleEl) roleEl.textContent = (state.user.role || 'user').toUpperCase();
  if (createdEl) createdEl.textContent = state.user.createdAt ? new Date(state.user.createdAt).toLocaleDateString() : 'N/A';

  openModal('profileModal');
}

// Initialization on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  loadCurrentUser();

  // Run initial health check in explorer
  testEndpoint('health');
});
