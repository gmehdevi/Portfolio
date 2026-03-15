#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <functional>
#include <vector>

#include "../core/types.h"
#include "../math/vec3.h"

using ForceAccumulator = std::function<void(const std::vector<Vec3>& positions,
                                            const std::vector<Vec3>& velocities,
                                            std::vector<Vec3>& outForces)>;

struct IntegratorWorkspace {
  std::vector<Vec3> forces;
  std::vector<Vec3> k1x;
  std::vector<Vec3> k2x;
  std::vector<Vec3> k3x;
  std::vector<Vec3> k4x;
  std::vector<Vec3> k1v;
  std::vector<Vec3> k2v;
  std::vector<Vec3> k3v;
  std::vector<Vec3> k4v;
  std::vector<Vec3> tmpPos;
  std::vector<Vec3> tmpVel;

  void resize(size_t count) {
    if (forces.size() != count) forces.assign(count, Vec3{});
    if (k1x.size() != count) k1x.assign(count, Vec3{});
    if (k2x.size() != count) k2x.assign(count, Vec3{});
    if (k3x.size() != count) k3x.assign(count, Vec3{});
    if (k4x.size() != count) k4x.assign(count, Vec3{});
    if (k1v.size() != count) k1v.assign(count, Vec3{});
    if (k2v.size() != count) k2v.assign(count, Vec3{});
    if (k3v.size() != count) k3v.assign(count, Vec3{});
    if (k4v.size() != count) k4v.assign(count, Vec3{});
    if (tmpPos.size() != count) tmpPos.assign(count, Vec3{});
    if (tmpVel.size() != count) tmpVel.assign(count, Vec3{});
  }
};

inline void symplecticEuler(std::vector<Vec3>& positions,
                            std::vector<Vec3>& velocities,
                            const std::vector<float>& invMass,
                            double dt,
                            std::vector<Vec3>& forces,
                            ForceAccumulator accumulateForces) {
  if (positions.size() != velocities.size() || positions.size() != invMass.size()) {
    return;
  }

  if (forces.size() != positions.size()) {
    forces.assign(positions.size(), Vec3{});
  } else {
    std::fill(forces.begin(), forces.end(), Vec3{});
  }
  accumulateForces(positions, velocities, forces);

  const float dtFull = static_cast<float>(dt);
  for (size_t i = 0; i < positions.size(); ++i) {
    if (invMass[i] == 0.0f) {
      continue;
    }
    Vec3 accel = forces[i] * invMass[i];
    velocities[i] += accel * dtFull;
    positions[i] += velocities[i] * dtFull;
  }
}

inline void velocityVerlet(std::vector<Vec3>& positions,
                           std::vector<Vec3>& velocities,
                           const std::vector<float>& invMass,
                           double dt,
                           std::vector<Vec3>& forces,
                           ForceAccumulator accumulateForces) {
  if (positions.size() != velocities.size() || positions.size() != invMass.size()) {
    return;
  }

  if (forces.size() != positions.size()) {
    forces.assign(positions.size(), Vec3{});
  } else {
    std::fill(forces.begin(), forces.end(), Vec3{});
  }
  accumulateForces(positions, velocities, forces);

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
  accumulateForces(positions, velocities, forces);
  for (size_t i = 0; i < positions.size(); ++i) {
    if (invMass[i] == 0.0f) {
      continue;
    }
    Vec3 accel = forces[i] * invMass[i];
    velocities[i] += accel * dtHalf;
  }
}

