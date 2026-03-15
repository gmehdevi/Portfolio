#pragma once

#include <cstdint>

enum BufferId : int {
  BUFFER_POSITIONS = 0,
  BUFFER_VELOCITIES = 1,
  BUFFER_NORMALS = 2,
  BUFFER_INDICES = 3,
  BUFFER_UVS = 4,
  BUFFER_COLORS = 5,
  BUFFER_SPRING_POSITIONS = 6,
  BUFFER_RENDER_PACKET = 100
};

enum SimType : int {
  SIM_PENDULUM_3D = 0
};

enum IntegratorId : int {
  INTEGRATOR_VELOCITY_VERLET = 0,
  INTEGRATOR_SYMPLECTIC_EULER = 1,
  INTEGRATOR_RK4 = 2,
  INTEGRATOR_IMPLICIT_MIDPOINT = 3,
  INTEGRATOR_COUNT = 4
};

struct Diagnostics {
  double kineticEnergy = 0.0;
  double potentialEnergy = 0.0;
  double springPotential = 0.0;
  double totalEnergy = 0.0;
  double constraintRms = 0.0;
  double solverIterations = 0.0;
  double stepTimeMs = 0.0;
};

enum BufferType : int {
  BUFFER_TYPE_F32 = 0,
  BUFFER_TYPE_U16 = 1,
  BUFFER_TYPE_U32 = 2,
  BUFFER_TYPE_U16_U32 = 3
};

struct BufferDescriptor {
  BufferId id;
  int components;
  BufferType type;
};

inline BufferDescriptor getBufferDescriptor(BufferId id) {
  switch (id) {
    case BUFFER_POSITIONS:
      return {id, 3, BUFFER_TYPE_F32};
    case BUFFER_VELOCITIES:
      return {id, 3, BUFFER_TYPE_F32};
    case BUFFER_NORMALS:
      return {id, 3, BUFFER_TYPE_F32};
    case BUFFER_INDICES:
      return {id, 1, BUFFER_TYPE_U16_U32};
    case BUFFER_UVS:
      return {id, 2, BUFFER_TYPE_F32};
    case BUFFER_COLORS:
      return {id, 4, BUFFER_TYPE_F32};
    case BUFFER_SPRING_POSITIONS:
      return {id, 3, BUFFER_TYPE_F32};
    default:
      return {id, 0, BUFFER_TYPE_F32};
  }
}
