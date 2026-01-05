#include "sim_api.h"

#include "sim_registry.h"

int sim_create(int sim_type, const void* config, int config_size) {
  return createSimulationHandle(sim_type, config, config_size);
}

void sim_step(int handle, double dt, int substeps) {
  Simulation* sim = lookupSimulation(handle);
  if (!sim) {
    return;
  }
  sim->step(dt, substeps);
}

void sim_destroy(int handle) {
  destroySimulationHandle(handle);
}

float* sim_get_buffer(int handle, int buffer_id) {
  Simulation* sim = lookupSimulation(handle);
  if (!sim) {
    return nullptr;
  }
  return sim->getBuffer(buffer_id);
}

int sim_get_buffer_size(int handle, int buffer_id) {
  Simulation* sim = lookupSimulation(handle);
  if (!sim) {
    return 0;
  }
  return sim->getBufferSize(buffer_id);
}

void sim_set_params(int handle, const void* params, int size) {
  Simulation* sim = lookupSimulation(handle);
  if (!sim) {
    return;
  }
  sim->setParams(params, size);
}

void sim_get_diagnostics(int handle, Diagnostics* out) {
  if (!out) {
    return;
  }
  Simulation* sim = lookupSimulation(handle);
  if (!sim) {
    *out = Diagnostics{};
    return;
  }
  *out = sim->getDiagnostics();
}
