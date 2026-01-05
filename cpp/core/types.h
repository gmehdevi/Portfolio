#pragma once

#include <cstdint>

enum BufferId : int {
  BUFFER_POSITIONS = 0,
  BUFFER_VELOCITIES = 1,
  BUFFER_NORMALS = 2,
  BUFFER_INDICES = 3
};

enum SimType : int {
  SIM_PENDULUM_3D = 0
};

struct Diagnostics {
  double kineticEnergy = 0.0;
  double potentialEnergy = 0.0;
  double totalEnergy = 0.0;
  double constraintRms = 0.0;
  int solverIterations = 0;
  double stepTimeMs = 0.0;
};
