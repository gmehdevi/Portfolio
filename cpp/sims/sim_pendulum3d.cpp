#include "sim_pendulum3d.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <vector>

#include "../core/types.h"
#include "../integrators/integrator_iface.h"
#include "../math/vec3.h"

namespace {

struct PendulumConfig {
  int particleCount = 8;
  float restLength = 0.5f;
  float mass = 1.0f;
  float stiffness = 30.0f;
  float damping = 0.2f;
  float gravity = 9.81f;
};

struct PendulumParams {
  float stiffness = 30.0f;
  float damping = 0.2f;
  float gravity = 9.81f;
  float restLength = 0.5f;
};

class Pendulum3D : public Simulation {
public:
  void init(const void* config, int configSize) override {
    PendulumConfig cfg{};
    if (config && configSize >= static_cast<int>(sizeof(PendulumConfig))) {
      std::memcpy(&cfg, config, sizeof(PendulumConfig));
    }
    cfg.particleCount = std::max(2, cfg.particleCount);
    cfg.mass = std::max(0.001f, cfg.mass);
    cfg.restLength = std::max(0.001f, cfg.restLength);
    cfg.stiffness = std::max(0.0f, cfg.stiffness);
    cfg.damping = std::max(0.0f, cfg.damping);
    cfg.gravity = std::max(0.0f, cfg.gravity);

    m_params.stiffness = cfg.stiffness;
    m_params.damping = cfg.damping;
    m_params.gravity = cfg.gravity;
    m_params.restLength = cfg.restLength;
    m_mass = cfg.mass;

    resize(static_cast<size_t>(cfg.particleCount));
    resetState();
  }

  void step(double dt, int substeps) override {
    const int steps = std::max(1, substeps);
    const double dtSub = dt / static_cast<double>(steps);

    auto start = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < steps; ++i) {
      velocityVerlet(m_positionsVec, m_velocitiesVec, m_invMass, dtSub,
                     [this](std::vector<Vec3>& outForces) { accumulateForces(outForces); });
      // Re-pin the anchor after integration.
      m_positionsVec[0] = m_anchor;
      m_velocitiesVec[0] = Vec3{};
    }
    auto end = std::chrono::high_resolution_clock::now();

    updateFlatBuffers();
    m_diagnostics = computeDiagnostics(steps,
                                       std::chrono::duration<double, std::milli>(end - start).count());
  }

  float* getBuffer(int bufferId) override {
    switch (bufferId) {
      case BUFFER_POSITIONS:
        return m_positions.data();
      case BUFFER_VELOCITIES:
        return m_velocities.data();
      case BUFFER_NORMALS:
        return m_normals.data();
      case BUFFER_INDICES:
        return m_indices.data();
      default:
        return nullptr;
    }
  }

  int getBufferSize(int bufferId) const override {
    switch (bufferId) {
      case BUFFER_POSITIONS:
        return static_cast<int>(m_positions.size());
      case BUFFER_VELOCITIES:
        return static_cast<int>(m_velocities.size());
      case BUFFER_NORMALS:
        return static_cast<int>(m_normals.size());
      case BUFFER_INDICES:
        return static_cast<int>(m_indices.size());
      default:
        return 0;
    }
  }

  void setParams(const void* params, int size) override {
    if (!params || size < static_cast<int>(sizeof(PendulumParams))) {
      return;
    }
    PendulumParams p{};
    std::memcpy(&p, params, sizeof(PendulumParams));
    m_params.stiffness = std::max(0.0f, p.stiffness);
    m_params.damping = std::max(0.0f, p.damping);
    m_params.gravity = std::max(0.0f, p.gravity);
    m_params.restLength = std::max(0.001f, p.restLength);
  }

  Diagnostics getDiagnostics() const override {
    return m_diagnostics;
  }

private:
  void resize(size_t count) {
    m_positionsVec.assign(count, Vec3{});
    m_velocitiesVec.assign(count, Vec3{});
    m_invMass.assign(count, 1.0f / m_mass);

    // Anchor at index 0 is pinned.
    m_invMass[0] = 0.0f;

    m_positions.resize(count * 3, 0.0f);
    m_velocities.resize(count * 3, 0.0f);
    m_normals.resize(count * 3, 0.0f);

    m_indices.clear();
    m_indices.reserve((count - 1) * 2);
    for (size_t i = 1; i < count; ++i) {
      m_indices.push_back(static_cast<float>(i - 1));
      m_indices.push_back(static_cast<float>(i));
    }
  }

