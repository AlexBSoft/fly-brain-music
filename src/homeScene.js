const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function createHomeScene(THREE, palette) {
  const group = new THREE.Group();
  group.name = 'home-interior';

  const mat = (color, options = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.8, metalness: 0.02, flatShading: true, ...options,
  });
  const wall = mat(0x30272b, { roughness: 0.95 });
  const wallInset = mat(0x3d3030, { roughness: 0.9 });
  const walnut = mat(0x503428, { roughness: 0.53 });
  const darkWood = mat(0x30221f, { roughness: 0.64 });
  const floorWood = mat(0x382b29, { roughness: 0.76 });
  const floorSeam = new THREE.MeshBasicMaterial({ color: 0x1d191c, transparent: true, opacity: 0.34 });
  const brass = mat(0xb99163, { metalness: 0.66, roughness: 0.35 });
  const cream = mat(0xc8aa8c, { roughness: 0.94 });
  const terracotta = mat(0x9e6557, { roughness: 0.93 });
  const mauve = mat(0x776068, { roughness: 0.96 });
  const cushion = mat(0xb28b7e, { roughness: 0.98 });
  const leaf = mat(0x4a6756, { side: THREE.DoubleSide });
  const leafDark = mat(0x344b42, { side: THREE.DoubleSide });
  const potMat = mat(0x9b6c58, { roughness: 0.91 });
  const nightGlass = new THREE.MeshBasicMaterial({ color: 0x14243b, toneMapped: false });
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xbad9db, transparent: true, opacity: 0.74, toneMapped: false });
  const lampShade = mat(0xe0b987, {
    side: THREE.DoubleSide, emissive: 0xffb876, emissiveIntensity: 0.48,
    roughness: 0.81,
  });
  const tinyGlow = new THREE.MeshBasicMaterial({
    color: palette?.accent ?? 0xffb876, transparent: true, opacity: 0.35,
    toneMapped: false, depthWrite: false,
  });

  function mesh(geometry, material, x, y, z, parent = group) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }
  function box(width, height, depth, material, x, y, z, parent = group) {
    return mesh(new THREE.BoxGeometry(width, height, depth), material, x, y, z, parent);
  }
  function rod(start, end, radius, material, parent = group) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const direction = b.clone().sub(a);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 6), material, 0, 0, 0, parent);
    object.position.copy(a.addScaledVector(direction, 0.5));
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return object;
  }

  // Cover the shared club grid with a quiet wood floor and plaster wall.
  box(18.2, 0.045, 17.1, floorWood, 0, 0.018, -0.6);
  box(18.4, 7.9, 0.12, wall, 0, 3.55, -8.43);
  for (let x = -8.1; x <= 8.1; x += 1.35) {
    box(0.012, 0.002, 16.9, floorSeam, x, 0.043, -0.6);
  }
  box(18, 0.16, 0.16, darkWood, 0, 0.15, -8.26);
  box(18, 0.042, 0.18, brass, 0, 0.25, -8.24);

  // A timber media wall reads as a frame around the shared television.
  box(8.4, 5.8, 0.07, wallInset, 0.95, 3.52, -8.32);
  for (let i = 0; i < 19; i++) {
    const x = -3.05 + i * 0.445;
    box(0.052, 5.55, 0.044, i % 3 === 0 ? walnut : darkWood, x, 3.52, -8.25);
  }

  // Cold night outside the left window balances the warm practical lights.
  box(3.04, 3.84, 0.09, darkWood, -6.25, 3.48, -8.23);
  box(2.72, 3.54, 0.012, nightGlass, -6.25, 3.48, -8.165);
  box(0.065, 3.69, 0.08, walnut, -6.25, 3.48, -8.12);
  box(2.82, 0.065, 0.08, walnut, -6.25, 3.36, -8.12);
  for (const x of [-7.76, -4.74]) {
    box(0.13, 3.91, 0.15, walnut, x, 3.48, -8.12);
    const curtain = box(0.36, 3.8, 0.07, mauve, x + (x < -6 ? 0.28 : -0.28), 3.36, -8.04);
    curtain.rotation.z = x < -6 ? -0.035 : 0.035;
  }
  box(3.19, 0.13, 0.36, walnut, -6.25, 1.54, -8.03);
  mesh(new THREE.CircleGeometry(0.2, 20), moonMat, -6.87, 4.55, -8.142);
  const cityLights = [];
  for (let i = 0; i < 9; i++) {
    const x = -7.48 + i * 0.28;
    const height = 0.15 + (i * 7 % 5) * 0.085;
    const light = box(0.04, height, 0.014, tinyGlow, x, 2.05 + (i % 3) * 0.09, -8.135);
    cityLights.push(light);
  }

  // Rug: broad woven rings make the central floor feel soft and occupied.
  const rugOuter = mesh(new THREE.CircleGeometry(1, 48), cream, -0.15, 0.06, 0.68);
  rugOuter.rotation.x = -Math.PI / 2;
  rugOuter.scale.set(3.65, 2.55, 1);
  const rugInner = mesh(new THREE.CircleGeometry(1, 48), terracotta, -0.15, 0.064, 0.68);
  rugInner.rotation.x = -Math.PI / 2;
  rugInner.scale.set(3.3, 2.26, 1);
  const rugCenter = mesh(new THREE.CircleGeometry(1, 48), mauve, -0.15, 0.068, 0.68);
  rugCenter.rotation.x = -Math.PI / 2;
  rugCenter.scale.set(2.62, 1.66, 1);

  // Low walnut console sits below the TV aperture.
  box(4.5, 0.78, 0.8, walnut, 0.95, 0.49, -5.06);
  box(4.56, 0.09, 0.92, darkWood, 0.95, 0.91, -5.06);
  for (const x of [-0.47, 0.95, 2.37]) {
    box(1.27, 0.58, 0.026, darkWood, x, 0.48, -4.64);
    box(0.09, 0.016, 0.028, brass, x, 0.52, -4.619);
  }

  // A side bookcase and a few varied spines give the wall domestic detail.
  const shelfX = 6.55, shelfZ = -7.92;
  box(2.28, 4.72, 0.63, darkWood, shelfX, 2.54, shelfZ);
  box(2.04, 4.49, 0.04, wallInset, shelfX, 2.54, shelfZ + 0.34);
  const bookColors = [0x8e5f5b, 0xb69172, 0x6a7772, 0x55676d, 0xa88869, 0x715968];
  const books = bookColors.map((color) => mat(color));
  for (let row = 0; row < 4; row++) {
    const y = 0.7 + row * 1.13;
    box(2.11, 0.075, 0.72, walnut, shelfX, y, shelfZ + 0.09);
    for (let i = 0; i < 6; i++) {
      const height = 0.43 + ((i * 3 + row * 5) % 5) * 0.075;
      const spine = box(0.16 + ((i + row) % 3) * 0.035, height, 0.38,
        books[(i + row * 2) % books.length],
        shelfX - 0.83 + i * 0.3, y + 0.04 + height / 2, shelfZ + 0.17);
      spine.rotation.z = i === 5 && row === 1 ? 0.16 : 0;
    }
  }

  // Faceted couch stays low and to the right of the fly's sightline.
  const couch = new THREE.Group();
  couch.position.set(5.15, 0, 1.15);
  couch.rotation.y = -0.3;
  group.add(couch);
  box(3.15, 0.32, 1.36, darkWood, 0, 0.38, 0, couch);
  box(3.12, 0.33, 1.28, mauve, 0, 0.61, -0.02, couch);
  box(3.16, 1.07, 0.31, terracotta, 0, 1.06, 0.6, couch);
  for (const x of [-1.01, 0, 1.01]) {
    box(0.96, 0.79, 0.045, cushion, x, 1.07, 0.785, couch);
  }
  box(3.14, 0.045, 0.055, mauve, 0, 1.49, 0.797, couch);
  for (const side of [-1, 1]) {
    box(0.28, 0.7, 1.44, terracotta, side * 1.54, 0.76, 0.02, couch);
    box(0.12, 0.23, 0.12, darkWood, side * 1.3, 0.18, -0.49, couch);
  }
  for (const x of [-0.73, 0.73]) {
    const seat = box(1.33, 0.18, 1.1, cushion, x, 0.81, -0.08, couch);
    seat.rotation.z = x < 0 ? 0.017 : -0.017;
    box(1.29, 0.55, 0.2, cushion, x, 1.14, 0.37, couch);
  }
  const pillow = box(0.64, 0.12, 0.57, cream, 0.97, 1.04, 0.12, couch);
  pillow.rotation.z = -0.12;

  // An open coffee table adds foreground scale without covering the screen.
  box(1.75, 0.09, 0.93, walnut, 1.16, 0.58, 0.5);
  for (const x of [0.43, 1.89]) for (const z of [0.13, 0.87]) {
    box(0.09, 0.46, 0.09, darkWood, x, 0.31, z);
  }
  mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.09, 10), cream, 1.14, 0.68, 0.5);
  mesh(new THREE.SphereGeometry(0.075, 8, 6), terracotta, 1.14, 0.76, 0.5);

  // Potted leaves bring a soft silhouette to the corner of the room.
  function plant(x, z, height, seed) {
    mesh(new THREE.CylinderGeometry(0.31, 0.23, 0.54, 8), potMat, x, 0.32, z);
    mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.035, 8), darkWood, x, 0.59, z);
    rod([x, 0.56, z], [x, height, z], 0.029, leafDark);
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.4 + seed;
      const spread = 0.28 + (i % 3) * 0.13;
      const y = 0.93 + i * (height - 0.95) / 9;
      const targetX = x + Math.cos(angle) * spread;
      const targetZ = z + Math.sin(angle) * spread;
      rod([x, y - 0.2, z], [targetX, y + 0.17, targetZ], 0.012, leafDark);
      const foliage = mesh(new THREE.IcosahedronGeometry(0.28, 0),
        i % 3 ? leaf : leafDark, targetX, y + 0.19, targetZ);
      foliage.scale.set(0.68, 1.32 + (i % 3) * 0.16, 0.42);
      foliage.rotation.z = -Math.cos(angle) * 0.44;
      foliage.rotation.x = Math.sin(angle) * 0.37;
    }
  }
  plant(-4.18, -3.72, 2.63, 0.3);
  plant(7.85, -4.42, 1.96, 1.4);

  // One warm practical lamp is the room's second visual anchor.
  const lampX = 4.85, lampZ = -2.58;
  mesh(new THREE.CylinderGeometry(0.37, 0.45, 0.08, 10), darkWood, lampX, 0.11, lampZ);
  rod([lampX, 0.15, lampZ], [lampX, 2.83, lampZ], 0.042, brass);
  mesh(new THREE.CylinderGeometry(0.34, 0.61, 0.59, 10, 1, true),
    lampShade, lampX, 2.77, lampZ);
  mesh(new THREE.SphereGeometry(0.2, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffdfad, toneMapped: false }),
    lampX, 2.64, lampZ);
  const lamp = new THREE.PointLight(0xffc68e, 7, 5.7, 2);
  lamp.position.set(lampX, 2.58, lampZ);
  group.add(lamp);

  function setPalette(nextPalette) {
    if (nextPalette?.accent !== undefined) tinyGlow.color.set(nextPalette.accent);
  }

  function update(time = 0, audio = {}, visual = {}, playing = false) {
    const bass = clamp(audio.bassImpact ?? audio.bass);
    const vocal = clamp(audio.vocal ?? audio.presence);
    const luma = clamp(visual.luma);
    const activity = playing ? 1 : 0.25;
    const breathe = 0.5 + 0.5 * Math.sin(time * 0.63);
    lamp.intensity = 6.6 + activity * (breathe * 0.35 + bass * 1.05 + luma * 0.45);
    lampShade.emissiveIntensity = 0.38 + activity * (bass * 0.16 + luma * 0.1);
    tinyGlow.opacity = 0.2 + activity * (0.1 + vocal * 0.15);
    for (let i = 0; i < cityLights.length; i++) {
      cityLights[i].scale.y = 0.8 + 0.2 * Math.sin(time * 0.39 + i * 1.2);
    }
  }

  return { group, update, setPalette };
}

