import * as THREE from 'three';

import type {
  RuntimeContext,
  RuntimeFeature,
  RuntimeFrameContext,
  RuntimeResizeContext,
} from '../../runtime';
import { createRaftHud } from './hud';
import type { RaftHud } from './hud';
import { sampleOceanWave } from '../ocean/waves';
import {
  oceanSurfaceServiceKey,
} from './types';
import type { OceanSurfaceService } from './types';

const WOOD_TEXTURE_URL = '/raft/raft-wood-albedo.png';
const SAIL_TEXTURE_URL = '/raft/raft-sail-albedo.png';
const FOAM_BREAKUP_URL = '/ocean/foam-breakup.png';
const KNOTS_PER_METRE_PER_SECOND = 1.943844;
// Dominant Gerstner D0, unitized. Apparent wind is W - v_boat.
const WIND_SEA_X = 0.970;
const WIND_SEA_Z = 0.243;
const WIND_SEA_LENGTH = Math.hypot(WIND_SEA_X, WIND_SEA_Z);
const WIND_DIR_X = WIND_SEA_X / WIND_SEA_LENGTH;
const WIND_DIR_Z = WIND_SEA_Z / WIND_SEA_LENGTH;
const WIND_SPEED_MPS = 4.2;
const SAIL_RUN_SPEED = 10.2;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function initialHeadingFromUrl(): number {
  if (typeof window === 'undefined') {
    return 0;
  }
  if (new URLSearchParams(window.location.search).get('run') !== '1') {
    return 0;
  }
  // Forward (sin θ, -cos θ) matches D0 so the still is a run, not a beat.
  return Math.atan2(WIND_SEA_X, -WIND_SEA_Z);
}
const MAX_PITCH = 0.45;
const MAX_ROLL = 0.52;
const CONTACT_HALF_WIDTH = 1.25;
const CONTACT_HALF_LENGTH = 2.05;
const WATERLINE_LOOP = [0, 1, 2, 5, 8, 7, 6, 3] as const;
const WATERLINE_WIDTH = 1.05;
const WATERLINE_LIFT = 0.04;
const WATERLINE_HASH_AMP = 0.2;
const WATERLINE_BOW_AMP = 0.1;
const WATERLINE_ALPHA = 0.88;

function waterlineHash(index: number, time: number): number {
  const value = Math.sin(index * 12.9898 + time * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
const HEAVE_EQUILIBRIUM_OFFSET = -0.12;
const MAX_HEAVE_DEVIATION = 0.72;
const MAX_HEAVE_VELOCITY = 3.2;
const MAX_PITCH_VELOCITY = 1.8;
const MAX_ROLL_VELOCITY = 1.9;
const HEAVE_NATURAL_FREQUENCY = 2.2;
const PITCH_NATURAL_FREQUENCY = 1.95;
const ROLL_NATURAL_FREQUENCY = 1.8;
const HEAVE_DAMPING_RATIO = 0.76;
const PITCH_DAMPING_RATIO = 0.72;
const ROLL_DAMPING_RATIO = 0.74;
// The velocity-dependent terms approximate the quadratic viscous/radiation
// damping used in reduced-order marine craft models while keeping the exact
// spring step below stable at large frame deltas.
const HEAVE_QUADRATIC_DAMPING = 0.075;
const PITCH_QUADRATIC_DAMPING = 0.13;
const ROLL_QUADRATIC_DAMPING = 0.14;

interface SprayParticle {
  readonly mesh: THREE.Mesh;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly phase: number;
  readonly spread: number;
  readonly size: number;
  bursting: boolean;
  burstStart: number;
  burstOriginX: number;
  burstOriginY: number;
  burstOriginZ: number;
  burstDirX: number;
  burstDirY: number;
  burstDirZ: number;
  burstStrength: number;
}

interface WakeSection {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly alpha: number;
}

const WAKE_SECTIONS: readonly WakeSection[] = [
  { x: 0.52, z: 1.76, width: 0.24, alpha: 0.78 },
  { x: 0.57, z: 1.98, width: 0.25, alpha: 0.72 },
  { x: 0.64, z: 2.23, width: 0.27, alpha: 0.64 },
  { x: 0.73, z: 2.53, width: 0.29, alpha: 0.55 },
  { x: 0.84, z: 2.88, width: 0.31, alpha: 0.46 },
  { x: 0.96, z: 3.28, width: 0.34, alpha: 0.38 },
  { x: 1.08, z: 3.74, width: 0.37, alpha: 0.3 },
  { x: 1.2, z: 4.25, width: 0.4, alpha: 0.22 },
  { x: 1.31, z: 6.8, width: 0.42, alpha: 0.15 },
  { x: 1.39, z: 8.5, width: 0.4, alpha: 0.08 },
  { x: 1.45, z: 10.5, width: 0.34, alpha: 0 },
];
interface SpringState {
  readonly position: number;
  readonly velocity: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function damp(current: number, target: number, sharpness: number, deltaSeconds: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-sharpness * deltaSeconds));
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

interface SailMeshData {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly billowWeights: Float32Array;
  readonly indices: number[];
}

function createSubdividedSailData(segments = 12): SailMeshData {
  const tack = { x: 0, y: 1.25, z: -0.79, u: 1, v: 0 };
  const head = { x: 0, y: 4.36, z: -0.79, u: 0.06, v: 0 };
  const clew = { x: -2.02, y: 1.22, z: -0.79, u: 1, v: 1 };
  const positions: number[] = [];
  const uvs: number[] = [];
  const billowWeights: number[] = [];
  const indexOf = new Map<string, number>();
  const keyFor = (i: number, j: number): string => `${i},${j}`;

  for (let i = 0; i <= segments; i += 1) {
    for (let j = 0; j <= segments - i; j += 1) {
      const tackWeight = i / segments;
      const headWeight = j / segments;
      const clewWeight = (segments - i - j) / segments;
      indexOf.set(keyFor(i, j), positions.length / 3);
      positions.push(
        tack.x * tackWeight + head.x * headWeight + clew.x * clewWeight,
        tack.y * tackWeight + head.y * headWeight + clew.y * clewWeight,
        tack.z * tackWeight + head.z * headWeight + clew.z * clewWeight,
      );
      uvs.push(
        tack.u * tackWeight + head.u * headWeight + clew.u * clewWeight,
        tack.v * tackWeight + head.v * headWeight + clew.v * clewWeight,
      );
      billowWeights.push(clewWeight * (0.55 + tackWeight * 0.45 + headWeight * 0.85));
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < segments - i; j += 1) {
      const a = indexOf.get(keyFor(i, j));
      const b = indexOf.get(keyFor(i + 1, j));
      const c = indexOf.get(keyFor(i, j + 1));
      if (a === undefined || b === undefined || c === undefined) {
        continue;
      }
      indices.push(a, b, c);
      const d = indexOf.get(keyFor(i + 1, j + 1));
      if (d !== undefined) {
        indices.push(b, d, c);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    billowWeights: new Float32Array(billowWeights),
    indices,
  };
}

interface DerivedSurfaceMaps {
  readonly normalMap: THREE.DataTexture;
  readonly roughnessMap: THREE.DataTexture;
}

interface DerivedSurfaceMapOptions {
  readonly normalStrength: number;
  readonly roughnessBias: number;
  readonly roughnessScale: number;
}

function sampleAlbedoLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const wrappedX = ((x % width) + width) % width;
  const wrappedY = ((y % height) + height) % height;
  const index = (wrappedY * width + wrappedX) * 4;
  return (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114) / 255;
}

function createDerivedSurfaceMaps(
  albedo: THREE.Texture,
  options: DerivedSurfaceMapOptions,
): DerivedSurfaceMaps {
  const image = albedo.image as { width?: number; height?: number } | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (width < 2 || height < 2) {
    throw new Error('Raft albedo texture is missing a readable image for derived maps.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Raft material maps require a 2D canvas context.');
  }
  context.drawImage(image as CanvasImageSource, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  const normalData = new Uint8Array(width * height * 4);
  const roughnessData = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = sampleAlbedoLuma(pixels, width, height, x + 1, y)
        - sampleAlbedoLuma(pixels, width, height, x - 1, y);
      const dy = sampleAlbedoLuma(pixels, width, height, x, y + 1)
        - sampleAlbedoLuma(pixels, width, height, x, y - 1);
      const normalX = -dx * options.normalStrength;
      const normalY = -dy * options.normalStrength;
      const inverseLength = 1 / Math.hypot(normalX, normalY, 1);
      const pixel = (y * width + x) * 4;
      normalData[pixel] = Math.round((normalX * inverseLength * 0.5 + 0.5) * 255);
      normalData[pixel + 1] = Math.round((normalY * inverseLength * 0.5 + 0.5) * 255);
      normalData[pixel + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
      normalData[pixel + 3] = 255;

      const roughness = clamp(
        options.roughnessBias + sampleAlbedoLuma(pixels, width, height, x, y) * options.roughnessScale,
        0.16,
        1,
      );
      const roughnessByte = Math.round(roughness * 255);
      roughnessData[pixel] = roughnessByte;
      roughnessData[pixel + 1] = roughnessByte;
      roughnessData[pixel + 2] = roughnessByte;
      roughnessData[pixel + 3] = 255;
    }
  }

  const configureMap = (texture: THREE.DataTexture): THREE.DataTexture => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.flipY = albedo.flipY;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  };

  return {
    normalMap: configureMap(new THREE.DataTexture(normalData, width, height)),
    roughnessMap: configureMap(new THREE.DataTexture(roughnessData, width, height)),
  };
}

/**
 * Advance x'' + 2*zeta*omega*x' + omega^2*x = 0 exactly over one frame.
 *
 * The target is held constant for the frame, so this is a frame-rate
 * independent second-order response rather than a lerp disguised as physics.
 * The closed-form branches remain bounded for the 0.25s runtime delta cap and
 * cover under-, critical-, and over-damped craft responses.
 */
function integrateDampedSpring(
  position: number,
  velocity: number,
  target: number,
  deltaSeconds: number,
  naturalFrequency: number,
  dampingRatio: number,
): SpringState {
  if (![position, velocity, target, deltaSeconds, naturalFrequency, dampingRatio].every(Number.isFinite)) {
    throw new Error('Raft spring received a non-finite state.');
  }
  if (deltaSeconds <= 0) {
    return { position, velocity };
  }

  const omega = Math.max(naturalFrequency, 0.001);
  const zeta = Math.max(dampingRatio, 0);
  const displacement = position - target;
  const safeDelta = Math.min(deltaSeconds, 0.25);
  let nextDisplacement: number;
  let nextVelocity: number;

  if (zeta < 1 - 1e-5) {
    const dampedFrequency = omega * Math.sqrt(Math.max(1 - zeta * zeta, 0));
    const angle = dampedFrequency * safeDelta;
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const decay = Math.exp(-zeta * omega * safeDelta);
    const frequencyRatio = (zeta * omega) / dampedFrequency;
    nextDisplacement = decay * (
      displacement * (cosine + frequencyRatio * sine)
      + velocity * (sine / dampedFrequency)
    );
    nextVelocity = decay * (
      velocity * (cosine - frequencyRatio * sine)
      - displacement * ((omega * omega / dampedFrequency) * sine)
    );
  } else if (zeta <= 1 + 1e-5) {
    const decay = Math.exp(-omega * safeDelta);
    const criticalVelocity = velocity + omega * displacement;
    nextDisplacement = decay * (displacement + criticalVelocity * safeDelta);
    nextVelocity = decay * (velocity - omega * criticalVelocity * safeDelta);
  } else {
    const root = Math.sqrt(zeta * zeta - 1);
    const firstRoot = -omega * (zeta - root);
    const secondRoot = -omega * (zeta + root);
    const secondCoefficient = (velocity - firstRoot * displacement) / (secondRoot - firstRoot);
    const firstCoefficient = displacement - secondCoefficient;
    const firstDecay = Math.exp(firstRoot * safeDelta);
    const secondDecay = Math.exp(secondRoot * safeDelta);
    nextDisplacement = firstCoefficient * firstDecay + secondCoefficient * secondDecay;
    nextVelocity = firstCoefficient * firstRoot * firstDecay
      + secondCoefficient * secondRoot * secondDecay;
  }

  const nextPosition = target + nextDisplacement;
  if (![nextPosition, nextVelocity].every(Number.isFinite)) {
    throw new Error('Raft spring produced a non-finite state.');
  }
  return { position: nextPosition, velocity: nextVelocity };
}

function boundSpringState(
  state: SpringState,
  minimum: number,
  maximum: number,
  maximumVelocity: number,
): SpringState {
  const boundedPosition = clamp(state.position, minimum, maximum);
  const boundedVelocity = clamp(state.velocity, -maximumVelocity, maximumVelocity);
  return {
    position: boundedPosition,
    // A hard attitude/heave clamp represents the hull leaving the linearized
    // regime. Bleeding most of the rate avoids an artificial rebound impulse.
    velocity: boundedPosition === state.position ? boundedVelocity : boundedVelocity * 0.18,
  };
}

function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      resolve,
      undefined,
      () => reject(new Error(`Raft texture failed to load: ${url}`)),
    );
  });
}

