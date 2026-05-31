cmake_minimum_required(VERSION 3.22.1)

project(signallm_native LANGUAGES C CXX)

set(SIGNAL_LM_LLAMA_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/llama.cpp)
set(SIGNAL_LM_HAS_LLAMA OFF)

if (EXISTS ${SIGNAL_LM_LLAMA_DIR}/CMakeLists.txt)
    message(STATUS "Signal LM: found vendored llama.cpp at ${SIGNAL_LM_LLAMA_DIR}")

    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_UI OFF CACHE BOOL "" FORCE)
    set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
    set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
    set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
    set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)

    add_subdirectory(${SIGNAL_LM_LLAMA_DIR} ${CMAKE_BINARY_DIR}/llama.cpp)
    set(SIGNAL_LM_HAS_LLAMA ON)
else()
    message(STATUS "Signal LM: vendored llama.cpp not found. Native scaffold will build without local inference backend.")
endif()

add_library(signallm_native SHARED
    native_inference.cpp
)

target_compile_features(signallm_native PRIVATE cxx_std_17)

find_library(log_lib log)

target_link_libraries(signallm_native
    ${log_lib}
)

if (SIGNAL_LM_HAS_LLAMA AND TARGET llama)
    target_compile_definitions(signallm_native PRIVATE SIGNAL_LM_HAS_LLAMA=1)
    target_link_libraries(signallm_native llama)
endif()
