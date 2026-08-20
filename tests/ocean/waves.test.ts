import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOceanWaveShaderSource,
  OCEAN_GRAVITY,
  OCEAN_STEEPNESS,
  OCEAN_WAVES,
  sampleOceanWave,
  sampleOceanWaveAtRest,
} from '../../src/features/ocean/waves.ts';

function assertFiniteSample(sample: ReturnType<typeof sampleOceanWave>): void {
  for (const value of Object.values(sample)) {
    assert.equal(typeof value, 'number');
    assert.ok(Number.isFinite(value), `expected finite sample value, got ${value}`);
  }
  const normalLength = Math.hypot(sample.normalX, sample.normalY, sample.normalZ);
  assert.ok(Math.abs(normalLength - 1) < 1e-6, `normal length was ${normalLength}`);
  assert.ok(sample.normalY > 0, `normal should face upward, got ${sample.normalY}`);
  assert.ok(sample.foam >= 0 && sample.foam <= 1, `foam was ${sample.foam}`);
}

test('ocean samples stay finite and normals stay normalized', () => {
  for (const elapsedSeconds of [0, 0.37, 3.2, 19.75]) {
    for (const x of [-120, -17.5, 0, 13.25, 120]) {
      for (const z of [-120, -11, 0, 29.5, 120]) {
        assertFiniteSample(sampleOceanWave(x, z, elapsedSeconds));
      }
    }
  }
});

test('deep-water component frequencies and Gerstner steepness are physical', () => {
  let steepnessBudget = 0;
  for (const wave of OCEAN_WAVES) {
    const waveNumber = (Math.PI * 2) / wave.wavelength;
    const expectedAngularFrequency = Math.sqrt(OCEAN_GRAVITY * waveNumber);
    assert.ok(
      Math.abs(wave.speed - expectedAngularFrequency) < 1e-12,
      `omega mismatch for wavelength ${wave.wavelength}`,
    );
    // q_i = Q / (k_i * A_i * N), so q_i * k_i * A_i = Q / N.
    steepnessBudget += (OCEAN_STEEPNESS / (waveNumber * OCEAN_WAVES.length * wave.amplitude))
      * waveNumber * wave.amplitude;
  }
  assert.ok(Math.abs(steepnessBudget - OCEAN_STEEPNESS) < 1e-12);
  assert.ok(steepnessBudget < 1, 'Gerstner steepness must stay below the loop threshold');
});

test('the lateral Gerstner mapping is invertible for CPU raft samples', () => {
  for (const [restX, restZ, elapsedSeconds] of [
    [-38.4, 7.2, 0.0],
    [1.25, -11.5, 1.7],
    [64.0, 42.0, 9.25],
  ] as const) {
    const displaced = sampleOceanWaveAtRest(restX, restZ, elapsedSeconds);
    const solved = sampleOceanWave(displaced.displacedX, displaced.displacedZ, elapsedSeconds);
    assert.ok(Math.hypot(solved.restX - restX, solved.restZ - restZ) < 1e-6);
    assert.ok(Math.abs(solved.height - displaced.height) < 1e-6);
    assert.ok(Math.hypot(
      solved.normalX - displaced.normalX,
      solved.normalY - displaced.normalY,
      solved.normalZ - displaced.normalZ,
    ) < 1e-6);
  }
});

test('surface motion is temporally continuous at a frame interval', () => {
  const before = sampleOceanWave(18.5, -9.25, 4.0);
  const after = sampleOceanWave(18.5, -9.25, 4.0 + 1 / 120);
  assert.ok(Math.abs(after.height - before.height) < 0.12);
  assert.ok(Math.hypot(after.normalX - before.normalX, after.normalZ - before.normalZ) < 0.12);
});

test('generated GLSL mirrors every CPU wave component', () => {
  const shader = createOceanWaveShaderSource();
  const terms = shader.match(/addGerstnerWave\(result,/g) ?? [];
  assert.equal(terms.length, OCEAN_WAVES.length);
  assert.match(shader, /OCEAN_STEEPNESS = 0\.82/);
  assert.match(shader, new RegExp(`OCEAN_WAVE_COUNT = ${OCEAN_WAVES.length}\\.0`));
  for (const wave of OCEAN_WAVES) {
    assert.match(shader, new RegExp(
      `vec2\\(${wave.directionX.toFixed(9).replace(/0+$/, '').replace(/\\.$/, '')}`,
    ));
  }
});

test('wind spectrum spans irregular scales without overpowering cross-chop', () => {
  assert.equal(OCEAN_WAVES.length, 12);
  const wavelengths = OCEAN_WAVES.map((wave) => wave.wavelength);
  const amplitudes = OCEAN_WAVES.map((wave) => wave.amplitude);
  const minWavelength = Math.min(...wavelengths);
  const maxWavelength = Math.max(...wavelengths);
  assert.ok(maxWavelength / minWavelength > 80, 'spectrum should cover long swell through fine chop');

  const wavelengthRatios = wavelengths.slice(1).map((wavelength, index) => wavelength / wavelengths[index]);
  const ratioRange = Math.max(...wavelengthRatios) - Math.min(...wavelengthRatios);
  assert.ok(ratioRange > 0.08, 'wavelength spacing should not be a single geometric progression');

  const windDirection = OCEAN_WAVES[0];
  const windEnergy = OCEAN_WAVES.reduce((sum, wave) => (
    sum + wave.amplitude * Math.max(
      wave.directionX * windDirection.directionX + wave.directionZ * windDirection.directionZ,
      0,
    )
  ), 0);
  const crossChopEnergy = OCEAN_WAVES.reduce((sum, wave) => {
    const alignment = wave.directionX * windDirection.directionX
      + wave.directionZ * windDirection.directionZ;
    return sum + wave.amplitude * Math.max(0, 0.72 - alignment);
  }, 0);
  assert.ok(windEnergy > amplitudes.reduce((sum, amplitude) => sum + amplitude, 0) * 0.84);
  assert.ok(crossChopEnergy < windEnergy * 0.16, 'cross-chop should break symmetry without dominating the wind sea');

  const highFrequencyEnergy = OCEAN_WAVES.reduce(
    (sum, wave) => sum + (wave.wavelength < 2 ? wave.amplitude : 0),
    0,
  );
  assert.ok(highFrequencyEnergy > 0.04, 'short components should still shape irregular silhouettes');
});
