const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : 'Не удалось открыть музыкальную библиотеку.';
    throw new Error(detail);
  }
  return data;
}

export function playlistSlugFromPath(pathname = window.location.pathname) {
  const match = /^\/p\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export async function libraryHasTracks() {
  const data = await api('/api/playlists');
  return Array.isArray(data.playlists) && data.playlists.some((playlist) => playlist.slug === 'all' && playlist.trackCount > 0);
}

export function createRadio({ slug, video, onPlaylist, onTrack, onTaste, onError }) {
  const path = '/api/playlists/' + encodeURIComponent(slug);
  let playlist = null;
  let current = null;
  let taste = null;
  let switching = false;
  let listenedSeconds = 0;
  let lastFrame = 0;
  let decisionAt = 85 + Math.random() * 35;
  let recent = [];
  let samples = 0;
  const totals = { bass: 0, groove: 0, energy: 0, treble: 0, vocal: 0, motion: 0 };

  function setTaste(nextTaste) {
    if (!nextTaste) return;
    taste = nextTaste;
    onTaste(nextTaste);
  }

  function resetListening() {
    listenedSeconds = 0;
    lastFrame = 0;
    decisionAt = 85 + Math.random() * 35;
    samples = 0;
    for (const key of Object.keys(totals)) totals[key] = 0;
  }

  function averages() {
    const values = {};
    for (const key of Object.keys(totals)) values[key] = clamp01(totals[key] / Math.max(1, samples));
    return values;
  }

  async function chooseTrack(autoplay) {
    const data = await api(path + '/next', {
      method: 'POST',
      body: JSON.stringify({ excludeTrackIds: recent.slice(-3) }),
    });
    if (!data.track) throw new Error('В плейлисте пока нет треков.');
    current = data.track;
    recent.push(current.id);
    if (recent.length > 8) recent = recent.slice(-8);
    resetListening();
    setTaste(data.taste);
    await onTrack(current, autoplay);
  }

  async function initialize() {
    const data = await api(path);
    playlist = data.playlist;
    if (!playlist || !Array.isArray(data.tracks) || !data.tracks.length) {
      throw new Error('В этом плейлисте пока нет треков.');
    }
    onPlaylist(playlist);
    setTaste(data.taste);
    await chooseTrack(false);
    return playlist;
  }

  async function next(reason = 'manual-skip') {
    if (switching || !current || !playlist) return;
    switching = true;
    const previous = current;
    const played = listenedSeconds;
    const features = averages();
    if (reason !== 'manual-skip') {
      try {
        const feedback = await api(path + '/feedback', {
          method: 'POST',
          body: JSON.stringify({
            trackId: previous.id,
            secondsPlayed: Math.round(played),
            reason,
            features: {
              bass: features.bass,
              groove: features.groove,
              energy: features.energy,
              treble: features.treble,
              vocal: features.vocal,
              motion: features.motion,
            },
          }),
        });
        setTaste(feedback.taste);
      } catch (error) {
        // A temporary feedback failure must never leave the listener on a silent track.
        console.warn('Fly taste feedback failed:', error);
      }
    }
    try {
      await chooseTrack(true);
    } catch (error) {
      onError(error);
    } finally {
      switching = false;
    }
  }

  function tick(timestamp, signal, visual) {
    if (!current || switching) return;
    const seconds = timestamp / 1000;
    const delta = lastFrame ? Math.min(0.1, Math.max(0, seconds - lastFrame)) : 0;
    lastFrame = seconds;
    if (video.paused || video.ended || video.readyState < 2) return;
    listenedSeconds += delta;
    if (delta > 0) {
      samples += 1;
      totals.bass += clamp01(signal.bass);
      totals.groove += clamp01(signal.groove);
      totals.energy += clamp01(signal.sectionEnergy);
      totals.treble += clamp01(signal.treble);
      totals.vocal += clamp01(signal.vocal);
      totals.motion += clamp01(visual.motion);
    }
    if ((playlist.trackCount || 0) < 2 || listenedSeconds < decisionAt) return;
    const mean = averages();
    const favorite = Array.isArray(taste?.favorites) && taste.favorites.some((item) => item.id === current.id);
    const restlessness = clamp01(0.44 + (0.45 - mean.energy) * 0.25 + mean.vocal * 0.08 - mean.groove * 0.12);
    const shouldSwitch = listenedSeconds > 240 || Math.random() < (favorite ? restlessness * 0.4 : restlessness);
    decisionAt = listenedSeconds + 38 + Math.random() * 42;
    if (shouldSwitch) next('fly-skip');
  }

  return {
    initialize,
    next,
    tick,
    get current() { return current; },
    get playlist() { return playlist; },
    get taste() { return taste; },
    get switching() { return switching; },
  };
}
