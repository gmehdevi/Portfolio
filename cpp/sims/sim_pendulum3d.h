#pragma once

#include <memory>

#include "../core/simulation.h"
#include "../core/types.h"

std::unique_ptr<Simulation> createPendulum3D();
