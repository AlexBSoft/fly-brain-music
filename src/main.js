import './style.css';
import { createStage } from './stage.js';
import { createBrainViz } from './brain.js';

const $ = (id) => document.getElementById(id);
const video = $('source-video');
video.src = `${import.meta.env.BASE_URL}media/demo.mp4`;
video.poster = `${import.meta.env.BASE_URL}media/poster.jpg`;
video.load();
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

const themes = {
  club: { name: 'НОЧНОЙ КЛУБ', short: 'Клуб', id: 'CLUB_01', scene: 'НОЧНОЙ КЛУБ' },
  garden: { name: 'ОРАНЖЕРЕЯ', short: 'Оранжерея', id: 'GARDEN_02', scene: 'ОРАНЖЕРЕЯ' },
  orbit: { name: 'ОРБИТА', short: 'Орбита', id: 'ORBIT_03', scene: 'ОРБИТА' },
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
  stage = { update() {}, resize() {}, setTheme() {}, dispose() {} };
}
const brain = createBrainViz(brainCanvas);

const audioState = {
  context: null,
  source: null,
  analyser: null,
  gain: null,
  recordingDestination: null,
  frequency: null,
  waveform: null,
  volume: 0.85,
  muted: false,
  bassAverage: 0.05,
  lastBeatAt: -10,
  beatInterval: 0.52,
  lastSampleAt: 0,
  spectralAverage: 0.008,
  previousSpectrum: null,
  spectrumReady: false,
  previousBands: { sub: 0, lowMid: 0, presence: 0, air: 0 },
};
// Amplitudes are 0..1. beatCount counts accents; beatPhase runs 0..1 between them.
const signal = {
  bass: 0, mid: 0, treble: 0, level: 0, beat: 0,
  sub: 0, lowMid: 0, presence: 0, air: 0,
  onset: 0, kick: 0, snare: 0, hat: 0,
  pulse: 0, groove: 0, beatPhase: 1, beatCount: 0,
};
const visual = { luma: 0.34, motion: 0.08, hue: 0.55 };
let metrics = { vision: 0, hearing: 0, motion: 0, focus: 0 };
let started = false;
let objectUrl = null;
let recording = null;
let recordingPending = false;
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
      waveform: new Uint8Array(analyser.fftSize),
      previousSpectrum: new Uint8Array(analyser.frequencyBinCount),
    });
  }
  if (audioState.context.state !== 'running') await audioState.context.resume();
}

