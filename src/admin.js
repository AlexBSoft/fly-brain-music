import './admin.css';

const TOKEN_KEY = 'dr-stun-admin-token';
const $ = (selector) => document.querySelector(selector);
const loginScreen = $('#login-screen');
const dashboard = $('#dashboard');
const loginForm = $('#login-form');
const loginError = $('#login-error');
const toastElement = $('#toast');
const importStatus = $('#import-status');
const importStatusText = $('#import-status-text');
const importProgressText = $('#import-progress-text');
const importProgressBar = $('#import-progress-bar');
const progressTrack = importStatus.querySelector('.progress-track');

let token = readToken();
let artists = [];
let tracks = [];
let playlists = [];
let toastTimer;

function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function saveToken(value) {
  token = value;
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* A session without storage still works until page reload. */ }
}

function showLogin(message = '') {
  dashboard.hidden = true;
  loginScreen.hidden = false;
  loginError.textContent = message;
  loginError.hidden = !message;
  $('#password').focus();
}

function showDashboard() {
  loginScreen.hidden = true;
  dashboard.hidden = false;
  loginForm.reset();
}

function expireSession() {
  saveToken('');
  showLogin('Сессия завершилась. Введите пароль ещё раз.');
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { error: text }; }
}

function errorMessage(data, response) {
  const value = data?.error || data?.detail || data?.message;
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) return value.map((entry) => entry.msg || String(entry)).join('; ');
  return `Ошибка ${response.status}. Попробуйте ещё раз.`;
}

async function api(path, { method = 'GET', body, authenticated = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (authenticated && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    if (authenticated && response.status === 401) expireSession();
    throw new Error(errorMessage(data, response));
  }
  return data;
}

function toast(message, isError = false) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.toggle('error', isError);
  toastElement.hidden = false;
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, 4800);
}

function showImportStatus(message, progress = null, isError = false) {
  importStatus.hidden = false;
  importStatus.classList.toggle('error', isError);
  importStatusText.textContent = message;
  importProgressText.textContent = typeof progress === 'number' ? `${Math.round(progress)}%` : '';
  progressTrack.classList.toggle('indeterminate', progress === null && !isError);
  importProgressBar.style.width = typeof progress === 'number' ? `${Math.max(0, Math.min(100, progress))}%` : '';
}

function setFormBusy(form, busy) {
  for (const control of form.querySelectorAll('input, button')) control.disabled = busy;
}

function setImportBusy(form, busy) {
  setFormBusy(form, busy);
  $('#tab-file').disabled = busy;
  $('#tab-youtube').disabled = busy;
}

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function displayArtist(track) {
  if (typeof track.artist === 'string') return track.artist || 'Без артиста';
  if (track.artist && typeof track.artist.name === 'string') return track.artist.name;
  return track.artistName || track.artist_name || 'Без артиста';
}

function displayDuration(raw) {
  const value = raw?.duration ?? raw?.durationSeconds ?? raw?.duration_seconds;
  if (typeof value === 'string' && value.includes(':')) return value;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}` : `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

function sourceLabel(track) {
  const source = String(track.source || track.sourceType || track.source_type || '').toLowerCase();
  if (source.includes('youtube')) return 'YOUTUBE';
  const format = String(track.mimeType || track.mime_type || track.format || track.filename || '').toLowerCase();
  if (format.includes('mp4')) return 'MP4';
  return 'АУДИО';
}

function linkFor(slug) {
  return new URL(`/p/${encodeURIComponent(slug)}`, window.location.origin).href;
}

async function copyLink(slug) {
  const value = linkFor(slug);
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      if (!copied) throw new Error('Clipboard unavailable');
    }
    toast('Ссылка скопирована');
  } catch {
    window.prompt('Скопируйте ссылку:', value);
  }
}

function renderPlaylists() {
  const container = $('#playlist-list');
  container.replaceChildren();
  const globalFromApi = playlists.find((playlist) => playlist.slug === 'all' || playlist.kind === 'global');
  const list = [{ slug: 'all', name: 'Все треки', kind: 'global', trackCount: tracks.length, ...globalFromApi }];
  const others = playlists.filter((playlist) => playlist.slug && playlist.slug !== 'all' && playlist.kind !== 'global');
  if (others.length) list.push(...others);
  else list.push(...artists.filter((artist) => artist.slug).map((artist) => ({ ...artist, kind: 'artist' })));

  for (const playlist of list) {
    const item = make('div', `playlist-item${playlist.kind === 'global' ? ' global' : ''}`);
    const symbol = make('span', 'playlist-symbol', playlist.kind === 'global' ? '✦' : '♫');
    symbol.setAttribute('aria-hidden', 'true');
    const meta = make('div', 'playlist-meta');
    meta.append(make('strong', '', playlist.name || playlist.slug));
    const count = Number(playlist.trackCount ?? playlist.track_count ?? 0);
    meta.append(make('small', '', `${count} ${pluralTracks(count)}`));
    const button = make('button', 'playlist-copy', 'Ссылка ↗');
    button.type = 'button';
    button.setAttribute('aria-label', `Скопировать ссылку на плейлист ${playlist.name || playlist.slug}`);
    button.addEventListener('click', () => copyLink(playlist.slug));
    item.append(symbol, meta, button);
    container.append(item);
  }
  $('#track-count').textContent = tracks.length.toLocaleString('ru-RU');
  $('#artist-count').textContent = artists.length.toLocaleString('ru-RU');
}

