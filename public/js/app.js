/**
 * Plezar Landing Page - Core Frontend Logic
 */

// Application State
const state = {
  user: null,
  token: localStorage.getItem('plezar_token') || null
};

// UI Elements
const dom = {
  navAuthArea: document.getElementById('navAuthArea'),
  userHeroSection: document.getElementById('userHeroSection'),
  guestHeroSection: document.getElementById('guestHeroSection'),
  toastContainer: document.getElementById('toastContainer')
};

// Escape user-provided text before inserting it as HTML
function escapeHTML(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

// Toast notification helper
function showToast(message, type = 'info') {
  if (!dom.toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${escapeHTML(message)}</span>
    <button onclick="this.parentElement.remove()" aria-label="Dismiss">&times;</button>
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
  if (!modal) return;
  modal.classList.add('active');
  const firstInput = modal.querySelector('input');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});

// Mobile navigation toggle
function toggleNav(button) {
  const links = document.getElementById('navLinks');
  if (!links) return;
  const open = links.classList.toggle('open');
  button.setAttribute('aria-expanded', String(open));
}

document.querySelectorAll('#navLinks a').forEach(link => {
  link.addEventListener('click', () => {
    document.getElementById('navLinks').classList.remove('open');
  });
});

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

// Load Authenticated User Profile
async function loadCurrentUser() {
  try {
    const { ok, data } = await apiRequest('/api/v1/users/me');
    state.user = ok && data.data ? data.data.user || data.data : null;
  } catch (err) {
    state.user = null;
  }
  renderAuthUI();
}

const isStaff = user => ['admin', 'manager', 'dev'].includes(user && user.role);

// Render Navigation & Hero depending on Auth State
function renderAuthUI() {
  if (!dom.navAuthArea) return;

  if (state.user) {
    const name = state.user.name || 'Explorer';
    const initial = escapeHTML(name.charAt(0).toUpperCase());

    dom.navAuthArea.innerHTML = `
      ${isStaff(state.user) ? '<a href="/admin" class="btn btn-dark btn-sm">Admin</a>' : ''}
      <button class="user-chip" onclick="openProfileModal()">
        <span class="avatar av-a">${initial}</span>
        <span class="user-chip-name">${escapeHTML(name.split(' ')[0])}</span>
        <span class="tag tag-orange">${escapeHTML(state.user.role || 'user')}</span>
      </button>
    `;

    if (dom.guestHeroSection) dom.guestHeroSection.style.display = 'none';
    if (dom.userHeroSection) {
      dom.userHeroSection.style.display = 'block';
      const welcomeName = document.getElementById('userWelcomeName');
      if (welcomeName) welcomeName.textContent = name.split(' ')[0];
    }
  } else {
    dom.navAuthArea.innerHTML = `
      <button class="btn btn-dark btn-sm" onclick="openModal('loginModal')">Sign In</button>
      <button class="btn btn-primary btn-sm" onclick="openModal('signupModal')">Get the App</button>
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
  submitBtn.textContent = 'Signing in...';

  try {
    const { ok, data } = await apiRequest('/api/v1/users/login', {
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
    const { ok, data } = await apiRequest('/api/v1/users/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, confirmPassword })
    });

    if (ok && data.token) {
      state.token = data.token;
      state.user = data.data;
      localStorage.setItem('plezar_token', data.token);
      showToast('Welcome to Plezar! Your account is ready.', 'success');
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

// Newsletter / download-link subscription handler (source comes from the form's data-source)
async function handleSubscribe(e) {
  e.preventDefault();
  const form = e.target;
  const emailInput = form.querySelector('input[type="email"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const email = emailInput?.value;
  if (!email) return;

  if (submitBtn) submitBtn.disabled = true;

  try {
    const { ok, data } = await apiRequest('/api/v1/subscribers', {
      method: 'POST',
      body: JSON.stringify({ email, source: form.dataset.source || 'landing' })
    });

    if (ok) {
      showToast(data.message || 'Subscribed successfully!', 'success');
      emailInput.value = '';
    } else {
      showToast(data.message || 'Subscription failed.', 'error');
    }
  } catch (err) {
    showToast('Error subscribing. Please try again.', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Profile Modal Details
function openProfileModal() {
  if (!state.user) return;

  const name = state.user.name || 'Explorer';
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set('profileInitial', name.charAt(0).toUpperCase());
  set('profileName', name);
  set('profileEmail', state.user.email || '');
  set('profileRole', (state.user.role || 'user').toUpperCase());
  set('profileCreatedAt', state.user.createdAt ? new Date(state.user.createdAt).toLocaleDateString() : 'N/A');

  const adminLink = document.getElementById('profileAdminLink');
  if (adminLink) adminLink.style.display = isStaff(state.user) ? '' : 'none';

  openModal('profileModal');
}

// Decorative QR-style codes (deterministic pattern with finder squares)
function renderQRCodes() {
  const size = 21;
  const inFinder = (r, c) => {
    const corners = [[0, 0], [0, size - 7], [size - 7, 0]];
    return corners.some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7);
  };
  const finderOn = (r, c) => {
    const lr = r % (size - 7) === r ? r : r - (size - 7);
    const lc = c % (size - 7) === c ? c : c - (size - 7);
    const edge = lr === 0 || lr === 6 || lc === 0 || lc === 6;
    const core = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
    return edge || core;
  };

  document.querySelectorAll('.qr').forEach(el => {
    let seed = Number(el.dataset.seed) || 1;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const center = Math.floor(size / 2);
    let cells = '';
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        let cls = '';
        if (inFinder(r, c)) cls = finderOn(r, c) ? 'on' : '';
        else if (Math.abs(r - center) <= 1 && Math.abs(c - center) <= 1) cls = 'hot';
        else cls = rand() > 0.52 ? 'on' : '';
        cells += `<i class="${cls}"></i>`;
      }
    }
    el.innerHTML = cells;
  });
}

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  renderQRCodes();
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
  renderAuthUI();
  loadCurrentUser();
});