async function play() {
  try {
    await ensureAudio();
    await video.play();
    started = true;
    $('start-overlay').classList.add('hidden');
  } catch (error) {
    console.error(error);
    showToast('Не удалось воспроизвести файл. Выберите другое видео или аудио.');
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

function meanBand(minHz, maxHz) {
  const { analyser, frequency, context } = audioState;
  if (!analyser || !frequency || !context) return 0;
  const binHz = context.sampleRate / analyser.fftSize;
  const start = Math.max(1, Math.floor(minHz / binHz));
  const end = Math.min(frequency.length, Math.ceil(maxHz / binHz));
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += frequency[index];
  return sum / Math.max(1, end - start) / 255;
}

function resetAudioAnalysis() {
  audioState.bassAverage = 0.05;
  audioState.lastBeatAt = -10;
  audioState.beatInterval = 0.52;
  audioState.lastSampleAt = 0;
  audioState.spectralAverage = 0.008;
  audioState.spectrumReady = false;
  audioState.previousSpectrum?.fill(0);
  for (const key of Object.keys(audioState.previousBands)) audioState.previousBands[key] = 0;
  for (const key of Object.keys(signal)) signal[key] = 0;
  signal.beatPhase = 1;
  peakFrequency = 0;
}

function sampleAudio(now) {
  const { analyser, frequency, waveform, context } = audioState;
  if (!analyser || video.paused || video.ended) {
    for (const key of ['bass', 'mid', 'treble', 'level', 'sub', 'lowMid', 'presence', 'air']) signal[key] *= 0.91;
    for (const key of ['onset', 'kick', 'snare', 'hat', 'pulse']) signal[key] *= 0.84;
    signal.beat *= 0.86;
    signal.groove *= 0.995;
    audioState.spectrumReady = false;
    peakFrequency *= 0.9;
    return;
  }
  analyser.getByteFrequencyData(frequency);
  analyser.getByteTimeDomainData(waveform);
  const deltaTime = clamp(now - audioState.lastSampleAt, 1 / 120, 0.1);
  audioState.lastSampleAt = now;
  const mediaTime = video.currentTime;

  const sub = clamp(meanBand(28, 85) * 2.45);
  const bass = clamp(meanBand(38, 190) * 2.0);
  const lowMid = clamp(meanBand(190, 650) * 2.55);
  const mid = clamp(meanBand(190, 2100) * 2.25);
  const presence = clamp(meanBand(1800, 5000) * 3.0);
  const treble = clamp(meanBand(2100, 9000) * 3.2);
  const air = clamp(meanBand(5500, 13000) * 4.2);

  let power = 0;
  for (let i = 0; i < waveform.length; i += 4) {
    const sample = (waveform[i] - 128) / 128;
    power += sample * sample;
  }
  const level = clamp(Math.sqrt(power / (waveform.length / 4)) * 4);
  signal.bass += (bass - signal.bass) * 0.34;
  signal.mid += (mid - signal.mid) * 0.25;
  signal.treble += (treble - signal.treble) * 0.22;
  signal.level += (level - signal.level) * 0.28;
  signal.sub += (sub - signal.sub) * 0.34;
  signal.lowMid += (lowMid - signal.lowMid) * 0.27;
  signal.presence += (presence - signal.presence) * 0.28;
  signal.air += (air - signal.air) * 0.25;

  // Positive spectral flux captures attacks without assuming a fixed tempo.
  // An adaptive floor works across quiet and loud user files.
  let rise = 0;
  let bins = 0;
  const previousSpectrum = audioState.previousSpectrum;
  for (let index = 2; index < Math.min(frequency.length, 580); index += 2) {
    if (audioState.spectrumReady) rise += Math.max(0, frequency[index] - previousSpectrum[index]);
    previousSpectrum[index] = frequency[index];
    bins += 1;
  }
  const spectralFlux = rise / Math.max(1, bins) / 255;
  audioState.spectrumReady = true;
  audioState.spectralAverage += (spectralFlux - audioState.spectralAverage) * 0.022;
  const onset = clamp((spectralFlux - audioState.spectralAverage * 0.66) / Math.max(0.008, audioState.spectralAverage * 2.2));
  signal.onset = Math.max(signal.onset * Math.exp(-deltaTime * 10), onset);

  const previousBands = audioState.previousBands;
  const kick = clamp(Math.max(0, sub - previousBands.sub) * 7.5);
  const snare = clamp((Math.max(0, lowMid - previousBands.lowMid) * 5.4 + Math.max(0, presence - previousBands.presence) * 2.3) * 0.8);
  const hat = clamp(Math.max(0, air - previousBands.air) * 8.0);
  previousBands.sub = sub;
  previousBands.lowMid = lowMid;
  previousBands.presence = presence;
  previousBands.air = air;
  signal.kick = Math.max(signal.kick * Math.exp(-deltaTime * 14), kick);
  signal.snare = Math.max(signal.snare * Math.exp(-deltaTime * 13), snare);
  signal.hat = Math.max(signal.hat * Math.exp(-deltaTime * 16), hat);

  audioState.bassAverage += (bass - audioState.bassAverage) * 0.025;
  const bassAccent = bass > Math.max(0.2, audioState.bassAverage * 1.28) && kick > 0.13;
  const broadAccent = onset > 0.53 && (kick > 0.15 || snare > 0.34);
  if ((bassAccent || broadAccent) && mediaTime - audioState.lastBeatAt > 0.24) {
    const interval = mediaTime - audioState.lastBeatAt;
    if (interval > 0.26 && interval < 1.25) {
      const regularity = 1 - clamp(Math.abs(interval - audioState.beatInterval) / Math.max(0.16, audioState.beatInterval * 0.58));
      signal.groove += (regularity - signal.groove) * 0.22;
      audioState.beatInterval += (interval - audioState.beatInterval) * 0.2;
    }
    signal.beat = 1;
    signal.pulse = 1;
    signal.beatCount += 1;
    signal.beatPhase = 0;
    audioState.lastBeatAt = mediaTime;
  } else {
    signal.beat *= Math.exp(-deltaTime * 8.4);
    signal.pulse *= Math.exp(-deltaTime * 4.4);
    signal.beatPhase = clamp((mediaTime - audioState.lastBeatAt) / audioState.beatInterval);
    signal.groove *= Math.exp(-deltaTime * 0.12);
  }

  let strongest = 1;
  for (let index = 2; index < Math.min(400, frequency.length); index += 1) {
    if (frequency[index] > frequency[strongest]) strongest = index;
  }
  peakFrequency = strongest * context.sampleRate / analyser.fftSize;
}

function sampleVideo(now) {
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
  if (!file || (!file.type.startsWith('video/') && !file.type.startsWith('audio/'))) {
    showToast('Выберите видео или аудиофайл.');
    return;
  }
  if (recording) stopRecording();
  video.pause();
  resetAudioAnalysis();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  video.load();
  previousPixels = null;
  lastVisualSample = 0;
  started = false;
  $('track-title').textContent = file.name.replace(/\.[^.]+$/, '');
  $('track-subtitle').textContent = `${file.type.startsWith('audio/') ? 'АУДИОФАЙЛ' : 'ВАШ КЛИП'} · ЛОКАЛЬНОЕ ВОСПРОИЗВЕДЕНИЕ`;
  $('current-time').textContent = '00:00';
  $('duration').textContent = '00:00';
  $('seek').value = 0;
  $('seek').style.setProperty('--seek-fill', '0%');
  updatePlaybackState();
  showToast('Клип загружен. Нажмите воспроизведение.');
}

function drawText(text, x, y, font, color, maxWidth) {
  recordingContext.font = font;
  recordingContext.fillStyle = color;
  recordingContext.fillText(text, x, y, maxWidth);
}

function drawImageCover(image, x, y, width, height) {
  const sourceWidth = image.width || image.videoWidth;
  const sourceHeight = image.height || image.videoHeight;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  recordingContext.drawImage(image, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, x, y, width, height);
}

function drawRecordingFrame() {
  const ctx = recordingContext;
  ctx.fillStyle = '#080b17';
  ctx.fillRect(0, 0, 1280, 720);
  drawImageCover(stageCanvas, 0, 0, 1280, 720);
  const gradient = ctx.createLinearGradient(0, 0, 0, 720);
  gradient.addColorStop(0, '#050815b3');
  gradient.addColorStop(0.2, '#05081500');
  gradient.addColorStop(0.72, '#05081500');
  gradient.addColorStop(1, '#050815d9');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);
  drawText('NOCTURNA', 36, 55, '800 23px Arial', '#f4f5ff');
  drawText('FLY STUDIO  /  LIVE VISUAL', 37, 77, '700 9px Arial', '#83eae2');
  ctx.save();
  ctx.globalAlpha = 0.87;
  ctx.shadowBlur = 26;
  ctx.shadowColor = '#66eae5';
  ctx.drawImage(brainCanvas, 984, 48, 268, 215);
  ctx.restore();
  drawText('NEURAL ACTIVITY / LIVE', 1000, 48, '700 10px Arial', '#a5f6ef');
  drawText(themes[theme].name, 36, 643, 'italic 40px Georgia', '#ffe4f2');
  drawText($('track-title').textContent, 38, 679, '600 17px Arial', '#f1eef8', 900);
  drawText(formatTime(video.currentTime), 1180, 679, '700 16px Arial', '#b5eae9');
}

function preferredRecordingType() {
  if (!window.MediaRecorder) return null;
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ].find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}

