import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const THEMES = {
  club: { background: 0x070719, fog: 0x08071a, floor: 0x121225, wall: 0x0b0b1d, primary: 0x5ceaff, secondary: 0xff4da9, accent: 0xffca89 },
  garden: { background: 0x071311, fog: 0x071611, floor: 0x10221d, wall: 0x0b1d19, primary: 0x7df6bc, secondary: 0xffcf80, accent: 0xf57f93 },
  orbit: { background: 0x050b1e, fog: 0x070e20, floor: 0x0c162a, wall: 0x081328, primary: 0x81c7ff, secondary: 0xb48aff, accent: 0xffbd87 },
};

const clamp = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export function createStage({ canvas, video }) {
  if (!canvas || !video) throw new Error('createStage needs a canvas and video element');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEMES.club.background);
  scene.fog = new THREE.FogExp2(THEMES.club.fog, 0.018);
  const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 80);
  camera.position.set(4.8, 3.7, 8.5);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.27;
  renderer.shadowMap.enabled = false;
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(-0.1, 1.85, -1.8);
  controls.enableDamping = true;
  controls.dampingFactor = 0.045;
  controls.enablePan = false;
  controls.minDistance = 7.2;
  controls.maxDistance = 16;
  controls.minPolarAngle = 0.72;
  controls.maxPolarAngle = 1.56;
  controls.minAzimuthAngle = -0.65;
  controls.maxAzimuthAngle = 0.72;
  controls.update();
  const initialViewOffset = camera.position.clone().sub(controls.target);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1000, 700), 0.78, 0.58, 0.74);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const roleMats = [];
  const palette = THEMES.club;
  const roleMat = (role, options = {}) => {
    const material = new THREE.MeshBasicMaterial({ color: palette[role], toneMapped: false, ...options });
    roleMats.push({ material, role, kind: 'color' });
    return material;
  };
  const glowMat = (role, intensity = 1) => {
    const material = new THREE.MeshStandardMaterial({ color: 0x161a27, emissive: palette[role], emissiveIntensity: intensity, metalness: 0.55, roughness: 0.3 });
    material.userData.baseEmissiveIntensity = intensity;
    roleMats.push({ material, role, kind: 'emissive' });
    return material;
  };
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x111525, metalness: 0.72, roughness: 0.29, flatShading: true });
  const edgeMetal = new THREE.MeshStandardMaterial({ color: 0x353849, metalness: 0.78, roughness: 0.25, flatShading: true });
  const floorMat = new THREE.MeshStandardMaterial({ color: palette.floor, metalness: 0.82, roughness: 0.35 });
  const wallMat = new THREE.MeshStandardMaterial({ color: palette.wall, metalness: 0.48, roughness: 0.57 });
  const hemisphere = new THREE.HemisphereLight(0x91b4ff, 0x161227, 1.05);
  scene.add(hemisphere);
  const primaryLight = new THREE.PointLight(palette.primary, 38, 15, 2);
  primaryLight.position.set(-4.8, 4.7, -0.5);
  scene.add(primaryLight);
  const secondaryLight = new THREE.PointLight(palette.secondary, 34, 13, 2);
  secondaryLight.position.set(4.9, 4.4, -2.9);
  scene.add(secondaryLight);
  const screenLight = new THREE.PointLight(0xbfd9ff, 25, 9, 2);
  screenLight.position.set(1, 2.75, -4.8);
  scene.add(screenLight);
  const flyFill = new THREE.PointLight(0xffb990, 26, 7, 2);
  flyFill.position.set(-1.1, 3.2, 3.8);
  scene.add(flyFill);
  const flyRim = new THREE.PointLight(0x71e8ff, 33, 7, 2);
  flyRim.position.set(-2.4, 3.4, -0.5);
  scene.add(flyRim);

  const mesh = (geometry, material, parent = scene) => { const object = new THREE.Mesh(geometry, material); parent.add(object); return object; };
  const box = (w, h, d, material, x, y, z, parent = scene) => { const object = mesh(new THREE.BoxGeometry(w, h, d), material, parent); object.position.set(x, y, z); return object; };
  const ring = (radius, tube, material, x, y, z, parent = scene, rotationX = 0) => { const object = mesh(new THREE.TorusGeometry(radius, tube, 6, 80), material, parent); object.position.set(x, y, z); object.rotation.x = rotationX; return object; };
  const rod = (a, b, radius, material, parent = scene, sides = 6) => {
    const direction = new THREE.Vector3().subVectors(b, a);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), sides), material, parent);
    object.position.copy(a).addScaledVector(direction, 0.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return object;
  };

  // A faceted stage and receding grid give the floating television a real room.
  box(35, 0.24, 35, floorMat, 0, -0.18, -2);
  box(19, 9, 0.3, wallMat, 0, 3.5, -8.7);
  const gridPositions = [];
  for (let x = -9; x <= 9; x += 0.9) gridPositions.push(x, 0.005, -8.5, x, 0.005, 8.5);
  for (let z = -8.5; z <= 8.5; z += 0.9) gridPositions.push(-9, 0.005, z, 9, 0.005, z);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
  const grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: palette.primary, transparent: true, opacity: 0.14, depthWrite: false }));
  scene.add(grid);
  const floorRings = [];
  for (const [radius, opacity] of [[2.3, 0.32], [3.7, 0.22], [5.5, 0.12]]) {
    const object = ring(radius, 0.015, roleMat('primary', { transparent: true, opacity, depthWrite: false }), -0.8, 0.02, -0.8, scene, Math.PI / 2);
    floorRings.push(object);
  }
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    rod(new THREE.Vector3(-0.8 + Math.cos(angle) * 2.2, 0.025, -0.8 + Math.sin(angle) * 2.2), new THREE.Vector3(-0.8 + Math.cos(angle) * 5.4, 0.025, -0.8 + Math.sin(angle) * 5.4), 0.008, roleMat(i % 2 ? 'primary' : 'secondary', { transparent: true, opacity: 0.2, depthWrite: false }));
  }
  for (let i = -4; i <= 4; i++) {
    const rib = box(0.075, 6.4, 0.12, glowMat(i % 2 ? 'secondary' : 'primary', 1.3), i * 1.8, 3.35, -8.48);
    rib.rotation.z = i * 0.025;
  }
  for (let i = 0; i < 4; i++) {
    const arch = ring(3.48 + i * 0.54, 0.023, roleMat(i % 2 ? 'secondary' : 'primary', { transparent: true, opacity: 0.7 - i * 0.13, depthWrite: false }), 0.9, 2.9, -7.9 - i * 0.13);
    arch.scale.y = 0.7;
  }

  // The TV has a fixed 16:9 aperture. The moving image is contained within it.
  const TV_X = 0.95, TV_Y = 2.85, TV_Z = -5.75, SCREEN_W = 4.78, SCREEN_H = 2.69;
  box(5.45, 3.3, 0.26, darkMetal, TV_X, TV_Y, TV_Z);
  box(5.22, 3.08, 0.08, edgeMetal, TV_X, TV_Y, TV_Z + 0.16);
  box(SCREEN_W + 0.07, SCREEN_H + 0.07, 0.02, new THREE.MeshBasicMaterial({ color: 0x050610 }), TV_X, TV_Y, TV_Z + 0.213);
  const screenPlane = mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }));
  screenPlane.position.set(TV_X, TV_Y, TV_Z + 0.228);
  const tvEdge = roleMat('primary');
  box(5.52, 0.028, 0.06, tvEdge, TV_X, TV_Y + 1.66, TV_Z + 0.1);
  box(5.52, 0.028, 0.06, tvEdge, TV_X, TV_Y - 1.66, TV_Z + 0.1);
  box(0.028, 3.32, 0.06, tvEdge, TV_X - 2.76, TV_Y, TV_Z + 0.1);
  box(0.028, 3.32, 0.06, tvEdge, TV_X + 2.76, TV_Y, TV_Z + 0.1);
  box(0.8, 0.06, 0.07, roleMat('secondary'), TV_X, TV_Y - 1.55, TV_Z + 0.24);
  const tvFoot = mesh(new THREE.CylinderGeometry(0.72, 0.92, 0.22, 8), darkMetal);
  tvFoot.position.set(TV_X, 0.1, TV_Z);
  box(0.15, 0.95, 0.16, darkMetal, TV_X, 0.65, TV_Z);

  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = 512; fallbackCanvas.height = 288;
  const fallbackCtx = fallbackCanvas.getContext('2d');
  const fallbackGradient = fallbackCtx.createLinearGradient(0, 0, 512, 288);
  fallbackGradient.addColorStop(0, '#0c274a'); fallbackGradient.addColorStop(0.5, '#160b35'); fallbackGradient.addColorStop(1, '#490a40');
  fallbackCtx.fillStyle = fallbackGradient; fallbackCtx.fillRect(0, 0, 512, 288);
  for (let i = 0; i < 38; i++) {
    const x = i * 14; const h = 20 + Math.abs(Math.sin(i * 0.78) * Math.cos(i * 0.24)) * 130;
    fallbackCtx.fillStyle = i % 2 ? 'rgba(93,232,255,.34)' : 'rgba(255,77,169,.3)';
    fallbackCtx.fillRect(x, 144 - h / 2, 7, h);
  }
  let fallbackTexture = new THREE.CanvasTexture(fallbackCanvas);
  fallbackTexture.colorSpace = THREE.SRGBColorSpace;
  let posterTexture = null;
  let videoTexture = null;
  let activeTexture = fallbackTexture;
  const applyTexture = (texture, width, height) => {
    activeTexture = texture;
    const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
    const apertureAspect = SCREEN_W / SCREEN_H;
    const w = aspect >= apertureAspect ? SCREEN_W : SCREEN_H * aspect;
    const h = aspect >= apertureAspect ? SCREEN_W / aspect : SCREEN_H;
    screenPlane.scale.set(w, h, 1);
    screenPlane.material.map = texture;
    screenPlane.material.needsUpdate = true;
  };
  applyTexture(fallbackTexture, 16, 9);
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}media/poster.jpg`, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    posterTexture = texture;
    if (!videoTexture || video.readyState < 2) applyTexture(posterTexture, texture.image.width, texture.image.height);
  }, undefined, () => {});
  const refreshVideoTexture = () => {
    if (videoTexture) videoTexture.dispose();
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.generateMipmaps = false;
    if (video.readyState >= 2 && video.videoWidth) applyTexture(videoTexture, video.videoWidth, video.videoHeight);
    else if (posterTexture) applyTexture(posterTexture, posterTexture.image.width, posterTexture.image.height);
  };
  const onVideoReady = () => {
    if (!videoTexture) refreshVideoTexture();
    if (video.videoWidth && video.readyState >= 2) applyTexture(videoTexture, video.videoWidth, video.videoHeight);
  };
  video.addEventListener('loadedmetadata', refreshVideoTexture);
  video.addEventListener('loadeddata', onVideoReady);
  if (video.videoWidth) refreshVideoTexture();

  // A gentle suggestion of light from the screen on the glossy floor.
  const reflection = mesh(new THREE.PlaneGeometry(5.1, 6), roleMat('primary', { transparent: true, opacity: 0.065, depthWrite: false, side: THREE.DoubleSide }));
  reflection.rotation.x = -Math.PI / 2;
  reflection.position.set(TV_X, 0.025, -2.5);

  // The fly is built from deliberately angular shapes, viewed over its shoulder.
  const perch = new THREE.Group();
  perch.position.set(-1.45, 0, 1.35);
  scene.add(perch);
  const plinth = mesh(new THREE.CylinderGeometry(0.82, 1.06, 0.66, 10), darkMetal, perch);
  plinth.position.y = 0.39;
  const plinthLip = mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.07, 10), glowMat('secondary', 1.5), perch);
  plinthLip.position.y = 0.74;
  const fly = new THREE.Group();
  fly.position.set(-1.45, 1.6, 1.35);
  fly.scale.setScalar(0.93);
  fly.rotation.y = -0.32;
  scene.add(fly);
  const flyBody = new THREE.MeshStandardMaterial({ color: 0x775e69, metalness: 0.34, roughness: 0.49, flatShading: true });
  const flyAbdomen = new THREE.MeshStandardMaterial({ color: 0x76535a, metalness: 0.35, roughness: 0.5, flatShading: true });
  const flyBands = new THREE.MeshStandardMaterial({ color: 0xca8b5d, emissive: 0x542713, emissiveIntensity: 0.35, metalness: 0.42, roughness: 0.4 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xf65a62, emissive: 0xbd1d52, emissiveIntensity: 1.45, metalness: 0.22, roughness: 0.19, flatShading: true });
  const flyHeadMat = new THREE.MeshStandardMaterial({ color: 0xb98b6b, metalness: 0.22, roughness: 0.52, flatShading: true });
  const thorax = mesh(new THREE.IcosahedronGeometry(0.56, 1), flyBody, fly);
  thorax.scale.set(1, 0.84, 1.16);
  const abdomenRig = new THREE.Group();
  abdomenRig.position.set(0, -0.04, 0.87);
  fly.add(abdomenRig);
  const abdomen = mesh(new THREE.IcosahedronGeometry(0.62, 1), flyAbdomen, abdomenRig);
  abdomen.scale.set(0.82, 0.7, 1.36);
  for (let i = 0; i < 4; i++) {
    const band = ring(0.46 - i * 0.035, 0.019, flyBands, 0, 0.01, -0.45 + i * 0.3, abdomenRig);
    band.scale.y = 0.78 - i * 0.035;
  }
  const headRig = new THREE.Group();
  headRig.position.set(0, 0.17, -0.79);
  fly.add(headRig);
  const head = mesh(new THREE.IcosahedronGeometry(0.5, 2), flyHeadMat, headRig);
  head.scale.set(1.05, 0.94, 0.92);
  const eyes = [];
  const antennae = [];
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.IcosahedronGeometry(0.34, 2), eyeMat, headRig);
    eye.position.set(side * 0.39, 0.05, -0.09);
    eye.scale.set(0.78, 0.88, 1.1);
    eyes.push(eye);
    const glint = mesh(new THREE.IcosahedronGeometry(0.065, 1), new THREE.MeshBasicMaterial({ color: 0xffe8d4, toneMapped: false }), headRig);
    glint.position.set(side * 0.59, 0.18, -0.24);
    const antenna = new THREE.Group();
    antenna.position.set(side * 0.16, 0.33, -0.28);
    headRig.add(antenna);
    rod(new THREE.Vector3(), new THREE.Vector3(side * 0.11, 0.37, -0.22), 0.016, flyBody, antenna);
    const antennaTip = mesh(new THREE.IcosahedronGeometry(0.045, 0), flyBands, antenna);
    antennaTip.position.set(side * 0.11, 0.37, -0.22);
    antennae.push({ pivot: antenna, side });
  }
  // Six articulated legs touch the rim of the perch.
  const legs = [];
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const z = -0.37 + i * 0.46;
    const hip = new THREE.Vector3(side * 0.34, -0.22, z);
    const joint = new THREE.Vector3(side * (0.65 + i * 0.04), -0.35, z + 0.12);
    const foot = new THREE.Vector3(side * (0.74 + i * 0.06), -0.78, z + 0.27);
    const leg = new THREE.Group();
    leg.position.copy(hip);
    fly.add(leg);
    rod(new THREE.Vector3(), joint.clone().sub(hip), 0.023, flyBody, leg);
    rod(joint.clone().sub(hip), foot.clone().sub(hip), 0.016, flyBody, leg);
    legs.push({ pivot: leg, side, index: i });
  }
  const wingMaterial = new THREE.MeshPhysicalMaterial({ color: 0xc4f7ff, emissive: 0x2c7890, emissiveIntensity: 0.38, metalness: 0.08, roughness: 0.19, transparent: true, opacity: 0.66, side: THREE.DoubleSide, depthWrite: false, flatShading: true });
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(side * 0.3, 0.37, 0.13);
    fly.add(wing);
    const outline = [[0, 0, 0], [0.24, 0.17, -0.04], [1.08, 0.66, -0.16], [1.92, 0.82, 0.18], [2.1, 0.7, 0.72], [1.65, 0.43, 1.13], [0.65, 0.12, 0.94], [0.08, 0.02, 0.42]];
    const positions = [];
    for (let i = 1; i < outline.length - 1; i++) {
      for (const index of [0, i, i + 1]) {
        const p = outline[index]; positions.push(side * p[0], p[1], p[2]);
      }
    }
    const wingGeometry = new THREE.BufferGeometry();
    wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    wingGeometry.computeVertexNormals();
    mesh(wingGeometry, wingMaterial, wing);
    const veinMaterial = new THREE.LineBasicMaterial({ color: 0xd5faff, transparent: true, opacity: 0.56, depthWrite: false });
    for (const end of [outline[3], outline[4], outline[5], outline[6]]) {
      const veinGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * end[0], end[1], end[2])]);
      wing.add(new THREE.Line(veinGeometry, veinMaterial));
    }
    wings.push(wing);
  }

  // Four recessed, deforming speaker cones put visible low-end motion in the room.
  // The outer rubber surround stays fixed while the diaphragm and dust cap travel.
  const club = new THREE.Group(); scene.add(club);
  const equalizers = [];
  const speakerDrivers = [];
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x242936, emissive: 0x111620, emissiveIntensity: 0.22, metalness: 0.62, roughness: 0.36, flatShading: true });
  const baffleMat = new THREE.MeshStandardMaterial({ color: 0x171b25, metalness: 0.42, roughness: 0.54 });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x454b56, emissive: 0x0b0e15, emissiveIntensity: 0.22, metalness: 0.47, roughness: 0.42, side: THREE.DoubleSide, flatShading: true });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x10131b, metalness: 0.18, roughness: 0.79 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x171c27, metalness: 0.72, roughness: 0.17 });
  const speakerTrimMat = new THREE.MeshStandardMaterial({ color: 0x606c7a, metalness: 0.82, roughness: 0.27 });
  const speakerCavityMat = new THREE.MeshBasicMaterial({ color: 0x05070d });
  function makeDiaphragm(radius) {
    // Radial profile: a shallow cone, a creased outer fold, then its fixed edge.
    const profile = [
      [0.17, 0.125, 1], [0.28, 0.108, 1], [0.39, 0.082, 0.88],
      [0.53, 0.035, 0.66], [0.68, -0.013, 0.37],
      [0.82, -0.032, 0.16], [0.92, -0.018, 0.035], [0.98, 0.005, 0],
    ];
    const segments = 40;
    const vertices = new Float32Array(profile.length * (segments + 1) * 3);
    const baseDepth = new Float32Array(profile.length * (segments + 1));
    const travelWeight = new Float32Array(baseDepth.length);
    const indices = [];
    for (let row = 0; row < profile.length; row++) {
      const [radial, depth, weight] = profile[row];
      for (let segment = 0; segment <= segments; segment++) {
        const angle = segment / segments * Math.PI * 2;
        const vertex = row * (segments + 1) + segment;
        vertices[vertex * 3] = Math.cos(angle) * radial * radius;
        vertices[vertex * 3 + 1] = Math.sin(angle) * radial * radius;
        vertices[vertex * 3 + 2] = depth;
        baseDepth[vertex] = depth;
        travelWeight[vertex] = weight;
      }
    }
    for (let row = 0; row < profile.length - 1; row++) {
      for (let segment = 0; segment < segments; segment++) {
        const inner = row * (segments + 1) + segment;
        const outer = (row + 1) * (segments + 1) + segment;
        indices.push(inner, outer, inner + 1, outer, outer + 1, inner + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return { geometry, baseDepth, travelWeight };
  }
  for (const side of [-1, 1]) {
    const sx = TV_X + side * 3.62;
    const cabinet = new THREE.Group();
    cabinet.position.set(sx, 2.0, -6.05);
    cabinet.rotation.y = -side * 0.11;
    club.add(cabinet);
    box(1.42, 3.52, 0.92, cabinetMat, 0, 0, 0, cabinet);
    box(1.31, 3.39, 0.05, baffleMat, 0, 0, 0.49, cabinet);
    box(1.36, 0.035, 0.045, speakerTrimMat, 0, 1.67, 0.51, cabinet);
    box(1.36, 0.035, 0.045, speakerTrimMat, 0, -1.67, 0.51, cabinet);
    box(0.72, 0.1, 0.015, speakerCavityMat, 0, -1.52, 0.522, cabinet);
    for (const [y, radius, gain, colorRole] of [[-0.76, 0.58, 1, 'secondary'], [0.69, 0.49, 0.68, 'primary']]) {
      const driver = new THREE.Group();
      driver.position.set(0, y, 0.52);
      cabinet.add(driver);
      mesh(new THREE.CircleGeometry(radius * 1.07, 48), speakerCavityMat, driver).position.z = 0.001;
      ring(radius * 1.025, 0.045, speakerTrimMat, 0, 0, 0.025, driver);
      ring(radius * 0.92, 0.047, rubberMat, 0, 0, 0.035, driver);
      const lightRing = ring(radius * 1.09, 0.012, glowMat(colorRole, 0.6), 0, 0, 0.048, driver);
      const { geometry, baseDepth, travelWeight } = makeDiaphragm(radius);
      mesh(geometry, coneMat, driver).position.z = 0.045;
      const dustCap = mesh(new THREE.SphereGeometry(radius * 0.29, 20, 12), capMat, driver);
      dustCap.scale.z = 0.48;
      dustCap.position.z = 0.17;
      const capHighlight = ring(radius * 0.23, 0.006, speakerTrimMat, 0, 0, 0.229, driver);
      for (const angle of [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4]) {
        const bolt = mesh(new THREE.SphereGeometry(0.025, 8, 5), speakerTrimMat, driver);
        bolt.position.set(Math.cos(angle) * radius * 1.14, Math.sin(angle) * radius * 1.14, 0.045);
      }
      speakerDrivers.push({ geometry, baseDepth, travelWeight, dustCap, capHighlight, lightRing, gain, baseCapZ: 0.17, baseHighlightZ: 0.229 });
    }
    for (let i = 0; i < 12; i++) {
      const bar = box(0.08, 0.35, 0.08, roleMat(i % 3 ? 'primary' : 'secondary'), side * (0.81 + i * 0.12), -1.69, -0.5, cabinet);
      equalizers.push(bar);
    }
  }
  const beamMaterial = roleMat('primary', { transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beams = [];
  for (let i = 0; i < 5; i++) {
    const x = -5 + i * 2.5;
    const beam = mesh(new THREE.CylinderGeometry(0.02, 0.85, 5.9, 14, 1, true), beamMaterial, club);
    beam.position.set(x, 3.35, -1.5 - (i % 2) * 1.4);
    beams.push(beam);
    const lamp = mesh(new THREE.IcosahedronGeometry(0.18, 1), glowMat(i % 2 ? 'secondary' : 'primary', 3), club);
    lamp.position.set(x, 6.23, beam.position.z);
  }

  const garden = new THREE.Group(); scene.add(garden);
  const leaves = [];
  for (let i = 0; i < 24; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (4.4 + (i % 4) * 0.38);
    const z = -7.5 + (i % 6) * 1.2;
    const stem = rod(new THREE.Vector3(x, 0.1, z), new THREE.Vector3(x - side * 0.35, 1.0 + (i % 5) * 0.33, z - 0.3), 0.026, glowMat('primary', 0.4), garden);
    const leaf = mesh(new THREE.IcosahedronGeometry(0.43, 0), i % 3 ? glowMat('primary', 1.2) : glowMat('secondary', 1), garden);
    leaf.position.copy(stem.position).add(new THREE.Vector3(0, 0.35, 0));
    leaf.scale.set(0.34, 1.25, 0.66); leaf.rotation.z = side * 0.35;
    leaves.push(leaf);
  }
  for (let i = 0; i < 9; i++) {
    const cap = mesh(new THREE.ConeGeometry(0.4 + (i % 3) * 0.16, 0.35, 7), glowMat(i % 2 ? 'secondary' : 'primary', 1.7), garden);
    cap.rotation.x = Math.PI; cap.position.set(-5.9 + i * 1.5, 0.8 + (i % 3) * 0.25, -4.8 - (i % 2) * 1.2);
    rod(new THREE.Vector3(cap.position.x, 0.03, cap.position.z), new THREE.Vector3(cap.position.x, cap.position.y, cap.position.z), 0.055, darkMetal, garden);
  }

  const orbit = new THREE.Group(); scene.add(orbit);
  const orbitRings = [];
  for (let i = 0; i < 5; i++) {
    const halo = ring(1.4 + i * 0.46, 0.023, roleMat(i % 2 ? 'secondary' : 'primary', { transparent: true, opacity: 0.7 - i * 0.08, depthWrite: false }), -4.4, 3.1, -7.1, orbit);
    halo.rotation.y = i * 0.25; halo.rotation.x = i * 0.3;
    orbitRings.push(halo);
  }
  for (let i = 0; i < 13; i++) {
    const angle = i * 2.399;
    const radius = 1.5 + (i % 4) * 0.56;
    const rock = mesh(new THREE.DodecahedronGeometry(0.16 + (i % 3) * 0.08, 0), i % 2 ? edgeMetal : glowMat('secondary', 0.8), orbit);
    rock.position.set(-4.4 + Math.cos(angle) * radius, 3.1 + Math.sin(angle) * radius, -7.2 + (i % 3) * 0.3);
    orbitRings.push(rock);
  }

  // Sparse drifting dust and a small neural halo add depth without shader heavy particles.
  const dustPositions = new Float32Array(360 * 3);
  let seed = 321989;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 360; i++) { dustPositions[i * 3] = (random() - 0.5) * 18; dustPositions[i * 3 + 1] = random() * 7.3; dustPositions[i * 3 + 2] = -8 + random() * 14; }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMaterial = new THREE.PointsMaterial({ color: palette.primary, size: 0.042, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const dust = new THREE.Points(dustGeo, dustMaterial); scene.add(dust);
  const neural = new THREE.Group(); neural.position.set(-3.8, 3.65, -0.8); scene.add(neural);
  const neuralShell = mesh(new THREE.IcosahedronGeometry(0.6, 2), roleMat('primary', { wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }), neural);
  neuralShell.scale.set(1.25, 0.78, 0.86);
  const neurons = [];
  for (let i = 0; i < 28; i++) {
    const a = i * 2.39996, v = -0.9 + 1.8 * i / 27;
    const r = Math.sqrt(1 - v * v);
    const node = mesh(new THREE.IcosahedronGeometry(0.04 + (i % 7 === 0 ? 0.035 : 0), 0), i % 3 ? glowMat('primary', 1) : glowMat('secondary', 1), neural);
    node.position.set(Math.cos(a) * r * 0.73, v * 0.45, Math.sin(a) * r * 0.52);
    neurons.push(node);
  }
  const neuralRing = ring(0.94, 0.012, roleMat('secondary', { transparent: true, opacity: 0.75, depthWrite: false }), 0, 0, 0, neural);
  neuralRing.rotation.x = 0.42; neuralRing.scale.y = 0.75;

  let theme = 'club';
  let disposed = false;
  function setTheme(name) {
    theme = Object.hasOwn(THEMES, name) ? name : 'club';
    const colors = THEMES[theme];
    scene.background.set(colors.background);
    scene.fog.color.set(colors.fog);
    floorMat.color.set(colors.floor); wallMat.color.set(colors.wall);
    primaryLight.color.set(colors.primary); secondaryLight.color.set(colors.secondary);
    dustMaterial.color.set(colors.primary); grid.material.color.set(colors.primary);
    for (const { material, role, kind } of roleMats) {
      if (kind === 'emissive') {
        material.emissive.set(colors[role]);
        material.emissiveIntensity = material.userData.baseEmissiveIntensity * (theme === 'garden' ? 0.45 : theme === 'orbit' ? 0.72 : 1);
      }
      else material.color.set(colors[role]);
    }
    bloom.strength = theme === 'garden' ? 0.36 : theme === 'orbit' ? 0.5 : 0.67;
    bloom.radius = 0.38;
    bloom.threshold = 0.88;
    club.visible = theme === 'club';
    garden.visible = theme === 'garden';
    orbit.visible = theme === 'orbit';
    return theme;
  }
  setTheme('club');

  function resize() {
    if (disposed) return;
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.parentElement?.clientWidth || canvas.width || 1000));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.parentElement?.clientHeight || canvas.height || 700));
    const ratio = Math.min(window.devicePixelRatio || 1, 1.7);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const framingScale = Math.min(2.6, Math.max(1, 1.42 / camera.aspect));
    camera.position.copy(controls.target).addScaledVector(initialViewOffset, framingScale);
    controls.maxDistance = Math.max(16, initialViewOffset.length() * framingScale * 1.2);
    controls.update();
  }
  resize();

  // Keep a musical phase running on the media clock even through quiet verses.
  // Detected hits gently correct its timing without becoming the only clock.
  let speakerDrive = 0;
  let speakerPhase = 0;
  let speakerImpulse = 0;
  let speakerImpulseAt = 0;
  let previousSpeakerImpact = 0;
  let danceEnergy = 0;
  let bassDrive = 0;
  let verseDrive = 0;
  let dancePhase = 0;
  let detectedBeatAt = -1;
  let beatInterval = 0.53;
  let lastBeatValue = 0;
  let lastDanceTime = 0;
  let lastWallTime = performance.now() * 0.001;
  const gestureNames = ['SIDE SLIDE', 'SHOULDER ROLL', 'SWAG WALK', 'HEAD TALK', 'CROSS STEP', 'LOW GROOVE', 'WING SHOW', 'DOUBLE TIME'];
  const motionDiagnostics = {
    mode: 'IDLE', gesture: gestureNames[0], energy: 0, bassShake: 0, speakerPump: 0,
    hop: 0, swagger: 0, sideStep: 0, shoulderRoll: 0,
    headNod: 0, legStep: 0, wingFlare: 0, antenna: 0,
  };
  const smoothstep = (a, b, value) => {
    const x = clamp((value - a) / (b - a));
    return x * x * (3 - 2 * x);
  };
  const mix = (a, b, amount) => a + (b - a) * amount;
  // Each four-beat phrase chooses a different silhouette. Blending at the
  // boundary avoids abrupt jumps while keeping recognizable choreography.
  function gesturePose(index, phase) {
    const s = Math.sin(phase), c = Math.cos(phase);
    const half = Math.sin(phase * 0.5);
    switch (index % gestureNames.length) {
      case 0: return [s, half * 0.65, s * 0.45, c * 0.2, 0.08, 0.72, 0.12];
      case 1: return [s * 0.38, c * 0.38, Math.sin(phase * 1.5) * 1.0, s * 0.32, 0.16, 0.5, 0.28];
      case 2: return [s * 0.76, c * 0.72, s * 0.64, -s * 0.55, Math.max(0, -s) * 0.26, 1, 0.2];
      case 3: return [s * 0.4, c * 0.28, Math.sin(phase * 2) * 0.42, Math.sin(phase * 1.5) * 0.8, 0.15, 0.58, 0.32];
      case 4: return [Math.sin(phase * 1.5) * 0.82, Math.cos(phase * 0.5) * 0.64, Math.sin(phase * 0.5) * 0.76, c * 0.3, 0.18, 0.96, 0.23];
      case 5: return [s * 0.48, c * 0.27, s * 0.53, c * 0.55, (1 + c) * 0.36, 0.7, 0.27];
      case 6: return [s * 0.62, c * 0.56, s * 0.66, -c * 0.34, 0.11, 0.76, 0.84];
      default: return [Math.sin(phase * 2) * 0.68, c * 0.4, Math.sin(phase * 2) * 0.75, s * 0.46, 0.14, 1, 0.38];
    }
  }

  function update({ time = 0, audio = {}, visual = {}, playing = false } = {}) {
    if (disposed) return motionDiagnostics;
    const t = Number.isFinite(time) ? time : 0;
    const bass = clamp(audio.bass), mid = clamp(audio.mid), treble = clamp(audio.treble);
    const level = clamp(audio.level), beat = clamp(audio.beat);
    const sub = clamp(audio.sub ?? bass), lowMid = clamp(audio.lowMid ?? mid);
    const presence = clamp(audio.presence ?? mid), air = clamp(audio.air ?? treble);
    const onset = clamp(audio.onset ?? beat), kick = clamp(audio.kick ?? beat);
    const snare = clamp(audio.snare ?? 0), hat = clamp(audio.hat ?? treble * 0.25);
    const pulse = clamp(audio.pulse ?? beat), groove = clamp(audio.groove ?? 0.4);
    const vocal = clamp(audio.vocal ?? presence);
    const vocalPulse = clamp(audio.vocalPulse ?? onset * presence);
    const bassImpact = clamp(audio.bassImpact ?? kick);
    const rhythmConfidence = clamp(audio.rhythmConfidence ?? groove);
    const luma = clamp(visual.luma), motion = clamp(visual.motion), hue = clamp(visual.hue);
    const activity = playing ? 1 : 0.28;
    const wallTime = performance.now() * 0.001;
    const delta = Math.min(0.05, Math.max(0, wallTime - lastWallTime));
    lastWallTime = wallTime;

    const mediaDelta = t - lastDanceTime;
    if (mediaDelta < -0.3 || mediaDelta > 2) {
      dancePhase = t * Math.PI * 2 / beatInterval;
      speakerPhase = 0;
      speakerImpulse = 0;
      speakerImpulseAt = t;
      previousSpeakerImpact = 0;
      detectedBeatAt = -1;
      lastBeatValue = 0;
    } else if (playing && mediaDelta > 0) {
      dancePhase += mediaDelta * Math.PI * 2 / beatInterval;
      speakerPhase += mediaDelta * Math.PI * 2 * (6.4 + sub * 1.4);
    }
    lastDanceTime = t;
    if (playing && beat > 0.92 && lastBeatValue <= 0.92) {
      const gap = t - detectedBeatAt;
      if (detectedBeatAt >= 0 && gap > 0.28 && gap < 1.15) beatInterval += (gap - beatInterval) * 0.21;
      detectedBeatAt = t;
      const phaseError = Math.atan2(Math.sin(dancePhase), Math.cos(dancePhase));
      dancePhase -= phaseError * (0.06 + rhythmConfidence * 0.1);
    }
    lastBeatValue = beat;
    const rhythm = dancePhase;
    const step = Math.sin(rhythm), stepLift = Math.abs(step);
    const side = Math.floor(rhythm / Math.PI) % 2 ? 1 : -1;
    const phrasePosition = Math.max(0, rhythm / (Math.PI * 8));
    const phraseNumber = Math.floor(phrasePosition);
    const phraseFraction = phrasePosition - phraseNumber;
    const phraseBlend = smoothstep(0.74, 1, phraseFraction);
    const firstPose = gesturePose(phraseNumber, rhythm);
    const nextPose = gesturePose(phraseNumber + 1, rhythm);
    const pose = firstPose.map((value, index) => mix(value, nextPose[index], phraseBlend));
    const phraseAccent = Math.floor(rhythm / (Math.PI * 2)) % 4 === 0 ? 1 : 0.35;

    // A broad low-end envelope distinguishes a bass drop from a spoken verse.
    // Vocal presence is kept alive in sparse passages rather than waiting for kicks.
    const bassTarget = playing ? clamp(Math.max(0, sub - 0.28) * 1.1 + Math.max(0, bass - 0.3) * 0.45 + bassImpact * 0.7 + kick * 0.18 - vocal * 0.32) : 0;
    bassDrive += (bassTarget - bassDrive) * (1 - Math.exp(-delta * (bassTarget > bassDrive ? 10 : 3.2)));
    const verseTarget = playing ? clamp(vocal * 0.95 + vocalPulse * 0.35 + presence * 0.39 + lowMid * 0.17 - bassDrive * 0.38) : 0;
    verseDrive += (verseTarget - verseDrive) * (1 - Math.exp(-delta * (verseTarget > verseDrive ? 7 : 3.5)));
    const verse = verseDrive * (1 - bassDrive * 0.48);
    const bassMode = bassDrive;
    const danceTarget = playing ? clamp(0.36 + level * 0.29 + groove * 0.13 + Math.max(verse, bassMode) * 0.28) : 0;
    danceEnergy += (danceTarget - danceEnergy) * (1 - Math.exp(-delta * (playing ? 7 : 5)));
    const d = danceEnergy;

    const lightScale = theme === 'garden' ? 0.57 : theme === 'orbit' ? 0.78 : 1;
    primaryLight.intensity = (21 + (bass * 23 + beat * 16) * activity) * lightScale;
    secondaryLight.intensity = (19 + (mid * 15 + treble * 15) * activity) * lightScale;
    screenLight.intensity = 19 + luma * 34 * activity;
    screenLight.color.setHSL(0.52 + hue * 0.25, 0.68, 0.72);

    // Side slides, shoulder rolls, head-talk and cross steps remain active
    // through a verse. The low end adds a harder bounce, shake and leg punch.
    const swagger = d * (0.33 + verse * 0.72);
    const bassShake = d * smoothstep(0.2, 0.55, bassMode);
    const shakeX = bassShake * (Math.sin(t * 29) * 0.09 + Math.sin(t * 43 + 1.2) * 0.05);
    const shakeY = bassShake * Math.sin(t * 33 + 0.8) * 0.055;
    const hop = kick * 0.32 + bassImpact * 0.2 + bassShake * stepLift * 0.28;
    const sideStep = swagger * pose[0] * 0.39 + lowMid * d * step * 0.08;
    fly.position.set(
      -1.45 + sideStep + shakeX + side * kick * 0.055,
      1.6 + d * (0.028 + sub * 0.08 - verse * pose[4] * 0.1) + hop + shakeY,
      1.35 + swagger * pose[1] * 0.21 + bassMode * d * Math.cos(rhythm) * 0.065,
    );
    flyFill.intensity = 24 + level * 7 * activity;
    flyRim.intensity = 28 + treble * 10 * activity;

    const shoulderRoll = swagger * pose[2] * 0.32 + side * snare * 0.17 + vocalPulse * verse * 0.12;
    fly.rotation.x = swagger * (pose[4] * 0.17 + pose[1] * 0.09) - bassMode * stepLift * 0.13 - snare * 0.09;
    fly.rotation.y = -0.32 + swagger * pose[1] * 0.28 + side * onset * 0.13 * phraseAccent + motion * 0.03 * activity + shakeX * 0.75;
    fly.rotation.z = shoulderRoll + shakeX * 1.6 + bassMode * d * Math.sin(rhythm * 2) * 0.09;

    const headNod = swagger * pose[3] * 0.31 - vocalPulse * (0.17 + verse * 0.24) - kick * 0.17;
    headRig.rotation.x = headNod;
    headRig.rotation.y = swagger * Math.sin(rhythm * 0.5 + 0.3) * 0.2 + verse * vocalPulse * side * 0.1 + motion * 0.05;
    headRig.rotation.z = -shoulderRoll * 0.36 + snare * side * 0.08;
    abdomenRig.rotation.z = swagger * pose[0] * 0.22 + bassMode * Math.sin(rhythm * 1.5) * 0.16;
    abdomenRig.rotation.y = bassMode * d * Math.sin(t * 7.4) * 0.17;
    abdomenRig.rotation.x = -bassMode * stepLift * 0.14 + pose[4] * verse * 0.08;
    thorax.scale.y = 0.84 * (1 + d * level * 0.04 + bassMode * Math.abs(Math.sin(t * 16)) * 0.04);
    abdomen.scale.y = 0.7 * (1 + d * level * 0.055 + bassMode * 0.07);

    let legStep = 0;
    for (const leg of legs) {
      const alternate = leg.side < 0 ? 0 : Math.PI;
      const gait = Math.max(0, Math.sin(rhythm + alternate + leg.index * 0.92));
      const doubleGait = Math.max(0, Math.sin(rhythm * 2 + alternate + leg.index * 0.6));
      const verseStep = swagger * pose[5] * (0.42 * gait + 0.17 * doubleGait);
      const bassPunch = bassMode * d * gait * (leg.index === 0 ? 0.32 : 0.19);
      let lift;
      if (leg.index === 0) lift = verseStep + bassPunch + (leg.side === side ? kick * 0.78 + vocalPulse * verse * 0.28 : kick * 0.08);
      else if (leg.index === 1) lift = verseStep * 0.71 + bassPunch + (leg.side !== side ? snare * 0.37 : 0);
      else lift = verseStep * 0.44 + hat * 0.2 + bassPunch * 0.5;
      leg.pivot.rotation.z = leg.side * lift;
      leg.pivot.rotation.x = -lift * (leg.index === 0 ? 0.49 : 0.32) + pose[1] * swagger * 0.09;
      leg.pivot.rotation.y = swagger * Math.sin(rhythm + leg.index + alternate) * 0.16;
      legStep = Math.max(legStep, lift);
    }

    const wingFlutter = Math.sin(t * (19 + air * 9) + rhythm * 0.5);
    const wingOpen = Math.min(1.2, 0.14 + d * 0.19 + swagger * pose[6] * 0.3 + bassMode * 0.32 + hat * 0.2 + onset * 0.08);
    wings[0].rotation.z = -wingOpen;
    wings[1].rotation.z = wingOpen * (0.94 + 0.06 * Math.sin(t * 5));
    wings[0].rotation.x = d * (air * 0.19 + bassMode * 0.11) * Math.sin(t * 23 + 0.3);
    wings[1].rotation.x = d * (air * 0.19 + bassMode * 0.11) * Math.sin(t * 23 + 1.2);
    const antennaKick = air * 0.2 + onset * 0.16 + vocalPulse * 0.12;
    for (const antenna of antennae) {
      antenna.pivot.rotation.z = antenna.side * (d * Math.sin(t * 19 + antenna.side) * antennaKick + hat * 0.25);
      antenna.pivot.rotation.x = -d * treble * Math.sin(t * 13 + antenna.side) * 0.12 - onset * 0.13;
    }
    motionDiagnostics.mode = !playing ? 'IDLE' : bassMode > 0.37 ? 'BASS DROP' : verse > 0.24 ? 'VERSE / SWAG' : 'GROOVE';
    motionDiagnostics.gesture = gestureNames[phraseNumber % gestureNames.length];
    motionDiagnostics.energy = d;
    motionDiagnostics.bassShake = clamp(bassShake);
    motionDiagnostics.hop = clamp(hop / 0.58);
    motionDiagnostics.swagger = clamp(swagger);
    motionDiagnostics.sideStep = clamp(Math.abs(sideStep) / 0.48);
    motionDiagnostics.shoulderRoll = clamp(Math.abs(shoulderRoll) / 0.52);
    motionDiagnostics.headNod = clamp(Math.abs(headNod) / 0.7);
    motionDiagnostics.legStep = clamp(legStep / 1.15);
    motionDiagnostics.wingFlare = clamp(wingOpen / 1.2);
    motionDiagnostics.antenna = clamp(antennaKick * 2.1 + hat * 0.25);
    // A fast bass envelope drives a lower visual oscillation. Kick attacks
    // throw the cone outward, then its suspended center recoils into the baffle.
    const speakerTarget = playing ? clamp(sub * 0.82 + bass * 0.21 + bassImpact * 0.62) : 0;
    speakerDrive += (speakerTarget - speakerDrive) * (1 - Math.exp(-delta * (speakerTarget > speakerDrive ? 22 : 5.5)));
    const impactRise = Math.max(0, bassImpact - previousSpeakerImpact);
    if (playing && impactRise > 0.035) {
      speakerImpulse = Math.min(1, speakerImpulse + impactRise * 1.15);
      speakerImpulseAt = t;
    }
    previousSpeakerImpact = bassImpact;
    speakerImpulse *= Math.exp(-delta * 9.5);
    const oscillation = Math.sin(speakerPhase);
    const recoil = Math.sin((t - speakerImpulseAt) * Math.PI * 2 * 7.2);
    const travel = playing ? Math.max(-0.18, Math.min(0.24,
      speakerDrive * oscillation * 0.16 + speakerImpulse * recoil * 0.1 + bassImpact * 0.105,
    )) : 0;
    motionDiagnostics.speakerPump = clamp(Math.abs(travel) / 0.24);
    for (const driver of speakerDrivers) {
      const displacement = travel * driver.gain;
      const positions = driver.geometry.attributes.position.array;
      for (let vertex = 0; vertex < driver.baseDepth.length; vertex++) {
        positions[vertex * 3 + 2] = driver.baseDepth[vertex] + displacement * driver.travelWeight[vertex];
      }
      driver.geometry.attributes.position.needsUpdate = true;
      driver.geometry.computeVertexNormals();
      driver.dustCap.position.z = driver.baseCapZ + displacement;
      driver.capHighlight.position.z = driver.baseHighlightZ + displacement;
      driver.lightRing.material.emissiveIntensity = 0.55 + speakerDrive * 1.65 + bassImpact * 0.9;
    }
    wingMaterial.emissiveIntensity = 0.3 + treble * 1.4 * activity;
    eyeMat.emissiveIntensity = 1.15 + level * 1.5 * activity;
    plinthLip.material.emissiveIntensity = (0.9 + bass * 1.35 * activity) * (theme === 'garden' ? 0.26 : theme === 'orbit' ? 0.7 : 1);
    for (let i = 0; i < floorRings.length; i++) {
      floorRings[i].scale.setScalar(1 + beat * (0.025 + i * 0.008) * activity);
      floorRings[i].material.opacity = (0.31 - i * 0.09) + bass * 0.25 * activity;
    }
    for (let i = 0; i < equalizers.length; i++) {
      const bar = equalizers[i];
      if (bar.geometry.type === 'BoxGeometry') {
        const value = 0.25 + Math.abs(Math.sin(t * 3.1 + i * 1.32)) * (0.4 + bass * 2.4 + treble * 0.4) * activity;
        bar.scale.y = value; bar.position.y = -1.82 + 0.175 * value;
      }
    }
    for (let i = 0; i < beams.length; i++) beams[i].rotation.z = Math.sin(t * (0.4 + motion * 0.7) + i * 1.13) * 0.13;
    beamMaterial.opacity = 0.045 + beat * 0.08 * activity;
    for (let i = 0; i < leaves.length; i++) leaves[i].rotation.z = (i % 2 ? 1 : -1) * (0.35 + Math.sin(t * 0.75 + i) * 0.09);
    for (let i = 0; i < orbitRings.length; i++) orbitRings[i].rotation.y += playing ? 0.0003 * (1 + i % 3) : 0;
    neural.rotation.y = Math.sin(t * 0.34) * 0.2;
    neuralShell.rotation.y = t * 0.16;
    neuralRing.rotation.z = t * 0.21;
    for (let i = 0; i < neurons.length; i++) {
      const pulse = 0.45 + 0.55 * Math.sin(t * (2.1 + i % 4) + i * 1.7);
      neurons[i].scale.setScalar(0.8 + pulse * 0.7 + (i % 3 ? treble : bass) * 0.7 * activity);
      neurons[i].material.emissiveIntensity = (0.6 + pulse + level * 1.3 * activity) * (theme === 'garden' ? 0.38 : theme === 'orbit' ? 0.76 : 1);
    }
    dust.rotation.y = Math.sin(t * 0.055) * 0.015;
    dustMaterial.opacity = 0.43 + treble * 0.5 * activity;
    controls.update();
    composer.render();
    return motionDiagnostics;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    video.removeEventListener('loadedmetadata', refreshVideoTexture);
    video.removeEventListener('loadeddata', onVideoReady);
    controls.dispose();
    const geometries = new Set(), materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    videoTexture?.dispose(); posterTexture?.dispose(); fallbackTexture?.dispose();
    composer.dispose(); renderer.dispose();
  }

  return { update, setTheme, resize, dispose };
}
