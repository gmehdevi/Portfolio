import { loadWasmModule } from '$lib/wasm/loader';
import type { CameraState } from './math';
import type { CameraMode } from './types';

export type CameraMathBackend = {
  viewProj: (cam: CameraState, aspect: number, near: number, far: number, fovY: number, out: Float32Array) => Float32Array;
};

let backend: CameraMathBackend | null = null;
let backendPromise: Promise<CameraMathBackend | null> | null = null;

const modeMap: Record<CameraMode, number> = {
  orbit: 0,
  fly: 1,
  track: 2
};

export function getCameraMathBackend(): CameraMathBackend | null {
  return backend;
}

export async function initCameraMathBackend(): Promise<CameraMathBackend | null> {
  if (backendPromise) {
    return backendPromise;
  }
  backendPromise = (async () => {
    const module: any = await loadWasmModule();
    if (!module || !module.cwrap || !module._malloc) {
      return null;
    }
    let camPtr = 0;
    let outPtr = 0;
    let camView: Float32Array | null = null;
    let outView: Float32Array | null = null;
    let heapBuffer: ArrayBuffer | null = null;

    const ensureViews = () => {
      if (!camPtr) {
        camPtr = module._malloc(6 * 4);
      }
      if (!outPtr) {
        outPtr = module._malloc(16 * 4);
      }
      if (heapBuffer !== module.HEAPF32.buffer || !camView || !outView) {
        heapBuffer = module.HEAPF32.buffer;
        camView = new Float32Array(heapBuffer, camPtr, 6);
        outView = new Float32Array(heapBuffer, outPtr, 16);
      }
    };

    if (!module._cam_view_proj && !module.cam_view_proj) {
      return null;
    }

    const cam_view_proj = module.cwrap('cam_view_proj', null, [
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number'
    ]);

    const impl: CameraMathBackend = {
      viewProj: (cam, aspect, near, far, fovY, out) => {
        ensureViews();
        if (!camView || !outView) {
          return out;
        }
        if (cam.mode === 'fly') {
          camView[0] = cam.position[0];
          camView[1] = cam.position[1];
          camView[2] = cam.position[2];
          camView[3] = 0;
        } else {
          camView[0] = cam.target[0];
          camView[1] = cam.target[1];
          camView[2] = cam.target[2];
          camView[3] = cam.distance;
        }
        camView[4] = cam.yaw;
        camView[5] = cam.pitch;

        cam_view_proj(camPtr, modeMap[cam.mode], fovY, aspect, near, far, outPtr);
        out.set(outView);
        return out;
      }
    };

    backend = impl;
    return impl;
  })();
  return backendPromise;
}
