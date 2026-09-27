import './style.css';
import { createStage } from './stage.js';
import { createBrainViz } from './brain.js';
import { createDebugPanel } from './debug.js';
import { createRadio, libraryHasTracks, playlistSlugFromPath } from './radio.js';

const $ = (id) => document.getElementById(id);
const video = $('source-video');
const playlistSlug = playlistSlugFromPath();
if (!playlistSlug) {
  video.src = `${import.meta.env.BASE_URL}media/demo.mp4`;
  video.load();
}
video.poster = `${import.meta.env.BASE_URL}media/poster.jpg`;
const stageCanvas = $('stage-canvas');
const brainCanvas = $('brain-canvas');
const recordingCanvas = $('recording-canvas');
const recordingContext = recordingCanvas.getContext('2d', { alpha: false });
const spectrum = $('spectrum');
const bars = Array.from({ length: spectrum ? 32 : 0 }, () => {
  const bar = document.createElement('i');
  spectrum.append(bar);
  return bar;
});
let toastTimer = null;
let stageFailed = false;
const PORTRAIT_RECORD_WIDTH = 1080;
const PORTRAIT_RECORD_HEIGHT = 1920;

function isPortraitStage() {
  const rect = stageCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  return rect.width <= 700 && rect.height > rect.width
    && Math.abs(rect.width / rect.height - 9 / 16) < 0.035;
}

const themes = {
  club: { name: 'НОЧНОЙ КЛУБ', short: 'Клуб', id: 'CLUB_01', scene: 'НОЧНОЙ КЛУБ' },
  garden: { name: 'ОРАНЖЕРЕЯ', short: 'Оранжерея', id: 'GARDEN_02', scene: 'ОРАНЖЕРЕЯ' },
  home: { name: 'ДОМ', short: 'Дом', id: 'HOME_03', scene: 'ДОМ' },
};
let theme = 'club';
let stage;
try {
  stage = createStage({ canvas: stageCanvas, video });
} catch (error) {
  console.error(error);
  stageFailed = true;
  $('start-overlay').classList.add('hidden');
  $('system-status').textContent = 'WEBGL НЕДОСТУПЕН';
  showToast('Для сцены нужен браузер с поддержкой WebGL.');
  stage = { update() {}, resize() {}, setTheme() {}, setAudioOnly() {}, setRecordingQuality() {}, dispose() {} };
}
const brain = createBrainViz(brainCanvas);
const debug = createDebugPanel({ panel: $('debug-panel'), toggleButton: $('debug-toggle') });

const audioState = {
  context: null,
  source: null,
  analyser: null,
  gain: null,
  recordingDestination: null,
  frequency: null,
  floatFrequency: null,
  waveform: null,
  volume: 0.85,
  muted: false,
  bassAverage: 0.05,
  subAverageDb: null,
  lastBeatAt: -10,
  beatInterval: 0.52,
  phaseAnchor: 0,
  lastSampleAt: 0,
  spectralAverage: 0.008,
  previousSpectrum: null,
  spectrumReady: false,
  previousBands: { sub: 0, bass: 0, lowMid: 0, presence: 0, air: 0, vocalCore: 0, vocalFormants: 0 },
};
// Amplitudes are 0..1. beatCount counts confirmed accents; beatPhase is a
// continuously cycling visual rhythm, including passages without bass hits.
const signal = {
  bass: 0, mid: 0, treble: 0, level: 0, beat: 0,
  sub: 0, lowMid: 0, presence: 0, air: 0,
  onset: 0, kick: 0, snare: 0, hat: 0,
  pulse: 0, groove: 0, beatPhase: 0, beatCount: 0,
  vocal: 0, vocalPulse: 0, bassImpact: 0, sectionEnergy: 0, rhythmConfidence: 0,
};
const visual = { luma: 0.34, motion: 0.08, hue: 0.55 };
let metrics = { vision: 0, hearing: 0, motion: 0, focus: 0 };
let started = false;
let radio = null;
let radioReady = null;
let radioLoadError = null;
let loadingPlayback = false;
let objectUrl = null;
let audioOnly = false;
let recording = null;
let recordingPending = false;
let recordingFinalizing = false;
let lastRecordingUrl = null;
let seekDragging = false;
let lastVisualSample = 0;
let previousPixels = null;
let lastUiUpdate = 0;
let peakFrequency = 0;
const videoProbe = document.createElement('canvas');
videoProbe.width = 32;
videoProbe.height = 18;
const videoProbeContext = videoProbe.getContext('2d', { willReadFrequently: true });

