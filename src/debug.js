const SOUND_METRICS = [
  { key: 'bassImpact', label: 'Удар баса', note: 'встряска · прыжок · крылья' },
  { key: 'bass', label: 'Бас', note: 'корпус · энергия' },
  { key: 'sub', label: 'Саббас', note: 'басовая встряска' },
  { key: 'vocal', label: 'Речитатив', note: 'сваг · шаг в сторону' },
  { key: 'vocalPulse', label: 'Акцент голоса', note: 'плечи · кивок' },
  { key: 'mid', label: 'Середина', note: 'корпус · плечи' },
  { key: 'presence', label: 'Присутствие', note: 'сваг · голова' },
  { key: 'air', label: 'Верхние частоты', note: 'крылья · усики' },
  { key: 'onset', label: 'Атака звука', note: 'смена жеста · усики' },
  { key: 'kick', label: 'Бочка', note: 'прыжок · шаг' },
  { key: 'snare', label: 'Снейр', note: 'плечи · шаг' },
  { key: 'hat', label: 'Хэты', note: 'крылья' },
  { key: 'groove', label: 'Грув', note: 'шаги · раскачка' },
  { key: 'beatPhase', label: 'Фаза ритма', note: 'синхронизация' },
  { key: 'rhythmConfidence', label: 'Ритм', note: 'уверенность анализа' },
];

const MOTION_METRICS = [
  { key: 'energy', label: 'Энергия', note: 'общая интенсивность' },
  { key: 'bassShake', label: 'Басовая встряска', note: '← саббас · удар баса' },
  { key: 'hop', label: 'Прыжок', note: '← бочка · удар баса' },
  { key: 'swagger', label: 'Сваг', note: '← речитатив · присутствие · грув' },
  { key: 'sideStep', label: 'Шаг в сторону', note: '← речитатив · присутствие · грув' },
  { key: 'shoulderRoll', label: 'Плечи', note: '← акцент голоса · снейр' },
  { key: 'headNod', label: 'Кивок', note: '← акцент голоса · присутствие' },
  { key: 'legStep', label: 'Шаги лапами', note: '← грув · бочка · снейр' },
  { key: 'wingFlare', label: 'Крылья', note: '← верх · хэты · удар баса' },
  { key: 'antenna', label: 'Усики', note: '← верх · атака звука' },
];

function makeRow(metric) {
  const row = document.createElement('div');
  row.className = 'debug-row';

  const heading = document.createElement('div');
  heading.className = 'debug-row-head';

  const name = document.createElement('span');
  name.className = 'debug-row-name';
  name.textContent = metric.label;
  name.title = metric.key;

  const value = document.createElement('span');
  value.className = 'debug-row-value';
  value.textContent = '—';

  const bar = document.createElement('div');
  bar.className = 'debug-bar';
  bar.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('span');
  fill.className = 'debug-bar-fill';
  bar.append(fill);

  const note = document.createElement('small');
  note.className = 'debug-row-note';
  note.textContent = metric.note;

  heading.append(name, value);
  row.append(heading, bar, note);
  return { row, value, fill, key: metric.key };
}

function fillRows(container, metrics) {
  const rows = metrics.map(makeRow);
  container.replaceChildren(...rows.map(({ row }) => row));
  return rows;
}

function refreshRows(rows, values) {
  for (const { key, value, fill } of rows) {
    const amount = values?.[key];
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      value.textContent = '—';
      fill.style.width = '0%';
      continue;
    }
    value.textContent = Math.abs(amount) >= 10 ? amount.toFixed(1) : amount.toFixed(2);
    fill.style.width = `${Math.min(100, Math.abs(amount) * 100)}%`;
  }
}

export function createDebugPanel({ panel, toggleButton }) {
  if (!panel || !toggleButton) {
    return { update() {}, toggle() {}, dispose() {} };
  }

  const audioRows = fillRows(panel.querySelector('#debug-audio-rows'), SOUND_METRICS);
  const motionRows = fillRows(panel.querySelector('#debug-motion-rows'), MOTION_METRICS);
  const modeText = panel.querySelector('#debug-mode');
  const gestureText = panel.querySelector('#debug-gesture');
  let lastAudio = {};
  let lastMotion = {};
  let lastPaint = 0;

  function paint(force = false) {
    if (panel.hidden || (!force && performance.now() - lastPaint < 90)) return;
    lastPaint = performance.now();
    modeText.textContent = String(lastMotion?.mode || '—').slice(0, 34);
    gestureText.textContent = String(lastMotion?.gesture || '—').slice(0, 34);
    refreshRows(audioRows, lastAudio);
    refreshRows(motionRows, lastMotion);
  }

  function setVisible(visible) {
    panel.hidden = !visible;
    toggleButton.classList.toggle('active', visible);
    toggleButton.setAttribute('aria-expanded', String(visible));
    toggleButton.setAttribute('aria-label', visible
      ? 'Скрыть отладку движений и звука'
      : 'Показать отладку движений и звука');
    toggleButton.title = visible
      ? 'Скрыть движение и звук · D'
      : 'Показать движение и звук · D';
    if (visible) paint(true);
    return visible;
  }

  function toggle() {
    return setVisible(panel.hidden);
  }

  function onKeyDown(event) {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyD') return;
    const target = event.target;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    toggle();
  }

  toggleButton.addEventListener('click', toggle);
  document.addEventListener('keydown', onKeyDown);

  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    setVisible(true);
  } else {
    setVisible(false);
  }

  return {
    update(audio, motion) {
      lastAudio = audio || {};
      lastMotion = motion || {};
      paint();
    },
    toggle,
    dispose() {
      toggleButton.removeEventListener('click', toggle);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