  void resetState() {
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      m_positionsVec[i] = {0.0f, -m_params.restLength * static_cast<float>(i), 0.0f};
      m_velocitiesVec[i] = Vec3{};
    }
    updateFlatBuffers();
    m_diagnostics = Diagnostics{};
  }

  void accumulateForces(std::vector<Vec3>& outForces) {
    if (outForces.size() != m_positionsVec.size()) {
      outForces.resize(m_positionsVec.size(), Vec3{});
    }

    // Gravity.
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      if (m_invMass[i] == 0.0f) {
        continue;
      }
      outForces[i].y -= m_params.gravity / m_invMass[i];
    }

    // Springs between consecutive particles.
    for (size_t i = 1; i < m_positionsVec.size(); ++i) {
      Vec3 delta = m_positionsVec[i] - m_positionsVec[i - 1];
      float len = length(delta);
      if (len < 1e-6f) {
        continue;
      }
      Vec3 dir = delta / len;
      float stretch = len - m_params.restLength;
      Vec3 force = dir * (-m_params.stiffness * stretch);

      // Damping along the link.
      Vec3 relVel = m_velocitiesVec[i] - m_velocitiesVec[i - 1];
      float rel = dot(relVel, dir);
      force += dir * (-m_params.damping * rel);

      outForces[i] += force;
      outForces[i - 1] -= force;
    }
  }

  void updateFlatBuffers() {
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      const size_t idx = i * 3;
      m_positions[idx] = m_positionsVec[i].x;
      m_positions[idx + 1] = m_positionsVec[i].y;
      m_positions[idx + 2] = m_positionsVec[i].z;

      m_velocities[idx] = m_velocitiesVec[i].x;
      m_velocities[idx + 1] = m_velocitiesVec[i].y;
      m_velocities[idx + 2] = m_velocitiesVec[i].z;
    }

    // Simple normals: copy tangents to hint rendering direction. Normals are zeroed for now.
    std::fill(m_normals.begin(), m_normals.end(), 0.0f);
  }

  Diagnostics computeDiagnostics(int substeps, double stepTimeMs) const {
    Diagnostics d{};
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      if (m_invMass[i] == 0.0f) {
        continue;
      }
      float mass = 1.0f / m_invMass[i];
      float v2 = dot(m_velocitiesVec[i], m_velocitiesVec[i]);
      d.kineticEnergy += 0.5 * mass * static_cast<double>(v2);
      double height = static_cast<double>(-m_positionsVec[i].y);  // y down
      d.potentialEnergy += mass * m_params.gravity * height;
    }

    double accumSq = 0.0;
    int constraints = 0;
    for (size_t i = 1; i < m_positionsVec.size(); ++i) {
      float len = length(m_positionsVec[i] - m_positionsVec[i - 1]);
      float stretch = len - m_params.restLength;
      accumSq += static_cast<double>(stretch * stretch);
      ++constraints;
    }
    if (constraints > 0) {
      d.constraintRms = std::sqrt(accumSq / constraints);
    }

    d.totalEnergy = d.kineticEnergy + d.potentialEnergy;
    d.solverIterations = substeps;
    d.stepTimeMs = stepTimeMs;
    return d;
  }

  PendulumParams m_params{};
  float m_mass = 1.0f;
  Vec3 m_anchor{0.0f, 0.0f, 0.0f};

  std::vector<Vec3> m_positionsVec;
  std::vector<Vec3> m_velocitiesVec;
  std::vector<float> m_invMass;

  std::vector<float> m_positions;
  std::vector<float> m_velocities;
  std::vector<float> m_normals;
  std::vector<float> m_indices;

  Diagnostics m_diagnostics{};
};

}  // namespace

std::unique_ptr<Simulation> createPendulum3D() {
  return std::make_unique<Pendulum3D>();
}
