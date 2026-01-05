#pragma once

#include <cstddef>
#include <functional>
#include <vector>

#include "../math/vec3.h"

using ForceAccumulator = std::function<void(std::vector<Vec3>& outForces)>;

inline void velocityVerlet(std::vector<Vec3>& positions,
                           std::vector<Vec3>& velocities,
                           const std::vector<float>& invMass,
                           double dt,
                           ForceAccumulator accumulateForces) {
  if (positions.size() != velocities.size() || positions.size() != invMass.size()) {
    return;
  }

  std::vector<Vec3> forces(positions.size());
  accumulateForces(forces);

  const float dtHalf = static_cast<float>(0.5 * dt);
  const float dtFull = static_cast<float>(dt);

  for (size_t i = 0; i < positions.size(); ++i) {
    if (invMass[i] == 0.0f) {
      continue;
    }
    Vec3 accel = forces[i] * invMass[i];
    velocities[i] += accel * dtHalf;
    positions[i] += velocities[i] * dtFull;
  }

  // Recompute forces at the updated position.
  std::fill(forces.begin(), forces.end(), Vec3{});
  accumulateForces(forces);
  for (size_t i = 0; i < positions.size(); ++i) {
    if (invMass[i] == 0.0f) {
      continue;
    }
    Vec3 accel = forces[i] * invMass[i];
    velocities[i] += accel * dtHalf;
  }
}
