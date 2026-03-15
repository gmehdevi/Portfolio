import type { CameraMode } from './types';

export type OrbitCamera = {
  mode: 'orbit';
  target: [number, number, number];
  distance: number;
  yaw: number;
  pitch: number;
};

export type TrackCamera = {
  mode: 'track';
  target: [number, number, number];
  distance: number;
  yaw: number;
  pitch: number;
};

export type FlyCamera = {
  mode: 'fly';
  position: [number, number, number];
  yaw: number;
  pitch: number;
};

export type CameraState = OrbitCamera | TrackCamera | FlyCamera;

export function makeOrbitCamera(): OrbitCamera {
  return { mode: 'orbit', target: [0, 0, 0], distance: 5, yaw: 0, pitch: -0.2 };
}

export function makeTrackCamera(): TrackCamera {
  return { mode: 'track', target: [0, 0, 0], distance: 5, yaw: 0, pitch: -0.2 };
}

export function makeFlyCamera(): FlyCamera {
  return { mode: 'fly', position: [0, 0, 5], yaw: 0, pitch: 0 };
}

export function makeCameraForMode(mode: CameraMode): CameraState {
  if (mode === 'fly') {
    return makeFlyCamera();
  }
  if (mode === 'track') {
    return makeTrackCamera();
  }
  return makeOrbitCamera();
}

export function viewMatrix(cam: CameraState): Float32Array {
  const out = new Float32Array(16);
  return viewMatrixInto(out, cam);
}

export function viewMatrixInto(out: Float32Array, cam: CameraState): Float32Array {
  let eye: [number, number, number];
  let target: [number, number, number];

  if (cam.mode === 'orbit' || cam.mode === 'track') {
    const cx = Math.cos(cam.yaw) * Math.cos(cam.pitch);
    const cy = Math.sin(cam.pitch);
    const cz = Math.sin(cam.yaw) * Math.cos(cam.pitch);
    eye = [
      cam.target[0] + cam.distance * cx,
      cam.target[1] + cam.distance * cy,
      cam.target[2] + cam.distance * cz
    ];
    target = cam.target;
  } else {
    eye = cam.position;
    const dir = forward(cam);
    target = [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]];
  }
  return lookAtInto(out, eye, target, [0, 1, 0]);
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const out = new Float32Array(16);
  return perspectiveInto(out, fovY, aspect, near, far);
}

export function perspectiveInto(out: Float32Array, fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = 2 * far * near * nf;
  out[15] = 0;
  return out;
}

export function forward(cam: CameraState): [number, number, number] {
  const fx = Math.cos(cam.yaw) * Math.cos(cam.pitch);
  const fy = Math.sin(cam.pitch);
  const fz = Math.sin(cam.yaw) * Math.cos(cam.pitch);
  return [fx, fy, fz];
}

export function right(cam: CameraState): [number, number, number] {
  const f = forward(cam);
  const up: [number, number, number] = [0, 1, 0];
  const rx = f[1] * up[2] - f[2] * up[1];
  const ry = f[2] * up[0] - f[0] * up[2];
  const rz = f[0] * up[1] - f[1] * up[0];
  const len = Math.hypot(rx, ry, rz) || 1e-6;
  return [rx / len, ry / len, rz / len];
}

// Column-major matrix multiply (OpenGL style): out = a * b
export function mulMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  return mulMat4Into(out, a, b);
}

export function mulMat4Into(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function lookAtInto(out: Float32Array, eye: [number, number, number], target: [number, number, number], up: [number, number, number]) {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  const zlen = Math.hypot(zx, zy, zz) || 1e-6;
  const zxN = zx / zlen;
  const zyN = zy / zlen;
  const zzN = zz / zlen;

  const xx = up[1] * zzN - up[2] * zyN;
  const xy = up[2] * zxN - up[0] * zzN;
  const xz = up[0] * zyN - up[1] * zxN;
  const xlen = Math.hypot(xx, xy, xz) || 1e-6;
  const xxN = xx / xlen;
  const xyN = xy / xlen;
  const xzN = xz / xlen;

  const yx = zyN * xzN - zzN * xyN;
  const yy = zzN * xxN - zxN * xzN;
  const yz = zxN * xyN - zyN * xxN;

  out[0] = xxN;
  out[1] = yx;
  out[2] = zxN;
  out[3] = 0;
  out[4] = xyN;
  out[5] = yy;
  out[6] = zyN;
  out[7] = 0;
  out[8] = xzN;
  out[9] = yz;
  out[10] = zzN;
  out[11] = 0;
  out[12] = -(xxN * eye[0] + xyN * eye[1] + xzN * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zxN * eye[0] + zyN * eye[1] + zzN * eye[2]);
  out[15] = 1;
  return out;
}