class RaftController {
  private readonly raftGroup = new THREE.Group();
  private readonly wakeGroup = new THREE.Group();
  private readonly contactFoamGroup = new THREE.Group();
  private readonly contactRings: THREE.Mesh[] = [];
  private waterlineRibbon: THREE.Mesh | null = null;
  private waterlinePositions: Float32Array | null = null;
  private hullFoamMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly waterlinePoints = new Float32Array(WATERLINE_LOOP.length * 3);
  private readonly sampleOffsets = [
    // A symmetric 3x3 contact stencil gives the hull a centerline keel and
    // midship contacts in addition to the four corners. It reacts to local
    // wave differences without letting a single corner dominate attitude.
    new THREE.Vector3(-CONTACT_HALF_WIDTH, 0, -CONTACT_HALF_LENGTH),
    new THREE.Vector3(0, 0, -CONTACT_HALF_LENGTH),
    new THREE.Vector3(CONTACT_HALF_WIDTH, 0, -CONTACT_HALF_LENGTH),
    new THREE.Vector3(-CONTACT_HALF_WIDTH, 0, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(CONTACT_HALF_WIDTH, 0, 0),
    new THREE.Vector3(-CONTACT_HALF_WIDTH, 0, CONTACT_HALF_LENGTH),
    new THREE.Vector3(0, 0, CONTACT_HALF_LENGTH),
    new THREE.Vector3(CONTACT_HALF_WIDTH, 0, CONTACT_HALF_LENGTH),
  ] as const;
  private readonly sampleWorldPosition = new THREE.Vector3();
  private readonly surfaceNormal = new THREE.Vector3(0, 1, 0);
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private readonly targetOffset = new THREE.Vector3();
  private readonly sampleHeights = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  private readonly sprayParticles: SprayParticle[] = [];
  private readonly plumeCards: THREE.Sprite[] = [];
  private readonly plumeMaterials: THREE.SpriteMaterial[] = [];
  private readonly sampleCompressions = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  private readonly contactBurstAt = [-1e9, -1e9, -1e9, -1e9, -1e9, -1e9, -1e9, -1e9, -1e9];
  private sprayEmitIndex = 0;
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();

  private ocean: OceanSurfaceService | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private hud: RaftHud | null = null;
  private sailGeometry: THREE.BufferGeometry | null = null;
  private sailBasePositions: Float32Array | null = null;
  private sailBillowWeights: Float32Array | null = null;
  private woodTexture: THREE.Texture | null = null;
  private sailTexture: THREE.Texture | null = null;
  private foamBreakupTexture: THREE.Texture | null = null;
  private readonly waterlineUniform = { value: 0 };
  private wakeUniforms: {
    readonly uTime: { value: number };
    readonly uStrength: { value: number };
  } | null = null;
  private lastPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private positionX = 0;
  private positionY = 0;
  private positionZ = 0;
  private heading = initialHeadingFromUrl();
  private speedMetersPerSecond = 0;
  private leewayMetersPerSecond = 0;
  private sailPower = 0.72;
  private apparentWindX = WIND_DIR_X * WIND_SPEED_MPS;
  private apparentWindZ = WIND_DIR_Z * WIND_SPEED_MPS;
  private steering = 0;
  private pitch = 0;
  private roll = 0;
  private heaveVelocity = 0;
  private pitchVelocity = 0;
  private rollVelocity = 0;
  private previousHeaveTarget = 0;
  private wakeImpact = 0;
  private surfaceTargetInitialized = false;
  private cameraYaw = 0;
  private cameraPitch = 0.06;
  private initialized = false;

  public async init(context: RuntimeContext): Promise<void> {
    const ocean = context.services.get(oceanSurfaceServiceKey);
    if (!ocean) {
      throw new Error(
        'Raft feature requires the "ocean.surface.v1" runtime service. Add the ocean surface before starting the raft.',
      );
    }
    if (typeof ocean.sampleHeight !== 'function' || typeof ocean.sampleNormal !== 'function') {
      throw new Error(
        'The "ocean.surface.v1" runtime service must provide sampleHeight and sampleNormal.',
      );
    }
    this.ocean = ocean;

    context.loading.update('Loading raft textures…');
    const loader = new THREE.TextureLoader();
    const [woodTexture, sailTexture, foamBreakupTexture] = await Promise.all([
      loadTexture(loader, WOOD_TEXTURE_URL),
      loadTexture(loader, SAIL_TEXTURE_URL),
      loadTexture(loader, FOAM_BREAKUP_URL),
    ]);
    this.woodTexture = woodTexture;
    this.sailTexture = sailTexture;
    this.foamBreakupTexture = foamBreakupTexture;
    this.textures.add(woodTexture);
    this.textures.add(sailTexture);
    this.textures.add(foamBreakupTexture);
    this.configureTexture(woodTexture, context.renderer);
    this.configureTexture(sailTexture, context.renderer);
    this.configureTexture(foamBreakupTexture, context.renderer);
    foamBreakupTexture.wrapS = THREE.RepeatWrapping;
    foamBreakupTexture.wrapT = THREE.RepeatWrapping;

    context.loading.update('Preparing raft systems…');
    this.buildRaft();
    this.buildWake();
    context.scene.add(this.raftGroup);
    context.scene.add(this.contactFoamGroup);
    this.canvas = context.renderer.domElement;
    this.canvas.dataset.qa = 'water-canvas';
    this.hud = createRaftHud(context.renderer.domElement);
    this.bindTrueWindHud(this.hud.element);
    this.initialized = true;
    this.updateSurface(1 / 60, 0);
    this.updateCamera(context, 1 / 60);
    this.hud.update(0, this.sailPower);
  }

  public update(context: RuntimeFrameContext): void {
    if (!this.initialized || !this.ocean) {
      return;
    }

    const deltaSeconds = Math.max(context.frame.deltaSeconds, 1 / 240);
    this.updateControls(context, deltaSeconds);
    this.updateMovement(deltaSeconds);
    this.updateSurface(deltaSeconds, context.frame.elapsedSeconds);
    this.updateSail();
    this.updateWake(context.frame.elapsedSeconds);
    this.updateCamera(context, deltaSeconds);
    this.hud?.update(
      this.speedMetersPerSecond * KNOTS_PER_METRE_PER_SECOND,
      this.sailPower,
    );
  }

  public resize(_context: RuntimeResizeContext): void {
    // The HUD uses viewport-relative CSS sizing; the runtime owns the camera projection.
  }

  private bindTrueWindHud(hudRoot: HTMLElement): void {
    const wind = hudRoot.querySelector('[data-qa="wind"]');
    if (!(wind instanceof HTMLElement)) {
      return;
    }
    const knots = WIND_SPEED_MPS * KNOTS_PER_METRE_PER_SECOND;
    const label = wind.querySelector('.raft-hud__wind-label');
    if (label) {
      label.textContent = `WIND ${knots.toFixed(1)} KN`;
    }
    const arrow = wind.querySelector('.raft-hud__wind-arrow');
    if (arrow instanceof HTMLElement) {
      // Compass N is HUD up. D0 in world XZ is (0.970, 0.243); north is -Z.
      const angleDeg = Math.atan2(WIND_SEA_X, -WIND_SEA_Z) * (180 / Math.PI);
      arrow.textContent = '↑';
      arrow.style.display = 'inline-block';
      arrow.style.transform = `rotate(${angleDeg.toFixed(2)}deg)`;
    }
  }

  public dispose(_context: RuntimeContext): void {
    if (this.canvas?.dataset.qa === 'water-canvas') {
      delete this.canvas.dataset.qa;
    }
    this.hud?.dispose();
    this.hud = null;
    this.raftGroup.removeFromParent();
    this.contactFoamGroup.removeFromParent();
    this.contactRings.length = 0;
    this.waterlineRibbon = null;
    this.waterlinePositions = null;
    this.hullFoamMaterial = null;
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    for (const texture of this.textures) {
      texture.dispose();
    }
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.sprayParticles.length = 0;
    this.plumeCards.length = 0;
    this.plumeMaterials.length = 0;
    this.sailGeometry = null;
    this.sailBasePositions = null;
    this.sailBillowWeights = null;
    this.woodTexture = null;
    this.sailTexture = null;
    this.foamBreakupTexture = null;
    this.wakeUniforms = null;
    this.heaveVelocity = 0;
    this.pitchVelocity = 0;
    this.rollVelocity = 0;
    this.leewayMetersPerSecond = 0;
    this.previousHeaveTarget = 0;
    this.wakeImpact = 0;
    this.surfaceTargetInitialized = false;
    this.ocean = null;
    this.canvas = null;
    this.initialized = false;
  }

  private configureTexture(texture: THREE.Texture, renderer: THREE.WebGLRenderer): void {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  }

  private buildRaft(): void {
    if (!this.woodTexture || !this.sailTexture) {
      throw new Error('Raft textures must be loaded before building the raft.');
    }

    this.raftGroup.name = 'raft-player';
    this.raftGroup.userData.raftFeature = true;
    this.wakeGroup.name = 'raft-wake';
    this.contactFoamGroup.name = 'raft-contact-foam';

    const woodMaps = this.registerDerivedMaps(this.woodTexture, {
      normalStrength: 2.1,
      roughnessBias: 0.36,
      roughnessScale: 0.4,
    });
    const sailMaps = this.registerDerivedMaps(this.sailTexture, {
      normalStrength: 1.15,
      roughnessBias: 0.62,
      roughnessScale: 0.22,
    });

    const woodMaterial = this.applyWaterlineWetness(this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0xa9794f,
      map: this.woodTexture,
      normalMap: woodMaps.normalMap,
      normalScale: new THREE.Vector2(0.62, 0.62),
      roughnessMap: woodMaps.roughnessMap,
      roughness: 0.76,
      metalness: 0.01,
      emissive: 0x2c1a0d,
      emissiveIntensity: 0.08,
    })));
    const darkWoodMaterial = this.applyWaterlineWetness(this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x67442f,
      map: this.woodTexture,
      normalMap: woodMaps.normalMap,
      normalScale: new THREE.Vector2(0.48, 0.48),
      roughnessMap: woodMaps.roughnessMap,
      roughness: 0.82,
      metalness: 0.01,
      emissive: 0x24150a,
      emissiveIntensity: 0.1,
    })));
    const ropeMaterial = this.applyWaterlineWetness(this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x765639,
      roughness: 0.88,
      metalness: 0,
      emissive: 0x1b1008,
      emissiveIntensity: 0.06,
    })));
    const sailMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0xf3efe6,
      map: this.sailTexture,
      normalMap: sailMaps.normalMap,
      normalScale: new THREE.Vector2(0.34, 0.34),
      roughnessMap: sailMaps.roughnessMap,
      roughness: 0.84,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.04,
      emissive: 0x2a261c,
      emissiveIntensity: 0.015,
    }));

    const logGeometry = this.registerGeometry(new THREE.CylinderGeometry(0.17, 0.17, 4.75, 12));
    for (let index = 0; index < 9; index += 1) {
      const log = new THREE.Mesh(logGeometry, woodMaterial);
      const radius = 0.16 + (index % 3) * 0.01;
      const radialScale = radius / 0.17;
      log.scale.set(radialScale, 1, radialScale);
      log.position.set(-1.44 + index * 0.36, 0, (index % 2 === 0 ? -1 : 1) * 0.025);
      log.rotation.x = -Math.PI / 2;
      log.rotation.z = Math.sin(index * 2.7) * 0.012;
      log.castShadow = true;
      log.receiveShadow = true;
      this.raftGroup.add(log);
    }

    const crossBeamGeometry = this.registerGeometry(new THREE.CylinderGeometry(0.14, 0.17, 3.8, 10));
    for (const z of [-1.75, 0, 1.75]) {
      const crossBeam = new THREE.Mesh(crossBeamGeometry, darkWoodMaterial);
      crossBeam.position.set(0, 0.2, z);
      crossBeam.rotation.z = Math.PI / 2;
      crossBeam.castShadow = true;
      crossBeam.receiveShadow = true;
      this.raftGroup.add(crossBeam);
    }

    const mastGeometry = this.registerGeometry(new THREE.CylinderGeometry(0.12, 0.17, 4.2, 10));
    const mast = new THREE.Mesh(mastGeometry, darkWoodMaterial);
    mast.position.set(0, 2.28, -0.74);
    mast.castShadow = true;
    mast.receiveShadow = true;
    this.raftGroup.add(mast);

    const mastCapGeometry = this.registerGeometry(new THREE.CylinderGeometry(0.19, 0.19, 0.24, 10));
    const mastCap = new THREE.Mesh(mastCapGeometry, darkWoodMaterial);
    mastCap.position.set(0, 4.5, -0.74);
    mastCap.castShadow = true;
    mastCap.receiveShadow = true;
    this.raftGroup.add(mastCap);

    const boomGeometry = this.registerGeometry(new THREE.CylinderGeometry(0.075, 0.09, 2.15, 8));
    const boom = new THREE.Mesh(boomGeometry, darkWoodMaterial);
    boom.position.set(-0.92, 1.28, -0.77);
    boom.rotation.z = Math.PI / 2;
    boom.castShadow = true;
    boom.receiveShadow = true;
    this.raftGroup.add(boom);

    const sailMesh = createSubdividedSailData(12);
    this.sailBasePositions = sailMesh.positions;
    this.sailBillowWeights = sailMesh.billowWeights;
    this.sailGeometry = this.registerGeometry(new THREE.BufferGeometry());
    this.sailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(sailMesh.positions.slice(), 3),
    );
    this.sailGeometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(sailMesh.uvs, 2),
    );
    this.sailGeometry.setIndex(sailMesh.indices);
    this.sailGeometry.computeVertexNormals();
    const sail = new THREE.Mesh(this.sailGeometry, sailMaterial);
    sail.name = 'raft-canvas-sail';
    sail.castShadow = true;
    sail.receiveShadow = true;
    this.raftGroup.add(sail);

    this.addRope([
      new THREE.Vector3(0, 4.38, -0.79),
      new THREE.Vector3(-1.95, 1.25, -0.79),
    ], ropeMaterial, 0.027);
    this.addRope([
      new THREE.Vector3(0, 4.38, -0.79),
      new THREE.Vector3(1.72, 0.36, -2.05),
    ], ropeMaterial, 0.025);
    this.addRope([
      new THREE.Vector3(0, 4.38, -0.79),
      new THREE.Vector3(-1.72, 0.36, -2.05),
    ], ropeMaterial, 0.025);
    this.addRope([
      new THREE.Vector3(-1.72, 0.36, -2.05),
      new THREE.Vector3(-1.72, 0.36, 2.08),
      new THREE.Vector3(1.72, 0.36, 2.08),
      new THREE.Vector3(1.72, 0.36, -2.05),
    ], ropeMaterial, 0.034);

    const crateGeometry = this.registerGeometry(new THREE.BoxGeometry(0.86, 0.62, 0.92));
    const crate = new THREE.Mesh(crateGeometry, darkWoodMaterial);
    crate.position.set(0.82, 0.54, 0.85);
    crate.rotation.y = -0.14;
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.raftGroup.add(crate);

    this.addRope([
      new THREE.Vector3(0.38, 0.78, 0.4),
      new THREE.Vector3(1.25, 0.78, 0.4),
      new THREE.Vector3(1.25, 0.78, 1.3),
      new THREE.Vector3(0.38, 0.78, 1.3),
      new THREE.Vector3(0.38, 0.78, 0.4),
    ], ropeMaterial, 0.024);
  }

  private buildWake(): void {
    const wakeUniforms = {
      uColor: { value: new THREE.Color(0x6fc4c9) },
      uOpacity: { value: 0.80 },
      uTime: { value: 0 },
      uStrength: { value: 0 },
      uFoamMap: { value: this.foamBreakupTexture },
    };
    const wakeMaterial = this.registerMaterial(new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...wakeUniforms,
      },
      toneMapped: true,
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        varying float vAlpha;
        varying vec3 vLocalPosition;

        #include <fog_pars_vertex>

        void main() {
          vAlpha = aAlpha;
          vLocalPosition = position;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        uniform float uStrength;
        uniform sampler2D uFoamMap;
        varying float vAlpha;
        varying vec3 vLocalPosition;

        #include <common>
        #include <fog_pars_fragment>

        float hash12(vec2 point) {
          point = fract(point * vec2(123.34, 456.21));
          point += dot(point, point + 45.32);
          return fract(point.x * point.y);
        }

        float noise2(vec2 point) {
          vec2 cell = floor(point);
          vec2 local = fract(point);
          local = local * local * (3.0 - 2.0 * local);
          float a = hash12(cell);
          float b = hash12(cell + vec2(1.0, 0.0));
          float c = hash12(cell + vec2(0.0, 1.0));
          float d = hash12(cell + vec2(1.0, 1.0));
          return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
        }

        float foamNoise(vec2 point) {
          float value = 0.0;
          float amplitude = 0.58;
          for (int octave = 0; octave < 3; octave += 1) {
            value += noise2(point) * amplitude;
            point = point * 2.07 + vec2(11.7, -8.4);
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          float distanceFade = 1.0 - smoothstep(6.0, 10.5, vLocalPosition.z);
          float turbulence = foamNoise(vec2(
            vLocalPosition.x * 9.4 + uTime * 0.10,
            vLocalPosition.z * 1.72 - uTime * 0.34
          ));
          float lace = smoothstep(0.27, 0.72, turbulence);
          float edgeBreakup = mix(0.32, 1.0, lace);
          float narrowStreak = 0.80 + 0.20 * sin(
            vLocalPosition.z * 6.4 - uTime * 1.8 + vLocalPosition.x * 9.0
          );
          float strength = smoothstep(0.04, 0.25, uStrength);
          float foamMap = texture2D(uFoamMap, vec2(
            vLocalPosition.x * 0.62 + uTime * 0.05,
            vLocalPosition.z * 0.16 - uTime * 0.28
          )).g;
          float foamAlpha = vAlpha * distanceFade * edgeBreakup * narrowStreak
            * uOpacity * strength * mix(0.42, 1.0, foamMap);
          float dither = hash12(vec2(
            floor(vLocalPosition.z * 7.0 + uTime * 0.8),
            floor(vLocalPosition.x * 18.0)
          ));
          if (foamAlpha < 0.028 || (vAlpha < 0.22 && dither > edgeBreakup * 0.98)) {
            discard;
          }

          vec3 foamColor = mix(
            uColor,
            vec3(0.94, 0.95, 0.93),
            clamp(smoothstep(0.38, 0.88, turbulence) * 0.72 + foamMap * 0.45, 0.0, 1.0)
          );
          gl_FragColor = vec4(foamColor, foamAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      transparent: true,
      fog: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }));
    this.wakeUniforms = {
      uTime: wakeUniforms.uTime,
      uStrength: wakeUniforms.uStrength,
    };
    for (const side of [-1, 1]) {
      const wakeGeometry = this.createWakeRibbonGeometry(
        WAKE_SECTIONS.map((section) => ({
          ...section,
          x: section.x * side,
        })),
      );
      const wake = new THREE.Mesh(wakeGeometry, wakeMaterial);
      wake.position.y = 0.06;
      wake.renderOrder = 1;
      this.wakeGroup.add(wake);
    }
    for (const side of [-1, 1]) {
      const volumeGeometry = this.createWakeRibbonGeometry(
        WAKE_SECTIONS.map((section) => ({
          ...section,
          x: section.x * side,
          width: section.width * 1.7,
          alpha: section.alpha * 0.55,
        })),
      );
      const volume = new THREE.Mesh(volumeGeometry, wakeMaterial);
      volume.position.y = 0.11;
      volume.renderOrder = 1;
      this.wakeGroup.add(volume);
    }
    const fillGeometry = this.createWakeRibbonGeometry(
      WAKE_SECTIONS.map((section, index) => ({
        x: 0,
        z: section.z,
        width: 0.6 + 1.6 * (index / Math.max(WAKE_SECTIONS.length - 1, 1)),
        alpha: 0.4,
      })),
    );
    const fill = new THREE.Mesh(fillGeometry, wakeMaterial);
    fill.position.y = 0.08;
    fill.renderOrder = 1;
    this.wakeGroup.add(fill);

    if (!this.foamBreakupTexture) {
      throw new Error('Foam breakup texture must be loaded before building hull foam.');
    }

    const sprayMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x8ec4c9,
      roughness: 0.32,
      metalness: 0,
      emissive: 0x173d43,
      emissiveIntensity: 0.04,
      transparent: true,
      opacity: 0.22,
      alphaTest: 0.02,
      depthWrite: false,
    }));
    const sprayGeometry = this.registerGeometry(new THREE.SphereGeometry(0.038, 10, 6));
    for (let index = 0; index < 24; index += 1) {
      const spread = (index % 8) / 7;
      const side = index % 2 === 0 ? -1 : 1;
      const baseX = side * (0.32 + spread * 1.18 + (index % 3) * 0.06);
      const particle = new THREE.Mesh(sprayGeometry, sprayMaterial);
      const baseY = 0.11 + (index % 4) * 0.035;
      const baseZ = 1.9 + (index % 8) * 0.28;
      particle.position.set(baseX, baseY, baseZ);
      particle.renderOrder = 2;
      this.raftGroup.add(particle);
      this.sprayParticles.push({
        mesh: particle,
        baseX,
        baseY,
        baseZ,
        phase: index * 0.71,
        spread,
        size: 0.52 + (index % 5) * 0.11,
        bursting: false,
        burstStart: 0,
        burstOriginX: baseX,
        burstOriginY: baseY,
        burstOriginZ: baseZ,
        burstDirX: 0,
        burstDirY: 0.70710678,
        burstDirZ: 0.70710678,
        burstStrength: 0,
      });
    }
    const plumeMap = this.foamBreakupTexture;
    const plumeSlots = [
      { x: -0.62, y: 0.52, z: -2.02, scale: 1.05 },
      { x: 0, y: 0.78, z: -2.18, scale: 1.42 },
      { x: 0.62, y: 0.52, z: -2.02, scale: 1.05 },
    ] as const;
    for (const slot of plumeSlots) {
      const material = this.registerMaterial(new THREE.SpriteMaterial({
        map: plumeMap,
        color: 0xf4f1ea,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
        fog: true,
      }));
      const card = new THREE.Sprite(material);
      card.position.set(slot.x, slot.y, slot.z);
      card.scale.set(slot.scale, slot.scale * 1.35, 1);
      card.renderOrder = 2;
      card.visible = false;
      this.raftGroup.add(card);
      this.plumeCards.push(card);
      this.plumeMaterials.push(material);
    }
    this.raftGroup.add(this.wakeGroup);

    const contactGeometry = this.registerGeometry(new THREE.RingGeometry(0.22, 1.35, 24));
    for (let index = 0; index < this.sampleOffsets.length; index += 1) {
      const contactMaterial = this.registerMaterial(new THREE.MeshBasicMaterial({
        color: 0xe8f6f6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: true,
      }));
      const ring = new THREE.Mesh(contactGeometry, contactMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 3;
      this.contactFoamGroup.add(ring);
      this.contactRings.push(ring);
    }

    const pointCount = WATERLINE_LOOP.length;
    const positions = new Float32Array(pointCount * 2 * 3);
    const uvs = new Float32Array(pointCount * 2 * 2);
    const indices: number[] = [];
    for (let index = 0; index < pointCount; index += 1) {
      const u = index / pointCount;
      uvs[index * 4] = u;
      uvs[index * 4 + 1] = 0;
      uvs[index * 4 + 2] = u;
      uvs[index * 4 + 3] = 1;
      const current = index * 2;
      const next = ((index + 1) % pointCount) * 2;
      indices.push(current, current + 1, next + 1, current, next + 1, next);
    }
    const geometry = this.registerGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const material = this.registerMaterial(new THREE.MeshBasicMaterial({
      color: 0xf0f2eb,
      map: this.foamBreakupTexture,
      transparent: true,
      opacity: WATERLINE_ALPHA,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      fog: true,
      side: THREE.DoubleSide,
    }));
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vWaterlineUv;`,
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          vWaterlineUv = uv;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vWaterlineUv;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float vAcross = vWaterlineUv.y * 2.0 - 1.0;
          diffuseColor.a *= (1.0 - abs(vAcross));`,
        );
    };
    material.customProgramCacheKey = () => 'raft-waterline-loaf';
    const ribbon = new THREE.Mesh(geometry, material);
    ribbon.frustumCulled = false;
    ribbon.renderOrder = 4;
    this.contactFoamGroup.add(ribbon);
    this.waterlineRibbon = ribbon;
    this.waterlinePositions = positions;
    this.hullFoamMaterial = material;
  }

  private createWakeRibbonGeometry(sections: readonly WakeSection[]): THREE.BufferGeometry {
    const positions: number[] = [];
    const alphas: number[] = [];
    const indices: number[] = [];

    for (const section of sections) {
      const edgeNoise = 0.5 + 0.5 * Math.sin(section.z * 4.35 + section.x * 6.2);
      const centerJitter = Math.sign(section.x || 1)
        * (0.018 + edgeNoise * 0.04)
        * Math.sin(section.z * 7.1 + section.x * 3.4);
      const center = section.x + centerJitter;
      const outerHalfWidth = section.width * (0.38 + edgeNoise * 0.12);
      const innerHalfWidth = section.width * (0.15 + edgeNoise * 0.07);
      positions.push(
        center - outerHalfWidth, 0, section.z,
        center - innerHalfWidth, 0, section.z,
        center + innerHalfWidth, 0, section.z,
        center + outerHalfWidth, 0, section.z,
      );
      alphas.push(0, section.alpha, section.alpha, 0);
    }

    for (let sectionIndex = 0; sectionIndex < sections.length - 1; sectionIndex += 1) {
      const current = sectionIndex * 4;
      const next = current + 4;
      for (let lane = 0; lane < 3; lane += 1) {
        const currentLeft = current + lane;
        const currentRight = current + lane + 1;
        const nextLeft = next + lane;
        const nextRight = next + lane + 1;
        indices.push(
          currentLeft, nextLeft, nextRight,
          currentLeft, nextRight, currentRight,
        );
      }
    }

    const geometry = this.registerGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
    geometry.setIndex(indices);
    return geometry;
  }

  private addRope(points: THREE.Vector3[], material: THREE.Material, radius: number): void {
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = this.registerGeometry(new THREE.TubeGeometry(curve, Math.max(points.length * 6, 12), radius, 6, false));
    const rope = new THREE.Mesh(geometry, material);
    rope.castShadow = true;
    rope.receiveShadow = true;
    this.raftGroup.add(rope);
  }

  private updateControls(context: RuntimeFrameContext, deltaSeconds: number): void {
    const keyboard = context.input.keyboard.pressed;
    const throttle = (keyboard.has('KeyW') ? 1 : 0) - (keyboard.has('KeyS') ? 1 : 0);
    this.sailPower = clamp(this.sailPower + throttle * deltaSeconds * 0.42, 0, 1);

    const steeringTarget = (keyboard.has('KeyD') ? 1 : 0) - (keyboard.has('KeyA') ? 1 : 0);
    this.steering = damp(this.steering, steeringTarget, 8, deltaSeconds);

    const pointer = context.input.pointer;
    if (pointer.isDown && pointer.pointerId !== null) {
      if (this.lastPointerId === pointer.pointerId) {
        this.cameraYaw = clamp(this.cameraYaw + (pointer.x - this.lastPointerX) * 0.005, -1.08, 1.08);
        this.cameraPitch = clamp(this.cameraPitch - (pointer.y - this.lastPointerY) * 0.004, -0.38, 0.62);
      }
      this.lastPointerId = pointer.pointerId;
      this.lastPointerX = pointer.x;
      this.lastPointerY = pointer.y;
    } else {
      this.lastPointerId = null;
    }
  }

  private updateMovement(deltaSeconds: number): void {
    const headingX = Math.sin(this.heading);
    const headingZ = -Math.cos(this.heading);
    const windX = WIND_DIR_X * WIND_SPEED_MPS;
    const windZ = WIND_DIR_Z * WIND_SPEED_MPS;
    this.apparentWindX = windX - headingX * this.speedMetersPerSecond;
    this.apparentWindZ = windZ - headingZ * this.speedMetersPerSecond;
    const apparentLength = Math.hypot(this.apparentWindX, this.apparentWindZ);
    const apparentDotHeading = apparentLength > 1e-4
      ? (this.apparentWindX * headingX + this.apparentWindZ * headingZ) / apparentLength
      : 0;
    // Beat is slow (dot<=0 → 0.35); run is fast (dot→1 → 1). W/S still sets sailPower.
    const pointOfSail = 0.35 + 0.65 * Math.max(0, apparentDotHeading);
    const targetSpeed = this.sailPower * pointOfSail * SAIL_RUN_SPEED;
    this.speedMetersPerSecond = damp(this.speedMetersPerSecond, targetSpeed, 1.6, deltaSeconds);
    const turnRate = 0.2 + this.sailPower * 0.72;
    this.heading += this.steering * turnRate * deltaSeconds;
    const courseX = Math.sin(this.heading);
    const courseZ = -Math.cos(this.heading);
    const perpX = Math.cos(this.heading);
    const perpZ = Math.sin(this.heading);
    const apparentLateral = this.apparentWindX * perpX + this.apparentWindZ * perpZ;
    // v_lat' = -0.55 A_lat - 1.8 v_lat. A beat crabs; a run has A_lat ≈ 0.
    const leewayDecay = Math.exp(-1.8 * deltaSeconds);
    this.leewayMetersPerSecond = this.leewayMetersPerSecond * leewayDecay
      - (0.55 / 1.8) * apparentLateral * (1 - leewayDecay);
    const maxLeeway = 0.35 * Math.abs(this.speedMetersPerSecond);
    this.leewayMetersPerSecond = clamp(
      this.leewayMetersPerSecond,
      -maxLeeway,
      maxLeeway,
    );
    this.positionX += courseX * this.speedMetersPerSecond * deltaSeconds
      + perpX * this.leewayMetersPerSecond * deltaSeconds;
    this.positionZ += courseZ * this.speedMetersPerSecond * deltaSeconds
      + perpZ * this.leewayMetersPerSecond * deltaSeconds;
  }

  private updateSurface(deltaSeconds: number, elapsedSeconds: number): void {
    const ocean = this.ocean;
    if (!ocean) {
      return;
    }

    for (let index = 0; index < this.sampleOffsets.length; index += 1) {
      const offset = this.sampleOffsets[index];
      this.sampleWorldPosition.copy(offset).applyAxisAngle(WORLD_UP, this.heading);
      this.sampleWorldPosition.x += this.positionX;
      this.sampleWorldPosition.z += this.positionZ;
      const height = ocean.sampleHeight(
        this.sampleWorldPosition.x,
        this.sampleWorldPosition.z,
        elapsedSeconds,
      );
      if (!Number.isFinite(height)) {
        throw new Error('The "ocean.surface.v1" service returned an invalid sample height.');
      }
      this.sampleHeights[index] = height;
    }

    const normal = ocean.sampleNormal(
      this.positionX,
      this.positionZ,
      elapsedSeconds,
      this.surfaceNormal,
    );
    if (!isFiniteVector(normal) || normal.lengthSq() < 0.001) {
      throw new Error('The "ocean.surface.v1" service returned an invalid surface normal.');
    }
    this.surfaceNormal.normalize();

    const leftHeight = (
      this.sampleHeights[0]
      + this.sampleHeights[3]
      + this.sampleHeights[6]
    ) / 3;
    const rightHeight = (
      this.sampleHeights[2]
      + this.sampleHeights[5]
      + this.sampleHeights[8]
    ) / 3;
    const frontHeight = (
      this.sampleHeights[0]
      + this.sampleHeights[1]
      + this.sampleHeights[2]
    ) / 3;
    const backHeight = (
      this.sampleHeights[6]
      + this.sampleHeights[7]
      + this.sampleHeights[8]
    ) / 3;
    const averageHeight = this.sampleHeights.reduce((sum, height) => sum + height, 0)
      / this.sampleHeights.length;
    const normalRoll = Math.atan2(this.surfaceNormal.x, this.surfaceNormal.y);
    const normalPitch = Math.atan2(this.surfaceNormal.z, this.surfaceNormal.y);
    const contactRoll = -Math.atan2(
      rightHeight - leftHeight,
      CONTACT_HALF_WIDTH * 2,
    );
    const contactPitch = Math.atan2(
      frontHeight - backHeight,
      CONTACT_HALF_LENGTH * 2,
    );
    const targetRoll = clamp(
      contactRoll * 0.82 + normalRoll * 0.18,
      -MAX_ROLL,
      MAX_ROLL,
    );
    const targetPitch = clamp(
      contactPitch * 0.82 + normalPitch * 0.18,
      -MAX_PITCH,
      MAX_PITCH,
    );

    const heaveTarget = averageHeight + HEAVE_EQUILIBRIUM_OFFSET;
    if (!this.surfaceTargetInitialized) {
      this.positionY = heaveTarget;
      this.pitch = targetPitch;
      this.roll = targetRoll;
      this.heaveVelocity = 0;
      this.pitchVelocity = 0;
      this.rollVelocity = 0;
      this.previousHeaveTarget = heaveTarget;
      this.surfaceTargetInitialized = true;
      this.wakeImpact = 0;
      this.waterlineUniform.value = averageHeight;
      this.validateMotionState();
      this.raftGroup.position.set(this.positionX, this.positionY, this.positionZ);
      this.raftGroup.rotation.set(this.pitch, this.heading, this.roll);
      return;
    }

    const targetRate = Math.abs(heaveTarget - this.previousHeaveTarget)
      / Math.max(deltaSeconds, 1 / 240);

    const heaveDamping = HEAVE_DAMPING_RATIO
      + Math.min(Math.abs(this.heaveVelocity) * HEAVE_QUADRATIC_DAMPING, 0.3);
    const rollDamping = ROLL_DAMPING_RATIO
      + Math.min(Math.abs(this.rollVelocity) * ROLL_QUADRATIC_DAMPING, 0.3);
    const pitchDamping = PITCH_DAMPING_RATIO
      + Math.min(Math.abs(this.pitchVelocity) * PITCH_QUADRATIC_DAMPING, 0.3);
    const heaveState = boundSpringState(
      integrateDampedSpring(
        this.positionY,
        this.heaveVelocity,
        heaveTarget,
        deltaSeconds,
        HEAVE_NATURAL_FREQUENCY,
        heaveDamping,
      ),
      heaveTarget - MAX_HEAVE_DEVIATION,
      heaveTarget + MAX_HEAVE_DEVIATION,
      MAX_HEAVE_VELOCITY,
    );
    const rollState = boundSpringState(
      integrateDampedSpring(
        this.roll,
        this.rollVelocity,
        targetRoll,
        deltaSeconds,
        ROLL_NATURAL_FREQUENCY,
        rollDamping,
      ),
      -MAX_ROLL,
      MAX_ROLL,
      MAX_ROLL_VELOCITY,
    );
    const pitchState = boundSpringState(
      integrateDampedSpring(
        this.pitch,
        this.pitchVelocity,
        targetPitch,
        deltaSeconds,
        PITCH_NATURAL_FREQUENCY,
        pitchDamping,
      ),
      -MAX_PITCH,
      MAX_PITCH,
      MAX_PITCH_VELOCITY,
    );
    this.positionY = heaveState.position;
    this.heaveVelocity = heaveState.velocity;
    this.roll = rollState.position;
    this.rollVelocity = rollState.velocity;
    this.pitch = pitchState.position;
    this.pitchVelocity = pitchState.velocity;
    this.previousHeaveTarget = heaveTarget;

    const impactSignal = clamp(
      targetRate * 0.2
      + Math.abs(this.heaveVelocity) * 0.12
      + Math.hypot(this.rollVelocity, this.pitchVelocity) * 0.06,
      0,
      1,
    );
    this.wakeImpact = Math.max(
      this.wakeImpact * Math.exp(-8.5 * deltaSeconds),
      impactSignal,
    );
    this.waterlineUniform.value = averageHeight;
    this.validateMotionState();
    this.raftGroup.position.set(this.positionX, this.positionY, this.positionZ);
    this.raftGroup.rotation.set(this.pitch, this.heading, this.roll);
  }

  private validateMotionState(): void {
    const motionState = [
      this.positionX,
      this.positionY,
      this.positionZ,
      this.heading,
      this.speedMetersPerSecond,
      this.leewayMetersPerSecond,
      this.pitch,
      this.roll,
      this.heaveVelocity,
      this.pitchVelocity,
      this.rollVelocity,
      this.wakeImpact,
    ];
    if (!motionState.every(Number.isFinite)) {
      throw new Error('Raft motion state became non-finite.');
    }
    if (
      Math.abs(this.positionY - this.previousHeaveTarget) > MAX_HEAVE_DEVIATION + 1e-6
      || Math.abs(this.pitch) > MAX_PITCH + 1e-6
      || Math.abs(this.roll) > MAX_ROLL + 1e-6
    ) {
      throw new Error('Raft motion state exceeded its physical bounds.');
    }
  }

  private updateSail(): void {
    const geometry = this.sailGeometry;
    const basePositions = this.sailBasePositions;
    const billowWeights = this.sailBillowWeights;
    if (!geometry || !basePositions || !billowWeights) {
      return;
    }
    const position = geometry.getAttribute('position');
    const localZ = this.apparentWindX * -Math.sin(this.heading)
      + this.apparentWindZ * Math.cos(this.heading);
    const apparentLength = Math.hypot(this.apparentWindX, this.apparentWindZ);
    // Sail local +Z is the canvas normal. Billow downwind: sign(A · sailN).
    const offsetScale = 0.16 * this.sailPower * apparentLength * Math.sign(localZ);
    for (let index = 0; index < position.count; index += 1) {
      const weight = billowWeights[index] ?? 0;
      const base = index * 3;
      position.setXYZ(
        index,
        basePositions[base],
        basePositions[base + 1],
        basePositions[base + 2] + weight * offsetScale,
      );
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  private updateWake(elapsedSeconds: number): void {
    const speedFactor = clamp(this.speedMetersPerSecond / SAIL_RUN_SPEED, 0, 1);
    const impactFactor = clamp(this.wakeImpact, 0, 1);
    // Wake is boat speed first, plus a slap from heave rate. Spring is read-only.
    const wakeStrength = clamp(
      smoothstep(0.8, 4.5, this.speedMetersPerSecond)
      + 0.2 * Math.abs(this.heaveVelocity),
      0,
      1,
    );
    this.wakeGroup.visible = wakeStrength > 0.012;
    this.wakeGroup.scale.set(
      0.82 + wakeStrength * 0.26,
      1,
      0.95 + wakeStrength * 0.85,
    );
    if (this.wakeUniforms) {
      this.wakeUniforms.uTime.value = elapsedSeconds;
      this.wakeUniforms.uStrength.value = wakeStrength;
    }

    const sprayStrength = clamp(speedFactor * 0.7 + impactFactor * 0.95, 0, 1);
    for (let index = 0; index < this.plumeCards.length; index += 1) {
      const card = this.plumeCards[index];
      const material = this.plumeMaterials[index];
      const slotScale = 1.05 + index * 0.18;
      const pulse = 0.86 + 0.14 * Math.sin(elapsedSeconds * (2.4 + index * 0.7) + index);
      const visible = sprayStrength > 0.04;
      card.visible = visible;
      card.position.y = (index === 1 ? 0.78 : 0.52) + sprayStrength * 0.22
        + Math.sin(elapsedSeconds * 3.1 + index) * 0.06;
      card.scale.set(
        slotScale * (0.72 + sprayStrength * 0.55) * pulse,
        slotScale * 1.35 * (0.78 + sprayStrength * 0.7) * pulse,
        1,
      );
      material.opacity = visible ? 0.18 + sprayStrength * 0.42 : 0;
      material.rotation = Math.sin(elapsedSeconds * 1.6 + index * 1.1) * 0.12;
    }
    for (const particle of this.sprayParticles) {
      particle.mesh.visible = false;
    }

    this.updateContactFoam(elapsedSeconds);
  }

  private updateContactFoam(elapsedSeconds: number): void {
    const ocean = this.ocean;
    if (!ocean) {
      this.contactFoamGroup.visible = false;
      return;
    }

    this.contactFoamGroup.visible = false;
    if (this.waterlineRibbon) {
      this.waterlineRibbon.visible = false;
    }
    let wetFloor = 0;
    let surfaceHeight = 0;
    for (let index = 0; index < this.sampleOffsets.length; index += 1) {
      const offset = this.sampleOffsets[index];
      this.sampleWorldPosition.copy(offset).applyAxisAngle(WORLD_UP, this.heading);
      this.sampleWorldPosition.x += this.positionX;
      this.sampleWorldPosition.z += this.positionZ;
      const height = ocean.sampleHeight(
        this.sampleWorldPosition.x,
        this.sampleWorldPosition.z,
        elapsedSeconds,
      );
      const compression = clamp(
        sampleOceanWave(
          this.sampleWorldPosition.x,
          this.sampleWorldPosition.z,
          elapsedSeconds,
        ).compression,
        0,
        1,
      );
      this.sampleCompressions[index] = compression;
      const alpha = clamp(
        0.28 + compression * smoothstep(0.3, 3.2, this.speedMetersPerSecond),
        0,
        1,
      );
      const radius = 0.55 + 0.7 * compression;
      const ring = this.contactRings[index];
      ring.position.set(
        this.sampleWorldPosition.x,
        height + 0.04,
        this.sampleWorldPosition.z,
      );
      ring.scale.setScalar(radius);
      ring.visible = false;
      wetFloor += alpha;
      surfaceHeight += height;
      const loopIndex = WATERLINE_LOOP.indexOf(index as typeof WATERLINE_LOOP[number]);
      if (loopIndex >= 0) {
        this.waterlinePoints[loopIndex * 3] = this.sampleWorldPosition.x;
        this.waterlinePoints[loopIndex * 3 + 1] = height + 0.04;
        this.waterlinePoints[loopIndex * 3 + 2] = this.sampleWorldPosition.z;
      }
    }
    const contacts = [];
    for (let loop = 0; loop < WATERLINE_LOOP.length; loop += 1) {
      contacts.push({
        x: this.waterlinePoints[loop * 3],
        z: this.waterlinePoints[loop * 3 + 2],
        radius: loop < 3 ? 1.85 : 1.15,
      });
    }
    const meanAlpha = wetFloor / this.sampleOffsets.length;
    ocean.setHullFoam(contacts, meanAlpha);
    const ribbon = this.waterlineRibbon;
    const target = this.waterlinePositions;
    const material = this.hullFoamMaterial;
    if (ribbon && target && material) {
      const count = WATERLINE_LOOP.length;
      const halfWidth = WATERLINE_WIDTH * 0.5;
      for (let index = 0; index < count; index += 1) {
        const prev = (index + count - 1) % count;
        const next = (index + 1) % count;
        const tangentX = this.waterlinePoints[next * 3] - this.waterlinePoints[prev * 3];
        const tangentZ = this.waterlinePoints[next * 3 + 2] - this.waterlinePoints[prev * 3 + 2];
        const length = Math.hypot(tangentX, tangentZ) || 1;
        const normalX = -tangentZ / length;
        const normalZ = tangentX / length;
        const amplitude = WATERLINE_HASH_AMP + (index < 3 ? WATERLINE_BOW_AMP : 0);
        const x = this.waterlinePoints[index * 3];
        const y = this.waterlinePoints[index * 3 + 1]
          + WATERLINE_LIFT
          + amplitude * waterlineHash(index, elapsedSeconds);
        const z = this.waterlinePoints[index * 3 + 2];
        target[index * 6] = x - normalX * halfWidth;
        target[index * 6 + 1] = y;
        target[index * 6 + 2] = z - normalZ * halfWidth;
        target[index * 6 + 3] = x + normalX * halfWidth;
        target[index * 6 + 4] = y;
        target[index * 6 + 5] = z + normalZ * halfWidth;
      }
      ribbon.geometry.getAttribute('position').needsUpdate = true;
      ribbon.visible = false;
      material.opacity = WATERLINE_ALPHA * meanAlpha;
    }
    this.emitContactSpray(elapsedSeconds);
  }

  private emitContactSpray(elapsedSeconds: number): void {
    if (this.sprayParticles.length === 0) {
      return;
    }
    const heave = Math.abs(this.heaveVelocity);
    const speed = this.speedMetersPerSecond;
    for (let index = 0; index < this.sampleOffsets.length; index += 1) {
      const bow = index < 3;
      const signal = Math.max(heave, this.sampleCompressions[index] * speed);
      const gate = bow ? 0.4 : 0.85;
      const cooldown = bow ? 0.12 : 0.28;
      if (signal <= gate || elapsedSeconds - this.contactBurstAt[index] < cooldown) {
        continue;
      }
      this.contactBurstAt[index] = elapsedSeconds;
      const count = Math.floor(bow ? 12 + 14 * signal : 3 + 8 * signal);
      const offset = this.sampleOffsets[index];
      for (let n = 0; n < count; n += 1) {
        const particle = this.sprayParticles[this.sprayEmitIndex % this.sprayParticles.length];
        this.sprayEmitIndex += 1;
        const jitter = (n - (count - 1) * 0.5) * 0.04;
        particle.bursting = true;
        particle.burstStart = elapsedSeconds;
        particle.burstOriginX = offset.x + jitter;
        particle.burstOriginY = 0.16;
        particle.burstOriginZ = offset.z;
        particle.burstDirX = 0;
        particle.burstDirY = bow ? 0.96 : 0.70710678;
        particle.burstDirZ = bow ? 0.28 : 0.70710678;
        particle.burstStrength = signal;
      }
    }
  }

  private updateCamera(context: RuntimeContext, deltaSeconds: number): void {
    this.cameraOffset.set(0, 6.0 + this.cameraPitch * 2.65, 12.5);
    this.cameraOffset.applyAxisAngle(WORLD_UP, this.heading + this.cameraYaw);
    this.desiredCameraPosition.copy(this.raftGroup.position).add(this.cameraOffset);
    // Keep the look point above the deck so the raised chase camera shows the
    // cargo and plank texture without letting the raft drift out of frame.
    this.targetOffset.set(0, 2.85 + this.cameraPitch * 1.15, -0.18);
    this.targetOffset.applyAxisAngle(WORLD_UP, this.heading);
    this.cameraTarget.copy(this.raftGroup.position).add(this.targetOffset);
    const cameraBlend = 1 - Math.exp(-6.5 * deltaSeconds);
    context.camera.position.lerp(this.desiredCameraPosition, cameraBlend);
    context.camera.lookAt(this.cameraTarget);
  }

  private registerGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private registerMaterial<T extends THREE.Material>(material: T): T {
    this.materials.add(material);
    return material;
  }

  private registerDerivedMaps(
    albedo: THREE.Texture,
    options: DerivedSurfaceMapOptions,
  ): DerivedSurfaceMaps {
    const maps = createDerivedSurfaceMaps(albedo, options);
    this.textures.add(maps.normalMap);
    this.textures.add(maps.roughnessMap);
    return maps;
  }

  private applyWaterlineWetness(
    material: THREE.MeshStandardMaterial,
  ): THREE.MeshStandardMaterial {
    const waterline = this.waterlineUniform;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterHeight = waterline;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWaterlineWorldPosition;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vWaterlineWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWaterHeight;
          varying vec3 vWaterlineWorldPosition;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float waterlineWetness = smoothstep(
            uWaterHeight + 0.42,
            uWaterHeight + 0.04,
            vWaterlineWorldPosition.y
          );
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.52, 0.60, 0.62), waterlineWetness * 0.58);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.22, waterlineWetness);`,
        );
    };
    material.customProgramCacheKey = () => 'raft-waterline-wetness';
    return material;
  }
}

export function createRaftFeature(): RuntimeFeature {
  let controller: RaftController | null = null;

  return {
    id: 'raft',
    async init(context: RuntimeContext): Promise<void> {
      const nextController = new RaftController();
      controller = nextController;
      try {
        await nextController.init(context);
      } catch (error) {
        nextController.dispose(context);
        controller = null;
        throw error;
      }
    },
    update(context: RuntimeFrameContext): void {
      controller?.update(context);
    },
    resize(context: RuntimeResizeContext): void {
      controller?.resize(context);
    },
    dispose(context: RuntimeContext): void {
      controller?.dispose(context);
      controller = null;
    },
  };
}
