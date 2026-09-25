// A sheltered night garden built from lightweight, reusable low-poly forms.
export function createGardenScene(THREE, initialPalette = {}) {
  const group = new THREE.Group();
  const palette = {
    primary: initialPalette.primary ?? 0x7df6bc,
    secondary: initialPalette.secondary ?? 0xffcf80,
    accent: initialPalette.accent ?? 0xf57f93,
  };
  const clamp = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const mesh = (geometry, material, parent = group) => {
    const object = new THREE.Mesh(geometry, material);
    parent.add(object);
    return object;
  };
  const box = (w, h, d, material, x, y, z, parent = group) => {
    const object = mesh(new THREE.BoxGeometry(w, h, d), material, parent);
    object.position.set(x, y, z);
    return object;
  };
  const staticRods = [];
  const rod = (a, b, radius, material, parent = group, sides = 6) => {
    if (parent === group) {
      staticRods.push({ a: a.clone(), b: b.clone(), radius, material, sides });
      return null;
    }
    const direction = new THREE.Vector3().subVectors(b, a);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), sides), material, parent);
    object.position.copy(a).addScaledVector(direction, 0.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return object;
  };
  const point = (x, y, z) => new THREE.Vector3(x, y, z);

  const frame = new THREE.MeshStandardMaterial({ color: 0x263c37, metalness: 0.55, roughness: 0.43, flatShading: true });
  const frameEdge = new THREE.MeshStandardMaterial({ color: 0x777d60, metalness: 0.66, roughness: 0.36, flatShading: true });
  const glass = new THREE.MeshBasicMaterial({ color: 0x1b3937, transparent: true, opacity: 0.46, side: THREE.DoubleSide, depthWrite: false });
  const glassGlint = new THREE.MeshBasicMaterial({ color: 0x84b4a0, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false });
  const stone = new THREE.MeshStandardMaterial({ color: 0x38453e, metalness: 0.11, roughness: 0.92, flatShading: true });
  const stoneLight = new THREE.MeshStandardMaterial({ color: 0x718076, metalness: 0.08, roughness: 0.88, flatShading: true });
  const moss = new THREE.MeshStandardMaterial({ color: 0x172c25, roughness: 0.98, side: THREE.DoubleSide });
  const mossLight = new THREE.MeshStandardMaterial({ color: 0x263b2e, roughness: 0.96, side: THREE.DoubleSide });
  const soil = new THREE.MeshStandardMaterial({ color: 0x1a211e, roughness: 1, flatShading: true });
  const potMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3f, metalness: 0.11, roughness: 0.85, flatShading: true });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3d6147, roughness: 0.95, flatShading: true });
  const vineMat = new THREE.MeshStandardMaterial({ color: 0x486851, roughness: 0.98, flatShading: true });
  const lampGlow = new THREE.MeshStandardMaterial({
    color: 0xb39262, emissive: palette.secondary, emissiveIntensity: 0.36,
    roughness: 0.32, metalness: 0.04,
  });
  const flowerPetal = new THREE.MeshStandardMaterial({
    color: 0xb78076, emissive: palette.accent, emissiveIntensity: 0.11,
    roughness: 0.75, side: THREE.DoubleSide, flatShading: true,
  });
  const flowerHeart = new THREE.MeshStandardMaterial({
    color: 0xe4be79, emissive: palette.secondary, emissiveIntensity: 0.21,
    roughness: 0.55,
  });

  // Dark moss islands soften the shared floor without covering the central view.
  for (const [x, z, sx, sz, material] of [
    [-5.2, -3.2, 2.8, 5.0, moss],
    [5.3, -3.4, 3.0, 5.2, moss],
    [0.2, -6.8, 3.7, 1.6, mossLight],
    [-1.5, 1.3, 1.9, 1.55, moss],
  ]) {
    const island = mesh(new THREE.CircleGeometry(1, 12), material);
    island.rotation.x = -Math.PI / 2;
    island.position.set(x, 0.008, z);
    island.scale.set(sx, sz, 1);
  }
  // Rough stepping stones guide the eye from the fly toward the screen.
  for (let i = 0; i < 8; i++) {
    const z = 0.4 - i * 0.68;
    const x = -0.28 + i * 0.17 + Math.sin(i * 1.7) * 0.17;
    const paver = mesh(new THREE.CylinderGeometry(0.4 + (i % 3) * 0.05, 0.44, 0.045, 7), i % 3 ? stone : stoneLight);
    paver.position.set(x, 0.027, z);
    paver.rotation.y = i * 0.71;
    paver.scale.z = 0.72 + (i % 2) * 0.11;
  }

  // Three window bays, a curved roof, and side rails establish a conservatory.
  const backZ = -8.31;
  const arches = [
    [-7.35, -3.30], [-3.30, 4.25], [4.25, 7.35],
  ];
  for (let bay = 0; bay < arches.length; bay++) {
    const [left, right] = arches[bay];
    const width = right - left;
    if (bay !== 1) {
      const pane = mesh(new THREE.PlaneGeometry(width - 0.22, 4.67), glass);
      pane.position.set((left + right) / 2, 2.43, backZ - 0.025);
      for (const offset of [-0.27, 0.25]) {
        const glint = mesh(new THREE.PlaneGeometry(0.11, 4.28), glassGlint);
        glint.position.set((left + right) / 2 + width * offset, 2.43, backZ + 0.016);
        glint.rotation.z = -0.07;
      }
    }
    rod(point(left, 0.05, backZ), point(left, 4.86, backZ), 0.07, frame);
    rod(point(right, 0.05, backZ), point(right, 4.86, backZ), 0.07, frame);
    rod(point(left, 4.86, backZ), point(right, 4.86, backZ), 0.05, frameEdge);
    for (let segment = 0; segment < 12; segment++) {
      const a = segment / 12;
      const b = (segment + 1) / 12;
      const archPoint = (u) => point(
        left + width * u,
        4.86 + (bay === 1 ? 1.48 : 1.2) * Math.sin(Math.PI * u),
        backZ,
      );
      rod(archPoint(a), archPoint(b), bay === 1 ? 0.075 : 0.058, frameEdge);
    }
    if (bay !== 1) {
      rod(point(left, 2.3, backZ + 0.01), point(right, 2.3, backZ + 0.01), 0.034, frame);
      rod(point((left + right) / 2, 0.05, backZ + 0.01), point((left + right) / 2, 4.86, backZ + 0.01), 0.032, frame);
    }
  }
  box(14.9, 0.26, 0.28, frame, 0, 0.18, backZ);
  box(14.9, 0.045, 0.32, frameEdge, 0, 0.34, backZ);

  for (const z of [-7.9, -5.45, -2.95, -0.5]) {
    for (let side of [-1, 1]) {
      rod(point(side * 7.2, 0.05, z), point(side * 7.2, 4.9, z), 0.055, frame);
    }
    for (let section = 0; section < 16; section++) {
      const a = -7.2 + section * 0.9;
      const b = a + 0.9;
      const roofY = (x) => 5.0 + 1.63 * (1 - Math.pow(Math.abs(x) / 7.2, 1.75));
      rod(point(a, roofY(a), z), point(b, roofY(b), z), 0.043, frameEdge);
    }
  }
  for (const x of [-7.2, -3.5, 0, 3.5, 7.2]) {
    const y = 5.0 + 1.63 * (1 - Math.pow(Math.abs(x) / 7.2, 1.75));
    rod(point(x, y, -8.3), point(x, y, -0.5), 0.035, frame);
  }
  for (let side of [-1, 1]) {
    for (const y of [1.65, 4.84]) {
      rod(point(side * 7.2, y, -8.3), point(side * 7.2, y, -0.48), 0.04, frame);
    }
  }

  // Raised beds hold overlapping silhouettes on either side of the screen.
  for (const side of [-1, 1]) {
    const x = side * 6.76;
    box(1.08, 0.52, 8.6, potMat, x, 0.29, -3.45);
    box(1.01, 0.035, 8.4, soil, x, 0.565, -3.45);
    for (const edge of [-1, 1]) {
      box(0.055, 0.055, 8.7, frameEdge, x + edge * 0.54, 0.58, -3.45);
      box(1.12, 0.055, 0.055, frameEdge, x, 0.58, -3.45 + edge * 4.32);
    }
    for (const offset of [-3.7, -1.2, 1.4, 3.8]) {
      box(1.1, 0.028, 0.035, frameEdge, x, 0.26, -3.45 + offset);
    }
  }

  function makeLeafGeometry(split) {
    const positions = [], colors = [], indices = [];
    const rows = 12;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      let width = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.76);
      if (split && i > 2 && i < rows - 1 && i % 3 === 0) width *= 0.72;
      const bow = Math.sin(Math.PI * t);
      positions.push(-width * 0.5, t, -bow * 0.045, 0, t, bow * 0.16, width * 0.5, t, -bow * 0.045);
      colors.push(0.69, 0.78, 0.67, 0.97, 1, 0.87, 0.58, 0.71, 0.62);
      if (i < rows) {
        const n = i * 3, next = n + 3;
        indices.push(n, next, n + 1, next, next + 1, n + 1);
        indices.push(n + 1, next + 1, n + 2, next + 1, next + 2, n + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
  const broadLeaf = makeLeafGeometry(true);
  const narrowLeaf = makeLeafGeometry(false);
  const foliageMats = [
    new THREE.MeshStandardMaterial({ color: 0x366c52, vertexColors: true, side: THREE.DoubleSide, roughness: 0.89, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x4d775b, vertexColors: true, side: THREE.DoubleSide, roughness: 0.86, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x6b8466, vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x244e3f, vertexColors: true, side: THREE.DoubleSide, roughness: 0.93, flatShading: true }),
  ];
  const swaying = [];
  let randomSeed = 97317;
  const random = () => {
    randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
    return randomSeed / 4294967296;
  };

  function makePlant(x, z, size, kind = 'broad', raised = false) {
    const root = new THREE.Group();
    root.position.set(x, raised ? 0.58 : 0, z);
    group.add(root);
    if (!raised) {
      const pot = mesh(new THREE.CylinderGeometry(0.37 * size, 0.27 * size, 0.44 * size, 9), potMat, root);
      pot.position.y = 0.23 * size;
      const soilTop = mesh(new THREE.CylinderGeometry(0.335 * size, 0.335 * size, 0.018, 9), soil, root);
      soilTop.position.y = 0.455 * size;
      const lip = mesh(new THREE.TorusGeometry(0.35 * size, 0.027 * size, 5, 18), frameEdge, root);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = 0.46 * size;
    }
    const foliage = new THREE.Group();
    foliage.position.y = raised ? 0.03 : 0.43 * size;
    root.add(foliage);
    if (kind === 'fern') {
      const fronds = 8, pairs = 6;
      const stemInstances = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5), stemMat, fronds);
      const pinnae = new THREE.InstancedMesh(narrowLeaf, foliageMats[0], fronds * (pairs * 2 + 1));
      const pivot = new THREE.Object3D();
      const local = new THREE.Object3D();
      const combined = new THREE.Matrix4();
      let leafIndex = 0;
      for (let j = 0; j < fronds; j++) {
        pivot.rotation.set(0, j * Math.PI * 2 / fronds + random() * 0.2, 0.32 + (j % 3) * 0.09);
        pivot.updateMatrix();
        const reach = size * (0.94 + random() * 0.25);
        local.position.set(0, reach * 0.5, 0);
        local.rotation.set(0, 0, 0);
        local.scale.set(0.009 * size, reach, 0.009 * size);
        local.updateMatrix();
        stemInstances.setMatrixAt(j, combined.multiplyMatrices(pivot.matrix, local.matrix));
        for (let pair = 0; pair < pairs; pair++) {
          const t = (pair + 1) / (pairs + 1);
          for (const side of [-1, 1]) {
            local.position.set(side * 0.015, reach * t, 0);
            local.rotation.set(0, 0, side * (0.95 + t * 0.18));
            local.scale.set(size * 0.16 * (1 - t * 0.38), size * 0.34 * (1 - t * 0.44), 1);
            local.updateMatrix();
            pinnae.setMatrixAt(leafIndex, combined.multiplyMatrices(pivot.matrix, local.matrix));
            pinnae.setColorAt(leafIndex, new THREE.Color((pair + j) % 3 ? 0xb4d6b4 : 0xd8dfbd));
            leafIndex++;
          }
        }
        local.position.set(0, reach * 0.83, 0);
        local.rotation.set(0, 0, 0);
        local.scale.set(size * 0.14, size * 0.26, 1);
        local.updateMatrix();
        pinnae.setMatrixAt(leafIndex, combined.multiplyMatrices(pivot.matrix, local.matrix));
        pinnae.setColorAt(leafIndex, new THREE.Color(0xc8dcc2));
        leafIndex++;
      }
      stemInstances.instanceMatrix.needsUpdate = true;
      pinnae.instanceMatrix.needsUpdate = true;
      if (pinnae.instanceColor) pinnae.instanceColor.needsUpdate = true;
      foliage.add(stemInstances, pinnae);
      swaying.push({ foliage, phase: random() * Math.PI * 2, amount: 0.028 });
      return;
    }
    const count = kind === 'sword' ? 9 : 8;
    const leafInstances = new THREE.InstancedMesh(kind === 'broad' ? broadLeaf : narrowLeaf, foliageMats[0], count);
    const stemInstances = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5), stemMat, count);
    const pivot = new THREE.Object3D();
    const local = new THREE.Object3D();
    const combined = new THREE.Matrix4();
    const shades = [0xd7e6d0, 0xb3d4bd, 0xe3d2af, 0x9fc3ab];
    for (let j = 0; j < count; j++) {
      pivot.rotation.set(0, (j / count) * Math.PI * 2 + random() * 0.35,
        (kind === 'sword' ? 0.21 : 0.29) + (j % 4) * 0.07);
      pivot.updateMatrix();
      const reach = size * (kind === 'sword' ? 1.65 : kind === 'fern' ? 1.12 : 1.32) *
        (0.72 + random() * 0.44);
      const stemLength = reach * (kind === 'fern' ? 0.28 : 0.39);
      local.position.set(0, stemLength * 0.5, 0);
      local.rotation.set(0, 0, 0);
      local.scale.set(0.012 * size, stemLength, 0.012 * size);
      local.updateMatrix();
      stemInstances.setMatrixAt(j, combined.multiplyMatrices(pivot.matrix, local.matrix));
      local.position.set(0, stemLength * 0.9, 0);
      local.rotation.set((random() - 0.5) * 0.45, 0, (random() - 0.5) * 0.12);
      local.scale.set(
        size * (kind === 'broad' ? 0.83 : 0.42) * (0.83 + random() * 0.32),
        reach * (kind === 'fern' ? 0.88 : 0.69), 1);
      local.updateMatrix();
      leafInstances.setMatrixAt(j, combined.multiplyMatrices(pivot.matrix, local.matrix));
      leafInstances.setColorAt(j, new THREE.Color(shades[(j + (kind === 'fern' ? 2 : 0)) % shades.length]));
    }
    leafInstances.instanceMatrix.needsUpdate = true;
    stemInstances.instanceMatrix.needsUpdate = true;
    if (leafInstances.instanceColor) leafInstances.instanceColor.needsUpdate = true;
    foliage.add(stemInstances, leafInstances);
    swaying.push({ foliage, phase: random() * Math.PI * 2, amount: kind === 'sword' ? 0.018 : 0.027 });
  }

  for (const side of [-1, 1]) {
    const x = side * 6.58;
    for (let i = 0; i < 5; i++) {
      makePlant(x + side * ((i % 2) * 0.17), -6.75 + i * 1.62,
        [1.22, 1.48, 1.18, 1.5, 1.24][i], i % 3 === 1 ? 'sword' : i % 3 === 2 ? 'fern' : 'broad', true);
    }
  }
  makePlant(-3.55, -6.85, 1.35, 'broad');
  makePlant(4.52, -6.68, 1.47, 'broad');
  makePlant(-4.66, 0.85, 1.15, 'fern');
  makePlant(5.16, 0.75, 1.12, 'sword');

  // Trailing vines break up the roofline, with small clustered leaves.
  for (const side of [-1, 1]) {
    for (let strand = 0; strand < 3; strand++) {
      const x = side * (3.8 + strand * 0.58);
      const z = -7.0 + strand * 0.75;
      const yTop = 6.04 - strand * 0.13;
      const length = 1.5 + strand * 0.38;
      const vine = new THREE.Group();
      vine.position.set(x, yTop, z);
      group.add(vine);
      const vinePoints = [];
      for (let segment = 0; segment <= 8; segment++) {
        const t = segment / 8;
        vinePoints.push(point(Math.sin(t * 5 + strand) * 0.13, -t * length, Math.sin(t * 4 + side) * 0.07));
      }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vinePoints), 20, 0.009, 4, false), vineMat, vine);
      const vineLeaves = new THREE.InstancedMesh(narrowLeaf, foliageMats[1], 7);
      const leafPart = new THREE.Object3D();
      for (let segment = 0; segment < 7; segment++) {
        leafPart.position.copy(vinePoints[segment + 1]);
        leafPart.rotation.set(Math.PI * 0.67, side * 0.45, (segment % 2 ? 1 : -1) * 0.9);
        leafPart.scale.set(0.22, 0.39 + (segment % 3) * 0.08, 1);
        leafPart.updateMatrix();
        vineLeaves.setMatrixAt(segment, leafPart.matrix);
        vineLeaves.setColorAt(segment, new THREE.Color(segment % 2 ? 0xd4e0b8 : 0xb0d7bf));
      }
      vineLeaves.instanceMatrix.needsUpdate = true;
      if (vineLeaves.instanceColor) vineLeaves.instanceColor.needsUpdate = true;
      vine.add(vineLeaves);
      swaying.push({ foliage: vine, phase: strand * 1.7 + side, amount: 0.011 });
    }
  }

  // Small warm blooms sit low, away from the television aperture.
  const flowers = [];
  const petalGeometry = new THREE.IcosahedronGeometry(0.115, 0);
  const flowerHeartGeometry = new THREE.IcosahedronGeometry(0.072, 0);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const x = side * (4.42 + (i % 3) * 0.29);
      const z = -6.75 + i * 0.86;
      const height = 0.64 + (i % 4) * 0.13;
      const flower = new THREE.Group();
      flower.position.set(x, 0, z);
      group.add(flower);
      rod(point(0, 0, 0), point(0, height, 0), 0.018, stemMat, flower, 5);
      const petals = new THREE.InstancedMesh(petalGeometry, flowerPetal, 5);
      const petalPart = new THREE.Object3D();
      for (let petal = 0; petal < 5; petal++) {
        const angle = petal * Math.PI * 2 / 5;
        petalPart.position.set(Math.cos(angle) * 0.105, height + Math.sin(angle) * 0.105, 0);
        petalPart.scale.set(0.82, 1.28, 0.44);
        petalPart.rotation.z = angle - Math.PI / 2;
        petalPart.updateMatrix();
        petals.setMatrixAt(petal, petalPart.matrix);
      }
      petals.instanceMatrix.needsUpdate = true;
      flower.add(petals);
      const center = mesh(flowerHeartGeometry, flowerHeart, flower);
      center.position.set(0, height, 0.055);
      flowers.push({ flower, phase: i * 0.8 + side });
    }
  }

  // Pendant globes and a sparse field of fireflies make the room feel inhabited.
  const lamps = [];
  for (const [x, z, hang] of [[-5.22, -4.6, 1.65], [5.35, -4.28, 1.52], [-5.95, -0.9, 1.25], [5.95, -1.15, 1.18]]) {
    const ceiling = 6.14;
    rod(point(x, ceiling, z), point(x, ceiling - hang, z), 0.016, frameEdge);
    const globe = mesh(new THREE.IcosahedronGeometry(0.18, 1), lampGlow);
    globe.position.set(x, ceiling - hang - 0.09, z);
    const cap = mesh(new THREE.CylinderGeometry(0.085, 0.12, 0.09, 8), frame);
    cap.position.set(x, ceiling - hang + 0.1, z);
    const light = new THREE.PointLight(palette.secondary, 5.5, 4.6, 2);
    light.position.copy(globe.position);
    group.add(light);
    lamps.push(light);
  }
  const fireflyPositions = new Float32Array(72 * 3);
  for (let i = 0; i < 72; i++) {
    const side = i % 2 ? 1 : -1;
    fireflyPositions[i * 3] = side * (3.2 + random() * 3.4);
    fireflyPositions[i * 3 + 1] = 0.85 + random() * 4.2;
    fireflyPositions[i * 3 + 2] = -7.8 + random() * 8.7;
  }
  const fireflyGeometry = new THREE.BufferGeometry();
  fireflyGeometry.setAttribute('position', new THREE.BufferAttribute(fireflyPositions, 3));
  const fireflyMat = new THREE.PointsMaterial({
    color: palette.secondary, size: 0.052, sizeAttenuation: true,
    transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const fireflies = new THREE.Points(fireflyGeometry, fireflyMat);
  group.add(fireflies);

  function setPalette(next = {}) {
    if (next.primary != null) palette.primary = next.primary;
    if (next.secondary != null) palette.secondary = next.secondary;
    if (next.accent != null) palette.accent = next.accent;
    lampGlow.emissive.set(palette.secondary);
    flowerPetal.emissive.set(palette.accent);
    flowerHeart.emissive.set(palette.secondary);
    fireflyMat.color.set(palette.secondary);
    for (const light of lamps) light.color.set(palette.secondary);
  }

  function update(time = 0, audio = {}, visual = {}, playing = false) {
    const t = Number.isFinite(time) ? time : 0;
    const air = clamp(audio.air ?? audio.treble);
    const mid = clamp(audio.mid);
    const beat = clamp(audio.beat);
    const motion = clamp(visual.motion);
    const breath = (playing ? 1 : 0.6) * (0.75 + air * 0.18 + motion * 0.12);
    for (const leaf of swaying) {
      leaf.foliage.rotation.z = Math.sin(t * 0.56 + leaf.phase) * leaf.amount * breath;
      leaf.foliage.rotation.x = Math.sin(t * 0.41 + leaf.phase * 1.4) * leaf.amount * 0.58 * breath;
    }
    for (const bloom of flowers) {
      bloom.flower.rotation.z = Math.sin(t * 0.74 + bloom.phase) * (0.018 + mid * 0.015);
    }
    const glow = 0.32 + (playing ? beat * 0.12 + air * 0.08 : 0);
    lampGlow.emissiveIntensity = glow;
    flowerHeart.emissiveIntensity = 0.18 + (playing ? air * 0.16 : 0);
    flowerPetal.emissiveIntensity = 0.09 + (playing ? mid * 0.055 : 0);
    fireflies.rotation.y = Math.sin(t * 0.09) * 0.015;
    fireflyMat.opacity = 0.36 + 0.11 * Math.sin(t * 1.05) + (playing ? air * 0.09 : 0);
    for (let i = 0; i < lamps.length; i++) {
      lamps[i].intensity = 5.2 + (playing ? beat * 0.85 : 0) + Math.sin(t * 0.8 + i * 1.4) * 0.2;
    }
  }

  // Static architectural rods share a few instanced draws instead of hundreds.
  const materials = [...new Set(staticRods.map((item) => item.material))];
  const upright = new THREE.Vector3(0, 1, 0);
  const part = new THREE.Object3D();
  for (const material of materials) {
    for (const sides of [5, 6]) {
      const pieces = staticRods.filter((item) => item.material === material && item.sides === sides);
      if (!pieces.length) continue;
      const batched = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, sides), material, pieces.length);
      for (let i = 0; i < pieces.length; i++) {
        const { a, b, radius } = pieces[i];
        const axis = new THREE.Vector3().subVectors(b, a);
        part.position.copy(a).addScaledVector(axis, 0.5);
        part.quaternion.setFromUnitVectors(upright, axis.clone().normalize());
        part.scale.set(radius, axis.length(), radius);
        part.updateMatrix();
        batched.setMatrixAt(i, part.matrix);
      }
      batched.instanceMatrix.needsUpdate = true;
      group.add(batched);
    }
  }

  return { group, update, setPalette };
}
