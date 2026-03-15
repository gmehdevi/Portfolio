#include "sim_api.h"

#include "../integrators/integrator_iface.h"
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

void sim_set_config(int handle, const void* config, int size) {
  Simulation* sim = lookupSimulation(handle);
  if (!sim) {
    return;
  }
  sim->init(config, size);
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

int sim_get_integrator_count() {
  int count = 0;
  for (const auto& entry : integratorRegistry()) {
    if (entry.fn) {
      ++count;
    }
  }
  return count;
}

int sim_get_integrator_id(int index) {
  int current = 0;
  for (const auto& entry : integratorRegistry()) {
    if (!entry.fn) {
      continue;
    }
    if (current == index) {
      return static_cast<int>(entry.id);
    }
    ++current;
  }
  return -1;
}

const char* sim_get_integrator_name(int index) {
  int current = 0;
  for (const auto& entry : integratorRegistry()) {
    if (!entry.fn) {
      continue;
    }
    if (current == index) {
      return entry.name ? entry.name : "";
    }
    ++current;
  }
  return "";
}

const char* sim_get_integrator_name_by_id(int id) {
  const auto* entry = findIntegrator(static_cast<IntegratorId>(id));
  if (!entry) {
    return "";
  }
  return entry->name ? entry->name : "";
}

int sim_get_supported_integrator_count(int handle) {
  Simulation* sim = lookupSimulation(handle);
  if (!sim) {
    return 0;
  }
  int count = 0;
  for (const auto& entry : integratorRegistry()) {
    if (!entry.fn) {
      continue;
    }
    if (sim->supportsIntegrator(entry.id)) {
      ++count;
    }
  }
  return count;
}

int sim_get_supported_integrator_id(int handle, int index) {
  Simulation* sim = lookupSimulation(handle);
  if (!sim) {
    return -1;
  }
  int current = 0;
  for (const auto& entry : integratorRegistry()) {
    if (!entry.fn) {
      continue;
    }
    if (!sim->supportsIntegrator(entry.id)) {
      continue;
    }
    if (current == index) {
      return static_cast<int>(entry.id);
    }
    ++current;
  }
  return -1;
}

int sim_get_buffer_descriptor(int buffer_id, BufferDescriptor* out) {
  if (!out) {
    return 0;
  }
  const auto descriptor = getBufferDescriptor(static_cast<BufferId>(buffer_id));
  if (descriptor.components <= 0) {
    return 0;
  }
  *out = descriptor;
  return 1;
}
