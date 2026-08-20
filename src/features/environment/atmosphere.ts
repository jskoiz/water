import * as THREE from 'three';

export interface MarineEnvironmentBuild {
  readonly root: THREE.Group;
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly sunDirection: THREE.Vector3;
}

const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vSkyDirection;

void main() {
  vSkyDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uSunDirection;
varying vec3 vSkyDirection;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float noise2(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float cloudNoise(vec2 point) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave += 1) {
    value += noise2(point) * amplitude;
    point = point * 2.03 + vec2(17.2, -11.7);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 direction = normalize(vSkyDirection);
  float altitude = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizonColor = vec3(0.54, 0.70, 0.72);
  vec3 zenithColor = vec3(0.055, 0.17, 0.27);
  vec3 skyColor = mix(horizonColor, zenithColor, smoothstep(0.30, 0.90, altitude));

  float cloudLayer = cloudNoise(direction.xz * 3.2 + vec2(direction.y * 1.8, direction.y * 0.8));
  float cloudBand = smoothstep(0.48, 0.78, cloudLayer)
    * smoothstep(0.03, 0.45, altitude)
    * (1.0 - smoothstep(0.72, 0.98, altitude));
  skyColor = mix(skyColor, vec3(0.77, 0.82, 0.80), cloudBand * 0.34);

  float lowMist = smoothstep(0.28, 0.52, altitude) * (1.0 - smoothstep(0.52, 0.76, altitude));
  skyColor += vec3(0.09, 0.13, 0.13) * lowMist;

  float sunAlignment = max(dot(direction, normalize(uSunDirection)), 0.0);
  float sunHalo = pow(sunAlignment, 18.0) * 0.22 + pow(sunAlignment, 96.0) * 0.82;
  skyColor += vec3(1.0, 0.76, 0.47) * sunHalo;

  gl_FragColor = vec4(skyColor, 1.0);
}
`;

interface MarineMaterials {
  readonly islandRock: THREE.MeshStandardMaterial;
  readonly islandShadow: THREE.MeshStandardMaterial;
  readonly islandVegetation: THREE.MeshStandardMaterial;
  readonly lighthouse: THREE.MeshStandardMaterial;
  readonly lighthouseTrim: THREE.MeshStandardMaterial;
  readonly lighthouseGlow: THREE.MeshBasicMaterial;
}

function createMarineMaterials(): MarineMaterials {
  return {
    islandRock: new THREE.MeshStandardMaterial({
      color: 0x24454b,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    }),
    islandShadow: new THREE.MeshStandardMaterial({
      color: 0x15353c,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    }),
    islandVegetation: new THREE.MeshStandardMaterial({
      color: 0x1e4b43,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    }),
    lighthouse: new THREE.MeshStandardMaterial({
      color: 0xd3c7ad,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    }),
    lighthouseTrim: new THREE.MeshStandardMaterial({
      color: 0x3e4d4c,
      roughness: 0.82,
      metalness: 0.08,
      flatShading: true,
    }),
    lighthouseGlow: new THREE.MeshBasicMaterial({
      color: 0xffe3a6,
    }),
  };
}

function addTree(
  parent: THREE.Group,
  materials: MarineMaterials,
  x: number,
  y: number,
  z: number,
  scale: number,
): void {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08 * scale, 0.14 * scale, 1.2 * scale, 5),
    materials.islandShadow,
  );
  trunk.position.set(x, y + 0.6 * scale, z);
  parent.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.85 * scale, 0),
    materials.islandVegetation,
  );
  crown.position.set(x, y + 1.5 * scale, z);
  crown.scale.set(1.2, 0.82, 1);
  parent.add(crown);
}

function addIsland(
  parent: THREE.Group,
  materials: MarineMaterials,
  x: number,
  z: number,
  scale: number,
  withTrees: boolean,
): void {
  const island = new THREE.Group();
  island.position.set(x, -0.22, z);
  island.scale.setScalar(scale);
  parent.add(island);

  const base = new THREE.Mesh(
    new THREE.DodecahedronGeometry(6.2, 1),
    materials.islandRock,
  );
  base.scale.set(1.8, 0.33, 0.8);
  base.position.y = 0.2;
  island.add(base);

  const peak = new THREE.Mesh(
    new THREE.ConeGeometry(3.7, 6.6, 7),
    materials.islandShadow,
  );
  peak.position.set(-1.5, 2.1, 0.25);
  peak.rotation.z = -0.1;
  island.add(peak);

  const shelf = new THREE.Mesh(
    new THREE.ConeGeometry(3.1, 3.2, 6),
    materials.islandRock,
  );
  shelf.position.set(3.3, 0.7, -0.35);
  shelf.scale.set(1.1, 0.8, 0.72);
  island.add(shelf);

  if (withTrees) {
    addTree(island, materials, -3.4, 2.6, 0.2, 0.85);
    addTree(island, materials, 0.8, 1.4, -0.8, 0.62);
    addTree(island, materials, 3.2, 1.7, 0.3, 0.55);
  }
}

function addLighthouse(parent: THREE.Group, materials: MarineMaterials): void {
  const lighthouse = new THREE.Group();
  lighthouse.position.set(-17, 0.03, -108);
  lighthouse.scale.setScalar(0.78);
  parent.add(lighthouse);

  const foundation = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 4.6, 1.7, 9),
    materials.islandRock,
  );
  foundation.position.y = 0.7;
  lighthouse.add(foundation);

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.78, 1.16, 8.2, 16),
    materials.lighthouse,
  );
  tower.position.y = 5.45;
  lighthouse.add(tower);

  const lowerTrim = new THREE.Mesh(
    new THREE.CylinderGeometry(1.26, 1.26, 0.42, 16),
    materials.lighthouseTrim,
  );
  lowerTrim.position.y = 9.46;
  lighthouse.add(lowerTrim);

  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.82, 0.76, 12),
    materials.lighthouseGlow,
  );
  lantern.position.y = 10.02;
  lighthouse.add(lantern);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.45, 1.4, 12),
    materials.lighthouseTrim,
  );
  roof.position.y = 11.08;
  lighthouse.add(roof);

  const beacon = new THREE.PointLight(0xffd991, 7, 70, 2);
  beacon.position.set(0, 10.05, 0);
  lighthouse.add(beacon);
}

export function createMarineEnvironment(
  sunDirection = new THREE.Vector3(-0.42, 0.76, -0.52).normalize(),
): MarineEnvironmentBuild {
  const root = new THREE.Group();
  root.name = 'marine-environment';
  const materials = createMarineMaterials();

  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: sunDirection.clone().normalize() },
    },
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const skyGeometry = new THREE.SphereGeometry(600, 48, 24);
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = 'marine-sky-dome';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  root.add(sky);

  const sun = new THREE.DirectionalLight(0xffe8bf, 3.15);
  sun.position.copy(sunDirection).multiplyScalar(90);
  sun.target.position.set(0, 0, -40);
  root.add(sun.target);
  root.add(sun);

  const hemisphere = new THREE.HemisphereLight(0x9bc6d4, 0x102c32, 1.65);
  root.add(hemisphere);

  addIsland(root, materials, -91, -154, 1.55, true);
  addIsland(root, materials, 57, -178, 1.06, true);
  addIsland(root, materials, 130, -145, 0.72, false);
  addIsland(root, materials, -149, -190, 0.8, false);
  addLighthouse(root, materials);

  return {
    root,
    sky,
    sunDirection: sunDirection.clone().normalize(),
  };
}
