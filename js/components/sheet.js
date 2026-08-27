// components/sheet.js — bottom-sheet primitives shared by the FAB action sheet,
// quick-capture text prompts, and larger form sheets (goal editor, day detail).

function shell(extraClass = '') {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = `sheet ${extraClass}`;
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));

  function close() {
    backdrop.classList.remove('is-open');
    setTimeout(() => backdrop.remove(), 220);
  }
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler, { once: true });
  return { backdrop, sheet, close };
}

export function openSheet({ title, actions, onSelect }) {
  const { sheet, close } = shell('sheet--actions');
  sheet.innerHTML = `
    <div class="sheet__grabber"></div>
    <h2 class="sheet__title">${title}</h2>
    <div class="sheet__actions">
      ${actions.map((a) => `
        <button class="sheet__action" data-id="${a.id}">
          <span class="sheet__action-icon">${a.icon}</span>
          <span class="sheet__action-text">
            <span class="sheet__action-label">${a.label}</span>
            <span class="sheet__action-hint">${a.hint}</span>
          </span>
        </button>
      `).join('')}
    </div>
  `;
  sheet.addEventListener('click', (e) => {
    const btn = e.target.closest('.sheet__action');
    if (!btn) return;
    close();
    onSelect(btn.dataset.id);
  });
  return { close };
}

export function openPrompt({ title, placeholder = '', confirmLabel = 'Add', initialValue = '', multiline = false, presets = [], onSubmit }) {
  const { sheet, close } = shell('sheet--prompt');
  const fieldTag = multiline ? 'textarea' : 'input';
  sheet.innerHTML = `
    <div class="sheet__grabber"></div>
    <h2 class="sheet__title">${title}</h2>
    ${presets.length ? `<div class="sheet__presets">${presets.map((p) => `<button type="button" class="preset-chip" data-value="${p.replace(/"/g, '&quot;')}">${p}</button>`).join('')}</div>` : ''}
    <${fieldTag} class="sheet__input" placeholder="${placeholder}" ${multiline ? '' : 'type="text"'}>${multiline ? initialValue : ''}</${fieldTag}>
    <button class="btn btn--primary sheet__submit">${confirmLabel}</button>
  `;
  const field = sheet.querySelector('.sheet__input');
  if (!multiline) field.value = initialValue;
  sheet.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => { field.value = chip.dataset.value; field.focus(); });
  });
  setTimeout(() => field.focus(), 80);

  function submit() {
    const value = field.value.trim();
    if (!value) { field.focus(); return; }
    close();
    onSubmit(value);
  }
  sheet.querySelector('.sheet__submit').addEventListener('click', submit);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); submit(); }
  });
  return { close };
}

// Large, scrollable form sheet for goal editing / day detail. `mount(bodyEl)` receives
// the content container to populate; caller wires its own save/close logic.
export function openFormSheet({ title, mount, onClose }) {
  const { sheet, close } = shell('sheet--form');
  sheet.innerHTML = `
    <div class="sheet__header">
      <h2 class="sheet__title">${title}</h2>
      <button class="sheet__close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="sheet__body"></div>
  `;
  sheet.querySelector('.sheet__close').addEventListener('click', () => { close(); onClose?.(); });
  const body = sheet.querySelector('.sheet__body');
  mount(body, close);
  return { close, body };
}
