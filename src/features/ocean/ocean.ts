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
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform float uCameraNear;
uniform float uCameraFar;
uniform mat4 uProjMatrix;
uniform sampler2D envMap;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec2 vOceanPosition;
varying float vFoam;
varying float vCompression;
varying float vCurvature;
varying float vWaveHeight;

#include <packing>
#include <fog_pars_fragment>
#include <cube_uv_reflection_fragment>

const float WATER_IOR = 1.333;
const float WATER_F0 = 0.020373;
#define SSR_STEPS 32

float foamLuma(vec2 uv) {
  return dot(texture2D(uFoamMap, uv).rgb, vec3(0.3333333));
}

float sceneEyeDepth(vec2 uv) {
  float depth = texture2D(uSceneDepth, uv).x;
  return -perspectiveDepthToViewZ(depth, uCameraNear, uCameraFar);
}

// WaterThreeJS SSR: march R through the pre-ocean color+depth target.
vec4 marchSceneReflection(vec3 origin, vec3 direction) {
  float stepLen = 2.2;
  float prevDiff = -1.0;
  vec2 prevUv = vec2(0.0);
  for (int i = 1; i <= SSR_STEPS; i += 1) {
    vec3 point = origin + direction * (stepLen * float(i));
    vec4 clip = uProjMatrix * viewMatrix * vec4(point, 1.0);
    if (clip.w <= 0.0) {
      break;
    }
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      break;
    }
    float sceneEye = sceneEyeDepth(uv);
    float rayEye = -(viewMatrix * vec4(point, 1.0)).z;
    float diff = rayEye - sceneEye;
    if (diff > 0.0 && diff < 6.0 && sceneEye < uCameraFar * 0.97) {
      float t = prevDiff < 0.0 ? 1.0 : (-prevDiff / (diff - prevDiff));
      vec2 hitUv = mix(prevUv, uv, clamp(t, 0.0, 1.0));
      vec2 edge = smoothstep(vec2(0.0), vec2(0.14), hitUv) * smoothstep(vec2(0.0), vec2(0.14), 1.0 - hitUv);
      float confidence = edge.x * edge.y * (1.0 - float(i) / float(SSR_STEPS) * 0.4);
      return vec4(texture2D(uSceneColor, hitUv).rgb, confidence);
    }
    prevDiff = diff;
    prevUv = uv;
    stepLen *= 1.06;
  }
  return vec4(0.0);
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

  // Breakup follows compressed/curved crests, not height alone.
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

  // Fresnel-Schlick for the air/water interface. F0 is derived from the
  // water IOR (roughly ((1.0 - 1.333) / (1.0 + 1.333))^2).
  float cosTheta = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float fresnel = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - cosTheta, 5.0);
  vec3 reflectedDirection = normalize(reflect(-viewDirection, normal));
  vec3 envSky = textureCubeUV(envMap, reflectedDirection, 0.0).rgb;
  vec4 sceneHit = marchSceneReflection(vWorldPosition, reflectedDirection);
  vec3 reflected = mix(envSky, sceneHit.rgb, clamp(sceneHit.a, 0.0, 1.0));

  // Use the wave height as a depth proxy for a finite water column: troughs
  // read denser and bluer while crests receive more transmitted sky color.
  float shallowFactor = smoothstep(-0.58, 0.46, vWaveHeight);
  float waterDepth = mix(2.4, 0.54, shallowFactor);
  vec3 shallowColor = vec3(0.008, 0.105, 0.18);
  vec3 deepColor = vec3(0.0015, 0.018, 0.045);
  vec3 bodyColor = mix(deepColor, shallowColor, shallowFactor);
  vec3 absorption = exp(-vec3(0.26, 0.95, 1.80) * waterDepth);
  vec3 transmittedWater = bodyColor * (0.52 + absorption * 0.68);
  vec3 waterColor = mix(transmittedWater, reflected, fresnel);
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
  readonly overrideMaterial: THREE.Material | null;
}

interface OceanUniforms {
  uTime: { value: number };
  uSunDirection: { value: THREE.Vector3 };
  uFoamMap: { value: THREE.Texture };
  uSceneColor: { value: THREE.Texture | null };
  uSceneDepth: { value: THREE.Texture | null };
  uCameraNear: { value: number };
  uCameraFar: { value: number };
  uProjMatrix: { value: THREE.Matrix4 };
  envMap: { value: THREE.Texture | null };
}

