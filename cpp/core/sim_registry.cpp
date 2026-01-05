#include "sim_registry.h"

#include <unordered_map>

#include "../sims/sim_pendulum3d.h"

namespace {
std::unordered_map<int, std::unique_ptr<Simulation>> g_simulations;
int g_nextHandle = 1;
}  // namespace

int createSimulationHandle(int simType, const void* config, int configSize) {
  auto sim = createSimulationByType(simType);
  if (!sim) {
    return -1;
  }

  sim->init(config, configSize);
  int handle = g_nextHandle++;
  g_simulations.emplace(handle, std::move(sim));
  return handle;
}

Simulation* lookupSimulation(int handle) {
  auto it = g_simulations.find(handle);
  if (it == g_simulations.end()) {
    return nullptr;
  }
  return it->second.get();
}

void destroySimulationHandle(int handle) {
  g_simulations.erase(handle);
}

std::unique_ptr<Simulation> createSimulationByType(int simType) {
  switch (simType) {
    case SIM_PENDULUM_3D:
      return createPendulum3D();
    default:
      return nullptr;
  }
}
