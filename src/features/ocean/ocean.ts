import * as THREE from 'three';

import { createMarineEnvironment } from '../environment/atmosphere';
import { createRuntimeServiceKey } from '../../runtime/services';
import type { RuntimeFeature } from '../../runtime/types';
import { sampleOceanNormal, sampleOceanWave } from './waves';

export interface OceanSurfaceService {
  sampleHeight(x: number, z: number, elapsedSeconds: number): number;
  sampleNormal(x: number, z: number, elapsedSeconds: number, target?: THREE.Vector3): THREE.Vector3;
}

export const oceanSurfaceServiceKey = createRuntimeServiceKey<OceanSurfaceService>('ocean.surface.v1');

const OCEAN_SIZE = 480;
const OCEAN_SEGMENTS = 180;
const FOAM_TEXTURE_PATH = '/ocean/foam-breakup.png';

const OCEAN_VERTEX_SHADER = /* glsl */ `
const float TWO_PI = 6.28318530718;

uniform float uTime;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec2 vOceanPosition;
varying float vFoam;

struct OceanWaveSample {
  float height;
  float dx;
  float dz;
  float foam;
};

void addWave(
  inout OceanWaveSample result,
  vec2 direction,
  float amplitude,
  float wavelength,
  float speed,
  float phaseOffset,
  vec2 point,
  float time
) {
  float frequency = TWO_PI / wavelength;
  float phase = dot(point, direction) * frequency + time * speed + phaseOffset;
  float sine = sin(phase);
  float cosine = cos(phase);
  float derivative = amplitude * frequency * cosine;
  result.height += amplitude * sine;
  result.dx += derivative * direction.x;
  result.dz += derivative * direction.y;
}

OceanWaveSample sampleOceanWave(vec2 point, float time) {
  OceanWaveSample result;
  result.height = 0.0;
  result.dx = 0.0;
  result.dz = 0.0;
  result.foam = 0.0;

  addWave(result, vec2(0.9701425, 0.2425356), 0.72, 32.0, 0.43, 0.0, point, time);
  addWave(result, vec2(0.4718579, 0.8816745), 0.42, 16.0, 0.61, 1.7, point, time);
  addWave(result, vec2(-0.8, 0.6), 0.22, 8.0, 0.82, 3.1, point, time);
  addWave(result, vec2(0.2, -0.98), 0.13, 4.5, 1.18, -0.9, point, time);
  addWave(result, vec2(-0.9353294, -0.3537814), 0.065, 2.4, 1.55, 2.2, point, time);
  addWave(result, vec2(0.702713, -0.711473), 0.035, 1.25, 2.3, -1.5, point, time);

  float slope = length(vec2(result.dx, result.dz));
  float crest = smoothstep(0.35, 1.05, result.height);
  float steepness = smoothstep(0.16, 0.72, slope);
  result.foam = clamp(crest * 0.7 + steepness * 0.3, 0.0, 1.0);
  return result;
}

#include <fog_pars_vertex>

void main() {
  vec2 oceanPosition = vec2(position.x, -position.y);
  OceanWaveSample wave = sampleOceanWave(oceanPosition, uTime);
  vec3 transformed = position;
  // PlaneGeometry is rotated -90 degrees around X by the mesh.  Displacing
  // local Z therefore moves the surface along world Y.
  transformed.z = wave.height;

  vOceanPosition = oceanPosition;
  vFoam = wave.foam;
  vNormal = normalize(normalMatrix * vec3(-wave.dx, wave.dz, 1.0));
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
varying vec3 vNormal;
varying vec2 vOceanPosition;
varying float vFoam;

#include <fog_pars_fragment>

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 sunDirection = normalize(uSunDirection);

  float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.4);
  float facingSun = max(dot(normal, sunDirection), 0.0);
  vec3 reflectedSun = reflect(-sunDirection, normal);
  float tightGlint = pow(max(dot(reflectedSun, viewDirection), 0.0), 112.0);
  float broadGlint = pow(max(dot(reflectedSun, viewDirection), 0.0), 9.0) * 0.16;

  vec3 deepTeal = vec3(0.012, 0.125, 0.17);
  vec3 coastalTeal = vec3(0.025, 0.30, 0.36);
  vec3 waterColor = mix(deepTeal, coastalTeal, clamp(normal.y * 0.8 + 0.2, 0.0, 1.0));
  waterColor = mix(waterColor, vec3(0.075, 0.40, 0.43), fresnel * 0.82);
  waterColor += vec3(0.16, 0.20, 0.16) * facingSun * 0.14;

  vec2 foamUv = vOceanPosition * vec2(0.027, 0.041)
    + vec2(uTime * 0.007, -uTime * 0.004);
  vec3 breakupA = texture2D(uFoamMap, foamUv).rgb;
  vec3 breakupB = texture2D(uFoamMap, foamUv * 1.83 - vec2(uTime * 0.002, uTime * 0.003)).rgb;
  float breakup = mix(dot(breakupA, vec3(0.3333)), dot(breakupB, vec3(0.3333)), 0.42);
  breakup = smoothstep(0.52, 0.94, breakup);
  float foam = clamp(vFoam * (0.34 + breakup * 0.92), 0.0, 1.0);
  vec3 foamColor = mix(vec3(0.37, 0.67, 0.68), vec3(0.88, 0.95, 0.90), breakup);
  waterColor = mix(waterColor, foamColor, foam * 0.82);

  waterColor += vec3(1.0, 0.70, 0.36) * (tightGlint * 1.25 + broadGlint);
  waterColor = pow(max(waterColor, 0.0), vec3(0.92));

  gl_FragColor = vec4(waterColor, 1.0);
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

        const sunDirection = new THREE.Vector3(-0.42, 0.76, -0.52).normalize();
        const environment = createMarineEnvironment(sunDirection);
        root = environment.root;
        sky = environment.sky;

        oceanUniforms = {
          uTime: { value: 0 },
          uSunDirection: { value: environment.sunDirection.clone() },
          uFoamMap: { value: activeFoamTexture },
        };

        const oceanMaterial = new THREE.ShaderMaterial({
          uniforms: oceanUniforms,
          vertexShader: OCEAN_VERTEX_SHADER,
          fragmentShader: OCEAN_FRAGMENT_SHADER,
          side: THREE.FrontSide,
          fog: true,
          depthWrite: true,
          depthTest: true,
        });
        const oceanGeometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGMENTS, OCEAN_SEGMENTS);
        const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
        ocean.name = 'animated-ocean-surface';
        ocean.rotation.x = -Math.PI / 2;
        ocean.frustumCulled = false;
        root.add(ocean);
        scene.add(root);

        scene.background = new THREE.Color(0x44717d);
        scene.fog = new THREE.FogExp2(0x709ba4, 0.0038);

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
