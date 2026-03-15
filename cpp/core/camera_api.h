#pragma once

#ifdef __cplusplus
extern "C" {
#endif

enum CameraMode : int {
  CAMERA_ORBIT = 0,
  CAMERA_FLY = 1,
  CAMERA_TRACK = 2
};

// cam_state layout: [x, y, z, distance, yaw, pitch]
// orbit/track: x,y,z = target, distance used
// fly: x,y,z = position, distance ignored
void cam_view_proj(const float* cam_state,
                   int cam_mode,
                   float fov_y,
                   float aspect,
                   float near_plane,
                   float far_plane,
                   float* out16);

#ifdef __cplusplus
}
#endif
