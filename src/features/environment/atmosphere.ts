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
  vec3 horizonColor = vec3(0.36, 0.58, 0.65);
  vec3 zenithColor = vec3(0.045, 0.15, 0.25);
  vec3 skyColor = mix(horizonColor, zenithColor, smoothstep(0.30, 0.90, altitude));

  vec2 cloudCoordinates = vec2(atan(direction.z, direction.x) * 0.75, direction.y * 3.6);
  float cloudFar = cloudNoise(cloudCoordinates * 1.85 + vec2(2.4, -0.7));
  float cloudNear = cloudNoise(cloudCoordinates * 5.4 - vec2(4.8, 1.9));
  float cloudEnvelope = smoothstep(0.08, 0.28, altitude)
    * (1.0 - smoothstep(0.72, 0.94, altitude));
  float farCloudBand = smoothstep(0.43, 0.70, cloudFar) * cloudEnvelope;
  float nearCloudBand = smoothstep(0.52, 0.80, cloudNear)
    * smoothstep(0.15, 0.34, altitude)
    * (1.0 - smoothstep(0.64, 0.86, altitude));
  skyColor = mix(skyColor, vec3(0.70, 0.78, 0.79), farCloudBand * 0.52);
  skyColor = mix(skyColor, vec3(0.88, 0.89, 0.84), nearCloudBand * 0.42);

  float lowMist = smoothstep(0.28, 0.52, altitude) * (1.0 - smoothstep(0.52, 0.76, altitude));
  skyColor += vec3(0.07, 0.11, 0.12) * lowMist;

  float sunAlignment = max(dot(direction, normalize(uSunDirection)), 0.0);
  float sunHalo = pow(sunAlignment, 16.0) * 0.045
    + pow(sunAlignment, 44.0) * 0.12
    + pow(sunAlignment, 150.0) * 0.34;
  float sunDisc = smoothstep(0.9992, 0.99995, sunAlignment);
  skyColor += vec3(1.0, 0.52, 0.22) * sunHalo;
  skyColor = mix(skyColor, vec3(1.0, 0.88, 0.62), sunDisc * 0.78);

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
      color: 0x2e555a,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    }),
    islandShadow: new THREE.MeshStandardMaterial({
      color: 0x193b43,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    }),
    islandVegetation: new THREE.MeshStandardMaterial({
      color: 0x25564a,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    }),
    lighthouse: new THREE.MeshStandardMaterial({
      color: 0xe0d1b3,
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
  lighthouse.position.set(-9, 0.18, -200);
  lighthouse.scale.setScalar(0.84);
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

  const beacon = new THREE.PointLight(0xffd991, 6, 70, 2);
  beacon.position.set(0, 10.05, 0);
  lighthouse.add(beacon);
}

export function createMarineEnvironment(
  sunDirection = new THREE.Vector3(-0.30, 0.12, -0.95).normalize(),
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

  addIsland(root, materials, -13, -205, 1.04, true);
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
