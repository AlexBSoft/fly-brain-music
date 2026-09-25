/**
 * A procedural, audio reactive neural cloud. This is an artistic simulation,
 * not a biological connectome or a neural network.
 */
export function createBrainViz(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { update() {}, resize() {}, dispose() {} };

  const W = 400;
  const H = 300;
  const TAU = Math.PI * 2;
  const basePalette = [
    [65, 226, 242],   // visual
    [231, 119, 246],  // sound
    [255, 177, 108],  // motor / rhythm
    [153, 164, 255],  // integration
  ];
  const palette = basePalette.map((color) => [...color]);
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));
  const rgba = (color, alpha) => 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',' + clamp(alpha) + ')';
  const mixColor = (a, b, amount) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount));
  let seed = 864023;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const gaussian = () => random() + random() + random() + random() + random() + random() - 3;
  function hslToRgb(hue, saturation, lightness) {
    const channel = (offset) => {
      const k = (offset + hue * 12) % 12;
      const a = saturation * Math.min(lightness, 1 - lightness);
      return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [channel(0), channel(8), channel(4)];
  }

  // Seven overlapping cell populations form two optic lobes, paired upper
  // sensory and lower motor clusters, and a central integration cluster.
  const clusters = [
    { x: -1.08, y: 0.00, z: -0.06, rx: 0.34, ry: 0.38, rz: 0.39, zone: 0, count: 27, phase: 0.1 },
    { x:  1.08, y: 0.02, z:  0.06, rx: 0.34, ry: 0.38, rz: 0.39, zone: 0, count: 27, phase: 1.7 },
    { x: -0.48, y: -0.49, z: 0.18, rx: 0.27, ry: 0.24, rz: 0.30, zone: 1, count: 20, phase: 2.8 },
    { x:  0.48, y: -0.47, z: 0.15, rx: 0.27, ry: 0.24, rz: 0.30, zone: 1, count: 20, phase: 4.2 },
    { x:  0.00, y:  0.00, z: -0.14, rx: 0.33, ry: 0.34, rz: 0.37, zone: 3, count: 25, phase: 1.1 },
    { x: -0.48, y:  0.52, z: 0.10, rx: 0.28, ry: 0.25, rz: 0.30, zone: 2, count: 20, phase: 5.1 },
    { x:  0.48, y:  0.52, z: 0.12, rx: 0.28, ry: 0.25, rz: 0.30, zone: 2, count: 20, phase: 3.5 },
  ];
  const nodes = [];
  const clusterNodes = clusters.map(() => []);
  for (let c = 0; c < clusters.length; c += 1) {
    const cluster = clusters[c];
    for (let j = 0; j < cluster.count; j += 1) {
      const hub = j === 0;
      const ox = hub ? 0 : gaussian() * cluster.rx;
      const oy = hub ? 0 : gaussian() * cluster.ry;
      const oz = hub ? 0 : gaussian() * cluster.rz;
      const node = {
        cluster: c,
        zone: cluster.zone,
        ox, oy, oz,
        radius: Math.sqrt((ox / cluster.rx) ** 2 + (oy / cluster.ry) ** 2 + (oz / cluster.rz) ** 2),
        size: hub ? 3.3 : 1.1 + random() * 1.25,
        phase: random() * TAU,
        rate: 2.1 + random() * 3.1,
        hub,
      };
      clusterNodes[c].push(nodes.length);
      nodes.push(node);
    }
  }

  const edges = [];
  const edgeKeys = new Set();
  function addEdge(a, b, cross = false) {
    const key = Math.min(a, b) + ':' + Math.max(a, b);
    if (a === b || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      a, b, cross,
      bend: cross ? (random() - 0.5) * 0.23 : 0,
      travel: random(),
      speed: 0.18 + random() * 0.36,
      pulse: cross || random() < 0.38,
    });
  }
  // A sparse local mesh leaves visible gaps between clusters.
  for (const ids of clusterNodes) {
    for (const i of ids) {
      const node = nodes[i];
      const nearest = ids
        .filter((j) => i !== j)
        .map((j) => {
          const other = nodes[j];
          const dx = node.ox - other.ox;
          const dy = node.oy - other.oy;
          const dz = (node.oz - other.oz) * 0.7;
          return { j, distance: dx * dx + dy * dy + dz * dz };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, node.hub ? 6 : 3);
      for (const item of nearest) addEdge(i, item.j);
      if (!node.hub && random() < 0.22) addEdge(i, ids[0]);
    }
  }
  // These bundles make communication between populations legible.
  const routes = [
    [0, 2], [1, 3], [0, 4], [1, 4],
    [2, 4], [3, 4], [2, 3], [4, 5],
    [4, 6], [5, 6], [0, 5], [1, 6],
  ];
  for (const [from, to] of routes) {
    const source = clusterNodes[from];
    const target = clusterNodes[to];
    addEdge(source[0], target[0], true);
    for (let i = 0; i < 2; i += 1) {
      addEdge(
        source[1 + Math.floor(random() * (source.length - 1))],
        target[1 + Math.floor(random() * (target.length - 1))],
        true,
      );
    }
  }

  const activity = [0.13, 0.12, 0.1, 0.13];
  const bursts = [0, 0, 0, 0];
  const previous = { bass: 0, mid: 0, treble: 0, level: 0, luma: 0.34, motion: 0, hue: 0.55 };
  const projected = nodes.map(() => ({ x: 0, y: 0, depth: 0, scale: 1 }));
  const projectedClusters = clusters.map(() => ({ x: 0, y: 0, depth: 0, scale: 1 }));
  const depthOrder = nodes.map((_, index) => index);
  let lastTime = null;
  let pixelWidth = 0;
  let pixelHeight = 0;
  let lastFrame = { time: 0, audio: {}, visual: {}, playing: false };
  let disposed = false;
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* optional */ }

  function glow(x, y, radius, color, strength) {
    if (strength <= 0.01) return;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, 0.22 * strength));
    gradient.addColorStop(0.36, rgba(color, 0.085 * strength));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
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

    const hueChange = Math.abs(hue - previous.hue);
    const colorJump = Math.min(hueChange, 1 - hueChange);
    if (playing) {
      bursts[0] = Math.max(bursts[0], clamp((motion - previous.motion) * 2.8), clamp((luma - previous.luma) * 3), clamp(colorJump * 5));
      bursts[1] = Math.max(bursts[1], clamp((mid - previous.mid) * 3.8), clamp((treble - previous.treble) * 3.8));
      bursts[2] = Math.max(bursts[2], beat, clamp((bass - previous.bass) * 4));
      bursts[3] = Math.max(bursts[3], beat * 0.65, clamp((level - previous.level) * 3));
    }
    Object.assign(previous, { bass, mid, treble, level, luma, motion, hue });
    const idle = playing ? 1 : 0.16;
    const targets = [
      (0.11 + 0.36 * luma + 0.64 * motion + 0.32 * treble + bursts[0] * 0.42) * idle,
      (0.10 + 0.74 * mid + 0.62 * treble + 0.32 * level + bursts[1] * 0.42) * idle,
      (0.10 + 0.88 * bass + 0.30 * level + 0.50 * beat + bursts[2] * 0.46) * idle,
      (0.12 + 0.60 * level + 0.32 * mid + 0.30 * motion + bursts[3] * 0.38) * idle,
    ];
    for (let i = 0; i < 4; i += 1) {
      const target = clamp(targets[i]);
      const rate = target > activity[i] ? 17 : 4.6;
      activity[i] += (target - activity[i]) * (1 - Math.exp(-dt * rate));
      bursts[i] *= Math.exp(-dt * (i === 2 ? 3.1 : 4.2));
    }
    const videoTint = hslToRgb(hue, 0.9, 0.66);
    palette[0] = mixColor(basePalette[0], videoTint, 0.8);
    palette[1] = mixColor(basePalette[1], videoTint, 0.14);
    palette[2] = mixColor(basePalette[2], videoTint, 0.1);
    palette[3] = mixColor(basePalette[3], videoTint, 0.32);

    // Slowly rotating perspective and independently breathing populations make
    // the network read as a cloud in depth rather than a flat anatomical icon.
    const yaw = reducedMotion ? 0.07 : 0.08 + Math.sin(time * 0.21) * 0.17 + Math.sin(time * 0.073) * 0.06;
    const pitch = reducedMotion ? -0.09 : -0.09 + Math.sin(time * 0.17 + 1.2) * 0.08;
    const roll = reducedMotion ? 0 : Math.sin(time * 0.13) * 0.022;
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
      const scale = 1 + depth * 0.14;
      result.x = 200 + rx * 118 * scale;
      result.y = 150 + ry * 118 * scale;
      result.depth = depth;
      result.scale = scale;
    }
    for (let c = 0; c < clusters.length; c += 1) {
      const cluster = clusters[c];
      const strength = activity[cluster.zone];
      const drift = reducedMotion ? 0 : 1;
      const cx = cluster.x + drift * Math.sin(time * 0.43 + cluster.phase) * (0.018 + strength * 0.022);
      const cy0 = cluster.y + drift * Math.cos(time * 0.37 + cluster.phase) * (0.015 + strength * 0.018);
      const cz = cluster.z + drift * Math.sin(time * 0.31 + cluster.phase * 1.7) * 0.025;
      const breathe = 1 + drift * Math.sin(time * 0.94 + cluster.phase) * 0.045 + strength * 0.055;
      project(cx, cy0, cz, projectedClusters[c]);
      for (const index of clusterNodes[c]) {
        const node = nodes[index];
        const micro = reducedMotion ? 0 : 0.009 + strength * 0.013;
        project(
          cx + node.ox * breathe + Math.sin(time * 0.7 + node.phase) * micro,
          cy0 + node.oy * breathe + Math.cos(time * 0.61 + node.phase * 1.3) * micro,
          cz + node.oz * breathe + Math.sin(time * 0.53 + node.phase * 0.8) * micro,
          projected[index],
        );
      }
    }

    ctx.setTransform(pixelWidth / W, 0, 0, pixelHeight / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    glow(200, 151, 108, palette[3], 0.38 + activity[3] * 1.0);
    for (let c = 0; c < clusters.length; c += 1) {
      const cluster = clusters[c];
      const center = projectedClusters[c];
      const strength = activity[cluster.zone];
      glow(center.x, center.y, (cluster.zone === 0 ? 57 : 49) * center.scale, palette[cluster.zone], 0.85 + strength * 2.0 + bursts[cluster.zone] * 0.85);
    }

    // Distant filaments recede; active inter-cluster bundles stay readable.
    for (const edge of edges) {
      const a = projected[edge.a], b = projected[edge.b];
      const zone = nodes[edge.a].zone;
      const strength = (activity[zone] + activity[nodes[edge.b].zone]) * 0.5;
      const depth = clamp(0.74 + (a.depth + b.depth) * 0.15, 0.45, 1);
      const flicker = reducedMotion ? 0.7 : 0.68 + 0.32 * Math.sin(time * 3.3 + edge.travel * TAU);
      const primary = edge.cross && nodes[edge.a].hub && nodes[edge.b].hub;
      const alpha = ((primary ? 0.42 : edge.cross ? 0.28 : 0.19)
        + strength * (primary ? 0.52 : edge.cross ? 0.44 : 0.34)
        + bursts[zone] * (edge.cross ? 0.26 : 0.18)) * depth * (0.86 + flicker * 0.14);
      ctx.strokeStyle = rgba(palette[zone], alpha);
      ctx.lineWidth = (primary ? 1.75 : edge.cross ? 1.3 : 0.9) + strength * (primary ? 1.1 : edge.cross ? 0.95 : 0.65);
      ctx.shadowColor = rgba(palette[zone], edge.cross ? 0.72 : 0);
      ctx.shadowBlur = edge.cross ? 7 + strength * 8 : 0;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (edge.cross) {
        const mx = (a.x + b.x) * 0.5 - (b.y - a.y) * edge.bend;
        const my = (a.y + b.y) * 0.5 + (b.x - a.x) * edge.bend;
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
      } else ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Individual packets travel down axons. Bass and onsets strengthen motor
    // routes; upper clusters answer mids and treble; optic clusters follow video.
    for (const edge of edges) {
      if (!edge.pulse) continue;
      const a = projected[edge.a], b = projected[edge.b];
      const zone = nodes[edge.a].zone;
      const strength = (activity[zone] + activity[nodes[edge.b].zone]) * 0.5;
      if (!reducedMotion) {
        edge.travel = (edge.travel + dt * edge.speed * (playing ? 0.55 + strength * 1.8 : 0.16)) % 1;
      }
      const t = edge.travel;
      const fade = Math.sin(Math.PI * t);
      const alpha = (0.23 + strength * 1.0 + bursts[zone] * 0.55) * fade * (playing ? 1 : 0.35);
      if (alpha < 0.055) continue;
      let x, y, tx, ty;
      if (edge.cross) {
        const mx = (a.x + b.x) * 0.5 - (b.y - a.y) * edge.bend;
        const my = (a.y + b.y) * 0.5 + (b.x - a.x) * edge.bend;
        const u = 1 - t;
        x = u * u * a.x + 2 * u * t * mx + t * t * b.x;
        y = u * u * a.y + 2 * u * t * my + t * t * b.y;
        tx = 2 * u * (mx - a.x) + 2 * t * (b.x - mx);
        ty = 2 * u * (my - a.y) + 2 * t * (b.y - my);
      } else {
        x = a.x + (b.x - a.x) * t;
        y = a.y + (b.y - a.y) * t;
        tx = b.x - a.x;
        ty = b.y - a.y;
      }
      const length = Math.hypot(tx, ty) || 1;
      const trail = edge.cross ? 5.5 : 3.2;
      ctx.strokeStyle = rgba(palette[zone], alpha * 0.62);
      ctx.lineWidth = 1.6 + strength * 1.3;
      ctx.beginPath();
      ctx.moveTo(x - tx / length * trail, y - ty / length * trail);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = rgba(palette[zone], alpha);
      ctx.shadowColor = rgba(palette[zone], 0.8);
      ctx.shadowBlur = 5 + strength * 8;
      ctx.beginPath();
      ctx.arc(x, y, 1.05 + strength * 1.45, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    depthOrder.sort((a, b) => projected[a].depth - projected[b].depth);
    for (const index of depthOrder) {
      const node = nodes[index];
      const point = projected[index];
      const strength = activity[node.zone];
      const localWave = reducedMotion ? 0.34 : Math.pow(Math.max(0, Math.sin(time * node.rate + node.phase - node.radius * 2.3)), 7);
      const travelling = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * (4.2 + strength * 2) - node.radius * 7.5 + clusters[node.cluster].phase);
      const energy = clamp(0.13 + strength * (0.48 + localWave * 0.65) + bursts[node.zone] * travelling * 0.55);
      const depth = clamp(0.72 + point.depth * 0.2, 0.42, 1);
      const radius = node.size * (0.94 + energy * 0.82) * point.scale;
      if (node.hub) {
        glow(point.x, point.y, 13 + strength * 10, palette[node.zone], 0.3 + energy * 1.5);
        ctx.strokeStyle = rgba(palette[node.zone], 0.13 + energy * 0.30);
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4.8 + energy * 2.7, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = rgba(palette[node.zone], (0.45 + energy * 0.55) * depth);
      if (energy > 0.32 || node.hub) {
        ctx.shadowColor = rgba(palette[node.zone], 0.75);
        ctx.shadowBlur = 7 + energy * 11;
      } else ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || canvas.clientWidth || 380;
    const cssHeight = rect.height || canvas.clientHeight || 300;
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

