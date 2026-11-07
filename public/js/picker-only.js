// Date and time fields are chosen from the browser's picker, never typed. Clicking a field opens the
// calendar or clock; keys can't change it, and Backspace or Delete clears it. Works for fields added later too.
(() => {
  const PICKERS = ['date', 'time', 'datetime-local', 'month', 'week'];
  const isPicker = el => el instanceof HTMLInputElement && PICKERS.includes(el.type);
  // Keys that move between fields or close the picker still work
  const PASS = ['Tab', 'Escape', 'Shift'];
  const OPEN = ['Enter', ' ', 'ArrowDown', 'ArrowUp'];

  const open = input => {
    if (input.disabled || input.readOnly) return;
    try { input.showPicker(); } catch (e) { /* older browsers open it from the calendar icon */ }
  };

  const clear = input => {
    if (input.disabled || input.readOnly || input.required || !input.value) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  document.addEventListener('click', e => { if (isPicker(e.target)) open(e.target); });

  document.addEventListener('keydown', e => {
    const input = e.target;
    if (!isPicker(input) || PASS.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (OPEN.includes(e.key)) open(input);
    else if (e.key === 'Backspace' || e.key === 'Delete') clear(input);
  });

  ['paste', 'drop'].forEach(type => document.addEventListener(type, e => { if (isPicker(e.target)) e.preventDefault(); }));
})();
