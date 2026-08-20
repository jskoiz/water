import * as THREE from 'three';

/**
 * The wave spectrum is intentionally kept in one place.  The same values are
 * mirrored in the surface shader so the raft service and the rendered ocean
 * agree on the waterline and slope.
 */
export interface WaveComponent {
  readonly directionX: number;
  readonly directionZ: number;
  readonly amplitude: number;
  readonly wavelength: number;
  readonly speed: number;
  readonly phaseOffset: number;
}

export interface OceanWaveSample {
  readonly height: number;
  readonly dx: number;
  readonly dz: number;
  readonly foam: number;
}

export const OCEAN_SURFACE_LEVEL = 0;

export const OCEAN_WAVES: readonly WaveComponent[] = [
  { directionX: 0.9701425, directionZ: 0.2425356, amplitude: 0.42, wavelength: 26, speed: 0.38, phaseOffset: 0.0 },
  { directionX: 0.4718579, directionZ: 0.8816745, amplitude: 0.24, wavelength: 13, speed: 0.56, phaseOffset: 1.7 },
  { directionX: -0.8, directionZ: 0.6, amplitude: 0.14, wavelength: 6.8, speed: 0.82, phaseOffset: 3.1 },
  { directionX: 0.2, directionZ: -0.98, amplitude: 0.085, wavelength: 4.1, speed: 1.12, phaseOffset: -0.9 },
  { directionX: -0.9353294, directionZ: -0.3537814, amplitude: 0.05, wavelength: 2.6, speed: 1.5, phaseOffset: 2.2 },
  { directionX: 0.702713, directionZ: -0.711473, amplitude: 0.028, wavelength: 1.7, speed: 2.15, phaseOffset: -1.5 },
  { directionX: 0.39, directionZ: 0.92, amplitude: 0.019, wavelength: 1.15, speed: 2.6, phaseOffset: 0.4 },
  { directionX: -0.72, directionZ: 0.69, amplitude: 0.013, wavelength: 0.88, speed: 2.9, phaseOffset: -2.2 },
];

const TWO_PI = Math.PI * 2;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function sampleOceanWave(x: number, z: number, elapsedSeconds: number): OceanWaveSample {
  let height = 0;
  let dx = 0;
  let dz = 0;

  for (const wave of OCEAN_WAVES) {
    const frequency = TWO_PI / wave.wavelength;
    const phase = (x * wave.directionX + z * wave.directionZ) * frequency
      + elapsedSeconds * wave.speed
      + wave.phaseOffset;
    const sine = Math.sin(phase);
    const cosine = Math.cos(phase);
    const derivative = wave.amplitude * frequency * cosine;
    height += wave.amplitude * sine;
    dx += derivative * wave.directionX;
    dz += derivative * wave.directionZ;
  }

  const slope = Math.hypot(dx, dz);
  const crest = smoothstep(0.3, 0.62, height);
  const steepness = smoothstep(0.2, 0.5, slope);
  const foam = Math.max(0, Math.min(1, crest * 0.62 + steepness * 0.38));

  return {
    height: OCEAN_SURFACE_LEVEL + height,
    dx,
    dz,
    foam,
  };
}

export function sampleOceanNormal(
  x: number,
  z: number,
  elapsedSeconds: number,
  target: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const wave = sampleOceanWave(x, z, elapsedSeconds);
  return target.set(-wave.dx, 1, -wave.dz).normalize();
}