inline void rk4(std::vector<Vec3>& positions,
                std::vector<Vec3>& velocities,
                const std::vector<float>& invMass,
                double dt,
                IntegratorWorkspace& workspace,
                ForceAccumulator accumulateForces) {
  if (positions.size() != velocities.size() || positions.size() != invMass.size()) {
    return;
  }

  const size_t count = positions.size();
  if (count == 0) {
    return;
  }

  workspace.resize(count);
  auto& forces = workspace.forces;
  auto& k1x = workspace.k1x;
  auto& k2x = workspace.k2x;
  auto& k3x = workspace.k3x;
  auto& k4x = workspace.k4x;
  auto& k1v = workspace.k1v;
  auto& k2v = workspace.k2v;
  auto& k3v = workspace.k3v;
  auto& k4v = workspace.k4v;
  auto& tmpPos = workspace.tmpPos;
  auto& tmpVel = workspace.tmpVel;

  const float dtFull = static_cast<float>(dt);
  const float dtHalf = dtFull * 0.5f;
  const float dtSixth = dtFull / 6.0f;

  std::fill(forces.begin(), forces.end(), Vec3{});
  accumulateForces(positions, velocities, forces);
  for (size_t i = 0; i < count; ++i) {
    if (invMass[i] == 0.0f) {
      k1x[i] = Vec3{};
      k1v[i] = Vec3{};
      tmpPos[i] = positions[i];
      tmpVel[i] = Vec3{};
      continue;
    }
    const Vec3 accel = forces[i] * invMass[i];
    k1x[i] = velocities[i];
    k1v[i] = accel;
    tmpPos[i] = positions[i] + k1x[i] * dtHalf;
    tmpVel[i] = velocities[i] + k1v[i] * dtHalf;
  }

  std::fill(forces.begin(), forces.end(), Vec3{});
  accumulateForces(tmpPos, tmpVel, forces);
  for (size_t i = 0; i < count; ++i) {
    if (invMass[i] == 0.0f) {
      k2x[i] = Vec3{};
      k2v[i] = Vec3{};
      tmpPos[i] = positions[i];
      tmpVel[i] = Vec3{};
      continue;
    }
    const Vec3 accel = forces[i] * invMass[i];
    k2x[i] = tmpVel[i];
    k2v[i] = accel;
    tmpPos[i] = positions[i] + k2x[i] * dtHalf;
    tmpVel[i] = velocities[i] + k2v[i] * dtHalf;
  }

  std::fill(forces.begin(), forces.end(), Vec3{});
  accumulateForces(tmpPos, tmpVel, forces);
  for (size_t i = 0; i < count; ++i) {
    if (invMass[i] == 0.0f) {
      k3x[i] = Vec3{};
      k3v[i] = Vec3{};
      tmpPos[i] = positions[i];
      tmpVel[i] = Vec3{};
      continue;
    }
    const Vec3 accel = forces[i] * invMass[i];
    k3x[i] = tmpVel[i];
    k3v[i] = accel;
    tmpPos[i] = positions[i] + k3x[i] * dtFull;
    tmpVel[i] = velocities[i] + k3v[i] * dtFull;
  }

  std::fill(forces.begin(), forces.end(), Vec3{});
  accumulateForces(tmpPos, tmpVel, forces);
  for (size_t i = 0; i < count; ++i) {
    if (invMass[i] == 0.0f) {
      k4x[i] = Vec3{};
      k4v[i] = Vec3{};
      velocities[i] = Vec3{};
      continue;
    }
    const Vec3 accel = forces[i] * invMass[i];
    k4x[i] = tmpVel[i];
    k4v[i] = accel;

    positions[i] += (k1x[i] + (k2x[i] + k3x[i]) * 2.0f + k4x[i]) * dtSixth;
    velocities[i] += (k1v[i] + (k2v[i] + k3v[i]) * 2.0f + k4v[i]) * dtSixth;
  }
}

using IntegratorFn = void(*)(std::vector<Vec3>& positions,
                             std::vector<Vec3>& velocities,
                             const std::vector<float>& invMass,
                             double dt,
                             IntegratorWorkspace& workspace,
                             ForceAccumulator accumulateForces);

inline void integratorVelocityVerlet(std::vector<Vec3>& positions,
                                     std::vector<Vec3>& velocities,
                                     const std::vector<float>& invMass,
                                     double dt,
                                     IntegratorWorkspace& workspace,
                                     ForceAccumulator accumulateForces) {
  velocityVerlet(positions, velocities, invMass, dt, workspace.forces, accumulateForces);
}

inline void integratorSymplecticEuler(std::vector<Vec3>& positions,
                                      std::vector<Vec3>& velocities,
                                      const std::vector<float>& invMass,
                                      double dt,
                                      IntegratorWorkspace& workspace,
                                      ForceAccumulator accumulateForces) {
  symplecticEuler(positions, velocities, invMass, dt, workspace.forces, accumulateForces);
}

inline void integratorRk4(std::vector<Vec3>& positions,
                          std::vector<Vec3>& velocities,
                          const std::vector<float>& invMass,
                          double dt,
                          IntegratorWorkspace& workspace,
                          ForceAccumulator accumulateForces) {
  rk4(positions, velocities, invMass, dt, workspace, accumulateForces);
}

struct IntegratorEntry {
  IntegratorId id;
  const char* name;
  IntegratorFn fn;
};

inline const std::array<IntegratorEntry, INTEGRATOR_COUNT>& integratorRegistry() {
  static const std::array<IntegratorEntry, INTEGRATOR_COUNT> kRegistry = {{
    {INTEGRATOR_VELOCITY_VERLET, "Velocity Verlet", integratorVelocityVerlet},
    {INTEGRATOR_SYMPLECTIC_EULER, "Symplectic Euler", integratorSymplecticEuler},
    {INTEGRATOR_RK4, "RK4", integratorRk4},
    {INTEGRATOR_IMPLICIT_MIDPOINT, "Implicit Midpoint", nullptr}
  }};
  return kRegistry;
}

inline const IntegratorEntry* findIntegrator(IntegratorId id) {
  const auto& registry = integratorRegistry();
  for (const auto& entry : registry) {
    if (entry.id == id) {
      return &entry;
    }
  }
  return nullptr;
}

inline bool integratorAvailable(IntegratorId id) {
  const auto* entry = findIntegrator(id);
  return entry && entry->fn;
}

inline bool applyIntegrator(IntegratorId id,
                            std::vector<Vec3>& positions,
                            std::vector<Vec3>& velocities,
                            const std::vector<float>& invMass,
                            double dt,
                            IntegratorWorkspace& workspace,
                            ForceAccumulator accumulateForces) {
  const auto* entry = findIntegrator(id);
  if (!entry || !entry->fn) {
    return false;
  }
  entry->fn(positions, velocities, invMass, dt, workspace, accumulateForces);
  return true;
}