async function startRecording() {
  if (recording || recordingPending) return;
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
    drawRecordingFrame();
    canvasStream = recordingCanvas.captureStream(30);
    const audioTracks = audioState.recordingDestination.stream.getAudioTracks();
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    const chunks = [];
    const mimeType = preferredRecordingType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 5_500_000,
      audioBitsPerSecond: 192_000,
    });
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('error', () => showToast('Во время записи произошла ошибка.'));
    recorder.addEventListener('stop', () => {
      if (recording?.recorder === recorder) {
        recording = null;
        $('record-btn').classList.remove('recording');
        $('record-label').textContent = 'Записать';
        $('record-btn').setAttribute('aria-label', 'Записать сцену');
        $('record-btn').title = 'Записать сцену';
        updatePlaybackState();
      }
      canvasStream.getTracks().forEach((track) => track.stop());
      if (!chunks.length) return showToast('Запись не содержит кадров. Попробуйте ещё раз.');
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      lastRecordingUrl = url;
      const link = $('download-link');
      link.href = url;
      link.download = `nocturna-${theme}-${new Date().toISOString().replace(/[:.]/g, '-')}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      link.hidden = false;
      link.click();
      showToast('Запись готова. Если скачивание не началось, нажмите «Скачать запись».');
    }, { once: true });
    recorder.start(1000);
    recording = { recorder, stream, startedAt: performance.now() };
    $('record-btn').classList.add('recording');
    $('record-btn').setAttribute('aria-label', 'Остановить запись');
    $('record-btn').title = 'Остановить запись';
    updatePlaybackState();
    showToast('Идёт запись сцены со звуком и нейрокартой.');
  } catch (error) {
    console.error(error);
    canvasStream?.getTracks().forEach((track) => track.stop());
    showToast('Не удалось начать запись в этом браузере.');
  } finally {
    recordingPending = false;
    $('record-btn').disabled = false;
  }
}

function stopRecording() {
  if (!recording) return;
  if (recording.recorder.state !== 'inactive') recording.recorder.stop();
  recording = null;
  $('record-btn').classList.remove('recording');
  $('record-label').textContent = 'Записать';
  $('record-btn').setAttribute('aria-label', 'Записать сцену');
  $('record-btn').title = 'Записать сцену';
  updatePlaybackState();
}

function animate(timestamp) {
  const now = timestamp / 1000;
  sampleAudio(now);
  sampleVideo(now);
  calculateMetrics();
  const frame = { time: started ? video.currentTime : now, audio: signal, visual, playing: !video.paused && !video.ended };
  stage.update(frame);
  brain.update(frame);
  if (recording) {
    drawRecordingFrame();
    $('record-label').textContent = `Остановить · ${formatTime((performance.now() - recording.startedAt) / 1000)}`;
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
$('upload-btn').addEventListener('click', () => $('file-input').click());
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
video.addEventListener('ended', updatePlaybackState);
video.addEventListener('loadedmetadata', updateTimeUi);
video.addEventListener('durationchange', updateTimeUi);
video.addEventListener('seeking', () => {
  previousPixels = null;
  visual.motion = 0;
  resetAudioAnalysis();
});
video.addEventListener('error', () => showToast('Этот файл не удалось открыть. Попробуйте MP4, WebM или MP3.'));
const stageSection = document.querySelector('.stage-section');
let dragDepth = 0;
document.addEventListener('dragenter', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
stageSection.addEventListener('dragenter', (event) => { event.preventDefault(); dragDepth += 1; $('drop-overlay').hidden = false; });
stageSection.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
stageSection.addEventListener('dragleave', (event) => { event.preventDefault(); dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
stageSection.addEventListener('drop', (event) => { event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; loadFile(event.dataTransfer.files?.[0]); });
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
});
const observer = new ResizeObserver(() => { stage.resize(); brain.resize(); });
observer.observe(stageSection);
observer.observe(document.querySelector('.brain-frame'));
stage.resize();
brain.resize();
updatePlaybackState();
updateTimeUi();
requestAnimationFrame(animate);
