#pragma once

#include "types.h"

extern "C" {

int sim_create(int sim_type, const void* config, int config_size);
void sim_step(int handle, double dt, int substeps);
void sim_destroy(int handle);

float* sim_get_buffer(int handle, int buffer_id);
int sim_get_buffer_size(int handle, int buffer_id);

void sim_set_params(int handle, const void* params, int size);
void sim_get_diagnostics(int handle, Diagnostics* out);

}
