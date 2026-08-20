import * as THREE from 'three';

import { createRuntimeServiceKey } from '../../runtime';
import type { RuntimeServiceKey } from '../../runtime';

/**
 * The ocean owns the implementation of this service. The raft only samples
 * the published surface contract and never creates a second wave model.
 */
export interface OceanSurfaceService {
  sampleHeight(x: number, z: number, elapsedSeconds: number): number;
  sampleNormal(
    x: number,
    z: number,
    elapsedSeconds: number,
    target?: THREE.Vector3,
  ): THREE.Vector3;
}

/**
 * Recreated locally so the raft and ocean resolve the same global symbol.
 */
export const oceanSurfaceServiceKey: RuntimeServiceKey<OceanSurfaceService> =
  createRuntimeServiceKey<OceanSurfaceService>('ocean.surface.v1');