function sceneTextureSize(width: number, height: number, pixelRatio = 1): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(1, Math.floor(width * pixelRatio)),
    height: Math.max(1, Math.floor(height * pixelRatio)),
  };
}

function createSceneTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(width, height);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    depthTexture,
    samples: 0,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  return target;
}

function createSkyPmrem(
  renderer: THREE.WebGLRenderer,
  sky: THREE.Mesh,
): THREE.WebGLRenderTarget {
  const generator = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const skyProbe = sky.clone();
  skyProbe.position.set(0, 0, 0);
  envScene.add(skyProbe);
  const target = generator.fromScene(envScene, 0, 0.1, 2000);
  envScene.remove(skyProbe);
  generator.dispose();
  return target;
}

function renderScenePrepass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  oceanMesh: THREE.Mesh,
  renderTarget: THREE.WebGLRenderTarget,
): void {
  const currentRenderTarget = renderer.getRenderTarget();
  const currentXrEnabled = renderer.xr.enabled;
  const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
  const currentToneMapping = renderer.toneMapping;
  const currentOutputColorSpace = renderer.outputColorSpace;
  // Hide Gerstner for the color+depth capture only. The main draw keeps the
  // 12-component displaced mesh; leaving this false is the 06f935e fail.
  oceanMesh.visible = false;
  try {
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setRenderTarget(renderTarget);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) {
      renderer.clear();
    }
    renderer.render(scene, camera);
  } finally {
    oceanMesh.visible = true;
    renderer.xr.enabled = currentXrEnabled;
    renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
    renderer.toneMapping = currentToneMapping;
    renderer.outputColorSpace = currentOutputColorSpace;
    renderer.setRenderTarget(currentRenderTarget);
  }
}