function clamp(value, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

function setStartLoading(loading, label = 'ПОГРУЗИТЬСЯ') {
  loadingPlayback = loading;
  $('start-overlay').classList.toggle('loading', loading);
  $('start-btn').disabled = loading;
  $('start-btn').setAttribute('aria-busy', String(loading));
  $('start-status').textContent = label;
}

function renderTaste(taste) {
  const panel = $('taste-panel');
  panel.hidden = false;
  const moodLabels = {
    'На своей волне': 'НА ВОЛНЕ',
    'Ловит ритм': 'В РИТМЕ',
    'Ищет другое звучание': 'ИЩЕТ ЗВУК',
    'Прислушивается': 'СЛУШАЕТ',
  };
  $('taste-mood').textContent = moodLabels[taste.label] || taste.label || 'СЛУШАЕТ';
  $('taste-mood').title = taste.label || '';
  const lists = [
    [$('taste-favorites'), (taste.favorites || []).slice(0, 2), '♥'],
    [$('taste-dislikes'), (taste.dislikes || []).slice(0, 1), '−'],
  ];
  for (const [container, tracks, icon] of lists) {
    container.replaceChildren();
    for (const track of tracks) {
      const row = document.createElement('div');
      const symbol = document.createElement('span');
      const name = document.createElement('span');
      symbol.textContent = icon;
      name.textContent = (track.artist ? track.artist + ' — ' : '') + track.title;
      name.title = name.textContent;
      row.append(symbol, name);
      container.append(row);
    }
  }
  if (!panel.querySelector('.taste-list > div')) {
    const empty = document.createElement('div');
    empty.className = 'taste-empty';
    empty.textContent = 'Вкус только формируется';
    $('taste-favorites').append(empty);
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

async function ensureAudio() {
  if (!audioState.context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API недоступен в этом браузере.');
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(video);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.74;
    // The default -30 dB upper bound clips the sub-bass of mastered music.
    analyser.minDecibels = -100;
    analyser.maxDecibels = 0;
    const gain = context.createGain();
    gain.gain.value = audioState.muted ? 0 : audioState.volume;
    const recordingDestination = context.createMediaStreamDestination();
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(context.destination);
    analyser.connect(recordingDestination);
    Object.assign(audioState, {
      context, source, analyser, gain, recordingDestination,
      frequency: new Uint8Array(analyser.frequencyBinCount),
      floatFrequency: new Float32Array(analyser.frequencyBinCount),
      waveform: new Uint8Array(analyser.fftSize),
      previousSpectrum: new Uint8Array(analyser.frequencyBinCount),
    });
  }
  if (audioState.context.state !== 'running') await audioState.context.resume();
}

async function play() {
  if (loadingPlayback) return;
  setStartLoading(true, radio ? 'ПОДКЛЮЧАЕМ МУЗЫКУ' : 'ЗАГРУЖАЕМ КЛИП');
  try {
    await ensureAudio();
    if (radio && !radio.current) {
      if (radioLoadError || !radioReady) radioReady = initializeRadio();
      await radioReady;
      if (!radio.current) throw radioLoadError || new Error('Плейлист пока недоступен.');
    }
    await video.play();
    started = true;
    $('start-overlay').classList.add('hidden');
  } catch (error) {
    console.error(error);
    showToast(radio ? error.message || 'Не удалось запустить плейлист.' : 'Не удалось воспроизвести файл. Выберите другое видео или аудио.');
  } finally {
    setStartLoading(false);
    updatePlaybackState();
  }
}

function updatePlaybackState() {
  const playing = !video.paused && !video.ended;
  $('play-btn').classList.toggle('playing', playing);
  $('play-btn').setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
  $('live-badge').classList.toggle('playing', playing);
  $('live-badge').textContent = playing ? '● LIVE' : '● STANDBY';
  $('system-status').textContent = stageFailed ? 'WEBGL НЕДОСТУПЕН' : recording ? 'ИДЁТ ЗАПИСЬ' : playing ? 'СИГНАЛ АКТИВЕН' : 'СЦЕНА ГОТОВА';
  $('start-overlay').classList.toggle('hidden', started || stageFailed);
}

function togglePlayback() {
  if (video.paused) play();
  else video.pause();
}

function updateTimeUi() {
  $('current-time').textContent = formatTime(video.currentTime);
  $('duration').textContent = formatTime(video.duration);
  if (!seekDragging && Number.isFinite(video.duration) && video.duration > 0) {
    const ratio = clamp(video.currentTime / video.duration);
    $('seek').value = Math.round(ratio * 1000);
    $('seek').style.setProperty('--seek-fill', `${ratio * 100}%`);
  }
}

function meanDbBand(minHz, maxHz) {
  const { analyser, floatFrequency, context } = audioState;
  if (!analyser || !floatFrequency || !context) return -110;
  const binHz = context.sampleRate / analyser.fftSize;
  const start = Math.max(1, Math.floor(minHz / binHz));
  const end = Math.min(floatFrequency.length, Math.ceil(maxHz / binHz));
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    const value = floatFrequency[index];
    sum += Number.isFinite(value) ? Math.max(-110, value) : -110;
  }
  return sum / Math.max(1, end - start);
}

function softDb(value, midpoint, width) {
  return 1 / (1 + Math.exp(-(value - midpoint) / width));
}

function resetAudioAnalysis() {
  audioState.bassAverage = 0.05;
  audioState.subAverageDb = null;
  audioState.lastBeatAt = -10;
  audioState.beatInterval = 0.52;
  audioState.phaseAnchor = video.currentTime || 0;
  audioState.lastSampleAt = 0;
  audioState.spectralAverage = 0.008;
  audioState.spectrumReady = false;
  audioState.previousSpectrum?.fill(0);
  for (const key of Object.keys(audioState.previousBands)) audioState.previousBands[key] = 0;
  for (const key of Object.keys(signal)) signal[key] = 0;
  signal.beatPhase = 0;
  peakFrequency = 0;
}

function sampleAudio(now) {
  const { analyser, frequency, floatFrequency, waveform, context } = audioState;
  if (!analyser || video.paused || video.ended) {
    for (const key of ['bass', 'mid', 'treble', 'level', 'sub', 'lowMid', 'presence', 'air', 'vocal', 'sectionEnergy']) signal[key] *= 0.91;
    for (const key of ['onset', 'kick', 'snare', 'hat', 'pulse', 'vocalPulse', 'bassImpact']) signal[key] *= 0.84;
    signal.beat *= 0.86;
    signal.groove *= 0.995;
    signal.rhythmConfidence *= 0.99;
    audioState.spectrumReady = false;
    peakFrequency *= 0.9;
    return;
  }
  analyser.getByteFrequencyData(frequency);
  if (analyser.getFloatFrequencyData) analyser.getFloatFrequencyData(floatFrequency);
  else for (let i = 0; i < floatFrequency.length; i += 1) floatFrequency[i] = -100 + frequency[i] * 100 / 255;
  analyser.getByteTimeDomainData(waveform);
  const deltaTime = clamp(now - audioState.lastSampleAt, 1 / 120, 0.1);
  audioState.lastSampleAt = now;
  const mediaTime = video.currentTime;

  // Floating point decibels retain the dynamics that 8-bit Web Audio bins
  // lose on loud mastered tracks. Soft curves leave headroom in every band.
  const subDb = meanDbBand(28, 85);
  const bassDb = meanDbBand(38, 190);
  const lowMidDb = meanDbBand(190, 650);
  const midDb = meanDbBand(190, 2100);
  const presenceDb = meanDbBand(1800, 5000);
  const trebleDb = meanDbBand(2100, 9000);
  const airDb = meanDbBand(5500, 13000);
  const vocalCoreDb = meanDbBand(280, 1150);
  const vocalFormantsDb = meanDbBand(750, 3000);
  const vocalEdgeDb = meanDbBand(2400, 4200);
  const sub = softDb(subDb, -17, 4);
  const bass = softDb(bassDb, -25, 5);
  const lowMid = softDb(lowMidDb, -43, 7);
  const mid = softDb(midDb, -54, 8);
  const presence = softDb(presenceDb, -60, 10);
  const treble = softDb(trebleDb, -63, 9);
  const air = softDb(airDb, -66, 10);

  let power = 0;
  for (let i = 0; i < waveform.length; i += 4) {
    const sample = (waveform[i] - 128) / 128;
    power += sample * sample;
  }
  const rms = Math.sqrt(power / (waveform.length / 4));
  const level = rms / (rms + 0.36);
  signal.bass += (bass - signal.bass) * 0.34;
  signal.mid += (mid - signal.mid) * 0.25;
  signal.treble += (treble - signal.treble) * 0.22;
  signal.level += (level - signal.level) * 0.28;
  signal.sub += (sub - signal.sub) * 0.34;
  signal.lowMid += (lowMid - signal.lowMid) * 0.27;
  signal.presence += (presence - signal.presence) * 0.28;
  signal.air += (air - signal.air) * 0.25;

  // The midrange's prominence over the lower accompaniment is a useful
  // heuristic for a vocal verse. It is not source separation.
  const vocalProminence = softDb(vocalFormantsDb - lowMidDb, -17, 5);
  const vocalTarget = clamp(
    softDb(vocalCoreDb, -52, 7) * 0.25
    + softDb(vocalFormantsDb, -56, 8) * 0.45
    + softDb(vocalEdgeDb, -64, 8) * 0.2
    + vocalProminence * 0.3 - 0.15,
  );
  signal.vocal += (vocalTarget - signal.vocal) * (vocalTarget > signal.vocal ? 0.36 : 0.17);
  const energyTarget = clamp(level * 0.35 + bass * 0.25 + mid * 0.28 + treble * 0.12);
  signal.sectionEnergy += (energyTarget - signal.sectionEnergy)
    * (1 - Math.exp(-deltaTime / (energyTarget > signal.sectionEnergy ? 0.8 : 2.2)));

  // Positive spectral flux captures broad attacks, with an adaptive floor
  // across quiet and loud local files.
  let rise = 0;
  let bins = 0;
  const previousSpectrum = audioState.previousSpectrum;
  const hadSpectrum = audioState.spectrumReady;
  for (let index = 2; index < Math.min(frequency.length, 580); index += 2) {
    if (hadSpectrum) rise += Math.max(0, frequency[index] - previousSpectrum[index]);
    previousSpectrum[index] = frequency[index];
    bins += 1;
  }
  const spectralFlux = rise / Math.max(1, bins) / 255;
  audioState.spectrumReady = true;
  audioState.spectralAverage += (spectralFlux - audioState.spectralAverage) * 0.022;
  const onset = clamp((spectralFlux - audioState.spectralAverage * 0.66)
    / Math.max(0.008, audioState.spectralAverage * 2.2));
  signal.onset = Math.max(signal.onset * Math.exp(-deltaTime * 10), onset);

  const previousBands = audioState.previousBands;
  const kick = hadSpectrum
    ? clamp(Math.max(0, subDb - previousBands.sub - 0.5) / 3.8
      + Math.max(0, bassDb - previousBands.bass - 0.7) / 8)
    : 0;
  const snare = hadSpectrum
    ? clamp(Math.max(0, lowMidDb - previousBands.lowMid - 0.8) / 7
      + Math.max(0, presenceDb - previousBands.presence - 1) / 12)
    : 0;
  const hat = hadSpectrum ? clamp(Math.max(0, airDb - previousBands.air - 1.2) / 8) : 0;
  const vocalRise = hadSpectrum
    ? Math.max(0, vocalCoreDb - previousBands.vocalCore - 0.6) / 5
      + Math.max(0, vocalFormantsDb - previousBands.vocalFormants - 0.6) / 6
    : 0;
  previousBands.sub = subDb;
  previousBands.bass = bassDb;
  previousBands.lowMid = lowMidDb;
  previousBands.presence = presenceDb;
  previousBands.air = airDb;
  previousBands.vocalCore = vocalCoreDb;
  previousBands.vocalFormants = vocalFormantsDb;
  signal.kick = Math.max(signal.kick * Math.exp(-deltaTime * 14), kick);
  signal.snare = Math.max(signal.snare * Math.exp(-deltaTime * 13), snare);
  signal.hat = Math.max(signal.hat * Math.exp(-deltaTime * 16), hat);
  const vocalAccent = clamp(vocalRise * 0.72 + onset * 0.15) * vocalTarget;
  signal.vocalPulse = Math.max(signal.vocalPulse * Math.exp(-deltaTime * 11), vocalAccent);

  if (audioState.subAverageDb === null) audioState.subAverageDb = subDb;
  audioState.subAverageDb += (subDb - audioState.subAverageDb)
    * (1 - Math.exp(-deltaTime / (subDb > audioState.subAverageDb ? 3.4 : 5.5)));
  const lowEndExcess = clamp((subDb - audioState.subAverageDb - 1.1) / 7);
  const bassProminence = softDb(subDb - vocalFormantsDb, 43, 5);
  const activeBass = clamp((sub - 0.2) / 0.6);
  const bassImpact = clamp(kick * 0.88 + lowEndExcess * 0.4
    + bassProminence * activeBass * 0.32);
  signal.bassImpact = Math.max(signal.bassImpact * Math.exp(-deltaTime * 6.5), bassImpact);

  audioState.bassAverage += (bass - audioState.bassAverage) * (1 - Math.exp(-deltaTime / 3.2));
  const bassAccent = kick > 0.28 && bass > Math.max(0.12, audioState.bassAverage * 0.8);
  const broadAccent = onset > 0.45 && (kick > 0.16 || snare > 0.32);
  if ((bassAccent || broadAccent) && mediaTime - audioState.lastBeatAt > 0.24) {
    const interval = mediaTime - audioState.lastBeatAt;
    let regularity = 0;
    if (interval > 0.26 && interval < 1.25) {
      regularity = 1 - clamp(Math.abs(interval - audioState.beatInterval)
        / Math.max(0.16, audioState.beatInterval * 0.58));
      signal.groove += (regularity - signal.groove) * 0.22;
      const oldInterval = audioState.beatInterval;
      audioState.beatInterval += (interval - audioState.beatInterval) * 0.2;
      const phase = (mediaTime - audioState.phaseAnchor) / oldInterval;
      audioState.phaseAnchor = mediaTime - phase * audioState.beatInterval;
    }
    signal.beat = 1;
    signal.pulse = 1;
    signal.beatCount += 1;
    signal.rhythmConfidence = clamp(signal.rhythmConfidence * 0.64 + 0.13 + regularity * 0.3);
    // Lock gently to confirmed accents without snapping the visual rhythm.
    const nearestCycle = Math.round((mediaTime - audioState.phaseAnchor) / audioState.beatInterval);
    audioState.phaseAnchor += (mediaTime - (audioState.phaseAnchor
      + nearestCycle * audioState.beatInterval)) * 0.22;
    audioState.lastBeatAt = mediaTime;
  } else {
    signal.beat *= Math.exp(-deltaTime * 8.4);
    signal.pulse *= Math.exp(-deltaTime * 4.4);
    signal.groove *= Math.exp(-deltaTime * 0.12);
    signal.rhythmConfidence *= Math.exp(-deltaTime * 0.3);
  }
  const cycles = (mediaTime - audioState.phaseAnchor) / audioState.beatInterval;
  signal.beatPhase = ((cycles % 1) + 1) % 1;

  let strongest = 1;
  for (let index = 2; index < Math.min(400, frequency.length); index += 1) {
    if (frequency[index] > frequency[strongest]) strongest = index;
  }
  peakFrequency = strongest * context.sampleRate / analyser.fftSize;
}

function sampleVideo(now) {
  if (audioOnly) {
    // Music supplies colour and apparent motion when the media has no frames.
    visual.luma += (0.19 + signal.level * 0.24 + signal.beat * 0.12 - visual.luma) * 0.12;
    visual.motion += (clamp(signal.onset * 0.65 + signal.bassImpact * 0.55 + signal.treble * 0.16) - visual.motion) * 0.15;
    visual.hue += (clamp(0.53 + signal.bass * 0.17 + signal.air * 0.13) - visual.hue) * 0.07;
    return;
  }
  if (now - lastVisualSample < 0.09 || !videoProbeContext || video.readyState < 2 || !video.videoWidth) return;
  lastVisualSample = now;
  try {
    videoProbeContext.drawImage(video, 0, 0, videoProbe.width, videoProbe.height);
    const pixels = videoProbeContext.getImageData(0, 0, videoProbe.width, videoProbe.height).data;
    let luminance = 0;
    let change = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      luminance += r * 0.2126 + g * 0.7152 + b * 0.0722;
      red += r; green += g; blue += b;
      if (previousPixels) change += Math.abs(r - previousPixels[i]) + Math.abs(g - previousPixels[i + 1]) + Math.abs(b - previousPixels[i + 2]);
    }
    const count = pixels.length / 4;
    visual.luma += (luminance / count / 255 - visual.luma) * 0.25;
    visual.motion += (clamp(change / count / 3 / 255 * 4.5) - visual.motion) * 0.3;
    const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
    let hue = visual.hue;
    if (max !== min) {
      if (max === red) hue = ((green - blue) / (max - min)) / 6;
      else if (max === green) hue = ((blue - red) / (max - min) + 2) / 6;
      else hue = ((red - green) / (max - min) + 4) / 6;
      hue = (hue + 1) % 1;
    }
    visual.hue += (hue - visual.hue) * 0.1;
    previousPixels = new Uint8ClampedArray(pixels);
  } catch (error) {
    // A local file or same-origin demo remains readable; an unusual browser
    // policy can only disable colour analysis, not playback or sound analysis.
    lastVisualSample = now + 60;
  }
}

function calculateMetrics() {
  metrics = {
    vision: clamp(0.14 + visual.luma * 0.28 + visual.motion * 0.95 + signal.treble * 0.24),
    hearing: clamp(0.08 + signal.level * 0.55 + signal.mid * 0.48),
    motion: clamp(0.06 + signal.bass * 0.54 + signal.beat * 0.3 + visual.motion * 0.18),
    focus: clamp(0.12 + visual.motion * 0.28 + signal.level * 0.34 + signal.mid * 0.18 + signal.beat * 0.12),
  };
}

function updateSignalUi() {
  for (const [key, value] of Object.entries(metrics)) {
    const valueElement = $(`${key}-value`);
    const barElement = $(`${key}-bar`);
    if (valueElement) valueElement.textContent = started ? String(Math.round(value * 100)).padStart(2, '0') : '--';
    if (barElement) barElement.style.width = `${started ? Math.max(3, value * 100) : 3}%`;
  }
  const frequencyReadout = $('frequency-readout');
  if (frequencyReadout) frequencyReadout.textContent = started && !video.paused ? `${Math.round(peakFrequency).toString().padStart(4, '0')} HZ / SYNC` : '00.0 HZ / SYNC';
  const frequency = audioState.frequency;
  for (let i = 0; i < bars.length; i += 1) {
    let value = 0.08;
    if (frequency && !video.paused) {
      const minIndex = Math.max(1, Math.floor(Math.pow(i / bars.length, 1.85) * 430));
      const maxIndex = Math.max(minIndex + 1, Math.floor(Math.pow((i + 1) / bars.length, 1.85) * 430));
      for (let j = minIndex; j < Math.min(maxIndex, frequency.length); j += 1) value = Math.max(value, frequency[j] / 255);
      value = clamp(value * 1.3);
    }
    bars[i].style.height = `${Math.max(3, value * 34)}px`;
    bars[i].style.opacity = `${0.42 + value * 0.58}`;
  }
}

function setTheme(nextTheme) {
  if (!themes[nextTheme]) return;
  theme = nextTheme;
  stage.setTheme(theme);
  document.querySelectorAll('.scene-option').forEach((button) => button.classList.toggle('active', button.dataset.theme === theme));
  const sceneCurrent = $('scene-current');
  if (sceneCurrent) sceneCurrent.textContent = themes[theme].short;
  if ($('scene-menu')) $('scene-menu').hidden = true;
  $('scene-toggle')?.setAttribute('aria-expanded', 'false');
}

function loadFile(file) {
  if (radio) return;
  const isAudio = Boolean(file && (file.type.startsWith('audio/')
    || /\.(?:mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(file.name)));
  const isVideo = Boolean(file && (file.type.startsWith('video/')
    || /\.(?:mp4|webm|mov|m4v)$/i.test(file.name)));
  if (!isAudio && !isVideo) {
    showToast('Выберите видео или аудиофайл.');
    return;
  }
  if (recording) stopRecording();
  video.pause();
  resetAudioAnalysis();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  audioOnly = isAudio;
  stage.setAudioOnly(audioOnly);
  video.load();
  previousPixels = null;
  lastVisualSample = 0;
  started = false;
  $('track-title').textContent = file.name.replace(/\.[^.]+$/, '');
  $('track-subtitle').textContent = `${audioOnly ? 'АУДИОФАЙЛ' : 'ВАШ КЛИП'} · ЛОКАЛЬНОЕ ВОСПРОИЗВЕДЕНИЕ`;
  $('current-time').textContent = '00:00';
  $('duration').textContent = '00:00';
  $('seek').value = 0;
  $('seek').style.setProperty('--seek-fill', '0%');
  updatePlaybackState();
  showToast('Файл загружен. Нажмите воспроизведение.');
}

async function prepareRadioTrack(track, autoplay) {
  video.pause();
  resetAudioAnalysis();
  video.loop = false;
  video.src = track.streamUrl;
  audioOnly = track.mediaType !== 'video' && !String(track.mimeType || '').startsWith('video/');
  stage.setAudioOnly(audioOnly);
  video.load();
  previousPixels = null;
  lastVisualSample = 0;
  $('track-title').textContent = (track.artist ? track.artist + ' — ' : '') + track.title;
  $('track-subtitle').textContent = (radio?.playlist?.name || 'Радио') + ' · ВЫБОР МУХИ';
  $('current-time').textContent = '00:00';
  $('duration').textContent = formatTime(track.duration);
  $('seek').value = 0;
  $('seek').style.setProperty('--seek-fill', '0%');
  if (autoplay) {
    try {
      await ensureAudio();
      await video.play();
    } catch (error) {
      console.warn('Automatic playback was blocked:', error);
      showToast('Следующий трек готов. Нажмите воспроизведение.');
    }
  }
  updatePlaybackState();
}

async function initializeRadio() {
  setStartLoading(true, 'СОБИРАЕМ ПЛЕЙЛИСТ');
  try {
    await radio.initialize();
    radioLoadError = null;
  } catch (error) {
    radioLoadError = error;
    console.error(error);
    showToast(error.message || 'Не удалось открыть плейлист.');
  } finally {
    setStartLoading(false, radioLoadError ? 'ПОВТОРИТЬ' : 'ПОГРУЗИТЬСЯ');
    updatePlaybackState();
  }
}

function drawRecordingFrame() {
  const ctx = recordingContext;
  const width = recordingCanvas.width;
  const height = recordingCanvas.height;
  const stageRect = stageCanvas.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) {
    ctx.drawImage(stageCanvas, 0, 0, width, height);
    return;
  }

  // Cover the export frame without distortion. On phones the preview itself
  // is 9:16, so this is the exact composition the viewer sees.
  const scale = Math.max(width / stageRect.width, height / stageRect.height);
  const drawWidth = stageRect.width * scale;
  const drawHeight = stageRect.height * scale;
  const offsetX = (width - drawWidth) * 0.5;
  const offsetY = (height - drawHeight) * 0.5;
  ctx.drawImage(stageCanvas, offsetX, offsetY, drawWidth, drawHeight);

  // Place only the animated neural cloud at its live screen coordinates.
  // UI labels, transport controls and decorative recording titles stay out.
  const brainRect = brainCanvas.getBoundingClientRect();
  if (!brainRect.width || !brainRect.height) return;
  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.shadowColor = '#7beee8';
  ctx.shadowBlur = 12 * scale;
  ctx.drawImage(
    brainCanvas,
    offsetX + (brainRect.left - stageRect.left) * scale,
    offsetY + (brainRect.top - stageRect.top) * scale,
    brainRect.width * scale,
    brainRect.height * scale,
  );
  ctx.restore();
}

function preferredRecordingTypes() {
  if (!window.MediaRecorder) return [];
  const types = [
    'video/mp4;codecs="avc1.424028, mp4a.40.2"',
    'video/mp4;codecs="avc1, mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return typeof MediaRecorder.isTypeSupported === 'function'
    ? types.filter((type) => MediaRecorder.isTypeSupported(type))
    : types;
}

function probeRecordingDuration(url) {
  return new Promise((resolve) => {
    const probe = document.createElement('video');
    let settled = false;
    const finish = (duration = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      probe.removeAttribute('src');
      probe.load();
      resolve(duration);
    };
    const checkDuration = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) finish(probe.duration);
    };
    const timeout = setTimeout(() => finish(), 2500);
    probe.addEventListener('loadedmetadata', checkDuration);
    probe.addEventListener('durationchange', checkDuration);
    probe.addEventListener('error', () => finish(), { once: true });
    probe.preload = 'metadata';
    probe.src = url;
  });
}

