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
const KNOTS_PER_METRE_PER_SECOND = 1.943844;
// Dominant Gerstner D0, unitized. Apparent wind is W - v_boat.
const WIND_SEA_X = 0.970;
const WIND_SEA_Z = 0.243;
const WIND_SEA_LENGTH = Math.hypot(WIND_SEA_X, WIND_SEA_Z);
const WIND_DIR_X = WIND_SEA_X / WIND_SEA_LENGTH;
const WIND_DIR_Z = WIND_SEA_Z / WIND_SEA_LENGTH;
const WIND_SPEED_MPS = 4.2;
const SAIL_RUN_SPEED = 3.35;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MAX_PITCH = 0.45;
const MAX_ROLL = 0.52;
const CONTACT_HALF_WIDTH = 1.25;
const CONTACT_HALF_LENGTH = 2.05;
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
}

interface WakeSection {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly alpha: number;
}

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
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();

  private ocean: OceanSurfaceService | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private hud: RaftHud | null = null;
  private sailGeometry: THREE.BufferGeometry | null = null;
  private sailBasePositions: Float32Array | null = null;
  private woodTexture: THREE.Texture | null = null;
  private sailTexture: THREE.Texture | null = null;
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
  private heading = 0;
  private speedMetersPerSecond = 0;
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
    const [woodTexture, sailTexture] = await Promise.all([
      loadTexture(loader, WOOD_TEXTURE_URL),
      loadTexture(loader, SAIL_TEXTURE_URL),
    ]);
    this.woodTexture = woodTexture;
    this.sailTexture = sailTexture;
    this.textures.add(woodTexture);
    this.textures.add(sailTexture);
    this.configureTexture(woodTexture, context.renderer);
    this.configureTexture(sailTexture, context.renderer);

    context.loading.update('Preparing raft systems…');
    this.buildRaft();
    this.buildWake();
    context.scene.add(this.raftGroup);
    context.scene.add(this.contactFoamGroup);
    this.canvas = context.renderer.domElement;
    this.canvas.dataset.qa = 'water-canvas';
    this.hud = createRaftHud(context.renderer.domElement);
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

  public dispose(_context: RuntimeContext): void {
    if (this.canvas?.dataset.qa === 'water-canvas') {
      delete this.canvas.dataset.qa;
    }
    this.hud?.dispose();
    this.hud = null;
    this.raftGroup.removeFromParent();
    this.contactFoamGroup.removeFromParent();
    this.contactRings.length = 0;
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
    this.sailGeometry = null;
    this.sailBasePositions = null;
    this.woodTexture = null;
    this.sailTexture = null;
    this.wakeUniforms = null;
    this.heaveVelocity = 0;
    this.pitchVelocity = 0;
    this.rollVelocity = 0;
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

    const woodMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0xa9794f,
      map: this.woodTexture,
      roughness: 0.76,
      metalness: 0.01,
      emissive: 0x2c1a0d,
      emissiveIntensity: 0.08,
    }));
    const darkWoodMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x67442f,
      map: this.woodTexture,
      roughness: 0.82,
      metalness: 0.01,
      emissive: 0x24150a,
      emissiveIntensity: 0.1,
    }));
    const ropeMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x765639,
      roughness: 0.88,
      metalness: 0,
      emissive: 0x1b1008,
      emissiveIntensity: 0.06,
    }));
    const sailMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0xe8d6b4,
      map: this.sailTexture,
      roughness: 0.84,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.04,
      emissive: 0x63482b,
      emissiveIntensity: 0.07,
    }));

    const plankGeometry = this.registerGeometry(new THREE.BoxGeometry(0.36, 0.32, 4.75, 1, 1, 8));
    for (let index = 0; index < 9; index += 1) {
      const plank = new THREE.Mesh(plankGeometry, woodMaterial);
      plank.position.set(-1.44 + index * 0.36, 0, (index % 2 === 0 ? -1 : 1) * 0.025);
      plank.rotation.z = Math.sin(index * 2.7) * 0.012;
      plank.castShadow = true;
      plank.receiveShadow = true;
      this.raftGroup.add(plank);
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

    this.sailGeometry = this.registerGeometry(new THREE.BufferGeometry());
    this.sailBasePositions = new Float32Array([
      0, 1.25, -0.79,
      0, 4.36, -0.79,
      -2.02, 1.22, -0.79,
    ]);
    this.sailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.sailBasePositions.slice(), 3),
    );
    this.sailGeometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array([1, 0, 0.06, 0, 1, 1]), 2),
    );
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
    crate.position.set(0.82, 0.52, 0.85);
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
      uOpacity: { value: 0.64 },
      uTime: { value: 0 },
      uStrength: { value: 0 },
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
          float distanceFade = 1.0 - smoothstep(3.45, 6.25, vLocalPosition.z);
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
          float foamAlpha = vAlpha * distanceFade * edgeBreakup * narrowStreak
            * uOpacity * strength;
          float dither = hash12(vec2(
            floor(vLocalPosition.z * 7.0 + uTime * 0.8),
            floor(vLocalPosition.x * 18.0)
          ));
          if (foamAlpha < 0.028 || (vAlpha < 0.22 && dither > edgeBreakup * 0.98)) {
            discard;
          }

          vec3 foamColor = mix(
            uColor,
            vec3(0.62, 0.84, 0.84),
            smoothstep(0.38, 0.88, turbulence) * 0.72
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
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }));
    this.wakeUniforms = {
      uTime: wakeUniforms.uTime,
      uStrength: wakeUniforms.uStrength,
    };
    const wakeSections: readonly WakeSection[] = [
      { x: 0.52, z: 1.76, width: 0.24, alpha: 0.78 },
      { x: 0.57, z: 1.98, width: 0.25, alpha: 0.72 },
      { x: 0.64, z: 2.23, width: 0.27, alpha: 0.64 },
      { x: 0.73, z: 2.53, width: 0.29, alpha: 0.55 },
      { x: 0.84, z: 2.88, width: 0.31, alpha: 0.46 },
      { x: 0.96, z: 3.28, width: 0.34, alpha: 0.38 },
      { x: 1.08, z: 3.74, width: 0.37, alpha: 0.3 },
      { x: 1.2, z: 4.25, width: 0.4, alpha: 0.22 },
      { x: 1.31, z: 4.82, width: 0.42, alpha: 0.15 },
      { x: 1.39, z: 5.44, width: 0.4, alpha: 0.08 },
      { x: 1.45, z: 6.08, width: 0.34, alpha: 0 },
    ];
    for (const side of [-1, 1]) {
      const wakeGeometry = this.createWakeRibbonGeometry(
        wakeSections.map((section) => ({
          ...section,
          x: section.x * side,
        })),
      );
      const wake = new THREE.Mesh(wakeGeometry, wakeMaterial);
      wake.position.y = 0.06;
      wake.renderOrder = 1;
      this.wakeGroup.add(wake);
    }

    const sprayMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x8ec4c9,
      roughness: 0.32,
      metalness: 0,
      emissive: 0x173d43,
      emissiveIntensity: 0.04,
      transparent: true,
      opacity: 0.4,
      alphaTest: 0.02,
      depthWrite: false,
    }));
    const sprayGeometry = this.registerGeometry(new THREE.SphereGeometry(0.055, 10, 6));
    for (let index = 0; index < 24; index += 1) {
      const spread = (index % 8) / 7;
      const side = index % 2 === 0 ? -1 : 1;
      const baseX = side * (0.32 + spread * 1.18 + (index % 3) * 0.06);
      const particle = new THREE.Mesh(sprayGeometry, sprayMaterial);
      const baseY = 0.11 + (index % 4) * 0.035;
      const baseZ = 1.9 + (index % 8) * 0.28;
      particle.position.set(baseX, baseY, baseZ);
      particle.renderOrder = 2;
      this.wakeGroup.add(particle);
      this.sprayParticles.push({
        mesh: particle,
        baseX,
        baseY,
        baseZ,
        phase: index * 0.71,
        spread,
        size: 0.52 + (index % 5) * 0.11,
      });
    }
    this.raftGroup.add(this.wakeGroup);

    const contactGeometry = this.registerGeometry(new THREE.RingGeometry(0.55, 1, 24));
    for (let index = 0; index < this.sampleOffsets.length; index += 1) {
      const contactMaterial = this.registerMaterial(new THREE.MeshBasicMaterial({
        color: 0xd8f2f2,
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
    this.positionX += Math.sin(this.heading) * this.speedMetersPerSecond * deltaSeconds;
    this.positionZ -= Math.cos(this.heading) * this.speedMetersPerSecond * deltaSeconds;
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
    if (!geometry || !basePositions) {
      return;
    }
    const position = geometry.getAttribute('position');
    const localX = this.apparentWindX * Math.cos(this.heading)
      + this.apparentWindZ * Math.sin(this.heading);
    const localZ = this.apparentWindX * -Math.sin(this.heading)
      + this.apparentWindZ * Math.cos(this.heading);
    const apparentLength = Math.hypot(localX, localZ);
    const fill = apparentLength > 1e-4
      ? 0.12 * (0.35 + this.sailPower) * Math.min(apparentLength / WIND_SPEED_MPS, 1)
      : 0;
    const dirX = apparentLength > 1e-4 ? localX / apparentLength : 0;
    const dirZ = apparentLength > 1e-4 ? localZ / apparentLength : 0;
    const weights = [0.1, 0.45, 1];
    for (let index = 0; index < 3; index += 1) {
      const weight = weights[index] * fill;
      const baseIndex = index * 3;
      position.setX(index, basePositions[baseIndex] + dirX * weight);
      position.setY(index, basePositions[baseIndex + 1]);
      position.setZ(index, basePositions[baseIndex + 2] + dirZ * weight);
    }
    position.needsUpdate = true;
  }

  private updateWake(elapsedSeconds: number): void {
    const speedFactor = clamp(this.speedMetersPerSecond / 3.35, 0, 1);
    const impactFactor = clamp(this.wakeImpact, 0, 1);
    // Wake is boat speed first, plus a slap from heave rate. Spring is read-only.
    const wakeStrength = clamp(
      smoothstep(0.35, 2.8, this.speedMetersPerSecond)
      + 0.2 * Math.abs(this.heaveVelocity),
      0,
      1,
    );
    this.wakeGroup.visible = wakeStrength > 0.012;
    this.wakeGroup.scale.set(
      0.82 + wakeStrength * 0.26,
      1,
      0.78 + wakeStrength * 0.48,
    );
    if (this.wakeUniforms) {
      this.wakeUniforms.uTime.value = elapsedSeconds;
      this.wakeUniforms.uStrength.value = wakeStrength;
    }

    const sprayStrength = clamp(speedFactor * 0.7 + impactFactor * 0.95, 0, 1);
    for (const particle of this.sprayParticles) {
      const phase = elapsedSeconds * (1.8 + particle.spread + speedFactor * 0.75) + particle.phase;
      const travel = (elapsedSeconds * (
        0.45
        + speedFactor * 0.9
        + impactFactor * 1.45
      ) + particle.phase * 0.14) % 1;
      const dissipation = 1 - travel;
      const launchHeight = 0.14 + speedFactor * 0.2 + impactFactor * 0.56;
      const launchDistance = 0.68 + speedFactor * 1.2 + impactFactor * 1.45;
      particle.mesh.position.x = particle.baseX
        + Math.sin(phase) * (0.08 + speedFactor * 0.04 + impactFactor * 0.1);
      particle.mesh.position.y = particle.baseY
        + Math.abs(Math.sin(phase * 0.8)) * launchHeight * (0.35 + particle.spread * 0.65);
      particle.mesh.position.z = particle.baseZ + travel * launchDistance;
      particle.mesh.visible = sprayStrength > 0.035 && dissipation > 0.025;
      // Elongated, dissipating droplets read as blown spray rather than static
      // spheres. A small impact boost produces a short burst on hard landings.
      const size = particle.size
        * (0.24 + sprayStrength * 0.68)
        * (0.36 + dissipation * 0.64);
      particle.mesh.scale.set(
        size * (0.58 + particle.spread * 0.14),
        size * (0.92 + impactFactor * 0.48),
        size * (0.44 + speedFactor * 0.28),
      );
    }

    this.updateContactFoam(elapsedSeconds);
  }

  private updateContactFoam(elapsedSeconds: number): void {
    const ocean = this.ocean;
    if (!ocean) {
      this.contactFoamGroup.visible = false;
      return;
    }

    this.contactFoamGroup.visible = true;
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
      const alpha = clamp(compression * this.speedMetersPerSecond, 0, 1);
      const radius = 0.35 + 0.45 * compression;
      const ring = this.contactRings[index];
      ring.position.set(
        this.sampleWorldPosition.x,
        height + 0.04,
        this.sampleWorldPosition.z,
      );
      ring.scale.setScalar(radius);
      ring.visible = alpha > 0.02;
      const material = ring.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = alpha * 0.72;
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
