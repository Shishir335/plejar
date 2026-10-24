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

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
  updateNav();
});
