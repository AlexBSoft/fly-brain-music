import * as THREE from 'three';

const unitY = new THREE.Vector3(0, 1, 0);
const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function rodBetween(start, end, radius, material, parent) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 6),
    material,
  );
  rod.position.copy(start).addScaledVector(direction, 0.5);
  rod.quaternion.setFromUnitVectors(unitY, direction.normalize());
  parent.add(rod);
  return rod;
}

function box(parent, width, height, depth, material, x, y, z) {
  const item = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  item.position.set(x, y, z);
  parent.add(item);
  return item;
}

export function createClubDepth(initialPalette) {
  const T = THREE;
  const group = new T.Group();
  group.name = 'club-architecture';

  const metal = new T.MeshStandardMaterial({
    color: 0x101522, metalness: 0.72, roughness: 0.38, flatShading: true,
  });
  const edge = new T.MeshStandardMaterial({
    color: 0x222b39, metalness: 0.78, roughness: 0.3, flatShading: true,
  });
  const recess = new T.MeshStandardMaterial({
    color: 0x070b16, metalness: 0.46, roughness: 0.72, flatShading: true,
  });
  const primary = new T.MeshBasicMaterial({
    color: initialPalette.primary, transparent: true, opacity: 0.13,
    toneMapped: false, depthWrite: false,
  });
  const secondary = new T.MeshBasicMaterial({
    color: initialPalette.secondary, transparent: true, opacity: 0.1,
    toneMapped: false, depthWrite: false,
  });
  const floorPrimary = primary.clone();
  const floorSecondary = secondary.clone();

  // Dark ceiling lattice recedes behind the TV, leaving its center open.
  // The slender braces catch existing stage lighting without glowing.
  for (const z of [-7.15, -4.65]) {
    rodBetween(new T.Vector3(-8.1, 5.61, z), new T.Vector3(8.1, 5.61, z), 0.038, metal, group);
    rodBetween(new T.Vector3(-8.1, 5.96, z), new T.Vector3(8.1, 5.96, z), 0.028, edge, group);
    for (let i = 0; i < 12; i++) {
      const x0 = -8.1 + i * 1.35;
      const x1 = x0 + 1.35;
      rodBetween(
        new T.Vector3(x0, 5.61, z),
        new T.Vector3(x1, 5.96, z),
        0.018, metal, group,
      );
    }
  }
  for (const x of [-7.7, 7.7]) {
    rodBetween(new T.Vector3(x, 5.76, -7.15), new T.Vector3(x, 5.76, -4.65), 0.035, metal, group);
    box(group, 1.65, 0.018, 0.035, x < 0 ? primary : secondary, x, 5.58, -4.62);
  }

  // A few recessed wall plates frame the screen from the far sides.
  const wallAccents = [];
  for (const side of [-1, 1]) {
    for (let column = 0; column < 2; column++) {
      const x = side * (6.0 + column * 1.55);
      const width = column === 0 ? 1.18 : 1.04;
      box(group, width, 4.62, 0.11, metal, x, 2.96, -8.37);
      box(group, width - 0.12, 4.38, 0.015, recess, x, 2.96, -8.295);
      box(group, 0.027, 4.36, 0.022, edge, x - side * (width * 0.5 - 0.11), 2.96, -8.27);
      const light = side < 0 ? primary : secondary;
      const spine = box(group, 0.025, 3.86, 0.024, light,
        x + side * (width * 0.5 - 0.13), 2.96, -8.255);
      wallAccents.push({ mesh: spine, index: column + (side > 0 ? 2 : 0) });
      for (let row = 0; row < 3; row++) {
        const y = 1.48 + row * 1.42;
        box(group, width * 0.53, 0.025, 0.025, edge,
          x - side * 0.12, y, -8.254);
      }
    }
  }

  // Short floor slits form perspective lanes; they animate softly with the
  // low end, safely outside the fly's perch and the television sightline.
  const floorSlits = [];
  for (const side of [-1, 1]) {
    const x = side < 0 ? -5.25 : 5.65;
    box(group, 0.11, 0.018, 11.5, recess, x, 0.008, -0.9);
    for (let i = 0; i < 13; i++) {
      const z = -6.16 + i * 0.87;
      const light = side < 0 ? floorPrimary : floorSecondary;
      const slit = box(group, 0.034, 0.013, 0.54, light, x, 0.027, z);
      floorSlits.push({ mesh: slit, index: i, side });
    }
  }

  function setPalette(palette) {
    if (!palette) return;
    primary.color.set(palette.primary);
    secondary.color.set(palette.secondary);
    floorPrimary.color.set(palette.primary);
    floorSecondary.color.set(palette.secondary);
  }

  function update(time = 0, audio = {}, visual = {}, playing = false) {
    const bass = clamp(audio.bassImpact ?? audio.bass);
    const groove = clamp(audio.groove);
    const vocal = clamp(audio.vocal ?? audio.presence);
    const air = clamp(audio.air ?? audio.treble);
    const motion = clamp(visual.motion);
    const active = playing ? 1 : 0.25;
    primary.opacity = 0.08 + active * (0.065 + bass * 0.15 + motion * 0.05);
    secondary.opacity = 0.07 + active * (0.05 + vocal * 0.13 + air * 0.05);
    floorPrimary.opacity = 0.09 + active * (0.07 + bass * 0.23 + groove * 0.04);
    floorSecondary.opacity = 0.08 + active * (0.06 + bass * 0.16 + air * 0.08);

    for (const { mesh, index } of wallAccents) {
      const wave = 0.5 + 0.5 * Math.sin(time * 1.8 + index * 1.9);
      mesh.scale.y = 0.78 + active * wave * (0.04 + vocal * 0.12 + bass * 0.12);
    }
    for (const { mesh, index, side } of floorSlits) {
      const chase = 0.5 + 0.5 * Math.sin(time * (2.3 + groove * 1.8) - index * 0.72 + side);
      mesh.scale.z = 0.58 + active * chase * (0.13 + bass * 0.43);
    }
  }

  return { group, update, setPalette };
}

