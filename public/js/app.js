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
  dom.nav.classList.toggle('is-solid', pastHero || menuOpen);
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

// Tour agent contact form
const BD_PHONE = /^(?:\+?880|0)1[3-9]\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showAgentError(form, message, field) {
  const box = document.getElementById('agentFormError');
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
}

async function handleAgentLead(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form).entries());
  Object.keys(values).forEach(key => { values[key] = values[key].trim(); });
  values.phone = values.phone.replace(/[\s-]/g, '');

  if (!values.agencyName) return showAgentError(form, t('errAgency'), form.agencyName);
  if (!values.contactName) return showAgentError(form, t('errName'), form.contactName);
  if (!BD_PHONE.test(values.phone)) return showAgentError(form, t('errPhone'), form.phone);
  if (!EMAIL.test(values.email)) return showAgentError(form, t('errEmail'), form.email);

  const errorBox = document.getElementById('agentFormError');
  if (errorBox) errorBox.hidden = true;
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));

  submitBtn.disabled = true;
  submitBtn.textContent = t('sending');

  try {
    const res = await fetch('/api/v1/agent-leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showAgentError(form, serverText(data, 'errAgentFailed'));
      return;
    }

    const done = document.getElementById('agentDone');
    const doneText = document.getElementById('agentDoneText');
    if (doneText) doneText.textContent = t('doneText');
    form.hidden = true;
    if (done) {
      done.hidden = false;
      done.focus();
    }
  } catch (err) {
    showAgentError(form, t('offline'));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = t('formSubmit');
  }
}

function resetAgentForm() {
  const form = document.getElementById('agentForm');
  const done = document.getElementById('agentDone');
  if (!form || !done) return;
  form.reset();
  done.hidden = true;
  form.hidden = false;
  form.agencyName.focus();
}

// Initialization
window.addEventListener('DOMContentLoaded', () => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
  updateNav();
});
