#include "sim_pendulum3d.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "../core/simulation_base.h"
#include "../core/types.h"
#include "../integrators/integrator_iface.h"
#include "../math/vec3.h"

namespace {

Vec3 cross(const Vec3& a, const Vec3& b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}

struct PendulumConfig {
  int particleCount = 8;
  float initialTheta = 0.0f;
  float initialPhi = 0.4f;
};

struct PendulumParams {
  float stiffness = 30.0f;
  float damping = 0.2f;
  float gravity = 9.81f;
  float restLength = 0.5f;
};

class Pendulum3D : public SimulationBase {
public:
  Pendulum3D() : SimulationBase(INTEGRATOR_VELOCITY_VERLET) {}

  void init(const void* config, int configSize) override {
    PendulumConfig cfg{};
    if (config && configSize >= static_cast<int>(sizeof(PendulumConfig))) {
      std::memcpy(&cfg, config, sizeof(PendulumConfig));
    }
    cfg.particleCount = clampMinInt(cfg.particleCount, 2);
    m_initialTheta = cfg.initialTheta;
    m_initialPhi = cfg.initialPhi;
    m_sphereRadius = std::max(0.05f, m_params.restLength * 0.3f);
    m_springAmplitude = std::max(0.02f, m_params.restLength * 0.2f);

    resize(static_cast<size_t>(cfg.particleCount));
    resetState();
  }

  void stepSubstep(double dt, IntegratorId integrator) override {
    const auto accumulate = [this](const std::vector<Vec3>& positions,
                                   const std::vector<Vec3>& velocities,
                                   std::vector<Vec3>& outForces) {
      accumulateForces(positions, velocities, outForces);
    };
    if (!applyIntegrator(integrator, m_positionsVec, m_velocitiesVec, m_invMass, dt, m_integratorWorkspace, accumulate)) {
      applyIntegrator(INTEGRATOR_VELOCITY_VERLET, m_positionsVec, m_velocitiesVec, m_invMass, dt, m_integratorWorkspace, accumulate);
    }
  }

  void postStep() override {
    updateFlatBuffers();
  }

  bool supportsIntegratorImpl(IntegratorId integrator) const override {
    return integratorAvailable(integrator);
  }

  float* getBuffer(int bufferId) override {
    switch (bufferId) {
      case BUFFER_POSITIONS:
        return m_positions.data();
      case BUFFER_VELOCITIES:
        return m_velocities.data();
      case BUFFER_NORMALS:
        return m_normals.data();
      case BUFFER_SPRING_POSITIONS:
        return m_springPositions.data();
      case BUFFER_RENDER_PACKET:
        return reinterpret_cast<float*>(m_renderPacket.data());
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
      case BUFFER_SPRING_POSITIONS:
        return static_cast<int>(m_springPositions.size());
      case BUFFER_RENDER_PACKET:
        return static_cast<int>(m_renderPacket.size());
      default:
        return 0;
    }
  }

  void setParams(const void* params, int size) override {
    constexpr int kParamCount = 4;
    if (!params || size < static_cast<int>(sizeof(float) * kParamCount)) {
      return;
    }
    const float* values = static_cast<const float*>(params);
    m_params.stiffness = clampNonNegative(values[0]);
    m_params.damping = clampNonNegative(values[1]);
    m_params.gravity = clampNonNegative(values[2]);
    m_params.restLength = clampMinFloat(values[3], 0.001f);
    m_sphereRadius = std::max(0.05f, m_params.restLength * 0.3f);
    m_springAmplitude = std::max(0.02f, m_params.restLength * 0.2f);
    if (size >= static_cast<int>(sizeof(float) * (kParamCount + 1))) {
      const int integrator = static_cast<int>(values[4]);
      setIntegrator(static_cast<IntegratorId>(integrator));
    }
    buildRenderPacket();
    updateSpringPositions();
  }

