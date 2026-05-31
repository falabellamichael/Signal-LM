cmake_minimum_required(VERSION 3.22.1)

project(signallm_native LANGUAGES C CXX)

set(SIGNAL_LM_LLAMA_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/llama.cpp)
set(SIGNAL_LM_HAS_LLAMA OFF)
set(SIGNAL_LM_ENABLE_VULKAN "AUTO" CACHE STRING "Enable llama.cpp Vulkan backend: AUTO, ON, or OFF")
set_property(CACHE SIGNAL_LM_ENABLE_VULKAN PROPERTY STRINGS AUTO ON OFF)

set(SIGNAL_LM_VULKAN_ENABLED OFF)
if (SIGNAL_LM_ENABLE_VULKAN STREQUAL "ON")
    set(SIGNAL_LM_VULKAN_ENABLED ON)
elseif (SIGNAL_LM_ENABLE_VULKAN STREQUAL "AUTO")
    find_program(SIGNAL_LM_HOST_CXX_COMPILER NAMES cl.exe g++.exe clang++.exe NO_CMAKE_FIND_ROOT_PATH)
    if (SIGNAL_LM_HOST_CXX_COMPILER AND NOT SIGNAL_LM_HOST_CXX_COMPILER MATCHES "[/\\\\]Android[/\\\\]Sdk[/\\\\]ndk[/\\\\]")
        set(SIGNAL_LM_VULKAN_ENABLED ON)
    else()
        message(WARNING "Signal LM: Vulkan backend disabled because no Windows host C++ compiler was found for llama.cpp shader generation. Install Visual Studio C++ Build Tools or MinGW and configure with -DSIGNAL_LM_ENABLE_VULKAN=ON to force it.")
    endif()
endif()

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
    set(GGML_VULKAN ${SIGNAL_LM_VULKAN_ENABLED} CACHE BOOL "Enable Vulkan backend" FORCE)

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
    if (TARGET ggml-vulkan)
        target_link_libraries(signallm_native ggml-vulkan vulkan)
    endif()
endif()