export function createOceanFeature(): RuntimeFeature {
  let root: THREE.Group | null = null;
  let sky: THREE.Mesh | null = null;
  let oceanMesh: THREE.Mesh | null = null;
  let oceanUniforms: OceanUniforms | null = null;
  let unregisterService: (() => void) | null = null;
  let scene: THREE.Scene | null = null;
  let sceneState: SceneState | null = null;
  let activeFoamTexture: THREE.Texture | null = null;
  let sceneTarget: THREE.WebGLRenderTarget | null = null;
  let pmremTarget: THREE.WebGLRenderTarget | null = null;
  let lastPmremSun = new THREE.Vector3();
  let disposed = false;
  let renderer: THREE.WebGLRenderer | null = null;
  let previousOnShaderError: THREE.WebGLRenderer['debug']['onShaderError'];

  const rebuildSkyPmrem = (
    renderer: THREE.WebGLRenderer,
    skyMesh: THREE.Mesh,
    sunDirection: THREE.Vector3,
  ): void => {
    const next = createSkyPmrem(renderer, skyMesh);
    const previous = pmremTarget;
    pmremTarget = next;
    lastPmremSun.copy(sunDirection);
    if (oceanUniforms) {
      oceanUniforms.envMap.value = next.texture;
    }
    previous?.dispose();
  };

  const detachOwnedEnvironmentTextures = (): void => {
    if (oceanUniforms) {
      oceanUniforms.uSceneColor.value = null;
      oceanUniforms.uSceneDepth.value = null;
      oceanUniforms.envMap.value = null;
    }
  };

  const bindSceneTarget = (target: THREE.WebGLRenderTarget): void => {
    if (!oceanUniforms) {
      return;
    }
    oceanUniforms.uSceneColor.value = target.texture;
    oceanUniforms.uSceneDepth.value = target.depthTexture;
  };

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
        overrideMaterial: scene.overrideMaterial,
      };

      renderer = context.renderer;
      previousOnShaderError = renderer.debug.onShaderError;
      renderer.debug.onShaderError = (gl, program, glVertexShader, glFragmentShader) => {
        const vsLog = gl.getShaderInfoLog(glVertexShader);
        const fsLog = gl.getShaderInfoLog(glFragmentShader);
        console.error('[ocean] shader error', vsLog, fsLog);
        previousOnShaderError?.(gl, program, glVertexShader, glFragmentShader);
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

        const size = sceneTextureSize(
          context.viewport.width,
          context.viewport.height,
          context.viewport.pixelRatio,
        );
        sceneTarget = createSceneTarget(size.width, size.height);
        oceanUniforms = {
          uTime: { value: 0 },
          uSunDirection: { value: environment.sunDirection.clone() },
          uFoamMap: { value: activeFoamTexture },
          uSceneColor: { value: sceneTarget.texture },
          uSceneDepth: { value: sceneTarget.depthTexture },
          uCameraNear: { value: context.camera.near },
          uCameraFar: { value: context.camera.far },
          uProjMatrix: { value: context.camera.projectionMatrix.clone() },
          envMap: { value: null },
        };
        rebuildSkyPmrem(context.renderer, sky, environment.sunDirection);

        const oceanMaterial = new THREE.ShaderMaterial({
          // Fog and color-management uniforms are cloned per material; custom
          // uniforms stay shared with the feature so update() mutates live values.
          uniforms: {
            ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
            ...oceanUniforms,
          },
          defines: {
            ENVMAP_TYPE_CUBE_UV: '',
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
        oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
        oceanMesh.name = 'animated-ocean-surface';
        oceanMesh.rotation.x = -Math.PI / 2;
        oceanMesh.frustumCulled = false;
        root.add(oceanMesh);
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
        detachOwnedEnvironmentTextures();
        sceneTarget?.dispose();
        pmremTarget?.dispose();
        sceneTarget = null;
        pmremTarget = null;
        scene.onBeforeRender = () => undefined;
        if (oceanMesh) {
          oceanMesh.onBeforeRender = () => undefined;
        }
        oceanMesh = null;
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
        scene.overrideMaterial = sceneState.overrideMaterial;
        throw error;
      }
    },

    update(context): void {
      if (!oceanUniforms || !sky || !oceanMesh || !scene || !sceneTarget) {
        return;
      }
      oceanUniforms.uTime.value = context.frame.elapsedSeconds;
      oceanUniforms.uCameraNear.value = context.camera.near;
      oceanUniforms.uCameraFar.value = context.camera.far;
      oceanUniforms.uProjMatrix.value.copy(context.camera.projectionMatrix);
      if (oceanUniforms.uSunDirection.value.distanceToSquared(lastPmremSun) > 1e-8) {
        rebuildSkyPmrem(context.renderer, sky, oceanUniforms.uSunDirection.value);
      }
      // Keep the dome centered on the viewer without taking ownership of the
      // camera or changing any camera transform.
      sky.position.copy(context.camera.position);
      // WaterThreeJS: hide Gerstner only for this standalone color+depth
      // render. The runtime's later scene render then draws the 12-component
      // mesh. Nesting that hide inside onBeforeRender was the flat-blue fail.
      renderScenePrepass(
        context.renderer,
        scene,
        context.camera,
        oceanMesh,
        sceneTarget,
      );
    },

    resize(context): void {
      if (!sceneTarget || !oceanUniforms) {
        return;
      }
      const size = sceneTextureSize(
        context.viewport.width,
        context.viewport.height,
        context.viewport.pixelRatio,
      );
      if (sceneTarget.width !== size.width || sceneTarget.height !== size.height) {
        sceneTarget.setSize(size.width, size.height);
        bindSceneTarget(sceneTarget);
      }
    },

    dispose(): void {
      disposed = true;
      if (renderer) {
        renderer.debug.onShaderError = previousOnShaderError;
        renderer = null;
      }
      unregisterService?.();
      unregisterService = null;

      detachOwnedEnvironmentTextures();
      sceneTarget?.dispose();
      pmremTarget?.dispose();
      sceneTarget = null;
      pmremTarget = null;
      if (scene) {
        scene.onBeforeRender = () => undefined;
      }
      if (oceanMesh) {
        oceanMesh.onBeforeRender = () => undefined;
      }
      oceanMesh = null;

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
        scene.overrideMaterial = sceneState.overrideMaterial;
      }
      scene = null;
      sceneState = null;
    },
  };
}
