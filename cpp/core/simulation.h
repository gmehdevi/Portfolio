#pragma once

#include "types.h"

class Simulation {
public:
  virtual ~Simulation() = default;

  virtual void init(const void* config, int configSize) = 0;
  virtual void step(double dt, int substeps) = 0;
  virtual float* getBuffer(int bufferId) = 0;
  virtual int getBufferSize(int bufferId) const = 0;
  virtual void setParams(const void* params, int size) = 0;
  virtual Diagnostics getDiagnostics() const = 0;
};
