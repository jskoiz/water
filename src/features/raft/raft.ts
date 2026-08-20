import * as THREE from 'three';

import type {
  RuntimeContext,
  RuntimeFeature,
  RuntimeFrameContext,
  RuntimeResizeContext,
} from '../../runtime';
import { createRaftHud } from './hud';
import type { RaftHud } from './hud';
import {
  oceanSurfaceServiceKey,
} from './types';
import type { OceanSurfaceService } from './types';

const WOOD_TEXTURE_URL = '/raft/raft-wood-albedo.png';
const SAIL_TEXTURE_URL = '/raft/raft-sail-albedo.png';
const KNOTS_PER_METRE_PER_SECOND = 1.943844;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const MAX_PITCH = 0.45;
const MAX_ROLL = 0.52;

interface SprayParticle {
  readonly mesh: THREE.Mesh;
  readonly baseX: number;
  readonly baseY: number;
  readonly phase: number;
  readonly spread: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function damp(current: number, target: number, sharpness: number, deltaSeconds: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-sharpness * deltaSeconds));
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
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
  private readonly sampleOffsets = [
    new THREE.Vector3(-1.25, 0, -2.05),
    new THREE.Vector3(1.25, 0, -2.05),
    new THREE.Vector3(-1.25, 0, 2.05),
    new THREE.Vector3(1.25, 0, 2.05),
  ] as const;
  private readonly sampleWorldPosition = new THREE.Vector3();
  private readonly surfaceNormal = new THREE.Vector3(0, 1, 0);
  private readonly desiredCameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private readonly targetOffset = new THREE.Vector3();
  private readonly sampleHeights = [0, 0, 0, 0];
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
  private lastPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private positionX = 0;
  private positionY = 0;
  private positionZ = 0;
  private heading = 0;
  private speedMetersPerSecond = 0;
  private sailPower = 0.72;
  private steering = 0;
  private pitch = 0;
  private roll = 0;
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
    this.updateSail(context.frame.elapsedSeconds);
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

    const woodMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x9a7650,
      map: this.woodTexture,
      roughness: 0.88,
      metalness: 0.02,
      emissive: 0x1a1008,
      emissiveIntensity: 0.16,
    }));
    const darkWoodMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x4a3524,
      map: this.woodTexture,
      roughness: 0.94,
      metalness: 0.01,
      emissive: 0x0b0704,
      emissiveIntensity: 0.12,
    }));
    const ropeMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0x55402c,
      roughness: 1,
      metalness: 0,
    }));
    const sailMaterial = this.registerMaterial(new THREE.MeshStandardMaterial({
      color: 0xd9ccb0,
      map: this.sailTexture,
      roughness: 0.98,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.04,
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
    this.raftGroup.add(mastCap);

    const boomGeometry = this.registerGeometry(new THREE.CylinderGeometry(0.075, 0.09, 2.15, 8));
    const boom = new THREE.Mesh(boomGeometry, darkWoodMaterial);
    boom.position.set(-0.92, 1.28, -0.77);
    boom.rotation.z = Math.PI / 2;
    boom.castShadow = true;
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
    const wakeMaterial = this.registerMaterial(new THREE.MeshBasicMaterial({
      color: 0xf4fbff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const wakeGeometry = this.registerGeometry(new THREE.PlaneGeometry(0.72, 4.8));
    for (const x of [-0.88, 0.88]) {
      const wake = new THREE.Mesh(wakeGeometry, wakeMaterial);
      wake.position.set(x, -0.04, 2.5);
      wake.rotation.x = -Math.PI / 2;
      wake.rotation.z = x * 0.04;
      wake.scale.set(0.85, 1, 1);
      this.wakeGroup.add(wake);
    }

    const sprayMaterial = this.registerMaterial(new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
    }));
    const sprayGeometry = this.registerGeometry(new THREE.IcosahedronGeometry(0.085, 0));
    for (let index = 0; index < 18; index += 1) {
      const spread = (index % 6) / 5;
      const baseX = (index % 2 === 0 ? -1 : 1) * (0.35 + spread * 1.2);
      const particle = new THREE.Mesh(sprayGeometry, sprayMaterial);
      particle.position.set(baseX, 0.16 + (index % 3) * 0.05, 2.15 + (index % 5) * 0.25);
      particle.scale.setScalar(0.5 + (index % 4) * 0.15);
      this.wakeGroup.add(particle);
      this.sprayParticles.push({
        mesh: particle,
        baseX,
        baseY: particle.position.y,
        phase: index * 0.71,
        spread,
      });
    }
    this.raftGroup.add(this.wakeGroup);
  }

  private addRope(points: THREE.Vector3[], material: THREE.Material, radius: number): void {
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = this.registerGeometry(new THREE.TubeGeometry(curve, Math.max(points.length * 6, 12), radius, 6, false));
    const rope = new THREE.Mesh(geometry, material);
    rope.castShadow = true;
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
    const targetSpeed = this.sailPower * 3.35;
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

    const leftHeight = (this.sampleHeights[0] + this.sampleHeights[2]) * 0.5;
    const rightHeight = (this.sampleHeights[1] + this.sampleHeights[3]) * 0.5;
    const frontHeight = (this.sampleHeights[0] + this.sampleHeights[1]) * 0.5;
    const backHeight = (this.sampleHeights[2] + this.sampleHeights[3]) * 0.5;
    const averageHeight = this.sampleHeights.reduce((sum, height) => sum + height, 0) / 4;
    const normalRoll = Math.atan2(this.surfaceNormal.x, this.surfaceNormal.y);
    const normalPitch = Math.atan2(this.surfaceNormal.z, this.surfaceNormal.y);
    const targetRoll = clamp(
      -Math.atan2(rightHeight - leftHeight, 2.5) + normalRoll * 0.32,
      -MAX_ROLL,
      MAX_ROLL,
    );
    const targetPitch = clamp(
      Math.atan2(frontHeight - backHeight, 4.1) + normalPitch * 0.32,
      -MAX_PITCH,
      MAX_PITCH,
    );

    this.positionY = damp(this.positionY, averageHeight - 0.12, 8.5, deltaSeconds);
    this.roll = damp(this.roll, targetRoll, 5.5, deltaSeconds);
    this.pitch = damp(this.pitch, targetPitch, 5.5, deltaSeconds);
    this.raftGroup.position.set(this.positionX, this.positionY, this.positionZ);
    this.raftGroup.rotation.set(this.pitch, this.heading, this.roll);
  }

  private updateSail(elapsedSeconds: number): void {
    const geometry = this.sailGeometry;
    const basePositions = this.sailBasePositions;
    if (!geometry || !basePositions) {
      return;
    }
    const position = geometry.getAttribute('position');
    const billow = Math.sin(elapsedSeconds * 1.4) * 0.12 * (0.35 + this.sailPower);
    position.setZ(0, basePositions[2] + billow * 0.1);
    position.setZ(1, basePositions[5] + billow * 0.45);
    position.setZ(2, basePositions[8] + billow);
    position.needsUpdate = true;
  }

  private updateWake(elapsedSeconds: number): void {
    const speedFactor = clamp(this.speedMetersPerSecond / 3.35, 0, 1);
    this.wakeGroup.visible = speedFactor > 0.01;
    this.wakeGroup.scale.set(0.78 + speedFactor * 0.32, 1, 0.75 + speedFactor * 0.35);
    for (const particle of this.sprayParticles) {
      const phase = elapsedSeconds * (1.8 + particle.spread) + particle.phase;
      const travel = (elapsedSeconds * (0.45 + speedFactor * 0.9) + particle.phase * 0.14) % 1;
      particle.mesh.position.x = particle.baseX + Math.sin(phase) * 0.12 * speedFactor;
      particle.mesh.position.y = particle.baseY + Math.abs(Math.sin(phase * 0.8)) * (0.18 + speedFactor * 0.25);
      particle.mesh.position.z = 2.15 + travel * (1.25 + speedFactor * 1.25);
      particle.mesh.visible = speedFactor > 0.03;
      particle.mesh.scale.setScalar((0.45 + particle.spread * 0.4) * (0.5 + speedFactor));
    }
  }

  private updateCamera(context: RuntimeContext, deltaSeconds: number): void {
    this.cameraOffset.set(0, 3.75 + this.cameraPitch * 2.5, 8.25);
    this.cameraOffset.applyAxisAngle(WORLD_UP, this.heading + this.cameraYaw);
    this.desiredCameraPosition.copy(this.raftGroup.position).add(this.cameraOffset);
    this.targetOffset.set(0, 1.05 + this.cameraPitch * 1.25, -0.45);
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
