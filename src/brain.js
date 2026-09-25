/**
 * A procedural, audio reactive point cloud. The clusters suggest a fly brain,
 * but this is an artistic simulation rather than an anatomical connectome.
 */
export function createBrainViz(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { update() {}, resize() {}, dispose() {} };

  const W = 400;
  const H = 300;
  const TAU = Math.PI * 2;
  const white = [238, 251, 255];
  const ice = [
    [201, 240, 255], // optic lobes: video and high frequencies
    [210, 230, 255], // auditory populations: mids and treble
    [232, 249, 255], // motor populations: bass and beats
    [175, 225, 252], // central integration
  ];
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));
  const rgba = (color, alpha) => 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + clamp(alpha) + ')';
  const blend = (a, b, t) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
  let seed = 782649;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  function hslToRgb(hue, saturation, lightness) {
    const channel = (offset) => {
      const k = (offset + hue * 12) % 12;
      const a = saturation * Math.min(lightness, 1 - lightness);
      return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [channel(0), channel(8), channel(4)];
  }

  // The broad outer populations give the cloud its two-lobed silhouette.
  // Small overlapping populations form dorsal, ventral and central regions.
  const clusters = [
    { x: -1.02, y: -0.06, z: -0.04, rx: 0.62, ry: 0.46, rz: 0.39, count: 205, zone: 0, phase: 0.4 },
    { x:  1.02, y: -0.05, z:  0.04, rx: 0.62, ry: 0.46, rz: 0.39, count: 205, zone: 0, phase: 2.3 },
    { x: -0.52, y: -0.34, z:  0.13, rx: 0.31, ry: 0.22, rz: 0.27, count: 74, zone: 1, phase: 1.5 },
    { x:  0.52, y: -0.34, z:  0.10, rx: 0.31, ry: 0.22, rz: 0.27, count: 74, zone: 1, phase: 4.0 },
    { x: -0.54, y:  0.32, z:  0.11, rx: 0.36, ry: 0.21, rz: 0.29, count: 68, zone: 2, phase: 5.2 },
    { x:  0.54, y:  0.32, z:  0.14, rx: 0.36, ry: 0.21, rz: 0.29, count: 68, zone: 2, phase: 3.2 },
    { x:  0.00, y: -0.02, z: -0.08, rx: 0.40, ry: 0.30, rz: 0.35, count: 92, zone: 3, phase: 0.8 },
  ];
  const neurons = [];
  const groups = clusters.map(() => []);
  const anchors = clusters.map(() => []);

  for (let c = 0; c < clusters.length; c += 1) {
    const cluster = clusters[c];
    for (let j = 0; j < cluster.count; j += 1) {
      const angle = random() * TAU;
      const elevation = random() * 2 - 1;
      const plane = Math.sqrt(1 - elevation * elevation);
      const radius = random() < 0.37 ? 0.78 + random() * 0.22 : Math.cbrt(random());
      const contour = 1
        + 0.055 * Math.sin(angle * 5 + cluster.phase)
        + 0.035 * Math.sin(angle * 9 - cluster.phase * 1.7);
      const ox = Math.cos(angle) * plane * radius * cluster.rx * contour;
      const oy = Math.sin(angle) * plane * radius * cluster.ry * contour;
      const oz = elevation * radius * cluster.rz;
      const sparkle = random() < 0.095;
      const neuron = {
        cluster: c,
        zone: cluster.zone,
        ox, oy, oz,
        radius,
        size: sparkle ? 1.65 + random() * 0.70 : 0.85 + random() * 0.86,
        phase: random() * TAU,
        rate: 1.5 + random() * 3.2,
        sparkle,
        tint: random() < 0.20,
      };
      groups[c].push(neurons.length);
      if (j % 9 === 0) anchors[c].push(neurons.length);
      neurons.push(neuron);
    }
  }

  const edges = [];
  const edgeKeys = new Set();
  function addEdge(a, b, cross = false) {
    if (a === b) return;
    const key = Math.min(a, b) + ':' + Math.max(a, b);
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      a, b, cross,
      phase: random(),
      speed: 0.20 + random() * 0.33,
      packet: cross || random() < 0.30,
      bend: cross ? (random() - 0.5) * 0.12 : 0,
    });
  }
  function distanceSquared(a, b) {
    const na = neurons[a], nb = neurons[b];
    const ca = clusters[na.cluster], cb = clusters[nb.cluster];
    const dx = ca.x + na.ox - cb.x - nb.ox;
    const dy = ca.y + na.oy - cb.y - nb.oy;
    const dz = ca.z + na.oz - cb.z - nb.oz;
    return dx * dx + dy * dy + dz * dz * 0.5;
  }
  // A sparse scaffold stays behind the particles. Only selected points get
  // filaments, so the network is legible without becoming a bright wire mesh.
  for (const ids of anchors) {
    for (const a of ids) {
      const nearest = ids
        .filter((b) => b !== a)
        .map((b) => ({ b, d: distanceSquared(a, b) }))
        .sort((one, two) => one.d - two.d)
        .slice(0, 2);
      for (const { b } of nearest) addEdge(a, b);
    }
  }
  const routes = [
    [0, 2], [1, 3], [0, 4], [1, 5],
    [0, 6], [1, 6], [2, 6], [3, 6],
    [4, 6], [5, 6], [2, 3], [4, 5],
  ];
  for (const [from, to] of routes) {
    const candidates = [];
    for (const a of anchors[from]) {
      for (const b of anchors[to]) candidates.push({ a, b, d: distanceSquared(a, b) });
    }
    candidates.sort((one, two) => one.d - two.d);
    for (const { a, b } of candidates.slice(0, 2)) addEdge(a, b, true);
  }

  const projected = neurons.map(() => ({ x: 0, y: 0, depth: 0, scale: 1 }));
  const projectedClusters = clusters.map(() => ({ x: 0, y: 0, depth: 0, scale: 1 }));
  const depthOrder = neurons.map((_, index) => index);
  const activity = [0.10, 0.10, 0.10, 0.10];
  const pulseAt = clusters.map(() => -10);
  const pulsePower = clusters.map(() => 0);
  const previous = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0, luma: 0.34, motion: 0, hue: 0.55 };
  let clock = 0;
  let lastTime = null;
  let pixelWidth = 0;
  let pixelHeight = 0;
  let lastFrame = { time: 0, audio: {}, visual: {}, playing: false };
  let disposed = false;
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* optional */ }

  function trigger(cluster, power) {
    if (clock - pulseAt[cluster] < 0.13) return;
    pulseAt[cluster] = clock;
    pulsePower[cluster] = clamp(power);
  }

  function draw(time, frame) {
    if (disposed || !pixelWidth || !pixelHeight) return;
    const audio = frame.audio || {};
    const visual = frame.visual || {};
    const bass = clamp(audio.bass);
    const mid = clamp(audio.mid);
    const treble = clamp(audio.treble);
    const level = clamp(audio.level);
    const beat = clamp(audio.beat);
    const luma = clamp(visual.luma);
    const motion = clamp(visual.motion);
    const hue = clamp(visual.hue == null ? 0.55 : visual.hue);
    const playing = !!frame.playing;
    const dt = lastTime == null ? 1 / 60 : Math.min(0.05, Math.max(1 / 120, Math.abs(time - lastTime)));
    lastTime = time;
    clock += dt * (playing ? 1 : 0.12);

    const hueDistance = Math.abs(hue - previous.hue);
    const visualOnset = Math.max(
      clamp((motion - previous.motion) * 3.4),
      clamp(Math.abs(luma - previous.luma) * 2.2),
      clamp(Math.min(hueDistance, 1 - hueDistance) * 4.2),
    );
    const soundOnset = Math.max(clamp((mid - previous.mid) * 3.5), clamp((treble - previous.treble) * 3.3));
    const bassOnset = Math.max(clamp((bass - previous.bass) * 3.8), beat);
    if (playing) {
      if (visualOnset > 0.16) {
        trigger(0, 0.36 + visualOnset * 0.64);
        trigger(1, 0.36 + visualOnset * 0.64);
      }
      if (soundOnset > 0.18) {
        trigger(2, 0.36 + soundOnset * 0.58);
        trigger(3, 0.36 + soundOnset * 0.58);
      }
      if (bassOnset > 0.48 && previous.beat < 0.78) {
        trigger(4, 0.40 + bassOnset * 0.60);
        trigger(5, 0.40 + bassOnset * 0.60);
        trigger(6, 0.30 + bassOnset * 0.56);
      }
      if (level - previous.level > 0.08) trigger(6, 0.42 + level * 0.5);
    }
    Object.assign(previous, { bass, mid, treble, level, beat, luma, motion, hue });

    const idle = playing ? 1 : 0.30;
    const targets = [
      (0.18 + 0.43 * motion + 0.26 * luma + 0.28 * treble + visualOnset * 0.20) * idle,
      (0.15 + 0.46 * mid + 0.39 * treble + 0.20 * level + soundOnset * 0.25) * idle,
      (0.15 + 0.51 * bass + 0.30 * beat + 0.18 * level) * idle,
      (0.19 + 0.27 * level + 0.23 * mid + 0.22 * motion + 0.18 * beat) * idle,
    ];
    for (let zone = 0; zone < activity.length; zone += 1) {
      const rate = targets[zone] > activity[zone] ? 15 : 3.8;
      activity[zone] += (clamp(targets[zone]) - activity[zone]) * (1 - Math.exp(-dt * rate));
    }

    const videoTint = hslToRgb(hue, 0.72, 0.72);
    const palette = ice.map((color, zone) => blend(color, videoTint, zone === 0 ? 0.22 : zone === 3 ? 0.15 : 0.08));
    const yaw = reducedMotion ? 0.06 : 0.06 + Math.sin(clock * 0.24) * 0.14;
    const pitch = reducedMotion ? -0.05 : -0.05 + Math.sin(clock * 0.19 + 1.2) * 0.08;
    const roll = reducedMotion ? 0 : Math.sin(clock * 0.14) * 0.016;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    function project(x, y, z, result) {
      const xx = x * cy + z * sy;
      const zz = z * cy - x * sy;
      const yy = y * cp - zz * sp;
      const depth = zz * cp + y * sp;
      const rx = xx * cr - yy * sr;
      const ry = xx * sr + yy * cr;
      const scale = 1 + depth * 0.12;
      result.x = 200 + rx * 109 * scale;
      result.y = 150 + ry * 109 * scale;
      result.depth = depth;
      result.scale = scale;
    }

    for (let c = 0; c < clusters.length; c += 1) {
      const cluster = clusters[c];
      const strength = activity[cluster.zone];
      const drift = reducedMotion ? 0 : 1;
      const cx = cluster.x + drift * Math.sin(clock * 0.48 + cluster.phase) * (0.014 + strength * 0.018);
      const cy0 = cluster.y + drift * Math.cos(clock * 0.39 + cluster.phase) * (0.012 + strength * 0.015);
      const cz = cluster.z + drift * Math.sin(clock * 0.30 + cluster.phase) * 0.018;
      const breathe = 1 + drift * Math.sin(clock * 1.1 + cluster.phase) * (0.014 + strength * 0.025);
      project(cx, cy0, cz, projectedClusters[c]);
      for (const index of groups[c]) {
        const neuron = neurons[index];
        const micro = reducedMotion ? 0 : 0.004 + strength * 0.006;
        project(
          cx + neuron.ox * breathe + Math.sin(clock * neuron.rate * 0.41 + neuron.phase) * micro,
          cy0 + neuron.oy * breathe + Math.cos(clock * neuron.rate * 0.37 + neuron.phase) * micro,
          cz + neuron.oz * breathe + Math.sin(clock * 0.49 + neuron.phase) * micro,
          projected[index],
        );
      }
    }

    ctx.setTransform(pixelWidth / W, 0, 0, pixelHeight / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // Subtle volumetric light sits beneath the much brighter point cloud.
    for (let c = 0; c < clusters.length; c += 1) {
      const center = projectedClusters[c];
      const strength = activity[clusters[c].zone];
      const radius = c < 2 ? 58 : 35;
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
      gradient.addColorStop(0, rgba(palette[clusters[c].zone], 0.035 + strength * 0.07));
      gradient.addColorStop(1, rgba(palette[clusters[c].zone], 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    }

    for (const edge of edges) {
      const a = projected[edge.a], b = projected[edge.b];
      const zone = neurons[edge.a].zone;
      const energy = (activity[zone] + activity[neurons[edge.b].zone]) * 0.5;
      const near = clamp(0.70 + (a.depth + b.depth) * 0.17, 0.45, 1);
      ctx.strokeStyle = rgba(palette[zone], (edge.cross ? 0.12 + energy * 0.16 : 0.055 + energy * 0.095) * near);
      ctx.lineWidth = edge.cross ? 0.75 : 0.57;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (edge.cross) {
        const mx = (a.x + b.x) * 0.5 - (b.y - a.y) * edge.bend;
        const my = (a.y + b.y) * 0.5 + (b.x - a.x) * edge.bend;
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
      } else ctx.lineTo(b.x, b.y);
      ctx.stroke();

      if (!edge.packet) continue;
      if (!reducedMotion && playing) edge.phase = (edge.phase + dt * edge.speed * (0.75 + energy * 2.2)) % 1;
      const t = edge.phase;
      const alpha = Math.sin(t * Math.PI) * (playing ? 0.24 + energy * 0.61 : 0.09);
      if (alpha < 0.07) continue;
      let x, y;
      if (edge.cross) {
        const mx = (a.x + b.x) * 0.5 - (b.y - a.y) * edge.bend;
        const my = (a.y + b.y) * 0.5 + (b.x - a.x) * edge.bend;
        const u = 1 - t;
        x = u * u * a.x + 2 * u * t * mx + t * t * b.x;
        y = u * u * a.y + 2 * u * t * my + t * t * b.y;
      } else {
        x = a.x + (b.x - a.x) * t;
        y = a.y + (b.y - a.y) * t;
      }
      ctx.fillStyle = rgba(white, alpha);
      ctx.beginPath();
      ctx.arc(x, y, 1.10 + energy * 0.50, 0, TAU);
      ctx.fill();
    }

    depthOrder.sort((a, b) => projected[a].depth - projected[b].depth);
    for (const index of depthOrder) {
      const neuron = neurons[index];
      const point = projected[index];
      const zoneEnergy = activity[neuron.zone];
      const age = clock - pulseAt[neuron.cluster];
      const wave = age >= 0 && age < 1.3
        ? Math.exp(-Math.pow((neuron.radius - age * 1.30) / 0.16, 2))
          * pulsePower[neuron.cluster] * Math.exp(-age * 0.8)
        : 0;
      const shimmer = reducedMotion ? 0.18 : Math.pow(Math.max(0, Math.sin(clock * neuron.rate + neuron.phase)), 8);
      const depth = clamp(0.76 + point.depth * 0.28, 0.52, 1);
      const energy = clamp(0.32 + zoneEnergy * 0.40 + shimmer * (playing ? 0.16 : 0.06) + wave * 0.67);
      const alpha = clamp((neuron.sparkle ? 0.64 : 0.38) + energy * 0.46 + wave * 0.28) * depth;
      const color = neuron.tint ? palette[neuron.zone] : white;
      const radius = neuron.size * (0.88 + energy * 0.23 + wave * 0.23) * point.scale;
      if (neuron.sparkle && (energy > 0.48 || wave > 0.24)) {
        ctx.shadowColor = rgba(color, 0.40 + wave * 0.48);
        ctx.shadowBlur = 4 + energy * 5;
      } else ctx.shadowBlur = 0;
      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || canvas.clientWidth || 236;
    const cssHeight = rect.height || canvas.clientHeight || 181;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
    const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    pixelWidth = nextWidth;
    pixelHeight = nextHeight;
    draw(lastFrame.time || 0, lastFrame);
  }

  function update(frame = {}) {
    if (disposed) return;
    lastFrame = frame;
    if (!pixelWidth || !pixelHeight) resize();
    let time = Number(frame.time);
    if (!Number.isFinite(time)) time = performance.now() * 0.001;
    if (time > 100000) time *= 0.001;
    draw(time, frame);
  }

  function dispose() {
    disposed = true;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  resize();
  return { update, resize, dispose };
}

