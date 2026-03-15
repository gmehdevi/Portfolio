#pragma once

#include "types.h"

extern "C" {

int sim_create(int sim_type, const void* config, int config_size);
void sim_step(int handle, double dt, int substeps);
void sim_destroy(int handle);

float* sim_get_buffer(int handle, int buffer_id);
int sim_get_buffer_size(int handle, int buffer_id);

void sim_set_params(int handle, const void* params, int size);
void sim_set_config(int handle, const void* config, int size);
void sim_get_diagnostics(int handle, Diagnostics* out);

int sim_get_integrator_count();
int sim_get_integrator_id(int index);
const char* sim_get_integrator_name(int index);
const char* sim_get_integrator_name_by_id(int id);

int sim_get_supported_integrator_count(int handle);
int sim_get_supported_integrator_id(int handle, int index);

int sim_get_buffer_descriptor(int buffer_id, BufferDescriptor* out);

}
