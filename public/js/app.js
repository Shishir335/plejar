/**
 * Plezar showcase page - frontend logic
 */

const dom = {
  nav: document.getElementById('nav'),
  navLinks: document.getElementById('navLinks'),
  toastContainer: document.getElementById('toastContainer')
};

// Escape text before inserting it as HTML
function escapeHTML(value) {
  // Escape quotes too, so the result is safe inside HTML attributes as well as text
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

// Mobile navigation toggle
function toggleNav(button) {
  if (!dom.navLinks) return;
  const open = dom.navLinks.classList.toggle('open');
  button.setAttribute('aria-expanded', String(open));
  updateNav();
}

if (dom.navLinks) {
  dom.navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => dom.navLinks.classList.remove('open'));
  });
}

// Nav sits transparent over the hero photo, then turns solid once you scroll past it
function updateNav() {
  if (!dom.nav) return;
  const pastHero = window.scrollY > window.innerHeight * 0.6;
  const menuOpen = dom.navLinks && dom.navLinks.classList.contains('open');
  dom.nav.classList.toggle('is-solid', pastHero || menuOpen || dom.nav.dataset.solid === 'true');
}

window.addEventListener('scroll', updateNav, { passive: true });

// Server replies are in English, so in Bangla mode show our own translated message instead
function serverText(data, key) {
  if (i18n.lang === 'bn') return t(key);
  return (data && data.message) || t(key);
}

// Email updates signup (source comes from the form's data-source)
async function handleSubscribe(e) {
  e.preventDefault();
  const form = e.target;
  const emailInput = form.querySelector('input[type="email"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const email = emailInput?.value;
  if (!email) return;

  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/v1/subscribers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: form.dataset.source || 'landing' })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      showToast(serverText(data, 'subscribed'), 'success');
      emailInput.value = '';
    } else {
      showToast(serverText(data, 'subscribeFailed'), 'error');
    }
  } catch (err) {
    showToast(t('offline'), 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Shared form checks (the membership application page uses these too)
const BD_PHONE = /^(?:\+?880|0)1[3-9]\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Web Authentication & Google Sign-In ----------

let currentUser = null;
let webGoogleInitialized = false;

function showAlertInModal(msg, type = 'error') {
  const alertEl = document.getElementById('authModalAlert');
  if (!alertEl) return;
  if (!msg) {
    alertEl.hidden = true;
    alertEl.textContent = '';
    alertEl.className = 'auth-modal-alert';
    return;
  }
  alertEl.hidden = false;
  alertEl.className = `auth-modal-alert ${type}`;
  alertEl.textContent = msg;
}

function openAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  showAlertInModal('');
  modal.hidden = false;
  initWebGoogleAuth();
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.hidden = true;
  showAlertInModal('');
}

function handleAuthModalClick(e) {
  if (e.target && e.target.id === 'authModal') {
    closeAuthModal();
  }
}

function toggleUserDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('navUserDropdown');
  const btn = document.getElementById('navUserBtn');
  if (!dropdown || !btn) return;
  const isHidden = dropdown.hidden;
  dropdown.hidden = !isHidden;
  btn.setAttribute('aria-expanded', String(isHidden));
}

document.addEventListener('click', e => {
  const badge = document.getElementById('navUserBadge');
  const dropdown = document.getElementById('navUserDropdown');
  if (badge && dropdown && !badge.contains(e.target)) {
    dropdown.hidden = true;
    document.getElementById('navUserBtn')?.setAttribute('aria-expanded', 'false');
  }
});

async function initWebGoogleAuth() {
  if (webGoogleInitialized || !window.PlezarGoogleAuth) return;
  const target = document.getElementById('webGoogleBtn');
  if (!target) return;
  webGoogleInitialized = true;

  await window.PlezarGoogleAuth.renderButton({
    target: 'webGoogleBtn',
    theme: 'outline',
    text: 'continue_with',
    shape: 'rectangular',
    size: 'large',
    width: 320,
    onSuccess: handleWebGoogleResponse,
    onError: err => {
      showAlertInModal(err.message || 'Google Sign-In initialization failed.');
    }
  });
}

async function handleWebGoogleResponse(response) {
  if (!response || !response.credential) return;
  showAlertInModal('Signing you in with Google...', 'info');

  try {
    const { ok, data } = await window.PlezarGoogleAuth.loginWithGoogleCredential(response.credential);
    if (ok && data.token) {
      currentUser = data.data;
      try { localStorage.setItem('plezar_token', data.token); } catch (e) { /* cookie still active */ }
      updateUserUI(currentUser);
      closeAuthModal();
      showToast(`Welcome, ${currentUser.name || 'Traveler'}!`, 'success');
    } else {
      showAlertInModal(data.message || 'Google sign-in could not be completed.');
    }
  } catch (err) {
    showAlertInModal('Network error. Please try again.');
  }
}

function updateUserUI(user) {
  const signInBtn = document.getElementById('navSignInBtn');
  const badge = document.getElementById('navUserBadge');
  if (!signInBtn || !badge) return;

  if (user) {
    signInBtn.hidden = true;
    badge.hidden = false;

    const avatar = document.getElementById('navUserAvatar');
    const nameEl = document.getElementById('navUserName');
    const dropName = document.getElementById('dropdownName');
    const dropEmail = document.getElementById('dropdownEmail');
    const dropRole = document.getElementById('dropdownRole');
    const adminLink = document.getElementById('dropdownAdminLink');
    const agentLink = document.getElementById('dropdownAgentLink');

    if (avatar) avatar.src = user.photo && user.photo !== 'profile.png' ? user.photo : '/img/users/profile.png';
    const firstName = user.firstName || (user.name ? user.name.split(' ')[0] : 'Account');
    if (nameEl) nameEl.textContent = firstName;
    if (dropName) dropName.textContent = user.name || 'Plezar traveler';
    if (dropEmail) dropEmail.textContent = user.email || '';

    const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role || 'user'];
    const isStaff = roles.some(r => ['admin', 'manager', 'dev'].includes(r));
    const isAgent = roles.includes('agent') && user.agency;

    if (dropRole) {
      dropRole.textContent = isStaff ? 'Administrator' : isAgent ? 'Vendor' : 'Traveler';
    }
    if (adminLink) adminLink.hidden = !isStaff;
    if (agentLink) agentLink.hidden = !isAgent;
  } else {
    signInBtn.hidden = false;
    badge.hidden = true;
  }
}

async function checkCurrentUser() {
  try {
    const token = localStorage.getItem('plezar_token');
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch('/api/v1/users/me', { headers, credentials: 'include' });
    if (res.ok) {
      const json = await res.json();
      if (json && json.status === 'success' && json.data && json.data.user) {
        currentUser = json.data.user;
        updateUserUI(currentUser);
      }
    }
  } catch (_) {
    // Offline or guest visitor
  }
}

async function handleWebLogout() {
  try {
    await fetch('/api/v1/users/logout', { credentials: 'include' });
  } catch (_) {}
  try { localStorage.removeItem('plezar_token'); } catch (_) {}
  currentUser = null;
  updateUserUI(null);
  const dropdown = document.getElementById('navUserDropdown');
  if (dropdown) dropdown.hidden = true;
  showToast('Signed out successfully.', 'info');
}

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
  updateNav();
  checkCurrentUser();
});
