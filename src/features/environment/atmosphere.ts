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

#include <common>
#include <dithering_pars_fragment>

const float THREE_OVER_SIXTEEN_PI = 0.05968310366;
const float ONE_OVER_FOUR_PI = 0.07957747155;
const float MIE_DIRECTIONAL_G = 0.78;

// Spectral coefficients for clear maritime air.  The values are scaled to
// this scene's compact world while preserving the lambda^-4 blue bias.
const vec3 RAYLEIGH_BETA = vec3(5.8045e-3, 1.3563e-2, 3.0266e-2);
const vec3 MIE_BETA = vec3(1.62e-2, 1.52e-2, 1.38e-2);
const float RAYLEIGH_ZENITH_LENGTH = 0.84;
const float MIE_ZENITH_LENGTH = 0.125;

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

float rayleighPhase(float cosine) {
  return THREE_OVER_SIXTEEN_PI * (1.0 + cosine * cosine);
}

float miePhase(float cosine) {
  float g2 = MIE_DIRECTIONAL_G * MIE_DIRECTIONAL_G;
  float denominator = pow(1.0 - 2.0 * MIE_DIRECTIONAL_G * cosine + g2, 1.5);
  return ONE_OVER_FOUR_PI * (1.0 - g2) / max(denominator, 0.001);
}

// Kasten-style air mass approximation: finite at the horizon, yet much
// denser there than at zenith, which supplies the aerial-perspective cue.
float opticalAirMass(float zenithCosine) {
  float cosine = clamp(zenithCosine, 0.0, 1.0);
  float angleFromZenith = degrees(acos(cosine));
  float denominator = cosine + 0.15 * pow(max(93.885 - angleFromZenith, 0.001), -1.253);
  return 1.0 / max(denominator, 0.025);
}

float sunIntensity(float zenithCosine) {
  const float cutoffAngle = 1.61107315569;
  const float steepness = 1.5;
  const float solarIrradiance = 1000.0;
  float angle = acos(clamp(zenithCosine, -1.0, 1.0));
  return solarIrradiance * max(0.0, 1.0 - exp(-((cutoffAngle - angle) / steepness)));
}

vec2 cloudField(float cloudAzimuth, float altitude, vec2 sunXZ) {
  vec2 cloudCoordinates = vec2(
    cloudAzimuth * 1.85 + altitude * 0.70
      + sin(altitude * 13.0 + cloudAzimuth * 2.4) * 0.24,
    altitude * 6.8 + sin(cloudAzimuth * 2.8 + altitude * 4.0) * 0.34
  );
  float cloudFar = cloudNoise(cloudCoordinates * 0.92 + vec2(2.4, -0.7));
  float cloudNear = cloudNoise(cloudCoordinates * 2.70 - vec2(4.8, 1.9));
  float lowCloudEnvelope = smoothstep(0.025, 0.16, altitude)
    * (1.0 - smoothstep(0.46, 0.68, altitude));
  float highCloudEnvelope = smoothstep(0.23, 0.39, altitude)
    * (1.0 - smoothstep(0.83, 0.985, altitude));
  float cloudBody = smoothstep(0.31, 0.57, cloudFar + (cloudNear - 0.5) * 0.22);
  float cloudDetail = smoothstep(0.36, 0.70, cloudNear);
  float lowCloud = cloudBody * lowCloudEnvelope;
  float highCloud = smoothstep(0.36, 0.61, mix(cloudFar, cloudNear, 0.34))
    * highCloudEnvelope;
  float density = clamp(lowCloud * 0.92 + highCloud * 0.80
    + lowCloud * highCloud * 0.20, 0.0, 1.0);
  density = clamp(density + cloudDetail * (lowCloudEnvelope * 0.24
    + highCloudEnvelope * 0.20), 0.0, 1.0);
  vec2 sunCloudOffset = normalize(sunXZ + vec2(0.0001)) * 0.19;
  float shadow = noise2(cloudCoordinates * 2.65 - sunCloudOffset * 2.4 + vec2(7.1, -3.6));
  return vec2(density, shadow);
}

