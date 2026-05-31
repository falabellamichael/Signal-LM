cmake_minimum_required(VERSION 3.22.1)

project(signallm_native LANGUAGES CXX)

add_library(signallm_native SHARED
    native_inference.cpp
)

target_compile_features(signallm_native PRIVATE cxx_std_17)

find_library(log_lib log)

target_link_libraries(signallm_native
    ${log_lib}
)
