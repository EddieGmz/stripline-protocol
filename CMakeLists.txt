cmake_minimum_required(VERSION 3.22)
project(stripline_protocol VERSION 0.1.0 LANGUAGES CXX)

# Header-only target. Consumers: add_subdirectory(protocol) then link stripline::protocol.
add_library(stripline_protocol INTERFACE)
add_library(stripline::protocol ALIAS stripline_protocol)
target_include_directories(stripline_protocol INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}/generated/cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/cpp)
target_compile_features(stripline_protocol INTERFACE cxx_std_17)

option(STRIPLINE_PROTOCOL_TESTS "Build the protocol's C++ tests" OFF)
if(STRIPLINE_PROTOCOL_TESTS)
    enable_testing()
    add_executable(stripline_protocol_tests tests/cpp_test.cpp)
    target_link_libraries(stripline_protocol_tests PRIVATE stripline::protocol)
    add_test(NAME stripline_protocol_tests COMMAND stripline_protocol_tests)
endif()