  EnergyMetrics computeEnergy() const override {
    EnergyMetrics energy{};
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      if (m_invMass[i] == 0.0f) {
        continue;
      }
      float mass = 1.0f / m_invMass[i];
      float v2 = dot(m_velocitiesVec[i], m_velocitiesVec[i]);
      energy.kinetic += 0.5 * mass * static_cast<double>(v2);
      double height = static_cast<double>(m_positionsVec[i].y);  // y up
      energy.potential += mass * m_params.gravity * height;
    }
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      const Vec3 p0 = (i == 0) ? m_anchor : m_positionsVec[i - 1];
      const Vec3 p1 = m_positionsVec[i];
      Vec3 delta = p1 - p0;
      float len = length(delta);
      float stretch = len - m_params.restLength;
      energy.spring += 0.5 * static_cast<double>(m_params.stiffness) * static_cast<double>(stretch * stretch);
    }
    return energy;
  }

  double computeConstraintRms() const override {
    double accumSq = 0.0;
    int constraints = 0;
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      const Vec3 p0 = (i == 0) ? m_anchor : m_positionsVec[i - 1];
      const Vec3 p1 = m_positionsVec[i];
      float len = length(p1 - p0);
      float stretch = len - m_params.restLength;
      accumSq += static_cast<double>(stretch * stretch);
      ++constraints;
    }
    if (constraints <= 0) {
      return 0.0;
    }
    return std::sqrt(accumSq / constraints);
  }

