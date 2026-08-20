import assert from 'node:assert/strict';
import test from 'node:test';

import { getMarineSkyShaderSource } from '../../src/features/environment/atmosphere.ts';

test('marine sky shader exposes one linear radiance function for cubemap capture', () => {
  const shader = getMarineSkyShaderSource();
  const radianceDefinitions = shader.match(/vec3 marineSkyRadiance\(/g) ?? [];
  assert.equal(radianceDefinitions.length, 1);
  assert.match(shader, /RAYLEIGH_BETA/);
  assert.match(shader, /MIE_BETA/);
  assert.match(shader, /cloudNoise\(/);
  assert.match(shader, /#include <tonemapping_fragment>/);
  assert.match(shader, /return max\(skyColor, vec3\(0\.0\)\);/);
});
