cmake_minimum_required(VERSION 3.22.1)
project(lm_studio_lite_runtime)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Point this at a checked-out llama.cpp source tree included in your Android project.
set(LLAMA_CPP_DIR ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp)

set(GGML_VULKAN ON CACHE BOOL "Enable Vulkan backend" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "Avoid host-specific native flags for Android cross-compile" FORCE)

add_subdirectory(${LLAMA_CPP_DIR} llama_cpp_build)

add_library(lmstudiolite_runtime SHARED llama_bridge.cpp)

target_link_libraries(lmstudiolite_runtime
    llama
    ggml
    ggml-vulkan
    android
    log
    vulkan
)