function pluralTracks(count) {
  if (count % 10 === 1 && count % 100 !== 11) return 'трек';
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'трека';
  return 'треков';
}

function renderArtistSuggestions() {
  for (const list of [$('#artist-suggestions'), $('#edit-artist-suggestions')]) {
    list.replaceChildren();
    for (const artist of artists) {
      const option = document.createElement('option');
      option.value = artist.name;
      list.append(option);
    }
  }
}

function openEdit(track) {
  $('#edit-track-id').value = String(track.id);
  $('#edit-track-title').value = track.title || '';
  $('#edit-track-artist').value = displayArtist(track) === 'Без артиста' ? '' : displayArtist(track);
  $('#edit-dialog').showModal();
  $('#edit-track-title').focus();
}

function openDelete(track) {
  $('#delete-track-id').value = String(track.id);
  $('#delete-description').textContent = `«${track.title || 'Этот трек'}» исчезнет из всех плейлистов. Это действие нельзя отменить.`;
  $('#delete-dialog').showModal();
}

function renderTracks() {
  const body = $('#tracks-body');
  body.replaceChildren();
  const query = $('#track-search').value.trim().toLocaleLowerCase('ru-RU');
  const visible = tracks.filter((track) => `${track.title || ''} ${displayArtist(track)}`.toLocaleLowerCase('ru-RU').includes(query));
  for (const track of visible) {
    const row = document.createElement('tr');
    const name = make('td');
    name.append(make('span', 'track-name', track.title || 'Без названия'), make('small', 'track-source', sourceLabel(track)));
    const artist = make('td', '', displayArtist(track));
    const duration = make('td', 'track-duration', displayDuration(track));
    const actions = make('td');
    const controls = make('div', 'row-actions');
    const edit = make('button', '', 'Править');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Править трек ${track.title || ''}`);
    edit.addEventListener('click', () => openEdit(track));
    const remove = make('button', 'delete', 'Удалить');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Удалить трек ${track.title || ''}`);
    remove.addEventListener('click', () => openDelete(track));
    controls.append(edit, remove);
    actions.append(controls);
    row.append(name, artist, duration, actions);
    body.append(row);
  }
  const empty = $('#tracks-empty');
  empty.textContent = tracks.length ? 'По вашему запросу треков не найдено.' : 'Здесь пока нет треков. Добавьте первый трек выше.';
  empty.hidden = visible.length > 0;
}

async function loadLibrary() {
  const [artistResult, trackResult, playlistResult] = await Promise.all([
    api('/api/admin/artists'),
    api('/api/admin/tracks'),
    api('/api/playlists'),
  ]);
  artists = Array.isArray(artistResult) ? artistResult : artistResult.artists || [];
  tracks = Array.isArray(trackResult) ? trackResult : trackResult.tracks || [];
  playlists = Array.isArray(playlistResult) ? playlistResult : playlistResult.playlists || [];
  renderArtistSuggestions();
  renderPlaylists();
  renderTracks();
}

async function refreshLibrary() {
  const button = $('#refresh-button');
  button.disabled = true;
  try { await loadLibrary(); }
  catch (error) { toast(error.message || 'Не удалось загрузить медиатеку.', true); }
  finally { button.disabled = false; }
}

function selectTab(which) {
  const file = which === 'file';
  $('#tab-file').setAttribute('aria-selected', String(file));
  $('#tab-youtube').setAttribute('aria-selected', String(!file));
  $('#file-form').hidden = !file;
  $('#youtube-form').hidden = file;
  importStatus.hidden = true;
}

function updateFileLabel() {
  const file = $('#media-file').files?.[0];
  $('#file-label').textContent = file ? file.name : 'Выберите MP3 или MP4';
  $('#file-help').textContent = file ? `${(file.size / 1024 / 1024).toFixed(1)} МБ · готов к загрузке` : 'До 150 МБ и 20 минут';
}

function uploadFile(formData) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/admin/tracks/upload');
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Accept', 'application/json');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) showImportStatus('Передаём файл на сервер…', event.loaded / event.total * 100);
    };
    request.upload.onload = () => showImportStatus('Файл загружен. Готовим трек…');
    request.onerror = () => reject(new Error('Сеть недоступна. Проверьте соединение.'));
    request.onload = () => {
      let data;
      try { data = JSON.parse(request.responseText || '{}'); } catch { data = { error: request.responseText }; }
      if (request.status >= 200 && request.status < 300) resolve(data);
      else {
        if (request.status === 401) expireSession();
        reject(new Error(errorMessage(data, { status: request.status })));
      }
    };
    request.send(formData);
  });
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-submit');
  button.disabled = true;
  loginError.hidden = true;
  try {
    const response = await api('/api/admin/login', { method: 'POST', body: { password: $('#password').value }, authenticated: false });
    if (!response.token) throw new Error('Сервер не выдал доступ. Попробуйте ещё раз.');
    saveToken(response.token);
    showDashboard();
    await refreshLibrary();
  } catch (error) {
    if (!token) {
      loginError.textContent = error.message || 'Не удалось войти.';
      loginError.hidden = false;
    }
  } finally { button.disabled = false; }
});

