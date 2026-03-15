cmake_minimum_required(VERSION 3.20)

project(PhysicsWasm LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(physics STATIC
  cpp/core/camera_api.cpp
  cpp/core/sim_api.cpp
  cpp/core/sim_registry.cpp
  cpp/sims/sim_pendulum3d.cpp
)

target_include_directories(physics PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/cpp
)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

option(PHYSICS_ENABLE_WARNINGS "Enable strict warnings" ON)
if(PHYSICS_ENABLE_WARNINGS)
  target_compile_options(physics PRIVATE
    -Wall -Wextra -Wpedantic
  )
endif()