function resetRecordButton() {
  const preferred = preferredRecordingTypes()[0] || '';
  const format = preferred.startsWith('video/mp4') ? 'MP4' : preferred ? 'WebM' : '';
  const ratio = isPortraitStage() ? ' 9:16' : '';
  const label = format ? `Записать сцену${ratio} в ${format}` : `Записать сцену${ratio}`;
  $('record-label').textContent = 'Записать';
  $('record-btn').setAttribute('aria-label', label);
  $('record-btn').title = label;
}

async function startRecording() {
  if (recording || recordingPending || recordingFinalizing) return;
  recordingPending = true;
  $('record-btn').disabled = true;
  let canvasStream;
  try {
    if (stageFailed || !recordingCanvas.captureStream || !window.MediaRecorder) {
      showToast('Этот браузер не поддерживает запись сцены. Попробуйте Chrome или Edge.');
      return;
    }
    if (video.paused) await play();
    if (video.paused) return;
    if (lastRecordingUrl) URL.revokeObjectURL(lastRecordingUrl);
    lastRecordingUrl = null;
    $('download-link').hidden = true;
    await ensureAudio();
    const portrait = isPortraitStage();
    stage.setRecordingQuality(portrait);
    const sourceWidth = stageCanvas.width;
    const sourceHeight = stageCanvas.height;
    recordingCanvas.width = portrait ? PORTRAIT_RECORD_WIDTH : Math.max(1, sourceWidth);
    recordingCanvas.height = portrait ? PORTRAIT_RECORD_HEIGHT : Math.max(1, sourceHeight);
    drawRecordingFrame();
    const recordingFps = portrait ? 30 : 60;
    canvasStream = recordingCanvas.captureStream(recordingFps);
    const audioTracks = audioState.recordingDestination.stream.getAudioTracks();
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    const chunks = [];
    const recorderOptions = {
      videoBitsPerSecond: Math.min(50_000_000, Math.max(8_000_000, Math.round(recordingCanvas.width * recordingCanvas.height * recordingFps * 0.16))),
      audioBitsPerSecond: 256_000,
    };
    // MP4 with H.264/AAC is preferred. If a codec passes the capability
    // check but cannot start at this canvas size, try the next recorder type.
    let recorder;
    for (const mimeType of [...preferredRecordingTypes(), '']) {
      try {
        const candidate = new MediaRecorder(stream, {
          ...recorderOptions,
          ...(mimeType ? { mimeType } : {}),
        });
        // A single final Blob avoids fragmented MP4 duration issues on Android.
        candidate.start();
        recorder = candidate;
        break;
      } catch (error) {
        console.warn('Recording format unavailable:', mimeType || 'browser default', error);
      }
    }
    if (!recorder) throw new Error('No working recording format');
    const recordingFormat = recorder.mimeType.toLowerCase().includes('mp4') ? 'MP4' : 'WebM';
    const recordingStartedAt = performance.now();
    let recordingFailed = false;
    let recordingAbandoned = false;
    let stopTimer = null;
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('error', (event) => {
      recordingFailed = true;
      console.error('Recording failed:', event.error || event);
      showToast(`Запись ${recordingFormat} прервана браузером. Попробуйте ещё раз.`);
    });
    recorder.addEventListener('stop', async () => {
      clearTimeout(stopTimer);
      stopTimer = null;
      canvasStream.getTracks().forEach((track) => track.stop());
      if (recordingAbandoned) return;
      recordingFinalizing = true;
      $('record-btn').disabled = true;
      if (recording?.recorder === recorder) {
        recording = null;
        $('record-btn').classList.remove('recording');
        resetRecordButton();
        updatePlaybackState();
      }
      stage.setRecordingQuality(false);
      try {
        if (recordingFailed) return;
        if (!chunks.length) {
          showToast('Запись не содержит кадров. Попробуйте ещё раз.');
          return;
        }
        const actualType = chunks[0]?.type || recorder.mimeType || 'application/octet-stream';
        const lowerType = actualType.toLowerCase();
        const extension = lowerType.includes('mp4') ? 'mp4'
          : lowerType.includes('webm') ? 'webm'
            : lowerType.includes('matroska') ? 'mkv' : 'bin';
        const blob = new Blob(chunks, { type: actualType });
        const url = URL.createObjectURL(blob);
        lastRecordingUrl = url;
        const link = $('download-link');
        const filename = `dr-stun-${theme}${portrait ? '-9x16' : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
        link.href = url;
        link.download = filename;
        link.textContent = portrait ? '↓ Скачать видео' : `↓ Скачать ${extension.toUpperCase()}`;
        const elapsedSeconds = (performance.now() - recordingStartedAt) / 1000;
        const fileSeconds = await probeRecordingDuration(url);
        link.hidden = false;
        console.info('Video recording finalized', {
          type: actualType, bytes: blob.size, chunks: chunks.length,
          elapsedSeconds: Math.round(elapsedSeconds * 10) / 10, fileSeconds,
        });
        if (elapsedSeconds >= 6 && Number.isFinite(fileSeconds) && fileSeconds < elapsedSeconds * 0.7) {
          showToast(`Браузер сохранил только ${formatTime(fileSeconds)} из ${formatTime(elapsedSeconds)}. Попробуйте другой браузер.`);
        } else if (elapsedSeconds >= 6 && extension === 'mp4' && fileSeconds === null) {
          showToast('Видео готово, но браузер не подтвердил длительность. Проверьте файл после скачивания.');
        } else if (portrait) {
          showToast(`Видео 9:16 готово в ${extension.toUpperCase()}. Нажмите «Скачать видео».`);
        } else {
          link.click();
          showToast(`Запись ${extension.toUpperCase()} готова. Если скачивание не началось, нажмите «Скачать».`);
        }
      } catch (error) {
        console.error('Could not finalize recording:', error);
        showToast('Не удалось подготовить видео. Попробуйте ещё раз.');
      } finally {
        recordingFinalizing = false;
        $('record-btn').disabled = false;
        resetRecordButton();
        updatePlaybackState();
      }
    }, { once: true });
    recording = {
      recorder, stream, startedAt: recordingStartedAt, portrait, sourceWidth, sourceHeight,
      armStopWatchdog(callback) { stopTimer = setTimeout(callback, 15000); },
      clearStopWatchdog() { clearTimeout(stopTimer); stopTimer = null; },
      abandon() {
        recordingAbandoned = true;
        canvasStream.getTracks().forEach((track) => track.stop());
      },
    };
    $('record-btn').classList.add('recording');
    $('record-btn').setAttribute('aria-label', 'Остановить запись');
    $('record-btn').title = 'Остановить запись';
    updatePlaybackState();
    showToast(portrait
      ? `Идёт запись 9:16 · 1080×1920 · ${recordingFormat}.`
      : `Идёт запись ${recordingFormat} со звуком и нейрокартой.`);
  } catch (error) {
    console.error(error);
    canvasStream?.getTracks().forEach((track) => track.stop());
    stage.setRecordingQuality(false);
    showToast('Не удалось начать запись в этом браузере.');
  } finally {
    recordingPending = false;
    $('record-btn').disabled = false;
  }
}

function stopRecording() {
  if (!recording) return;
  const active = recording;
  const { recorder } = active;
  recording = null;
  recordingFinalizing = true;
  $('record-btn').disabled = true;
  active.armStopWatchdog(() => {
    active.clearStopWatchdog();
    active.abandon();
    recordingFinalizing = false;
    $('record-btn').disabled = false;
    showToast('Браузер не завершил запись. Попробуйте ещё раз.');
  }, 15000);
  try {
    if (recorder.state !== 'inactive') recorder.stop();
    showToast('Подготавливаем видео…');
  } catch (error) {
    console.error('Could not stop recording:', error);
    active.clearStopWatchdog();
    active.abandon();
    recordingFinalizing = false;
    $('record-btn').disabled = false;
    showToast('Не удалось остановить запись. Попробуйте ещё раз.');
  }
  stage.setRecordingQuality(false);
  $('record-btn').classList.remove('recording');
  resetRecordButton();
  updatePlaybackState();
}

function animate(timestamp) {
  const now = timestamp / 1000;
  sampleAudio(now);
  sampleVideo(now);
  calculateMetrics();
  radio?.tick(timestamp, signal, visual);
  const frame = {
    time: started ? video.currentTime : now,
    audio: signal,
    visual,
    playing: !video.paused && !video.ended,
    waveform: audioState.waveform,
    frequency: audioState.frequency,
  };
  const flyMotion = stage.update(frame);
  brain.update(frame);
  debug.update(frame.audio, flyMotion);
  if (recording) {
    const captureChanged = recording.portrait ? !isPortraitStage()
      : stageCanvas.width !== recording.sourceWidth || stageCanvas.height !== recording.sourceHeight;
    if (captureChanged) {
      stopRecording();
      showToast('Ориентация или размер кадра изменились. Запись сохранена.');
    } else {
      drawRecordingFrame();
      $('record-label').textContent = `Остановить · ${formatTime((performance.now() - recording.startedAt) / 1000)}`;
    }
  }
  if (timestamp - lastUiUpdate > 50) {
    updateSignalUi();
    updateTimeUi();
    lastUiUpdate = timestamp;
  }
  requestAnimationFrame(animate);
}

$('start-btn').addEventListener('click', play);
$('play-btn').addEventListener('click', togglePlayback);
$('upload-btn').addEventListener('click', () => radio ? radio.next('manual-skip') : $('file-input').click());
$('file-input').addEventListener('change', (event) => {
  loadFile(event.target.files?.[0]);
  event.target.value = '';
});
$('record-btn').addEventListener('click', () => recording ? stopRecording() : startRecording());
$('mute-btn').addEventListener('click', () => {
  audioState.muted = !audioState.muted;
  if (audioState.gain) audioState.gain.gain.value = audioState.muted ? 0 : audioState.volume;
  $('mute-btn').style.color = audioState.muted ? '#ff8bc6' : '';
  $('mute-btn').setAttribute('aria-label', audioState.muted ? 'Включить звук' : 'Отключить звук');
});
$('volume').addEventListener('input', (event) => {
  audioState.volume = Number(event.target.value) / 100;
  audioState.muted = false;
  $('mute-btn').style.color = '';
  if (audioState.gain) audioState.gain.gain.value = audioState.volume;
});
$('seek').addEventListener('pointerdown', () => { seekDragging = true; });
$('seek').addEventListener('pointerup', () => { seekDragging = false; });
$('seek').addEventListener('pointercancel', () => { seekDragging = false; });
window.addEventListener('pointerup', () => { seekDragging = false; });
$('seek').addEventListener('change', () => { seekDragging = false; });
$('seek').addEventListener('input', (event) => {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const ratio = Number(event.target.value) / 1000;
  video.currentTime = ratio * video.duration;
  $('current-time').textContent = formatTime(video.currentTime);
  $('seek').style.setProperty('--seek-fill', `${ratio * 100}%`);
});
$('fullscreen-btn').addEventListener('click', () => {
  const section = document.querySelector('.stage-section');
  if (document.fullscreenElement) document.exitFullscreen();
  else section.requestFullscreen?.();
});
document.querySelectorAll('.scene-option').forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.theme)));
$('scene-toggle')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const menu = $('scene-menu');
  menu.hidden = !menu.hidden;
  $('scene-toggle').setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', (event) => {
  const menu = $('scene-menu');
  if (menu && !menu.hidden && !menu.contains(event.target) && !$('scene-toggle')?.contains(event.target)) {
    menu.hidden = true;
    $('scene-toggle')?.setAttribute('aria-expanded', 'false');
  }
});
video.addEventListener('play', updatePlaybackState);
video.addEventListener('pause', updatePlaybackState);
video.addEventListener('ended', () => { updatePlaybackState(); radio?.next('ended'); });
video.addEventListener('loadedmetadata', updateTimeUi);
video.addEventListener('durationchange', updateTimeUi);
video.addEventListener('seeking', () => {
  previousPixels = null;
  visual.motion = 0;
  resetAudioAnalysis();
});
video.addEventListener('error', () => showToast(radio ? 'Не удалось загрузить трек. Выберите следующий.' : 'Этот файл не удалось открыть. Попробуйте MP4, WebM или MP3.'));
const stageSection = document.querySelector('.stage-section');
let dragDepth = 0;
document.addEventListener('dragenter', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
stageSection.addEventListener('dragenter', (event) => { event.preventDefault(); if (radio) return; dragDepth += 1; $('drop-overlay').hidden = false; });
stageSection.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
stageSection.addEventListener('dragleave', (event) => { event.preventDefault(); dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
stageSection.addEventListener('drop', (event) => { event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; if (!radio) loadFile(event.dataTransfer.files?.[0]); });
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && $('scene-menu') && !$('scene-menu').hidden) {
    $('scene-menu').hidden = true;
    $('scene-toggle')?.setAttribute('aria-expanded', 'false');
    return;
  }
  if (event.code !== 'Space' || ['INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) return;
  event.preventDefault();
  togglePlayback();
});
window.addEventListener('beforeunload', () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  if (lastRecordingUrl) URL.revokeObjectURL(lastRecordingUrl);
  if (recording) stopRecording();
  stage.dispose();
  brain.dispose();
  debug.dispose();
});
const observer = new ResizeObserver(() => { stage.resize(); brain.resize(); });
observer.observe(stageSection);
observer.observe(document.querySelector('.brain-frame'));
if (playlistSlug) {
  radio = createRadio({
    slug: playlistSlug,
    video,
    onPlaylist(playlist) {
      document.title = playlist.name + ' — Dr. Stun';
      if (playlistSlug !== 'all') {
        const link = $('radio-entry');
        link.textContent = '◖ ВСЕ ТРЕКИ';
        link.hidden = false;
      }
    },
    onTrack: prepareRadioTrack,
    onTaste: renderTaste,
    onError(error) { showToast(error.message || 'Не удалось выбрать следующий трек.'); },
  });
  const nextButton = $('upload-btn');
  nextButton.title = 'Следующий трек';
  nextButton.setAttribute('aria-label', 'Следующий трек');
  nextButton.querySelector('path').setAttribute('d', 'M5 5v14l11-7L5 5Zm14 0v14');
  document.body.classList.add('radio-mode');
  radioReady = initializeRadio();
} else {
  libraryHasTracks().then((available) => { $('radio-entry').hidden = !available; }).catch(() => {});
}
stage.resize();
brain.resize();
resetRecordButton();
updatePlaybackState();
updateTimeUi();
requestAnimationFrame(animate);
