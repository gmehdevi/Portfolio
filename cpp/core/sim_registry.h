#pragma once

#include <memory>

#include "simulation.h"
#include "types.h"

int createSimulationHandle(int simType, const void* config, int configSize);
Simulation* lookupSimulation(int handle);
void destroySimulationHandle(int handle);

std::unique_ptr<Simulation> createSimulationByType(int simType);
