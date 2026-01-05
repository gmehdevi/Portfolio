export type OrbitCamera = {
  mode: 'orbit';
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

export type CameraState = OrbitCamera | FlyCamera;

export function makeOrbitCamera(): OrbitCamera {
  return { mode: 'orbit', target: [0, 0, 0], distance: 5, yaw: 0, pitch: -0.2 };
}

export function makeFlyCamera(): FlyCamera {
  return { mode: 'fly', position: [0, 0, 5], yaw: 0, pitch: 0 };
}

export function viewMatrix(cam: CameraState): Float32Array {
  let eye: [number, number, number];
  let target: [number, number, number];

  if (cam.mode === 'orbit') {
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
  return lookAt(eye, target, [0, 1, 0]);
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
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

function lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]) {
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

  return new Float32Array([
    xxN, yx, zxN, 0,
    xyN, yy, zyN, 0,
    xzN, yz, zzN, 0,
    -(xxN * eye[0] + xyN * eye[1] + xzN * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zxN * eye[0] + zyN * eye[1] + zzN * eye[2]),
    1
  ]);
}