void main() {
  vec3 direction = normalize(vSkyDirection);
  vec3 sunDirection = normalize(uSunDirection);
  float viewZenithCosine = max(direction.y, 0.0);
  float sunZenithCosine = max(sunDirection.y, 0.0);
  float viewAirMass = opticalAirMass(viewZenithCosine);
  float sunAirMass = opticalAirMass(sunZenithCosine);

  // Single-scattering estimate inspired by Preetham's daylight fit, with
  // Bruneton-style extinction along both the view and sun paths.
  vec3 betaR = RAYLEIGH_BETA;
  vec3 betaM = MIE_BETA;
  vec3 extinction = exp(-(betaR * RAYLEIGH_ZENITH_LENGTH * (viewAirMass + sunAirMass)
    + betaM * MIE_ZENITH_LENGTH * (viewAirMass + sunAirMass)));
  float cosineToSun = dot(direction, sunDirection);
  float rayleigh = rayleighPhase(cosineToSun);
  // Aerosol scattering stays directional, but carries a wider forward haze
  // so the sun reads through humid maritime air instead of as a lone pixel.
  float mie = miePhase(cosineToSun) * 0.30;
  float sunEnergy = sunIntensity(sunZenithCosine);
  vec3 scattering = sunEnergy * (betaR * rayleigh + betaM * mie) / (betaR + betaM);
  vec3 inScattering = pow(max(scattering * (1.0 - extinction), vec3(0.0)), vec3(1.12));

  // A low, lightly hazed sun shifts the horizon toward warm sea-air blue;
  // the term is intentionally restrained so fog can remain the final depth cue.
  float altitude = max(direction.y, 0.0);
  float horizon = 1.0 - smoothstep(0.0, 0.34, altitude);
  vec3 horizonAerialTint = mix(vec3(0.26, 0.44, 0.57), vec3(0.78, 0.55, 0.34),
    smoothstep(-0.02, 0.26, sunDirection.y));
  vec3 skyColor = inScattering * 0.052;
  skyColor += extinction * mix(vec3(0.006, 0.018, 0.050), horizonAerialTint * 0.11, horizon);
  skyColor += extinction * vec3(0.000, 0.005, 0.024) * smoothstep(0.08, 0.92, altitude);
  skyColor += horizonAerialTint * horizon * horizon * 0.064;

  // Two correlated, four-octave cloud fields. 2-sample atan across ±π so the
  // SphereGeometry φ-cut does not flash a vertical cloud edge.
  float cloudAzimuth = atan(direction.z, direction.x);
  float cloudAzimuthWrap = cloudAzimuth - sign(cloudAzimuth) * 6.28318530718;
  float meridianMix = smoothstep(3.14159265359 - 0.12, 3.14159265359, abs(cloudAzimuth));
  vec2 cloudA = cloudField(cloudAzimuth, altitude, sunDirection.xz);
  vec2 cloudB = cloudField(cloudAzimuthWrap, altitude, sunDirection.xz);
  float cloudDensity = mix(cloudA.x, 0.5 * (cloudA.x + cloudB.x), meridianMix);
  // Cloud break along the sun so the disc punches a glitter path on the water.
  cloudDensity *= 1.0 - pow(max(cosineToSun, 0.0), 4.0) * 0.85;
  float cloudShadowNoise = mix(cloudA.y, 0.5 * (cloudA.y + cloudB.y), meridianMix);
  float cloudSelfShadow = smoothstep(0.25, 0.72, cloudShadowNoise);
  float sunFacingCloud = clamp(dot(direction, sunDirection) * 0.5 + 0.5, 0.0, 1.0);
  float cloudLight = mix(0.18, 0.98, sunFacingCloud) * mix(0.40, 1.0, cloudSelfShadow);
  float cloudInterior = smoothstep(0.32, 0.78, cloudDensity);
  float cloudEdge = smoothstep(0.08, 0.30, cloudDensity)
    * (1.0 - smoothstep(0.48, 0.82, cloudDensity));
  vec3 cloudShadowColor = vec3(0.09, 0.13, 0.17);
  vec3 cloudSunColor = vec3(1.02, 0.93, 0.77);
  vec3 cloudColor = mix(cloudShadowColor, cloudSunColor, cloudLight);
  cloudColor = mix(cloudColor, cloudShadowColor * 0.76, cloudInterior * 0.36);
  cloudColor += cloudSunColor * cloudEdge * cloudLight * 0.16;
  skyColor = mix(skyColor, cloudColor, cloudDensity * 0.92);
  float silverLining = (pow(max(cosineToSun, 0.0), 10.0) * 0.040
    + pow(max(cosineToSun, 0.0), 24.0) * 0.095) * cloudEdge;
  skyColor += vec3(1.0, 0.82, 0.58) * silverLining;

  // 0.53 degree apparent solar diameter (0.265 degree radius), with a
  // narrow analytic edge instead of a large, blown-out painted blob.
  const float SUN_DISC_EDGE_COS = 0.9999850;
  const float SUN_DISC_FULL_COS = 0.9999930;
  float sunDisc = smoothstep(SUN_DISC_EDGE_COS, SUN_DISC_FULL_COS, cosineToSun);
  float sunHalo = (pow(max(cosineToSun, 0.0), 4.0) * 0.024
    + pow(max(cosineToSun, 0.0), 12.0) * 0.060
    + pow(max(cosineToSun, 0.0), 36.0) * 0.105
    + pow(max(cosineToSun, 0.0), 96.0) * 0.070) * 0.6;
  float sunVisibility = mix(1.0, 0.48 + cloudLight * 0.52, cloudDensity);
  skyColor += vec3(1.0, 0.59, 0.28) * sunHalo * sunVisibility;
  skyColor += vec3(8.0, 4.4, 1.45) * sunDisc * sunVisibility;

  // Keep the shader in linear-sRGB scene space; Three.js applies the active
  // renderer tone mapper and final sRGB transform through these chunks.
  gl_FragColor = vec4(max(skyColor, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

interface MarineMaterials {
  readonly islandRock: THREE.MeshStandardMaterial;
  readonly islandShadow: THREE.MeshStandardMaterial;
  readonly islandVegetation: THREE.MeshStandardMaterial;
  readonly lighthouse: THREE.MeshStandardMaterial;
  readonly lighthouseTrim: THREE.MeshStandardMaterial;
  readonly lighthouseGlow: THREE.MeshStandardMaterial;
}

function createMarineMaterials(): MarineMaterials {
  return {
    islandRock: new THREE.MeshStandardMaterial({
      color: 0x2e555a,
      roughness: 0.94,
      metalness: 0,
      flatShading: false,
    }),
    islandShadow: new THREE.MeshStandardMaterial({
      color: 0x193b43,
      roughness: 0.98,
      metalness: 0,
      flatShading: false,
    }),
    islandVegetation: new THREE.MeshStandardMaterial({
      color: 0x25564a,
      roughness: 0.91,
      metalness: 0,
      flatShading: false,
    }),
    lighthouse: new THREE.MeshStandardMaterial({
      color: 0xe0d1b3,
      roughness: 0.66,
      metalness: 0,
      flatShading: false,
    }),
    lighthouseTrim: new THREE.MeshStandardMaterial({
      color: 0x3e4d4c,
      roughness: 0.34,
      metalness: 0.28,
      flatShading: false,
    }),
    lighthouseGlow: new THREE.MeshStandardMaterial({
      color: 0xffe3a6,
      emissive: 0xffb54a,
      emissiveIntensity: 1.8,
      roughness: 0.28,
      metalness: 0,
      flatShading: false,
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

  const beacon = new THREE.PointLight(0xffd991, 7, 70, 2);
  beacon.position.set(0, 10.05, 0);
  lighthouse.add(beacon);
}

function configureEnvironmentShadows(root: THREE.Group, sky: THREE.Mesh): void {
  sky.castShadow = false;
  sky.receiveShadow = false;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object !== sky) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

export function createMarineEnvironment(
  sunDirection = new THREE.Vector3(-0.35, 0.28, -0.89).normalize(),
): MarineEnvironmentBuild {
  const root = new THREE.Group();
  root.name = 'marine-environment';
  const materials = createMarineMaterials();
  const normalizedSunDirection = sunDirection.clone().normalize();

  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: normalizedSunDirection.clone() },
    },
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    dithering: true,
    toneMapped: true,
  });
  const skyGeometry = new THREE.SphereGeometry(600, 96, 48);
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = 'marine-sky-dome';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  // SphereGeometry φ-cut is local -X. Rotate it onto -D0 so a run (looks
  // down D0 ≈ +X) sees the seam behind the stern, not above the mast.
  const windSeaX = 0.970;
  const windSeaZ = 0.243;
  sky.rotation.y = Math.atan2(-windSeaZ, windSeaX);
  const yaw = sky.rotation.y;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  // Shader uses local position; put the world sun into that frame.
  skyMaterial.uniforms.uSunDirection.value.set(
    normalizedSunDirection.x * cosYaw + normalizedSunDirection.z * sinYaw,
    normalizedSunDirection.y,
    -normalizedSunDirection.x * sinYaw + normalizedSunDirection.z * cosYaw,
  ).normalize();
  root.add(sky);

  const sun = new THREE.DirectionalLight(0xffd8b5, 3.05);
  sun.position.copy(normalizedSunDirection).multiplyScalar(180);
  sun.target.position.set(0, 0, -40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 520;
  sun.shadow.camera.left = -220;
  sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 2;
  sun.shadow.camera.updateProjectionMatrix();
  root.add(sun.target);
  root.add(sun);

  const hemisphere = new THREE.HemisphereLight(0x8dbdce, 0x16282d, 1.05);
  root.add(hemisphere);

  // Destination positions intentionally remain unchanged from OCE-005.
  addIsland(root, materials, -13, -205, 1.04, true);
  addIsland(root, materials, -91, -154, 1.55, true);
  addIsland(root, materials, 57, -178, 1.06, true);
  addIsland(root, materials, 130, -145, 0.72, false);
  addIsland(root, materials, -149, -190, 0.8, false);
  addLighthouse(root, materials);
  configureEnvironmentShadows(root, sky);

  return {
    root,
    sky,
    sunDirection: normalizedSunDirection,
  };
}
