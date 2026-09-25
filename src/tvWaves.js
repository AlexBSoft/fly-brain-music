// Audio-only television picture: a bank of horizontal traces driven by the
// same analyser samples that animate the rest of the scene.
const WIDTH = 960;
const HEIGHT = 540;
const TRACE_COUNT = 27;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));

export function createTvWaves() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });

  const backdrop = document.createElement('canvas');
  backdrop.width = WIDTH;
  backdrop.height = HEIGHT;
  const back = backdrop.getContext('2d', { alpha: false });
  const wash = back.createLinearGradient(0, 0, WIDTH, HEIGHT);
  wash.addColorStop(0, '#091526');
  wash.addColorStop(0.48, '#070b1e');
  wash.addColorStop(1, '#1b0921');
  back.fillStyle = wash;
  back.fillRect(0, 0, WIDTH, HEIGHT);
  const halo = back.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.5, 30, WIDTH * 0.5, HEIGHT * 0.5, HEIGHT * 0.75);
  halo.addColorStop(0, 'rgba(53, 121, 178, 0.22)');
  halo.addColorStop(0.5, 'rgba(33, 52, 111, 0.09)');
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  back.fillStyle = halo;
  back.fillRect(0, 0, WIDTH, HEIGHT);
  back.strokeStyle = 'rgba(146, 202, 236, 0.045)';
  back.lineWidth = 1;
  for (let y = 30; y < HEIGHT; y += 18) {
    back.beginPath();
    back.moveTo(0, y + 0.5);
    back.lineTo(WIDTH, y + 0.5);
    back.stroke();
  }
  for (let x = 0; x < WIDTH; x += 80) {
    back.beginPath();
    back.moveTo(x + 0.5, 0);
    back.lineTo(x + 0.5, HEIGHT);
    back.stroke();
  }

  function draw({ time = 0, audio = {}, waveform, frequency, playing = false } = {}) {
    const bass = clamp(audio.bass);
    const mid = clamp(audio.mid);
    const treble = clamp(audio.treble);
    const level = clamp(audio.level);
    const beat = clamp(audio.beat);
    const onset = clamp(audio.onset);
    const kick = clamp(audio.kick);
    const energy = playing ? 0.2 + level * 1.3 + bass * 0.85 + beat * 0.35 : 0.11;
    const sampleCount = waveform?.length || 0;
    const spectrumCount = frequency?.length || 0;

    ctx.drawImage(backdrop, 0, 0);
    const sweepX = (time * 115) % (WIDTH + 360) - 180;
    const sweep = ctx.createLinearGradient(sweepX - 180, 0, sweepX + 180, 0);
    sweep.addColorStop(0, 'rgba(78, 223, 251, 0)');
    sweep.addColorStop(0.5, `rgba(78, 223, 251, ${0.018 + energy * 0.025})`);
    sweep.addColorStop(1, 'rgba(78, 223, 251, 0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let row = 0; row < TRACE_COUNT; row += 1) {
      const ratio = row / (TRACE_COUNT - 1);
      const baseline = 34 + ratio * (HEIGHT - 68);
      const middleWeight = Math.pow(Math.max(0, 1 - Math.abs(ratio - 0.5) * 1.65), 1.3);
      const bin = spectrumCount ? Math.min(spectrumCount - 1, Math.floor(2 + Math.pow(ratio, 1.6) * 360)) : 0;
      const band = spectrumCount && playing ? frequency[bin] / 255 : 0;
      const amplitude = (4 + energy * (11 + middleWeight * 32) + band * 14 + kick * 18 * middleWeight)
        * (0.72 + middleWeight * 0.52);
      const hue = 184 + ratio * 117 + bass * 12 - treble * 10;
      const brightness = 65 + middleWeight * 14 + beat * 7;
      const opacity = clamp(0.19 + middleWeight * 0.36 + band * 0.18 + onset * 0.12);
      const featured = row % 6 === 2 || row === 13;

      ctx.beginPath();
      for (let x = 0; x <= WIDTH; x += 4) {
        let sample = 0;
        if (sampleCount && playing) {
          const position = (Math.floor(x / WIDTH * (sampleCount - 16)) + row * 11) % sampleCount;
          // Neighbour averaging avoids harsh aliasing while retaining the
          // waveform's actual peaks and rhythm.
          sample = clamp((((waveform[position] + waveform[(position + 4) % sampleCount]
            + waveform[(position + 8) % sampleCount]) / 3 - 128) / 128) * 2.4, -1, 1);
        }
        const carrier = Math.sin(x * (0.014 + ratio * 0.004) - time * (2.8 + ratio * 1.1) + row * 0.41);
        const overtone = Math.sin(x * 0.034 + time * 1.7 - row * 0.64);
        const edgeFade = Math.sin(Math.PI * x / WIDTH) ** 0.72;
        const displacement = (sample * 0.78 + carrier * 0.2 + overtone * 0.05) * amplitude * edgeFade;
        const y = baseline + displacement;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${hue}, 96%, ${brightness}%, ${opacity})`;
      ctx.lineWidth = featured ? 2.1 + beat * 0.8 : 0.9 + middleWeight * 0.55;
      ctx.shadowColor = `hsla(${hue}, 100%, 66%, 0.9)`;
      ctx.shadowBlur = featured ? 15 + beat * 11 : 5 + energy * 4;
      ctx.stroke();
    }

    // Three brighter lead traces remain legible when the television is small
    // in the room, while the fine horizontal rows give them depth.
    for (let lead = 0; lead < 3; lead += 1) {
      const baseline = HEIGHT * (0.39 + lead * 0.11);
      const hue = [190, 262, 326][lead];
      const offset = lead * 37;
      const amplitude = 28 + energy * 78 + (lead === 1 ? bass * 23 : mid * 13) + kick * 32;
      ctx.beginPath();
      for (let x = 0; x <= WIDTH; x += 3) {
        let sample = 0;
        if (sampleCount && playing) {
          const position = (Math.floor(x / WIDTH * (sampleCount - 16)) + offset) % sampleCount;
          sample = clamp((((waveform[position] + waveform[(position + 3) % sampleCount]
            + waveform[(position + 7) % sampleCount]) / 3 - 128) / 128) * 2.5, -1, 1);
        }
        const carrier = Math.sin(x * 0.017 - time * (3.1 + lead * 0.28) + lead * 0.72);
        const edgeFade = Math.sin(Math.PI * x / WIDTH) ** 0.65;
        const y = baseline + (sample * 0.78 + carrier * 0.16) * amplitude * edgeFade;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${hue}, 100%, 77%, ${0.73 + level * 0.2})`;
      ctx.lineWidth = 2.7 + beat * 1.1;
      ctx.shadowColor = `hsla(${hue}, 100%, 68%, 1)`;
      ctx.shadowBlur = 21 + kick * 15;
      ctx.stroke();
    }
    ctx.restore();

    const centerGlow = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.5, 4, WIDTH * 0.5, HEIGHT * 0.5, HEIGHT * 0.43);
    centerGlow.addColorStop(0, `rgba(116, 227, 255, ${0.015 + bass * 0.048 + beat * 0.045})`);
    centerGlow.addColorStop(1, 'rgba(116, 227, 255, 0)');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  draw();
  return { canvas, draw };
}
