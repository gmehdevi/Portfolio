#include "camera_api.h"

#include <cmath>

namespace {

void lookAt(const float eye[3], const float target[3], const float up[3], float out[16]) {
  float zx = eye[0] - target[0];
  float zy = eye[1] - target[1];
  float zz = eye[2] - target[2];
  float zlen = std::sqrt(zx * zx + zy * zy + zz * zz);
  if (zlen < 1e-6f) {
    zlen = 1e-6f;
  }
  const float zxN = zx / zlen;
  const float zyN = zy / zlen;
  const float zzN = zz / zlen;

  float xx = up[1] * zzN - up[2] * zyN;
  float xy = up[2] * zxN - up[0] * zzN;
  float xz = up[0] * zyN - up[1] * zxN;
  float xlen = std::sqrt(xx * xx + xy * xy + xz * xz);
  if (xlen < 1e-6f) {
    xlen = 1e-6f;
  }
  const float xxN = xx / xlen;
  const float xyN = xy / xlen;
  const float xzN = xz / xlen;

  const float yx = zyN * xzN - zzN * xyN;
  const float yy = zzN * xxN - zxN * xzN;
  const float yz = zxN * xyN - zyN * xxN;

  out[0] = xxN;
  out[1] = yx;
  out[2] = zxN;
  out[3] = 0.0f;

  out[4] = xyN;
  out[5] = yy;
  out[6] = zyN;
  out[7] = 0.0f;

  out[8] = xzN;
  out[9] = yz;
  out[10] = zzN;
  out[11] = 0.0f;

  out[12] = -(xxN * eye[0] + xyN * eye[1] + xzN * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zxN * eye[0] + zyN * eye[1] + zzN * eye[2]);
  out[15] = 1.0f;
}

void perspective(float fovY, float aspect, float nearPlane, float farPlane, float out[16]) {
  const float f = 1.0f / std::tan(fovY * 0.5f);
  const float nf = 1.0f / (nearPlane - farPlane);

  out[0] = f / aspect;
  out[1] = 0.0f;
  out[2] = 0.0f;
  out[3] = 0.0f;

  out[4] = 0.0f;
  out[5] = f;
  out[6] = 0.0f;
  out[7] = 0.0f;

  out[8] = 0.0f;
  out[9] = 0.0f;
  out[10] = (farPlane + nearPlane) * nf;
  out[11] = -1.0f;

  out[12] = 0.0f;
  out[13] = 0.0f;
  out[14] = 2.0f * farPlane * nearPlane * nf;
  out[15] = 0.0f;
}

void mulMat4(const float a[16], const float b[16], float out[16]) {
  for (int col = 0; col < 4; ++col) {
    for (int row = 0; row < 4; ++row) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
}

}  // namespace

void cam_view_proj(const float* cam_state,
                   int cam_mode,
                   float fov_y,
                   float aspect,
                   float near_plane,
                   float far_plane,
                   float* out16) {
  if (!cam_state || !out16) {
    return;
  }

  const float x = cam_state[0];
  const float y = cam_state[1];
  const float z = cam_state[2];
  const float distance = cam_state[3];
  const float yaw = cam_state[4];
  const float pitch = cam_state[5];

  float eye[3];
  float target[3];

  if (cam_mode == CAMERA_FLY) {
    eye[0] = x;
    eye[1] = y;
    eye[2] = z;
    const float fx = std::cos(yaw) * std::cos(pitch);
    const float fy = std::sin(pitch);
    const float fz = std::sin(yaw) * std::cos(pitch);
    target[0] = eye[0] + fx;
    target[1] = eye[1] + fy;
    target[2] = eye[2] + fz;
  } else {
    const float cx = std::cos(yaw) * std::cos(pitch);
    const float cy = std::sin(pitch);
    const float cz = std::sin(yaw) * std::cos(pitch);
    target[0] = x;
    target[1] = y;
    target[2] = z;
    eye[0] = target[0] + distance * cx;
    eye[1] = target[1] + distance * cy;
    eye[2] = target[2] + distance * cz;
  }

  float view[16];
  float proj[16];
  float up[3] = {0.0f, 1.0f, 0.0f};
  lookAt(eye, target, up, view);
  perspective(fov_y, aspect, near_plane, far_plane, proj);
  mulMat4(proj, view, out16);
}
