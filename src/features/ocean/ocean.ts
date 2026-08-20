import * as THREE from 'three';

import { createMarineEnvironment } from '../environment/atmosphere';
import { createRuntimeServiceKey } from '../../runtime/services';
import type { RuntimeFeature } from '../../runtime/types';
import {
  createOceanWaveShaderSource,
  sampleOceanNormal,
  sampleOceanWave,
} from './waves';

export interface OceanSurfaceService {
  sampleHeight(x: number, z: number, elapsedSeconds: number): number;
  sampleNormal(x: number, z: number, elapsedSeconds: number, target?: THREE.Vector3): THREE.Vector3;
}

export const oceanSurfaceServiceKey = createRuntimeServiceKey<OceanSurfaceService>('ocean.surface.v1');

const OCEAN_SIZE = 480;
const OCEAN_SEGMENTS = 240;
const FOAM_TEXTURE_PATH = '/ocean/foam-breakup.png';
const OCEAN_WAVE_SHADER_SOURCE = createOceanWaveShaderSource();

const OCEAN_VERTEX_SHADER = /* glsl */ `
${OCEAN_WAVE_SHADER_SOURCE}

uniform float uTime;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vOceanPosition;
varying float vFoam;
varying float vCompression;
varying float vCurvature;
varying float vWaveHeight;

#include <fog_pars_vertex>

void main() {
  // PlaneGeometry is rotated -90 degrees around X by the mesh. Its local
  // (x, -y) coordinates therefore map directly to world (x, z).
  vec2 oceanPosition = vec2(position.x, -position.y);
  OceanWaveSample wave = sampleOceanWave(oceanPosition, uTime);
  vec2 displacedPosition = oceanPosition + wave.displacement;

  vec3 transformed = position;
  transformed.x = displacedPosition.x;
  transformed.y = -displacedPosition.y;
  transformed.z = OCEAN_SURFACE_LEVEL + wave.height;

  // oceanNormal() is expressed in world rest axes (x, y, z). Convert it back
  // to this plane's local basis before applying the model transform.
  vec3 worldNormal = oceanNormal(wave);
  vec3 localNormal = vec3(worldNormal.x, -worldNormal.z, worldNormal.y);

  vOceanPosition = oceanPosition;
  vFoam = wave.foam;
  vCompression = wave.compression;
  vCurvature = wave.curvature / OCEAN_CURVATURE_SCALE;
  vWaveHeight = wave.height;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;

  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const OCEAN_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirection;
uniform sampler2D uFoamMap;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vOceanPosition;
varying float vFoam;
varying float vCompression;
varying float vCurvature;
varying float vWaveHeight;

#include <fog_pars_fragment>

const float WATER_IOR = 1.333;
const float WATER_F0 = 0.020373;

float foamLuma(vec2 uv) {
  return dot(texture2D(uFoamMap, uv).rgb, vec3(0.3333333));
}

vec3 skyRadiance(vec3 direction) {
  vec3 skyDirection = normalize(direction);
  float horizon = smoothstep(-0.12, 0.52, skyDirection.y);
  vec3 horizonColor = vec3(0.15, 0.34, 0.42);
  vec3 zenithColor = vec3(0.022, 0.078, 0.16);
  vec3 sky = mix(horizonColor, zenithColor, horizon);

  float sunAlignment = max(dot(skyDirection, normalize(uSunDirection)), 0.0);
  sky += vec3(1.0, 0.72, 0.42) * pow(sunAlignment, 256.0) * 1.25;
  sky += vec3(1.0, 0.43, 0.16) * pow(sunAlignment, 28.0) * 0.018;
  return sky;
}

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 sunDirection = normalize(uSunDirection);

  // Two animated scales of the required breakup map supply sub-vertex
  // roughness. Fade those normals in near the camera where geometry is too
  // coarse to carry the fine chop and fade them out before aliasing begins.
  float distanceToCamera = distance(cameraPosition, vWorldPosition);
  float detailFade = 1.0 - smoothstep(10.0, 145.0, distanceToCamera);
  vec2 broadUv = vOceanPosition * 0.64 + vec2(uTime * 0.014, -uTime * 0.010);
  vec2 fineUv = vOceanPosition * 2.55 + vec2(-uTime * 0.033, uTime * 0.024);
  vec2 broadStep = vec2(0.009, 0.0);
  vec2 fineStep = vec2(0.018, 0.0);
  float broadDx = foamLuma(broadUv + broadStep) - foamLuma(broadUv - broadStep);
  float broadDz = foamLuma(broadUv + broadStep.yx) - foamLuma(broadUv - broadStep.yx);
  float fineDx = foamLuma(fineUv + fineStep) - foamLuma(fineUv - fineStep);
  float fineDz = foamLuma(fineUv + fineStep.yx) - foamLuma(fineUv - fineStep.yx);
  vec3 reference = abs(normal.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(reference, normal));
  vec3 bitangent = normalize(cross(normal, tangent));
  vec2 microSlope = vec2(broadDx * 0.38 + fineDx * 0.18, broadDz * 0.38 + fineDz * 0.18);
  normal = normalize(normal + (tangent * microSlope.x + bitangent * microSlope.y) * detailFade);

  // Fresnel-Schlick for the air/water interface. F0 is derived from the
  // water IOR (roughly ((1.0 - 1.333) / (1.0 + 1.333))^2).
  float cosTheta = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float fresnel = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - cosTheta, 5.0);
  vec3 reflectedDirection = normalize(reflect(-viewDirection, normal));
  vec3 reflectedSky = skyRadiance(reflectedDirection);

  // Use the wave height as a depth proxy for a finite water column: troughs
  // read denser and bluer while crests receive more transmitted sky color.
  float shallowFactor = smoothstep(-0.58, 0.46, vWaveHeight);
  float waterDepth = mix(2.4, 0.54, shallowFactor);
  vec3 shallowColor = vec3(0.008, 0.105, 0.18);
  vec3 deepColor = vec3(0.0015, 0.018, 0.045);
  vec3 bodyColor = mix(deepColor, shallowColor, shallowFactor);
  vec3 absorption = exp(-vec3(0.26, 0.95, 1.80) * waterDepth);
  vec3 transmittedWater = bodyColor * (0.52 + absorption * 0.68);
  vec3 waterColor = mix(transmittedWater, reflectedSky, fresnel);

  // Breakup follows compressed/curved crests, not height alone. The map
  // modulates the analytic signal into irregular patches and dissipating
  // streaks instead of a uniform white band.
  vec2 foamUv = vOceanPosition * vec2(0.105, 0.14)
    + vec2(uTime * 0.009, -uTime * 0.006);
  vec3 breakupA = texture2D(uFoamMap, foamUv).rgb;
  vec3 breakupB = texture2D(
    uFoamMap,
    foamUv * 1.71 - vec2(uTime * 0.003, uTime * 0.004)
  ).rgb;
  float breakup = mix(dot(breakupA, vec3(0.3333333)), dot(breakupB, vec3(0.3333333)), 0.42);
  breakup = smoothstep(0.62, 0.88, breakup);
  float crestMask = max(
    smoothstep(0.10, 0.42, vCompression),
    smoothstep(0.18, 0.68, max(vCurvature, 0.0)) * 0.72
  );
  float foam = clamp(
    vFoam * (0.025 + breakup * 0.52) * (0.26 + crestMask * 0.74)
      + vCompression * 0.045,
    0.0,
    1.0
  );
  vec3 foamColor = mix(vec3(0.16, 0.37, 0.42), vec3(0.72, 0.85, 0.81), breakup);
  waterColor = mix(waterColor, foamColor, foam * 0.52);

  // A restrained, broad-plus-tight sun glint keeps the highlight tied to the
  // same physical half-vector without turning the whole ocean metallic.
  vec3 halfVector = normalize(viewDirection + sunDirection);
  float facetAlignment = max(dot(normal, halfVector), 0.0);
  vec2 sparkleUv = vOceanPosition * vec2(0.032, 0.047)
    + vec2(uTime * 0.006, -uTime * 0.004);
  float sparkleNoise = foamLuma(sparkleUv);
  float sparkleMask = smoothstep(0.58, 0.84, sparkleNoise);
  float sunFacet = smoothstep(0.16, 0.72, max(dot(normal, sunDirection), 0.0));
  float brokenSunPath = mix(0.14, 1.0, sparkleMask) * mix(0.45, 1.0, sunFacet);
  float broadGlint = pow(facetAlignment, 74.0) * 0.012;
  float tightGlint = pow(facetAlignment, 190.0) * 0.08;
  waterColor += vec3(1.0, 0.70, 0.34) * (broadGlint + tightGlint) * brokenSunPath;

  gl_FragColor = vec4(max(waterColor, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function configureFoamTexture(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

async function loadRequiredFoamTexture(): Promise<THREE.Texture> {
  try {
    const texture = await new THREE.TextureLoader().loadAsync(FOAM_TEXTURE_PATH);
    return configureFoamTexture(texture);
  } catch (error) {
    throw new Error(`Required ocean foam texture failed to load: ${FOAM_TEXTURE_PATH}`, { cause: error });
  }
}

function disposeMaterial(
  material: THREE.Material,
  disposedMaterials: Set<THREE.Material>,
  disposedTextures: Set<THREE.Texture>,
): void {
  if (disposedMaterials.has(material)) {
    return;
  }
  disposedMaterials.add(material);

  const disposeTexture = (value: unknown): void => {
    if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
      disposedTextures.add(value);
      value.dispose();
    }
  };

  const materialProperties = material as unknown as Record<string, unknown>;
  for (const key of ['map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap']) {
    disposeTexture(materialProperties[key]);
  }
  if (material instanceof THREE.ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      disposeTexture(uniform.value);
    }
  }
  material.dispose();
}

function disposeObjectResources(root: THREE.Object3D): void {
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();
  const disposedGeometries = new Set<THREE.BufferGeometry>();

  root.traverse((object) => {
    const resourceObject = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (resourceObject.geometry && !disposedGeometries.has(resourceObject.geometry)) {
      disposedGeometries.add(resourceObject.geometry);
      resourceObject.geometry.dispose();
    }
    if (resourceObject.material) {
      const materials = Array.isArray(resourceObject.material)
        ? resourceObject.material
        : [resourceObject.material];
      for (const material of materials) {
        disposeMaterial(material, disposedMaterials, disposedTextures);
      }
    }
  });
}

interface SceneState {
  readonly background: THREE.Color | THREE.Texture | null;
  readonly fog: THREE.Fog | THREE.FogExp2 | null;
  readonly environment: THREE.Texture | null;
  readonly overrideMaterial: THREE.Material | null;
}

export function createOceanFeature(): RuntimeFeature {
  let root: THREE.Group | null = null;
  let sky: THREE.Mesh | null = null;
  let oceanUniforms: {
    uTime: { value: number };
    uSunDirection: { value: THREE.Vector3 };
    uFoamMap: { value: THREE.Texture };
  } | null = null;
  let unregisterService: (() => void) | null = null;
  let scene: THREE.Scene | null = null;
  let sceneState: SceneState | null = null;
  let activeFoamTexture: THREE.Texture | null = null;
  let disposed = false;

  return {
    id: 'ocean',

    async init(context): Promise<void> {
      if (root) {
        return;
      }
      disposed = false;
      scene = context.scene;
      sceneState = {
        background: scene.background,
        fog: scene.fog,
        environment: scene.environment,
        overrideMaterial: scene.overrideMaterial,
      };

      context.loading.update('Loading ocean foam…');
      try {
        activeFoamTexture = await loadRequiredFoamTexture();
        if (disposed) {
          activeFoamTexture.dispose();
          activeFoamTexture = null;
          return;
        }

        const sunDirection = new THREE.Vector3(-0.30, 0.12, -0.95).normalize();
        const environment = createMarineEnvironment(sunDirection);
        root = environment.root;
        sky = environment.sky;

        oceanUniforms = {
          uTime: { value: 0 },
          uSunDirection: { value: environment.sunDirection.clone() },
          uFoamMap: { value: activeFoamTexture },
        };

        const oceanMaterial = new THREE.ShaderMaterial({
          // Fog and color-management uniforms are cloned per material; custom
          // uniforms stay shared with the feature so update() mutates live values.
          uniforms: {
            ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
            ...oceanUniforms,
          },
          vertexShader: OCEAN_VERTEX_SHADER,
          fragmentShader: OCEAN_FRAGMENT_SHADER,
          side: THREE.FrontSide,
          fog: true,
          depthWrite: true,
          depthTest: true,
          toneMapped: true,
        });
        const oceanGeometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGMENTS, OCEAN_SEGMENTS);
        const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
        ocean.name = 'animated-ocean-surface';
        ocean.rotation.x = -Math.PI / 2;
        ocean.frustumCulled = false;
        root.add(ocean);
        scene.add(root);

        scene.background = new THREE.Color(0x315c6b);
        scene.fog = new THREE.FogExp2(0x5b8793, 0.0031);

        unregisterService = context.services.provide(oceanSurfaceServiceKey, {
          sampleHeight: (x: number, z: number, elapsedSeconds: number): number => (
            sampleOceanWave(x, z, elapsedSeconds).height
          ),
          sampleNormal: (
            x: number,
            z: number,
            elapsedSeconds: number,
            target?: THREE.Vector3,
          ): THREE.Vector3 => sampleOceanNormal(x, z, elapsedSeconds, target),
        });
      } catch (error) {
        unregisterService?.();
        unregisterService = null;
        if (root) {
          scene.remove(root);
          disposeObjectResources(root);
        }
        activeFoamTexture?.dispose();
        root = null;
        sky = null;
        oceanUniforms = null;
        activeFoamTexture = null;
        scene.background = sceneState.background;
        scene.fog = sceneState.fog;
        scene.environment = sceneState.environment;
        scene.overrideMaterial = sceneState.overrideMaterial;
        throw error;
      }
    },

    update(context): void {
      if (!oceanUniforms || !sky) {
        return;
      }
      oceanUniforms.uTime.value = context.frame.elapsedSeconds;
      // Keep the dome centered on the viewer without taking ownership of the
      // camera or changing any camera transform.
      sky.position.copy(context.camera.position);
    },

    dispose(): void {
      disposed = true;
      unregisterService?.();
      unregisterService = null;

      if (root && scene) {
        scene.remove(root);
        disposeObjectResources(root);
      }
      root = null;
      sky = null;
      oceanUniforms = null;
      activeFoamTexture = null;

      if (scene && sceneState) {
        scene.background = sceneState.background;
        scene.fog = sceneState.fog;
        scene.environment = sceneState.environment;
        scene.overrideMaterial = sceneState.overrideMaterial;
      }
      scene = null;
      sceneState = null;
    },
  };
}
