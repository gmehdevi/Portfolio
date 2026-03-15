#pragma once

#include <algorithm>
#include <chrono>

#include "simulation.h"

class SimulationBase : public Simulation {
public:
  explicit SimulationBase(IntegratorId defaultIntegrator = INTEGRATOR_VELOCITY_VERLET)
      : m_integrator(defaultIntegrator), m_defaultIntegrator(defaultIntegrator) {}

  void step(double dt, int substeps) final {
    const int steps = std::max(1, substeps);
    const double dtSub = dt / static_cast<double>(steps);

    auto start = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < steps; ++i) {
      stepSubstep(dtSub, m_integrator);
    }
    auto end = std::chrono::high_resolution_clock::now();

    postStep();
    const double stepTimeMs = std::chrono::duration<double, std::milli>(end - start).count();
    const EnergyMetrics energy = computeEnergy();
    Diagnostics d{};
    d.kineticEnergy = energy.kinetic;
    d.potentialEnergy = energy.potential;
    d.springPotential = energy.spring;
    d.totalEnergy = energy.kinetic + energy.potential + energy.spring;
    d.constraintRms = computeConstraintRms();
    d.solverIterations = static_cast<double>(steps);
    d.stepTimeMs = stepTimeMs;
    m_diagnostics = d;
  }

  Diagnostics getDiagnostics() const final {
    return m_diagnostics;
  }

  bool supportsIntegrator(IntegratorId integrator) const final {
    return supportsIntegratorImpl(integrator);
  }

protected:
  struct EnergyMetrics {
    double kinetic = 0.0;
    double potential = 0.0;
    double spring = 0.0;
  };

  static int clampMinInt(int value, int minValue) {
    return value < minValue ? minValue : value;
  }

  static float clampMinFloat(float value, float minValue) {
    return value < minValue ? minValue : value;
  }

  static float clampNonNegative(float value) {
    return value < 0.0f ? 0.0f : value;
  }

  bool setIntegrator(IntegratorId integrator) {
    if (!supportsIntegratorImpl(integrator)) {
      return false;
    }
    if (m_integrator == integrator) {
      return true;
    }
    m_integrator = integrator;
    onIntegratorChanged(integrator);
    return true;
  }

  IntegratorId getIntegrator() const {
    return m_integrator;
  }

  IntegratorId getDefaultIntegrator() const {
    return m_defaultIntegrator;
  }

  void resetIntegrator() {
    setIntegrator(m_defaultIntegrator);
  }

  virtual bool supportsIntegratorImpl(IntegratorId integrator) const {
    return integrator == m_defaultIntegrator;
  }

  virtual void onIntegratorChanged(IntegratorId) {}

  virtual void stepSubstep(double dt, IntegratorId integrator) = 0;
  virtual void postStep() {}
  virtual EnergyMetrics computeEnergy() const = 0;
  virtual double computeConstraintRms() const { return 0.0; }

  IntegratorId m_integrator;
  IntegratorId m_defaultIntegrator;
  Diagnostics m_diagnostics{};
};