$('#logout-button').addEventListener('click', () => { saveToken(''); showLogin(); });
$('#copy-all-link').addEventListener('click', () => copyLink('all'));
$('#refresh-button').addEventListener('click', refreshLibrary);
$('#track-search').addEventListener('input', renderTracks);
$('#tab-file').addEventListener('click', () => selectTab('file'));
$('#tab-youtube').addEventListener('click', () => selectTab('youtube'));
$('#media-file').addEventListener('change', updateFileLabel);

const fileDrop = $('#file-drop');
for (const type of ['dragenter', 'dragover']) fileDrop.addEventListener(type, (event) => { event.preventDefault(); fileDrop.classList.add('drag-over'); });
for (const type of ['dragleave', 'drop']) fileDrop.addEventListener(type, (event) => { event.preventDefault(); fileDrop.classList.remove('drag-over'); });
fileDrop.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files?.length) return;
  $('#media-file').files = event.dataTransfer.files;
  updateFileLabel();
});

$('#file-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = $('#media-file').files?.[0];
  if (!file) return;
  if (!/\.(mp3|mp4)$/i.test(file.name)) {
    showImportStatus('Выберите файл MP3 или MP4.', null, true);
    return;
  }
  const payload = new FormData();
  payload.append('file', file);
  payload.append('title', $('#upload-title').value.trim() || file.name.replace(/\.(mp3|mp4)$/i, ''));
  payload.append('artist', $('#upload-artist').value.trim());
  setImportBusy(form, true);
  showImportStatus('Начинаем загрузку…', 0);
  try {
    await uploadFile(payload);
    showImportStatus('Трек добавлен в медиатеку.', 100);
    toast('Трек добавлен');
    form.reset();
    updateFileLabel();
    await refreshLibrary();
  } catch (error) {
    showImportStatus(error.message || 'Не удалось загрузить файл.', null, true);
  } finally { setImportBusy(form, false); }
});

$('#youtube-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const url = $('#youtube-url').value.trim();
  let parsed;
  try { parsed = new URL(url); } catch { showImportStatus('Введите корректную ссылку.', null, true); return; }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(parsed.hostname)) {
    showImportStatus('Нужна ссылка на YouTube.', null, true);
    return;
  }
  const payload = { url };
  const title = $('#youtube-title').value.trim();
  const artist = $('#youtube-artist').value.trim();
  if (title) payload.title = title;
  if (artist) payload.artist = artist;
  setImportBusy(form, true);
  showImportStatus('Загружаем и готовим трек. Это может занять несколько минут…');
  try {
    await api('/api/admin/tracks/youtube', { method: 'POST', body: payload });
    showImportStatus('Трек добавлен в медиатеку.', 100);
    toast('Трек добавлен');
    form.reset();
    await refreshLibrary();
  } catch (error) {
    showImportStatus(error.message || 'Не удалось импортировать видео.', null, true);
  } finally { setImportBusy(form, false); }
});

$('#artist-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $('#artist-name').value.trim();
  if (!name) return;
  setFormBusy(form, true);
  try {
    await api('/api/admin/artists', { method: 'POST', body: { name } });
    form.reset();
    toast('Плейлист артиста создан');
    await refreshLibrary();
  } catch (error) { toast(error.message || 'Не удалось создать артиста.', true); }
  finally { setFormBusy(form, false); }
});

$('#edit-cancel').addEventListener('click', () => $('#edit-dialog').close());
$('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#edit-track-id').value;
  const title = $('#edit-track-title').value.trim();
  const artist = $('#edit-track-artist').value.trim();
  if (!title || !artist) return;
  $('#edit-save').disabled = true;
  try {
    await api(`/api/admin/tracks/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title, artist } });
    $('#edit-dialog').close();
    $('#track-search').value = '';
    toast('Трек обновлён');
    await refreshLibrary();
  } catch (error) { toast(error.message || 'Не удалось обновить трек.', true); }
  finally { $('#edit-save').disabled = false; }
});

$('#delete-cancel').addEventListener('click', () => $('#delete-dialog').close());
$('#delete-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#delete-track-id').value;
  $('#delete-confirm').disabled = true;
  try {
    await api(`/api/admin/tracks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    $('#delete-dialog').close();
    toast('Трек удалён');
    await refreshLibrary();
  } catch (error) { toast(error.message || 'Не удалось удалить трек.', true); }
  finally { $('#delete-confirm').disabled = false; }
});

(async () => {
  if (!token) { showLogin(); return; }
  try {
    await api('/api/admin/me');
    showDashboard();
    await refreshLibrary();
  } catch (error) {
    if (token) {
      showDashboard();
      toast(error.message || 'Не удалось проверить доступ.', true);
    }
  }
})();
