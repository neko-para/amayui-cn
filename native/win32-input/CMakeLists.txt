cmake_minimum_required(VERSION 3.20)

# win32_input —— 「宿主侧 Win32 能力」原生模块（N-API，见 ../README.md 与 index.js 的加载链）。
#
# 为什么是 CMake（而不是 node-gyp）：本仓已经有 CMake/Ninja 工具链；CMake 侧只依赖三个变量，
# 由 cmake-js 注入（见 node-addon-api 的 doc/cmake-js.md）：
#   CMAKE_JS_INC  —— Node/Electron 的头文件目录（含 node_api.h / napi.h 所在的 node-addon-api）
#   CMAKE_JS_LIB  —— node.lib（导入库；**纯 N-API 只用到 napi_* 符号**）
#   CMAKE_JS_SRC  —— ★Windows 的 win_delay_load_hook.cc（Electron 必需的延迟加载钩子）
#
# ★为什么必须带 `CMAKE_JS_SRC`：Windows 上 `node.lib` 把导入记录写成 **node.exe**，而 Electron 的宿主
# 可执行文件是 electron.exe（没有 node.dll）⇒ 不装延迟加载钩子，`require()` 时会报
# 「The specified module could not be found / Module did not self-register」。
# 官方口径见 https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
# （"you'll need to ensure that you build with a delay-load hook installed in the main .node file"）。
project(win32_input LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT DEFINED CMAKE_JS_INC)
  message(FATAL_ERROR "CMAKE_JS_INC 未定义：请用 `npx cmake-js build`（或 configure）来构建，不要直接 cmake 生成。")
endif()

# node-addon-api 是**头文件包**（`napi.h` 在包根，不在 node 头里）⇒ 必须单独取它的 include 目录。
# 官方写法就是问 node 自己（node-addon-api 的 doc/cmake-js.md）；失败时退回 node_modules 约定路径。
execute_process(
  COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  ERROR_QUIET
  OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR "${NODE_ADDON_API_DIR}")
if(NOT NODE_ADDON_API_DIR OR NOT EXISTS "${NODE_ADDON_API_DIR}")
  set(NODE_ADDON_API_DIR "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api")
endif()
message(STATUS "node-addon-api include: ${NODE_ADDON_API_DIR}")

add_library(${PROJECT_NAME} SHARED
  src/win32_input.cc
)
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_JS_INC} ${NODE_ADDON_API_DIR})

# 纯 N-API：不引用 node:: 的 C++ 符号，因此**同一个 .node 在 Node 与 Electron 里都能加载**
# （Node-API 的 ABI 稳定性）。NAPI_VERSION 取 8 = Node 16+ / Electron 14+ 的公共子集；
# 抬高它只会收窄可加载的宿主范围，本模块用不到更新的特性。
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)

if(CMAKE_JS_SRC)
  target_sources(${PROJECT_NAME} PRIVATE ${CMAKE_JS_SRC})
  # node-gyp 的 win_delay_load_hook.cc 需要 delayimp.lib（DelayLoad 失败时回调 GetModuleHandle）。
  target_link_libraries(${PROJECT_NAME} PRIVATE delayimp)
  set_target_properties(${PROJECT_NAME} PROPERTIES LINK_FLAGS "/DELAYLOAD:node.exe")
endif()

target_link_libraries(${PROJECT_NAME} PRIVATE ${CMAKE_JS_LIB})

# 产物名：build/Release/win32_input.node（cmake-js 会把 Release 放进 build/Release）
set_target_properties(${PROJECT_NAME} PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "win32_input"
)

if(MSVC)
  # `/utf-8`：源码是 UTF-8（含中文注释），不指定时 MSVC 按系统代码页（936）读 → C4819 且注释可能被截断。
  # `/permissive-`：贴近标准；`/W4` 只警告不报错。clang-cl 同样接受这些开关。
  target_compile_options(${PROJECT_NAME} PRIVATE /utf-8 /permissive- /W4)
else()
  target_compile_options(${PROJECT_NAME} PRIVATE -Wall -Wextra)
endif()