private:
  void resize(size_t count) {
    m_positionsVec.assign(count, Vec3{});
    m_velocitiesVec.assign(count, Vec3{});
    m_invMass.assign(count, 1.0f);
    m_integratorWorkspace.resize(count);

    m_positions.resize(count * 3, 0.0f);
    m_velocities.resize(count * 3, 0.0f);
    m_normals.resize(count * 3, 0.0f);
    resizeSpringBuffer(count);

    buildRenderPacket();
  }

  void resetState() {
    const float sinPhi = std::sin(m_initialPhi);
    const float cosPhi = std::cos(m_initialPhi);
    const float cosTheta = std::cos(m_initialTheta);
    const float sinTheta = std::sin(m_initialTheta);
    const Vec3 dir{
      sinPhi * cosTheta,
      -cosPhi,
      sinPhi * sinTheta
    };
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      const float dist = m_params.restLength * static_cast<float>(i + 1);
      m_positionsVec[i] = {dir.x * dist, dir.y * dist, dir.z * dist};
      m_velocitiesVec[i] = Vec3{};
    }
    updateFlatBuffers();
    m_diagnostics = Diagnostics{};
  }

  void accumulateForces(const std::vector<Vec3>& positions,
                        const std::vector<Vec3>& velocities,
                        std::vector<Vec3>& outForces) {
    if (outForces.size() != positions.size()) {
      outForces.resize(positions.size(), Vec3{});
    }

    // Gravity.
    for (size_t i = 0; i < positions.size(); ++i) {
      if (m_invMass[i] == 0.0f) {
        continue;
      }
      outForces[i].y -= m_params.gravity / m_invMass[i];
    }

    // Springs between anchor and first particle, plus consecutive particles.
    for (size_t i = 0; i < positions.size(); ++i) {
      const Vec3 p0 = (i == 0) ? m_anchor : positions[i - 1];
      const Vec3 v0 = (i == 0) ? Vec3{} : velocities[i - 1];
      const Vec3 p1 = positions[i];
      const Vec3 v1 = velocities[i];
      Vec3 delta = p1 - p0;
      float len = length(delta);
      if (len < 1e-6f) {
        continue;
      }
      Vec3 dir = delta / len;
      float stretch = len - m_params.restLength;
      Vec3 force = dir * (-m_params.stiffness * stretch);

      // Damping along the link.
      Vec3 relVel = v1 - v0;
      float rel = dot(relVel, dir);
      force += dir * (-m_params.damping * rel);

      outForces[i] += force;
      if (i > 0) {
        outForces[i - 1] -= force;
      }
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
    updateSpringPositions();
  }

  void resizeSpringBuffer(size_t count) {
    const size_t links = count;
    const size_t pointCount = links > 0 ? 1 + links * static_cast<size_t>(m_springZigs + 1) : count;
    m_springPointCount = pointCount;
    m_springPositions.assign(pointCount * 3, 0.0f);
  }

  void updateSpringPositions() {
    if (m_positionsVec.empty() || m_springPositions.empty()) {
      return;
    }
    size_t write = 0;
    auto push = [&](const Vec3& p) {
      if (write + 2 >= m_springPositions.size()) {
        return;
      }
      m_springPositions[write++] = p.x;
      m_springPositions[write++] = p.y;
      m_springPositions[write++] = p.z;
    };
    push(m_anchor);
    for (size_t i = 0; i < m_positionsVec.size(); ++i) {
      const Vec3 p0 = (i == 0) ? m_anchor : m_positionsVec[i - 1];
      const Vec3 p1 = m_positionsVec[i];
      const Vec3 delta = p1 - p0;
      const float len = length(delta);
      Vec3 dir = len > 1e-6f ? delta / len : Vec3{0.0f, -1.0f, 0.0f};
      Vec3 ref = std::fabs(dir.y) > 0.9f ? Vec3{1.0f, 0.0f, 0.0f} : Vec3{0.0f, 1.0f, 0.0f};
      Vec3 side = normalize(cross(dir, ref));
      if (length(side) < 1e-6f) {
        side = Vec3{1.0f, 0.0f, 0.0f};
      }
      const float step = len / static_cast<float>(m_springZigs + 1);
      for (int k = 1; k <= m_springZigs; ++k) {
        const float t = static_cast<float>(k);
        const float sign = (k % 2 == 0) ? 1.0f : -1.0f;
        const Vec3 base = p0 + dir * (step * t);
        push(base + side * (m_springAmplitude * sign));
      }
      push(p1);
    }
  }

  void buildRenderPacket() {
    constexpr uint32_t kMagic = 0x52504b54;
    constexpr uint32_t kVersion = 2;
    constexpr uint32_t kStride = 4;
    constexpr uint32_t kCmdLines = 0;
    constexpr uint32_t kCmdSpheres = 1;
    const uint32_t count = static_cast<uint32_t>(m_springPointCount);
    const uint32_t sphereCount = static_cast<uint32_t>(m_positionsVec.size());

    m_renderPacket.resize(4 + 8);
    m_renderPacket[0] = kMagic;
    m_renderPacket[1] = kVersion;
    m_renderPacket[2] = 2;
    m_renderPacket[3] = kStride;

    m_renderPacket[4] = kCmdLines;
    m_renderPacket[5] = BUFFER_SPRING_POSITIONS;
    m_renderPacket[6] = count;
    m_renderPacket[7] = 0;

    m_renderPacket[8] = kCmdSpheres;
    m_renderPacket[9] = BUFFER_POSITIONS;
    m_renderPacket[10] = sphereCount;
    m_renderPacket[11] = packFloat(m_sphereRadius);
  }

  static uint32_t packFloat(float value) {
    uint32_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    return bits;
  }

  PendulumParams m_params{};
  Vec3 m_anchor{0.0f, 0.0f, 0.0f};
  float m_initialTheta = 0.0f;
  float m_initialPhi = 0.4f;

  std::vector<Vec3> m_positionsVec;
  std::vector<Vec3> m_velocitiesVec;
  std::vector<float> m_invMass;

  std::vector<float> m_positions;
  std::vector<float> m_velocities;
  std::vector<float> m_normals;
  std::vector<float> m_springPositions;
  size_t m_springPointCount = 0;
  std::vector<uint32_t> m_renderPacket;
  float m_sphereRadius = 0.15f;
  int m_springZigs = 6;
  float m_springAmplitude = 0.1f;
  IntegratorWorkspace m_integratorWorkspace;
};

}  // namespace

std::unique_ptr<Simulation> createPendulum3D() {
  return std::make_unique<Pendulum3D>();
}
