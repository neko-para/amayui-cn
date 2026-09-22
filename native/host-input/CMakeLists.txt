cmake_minimum_required(VERSION 3.20)

# host_input —— 「宿主侧原生能力」原生模块（N-API，见 ../README.md 与 index.js 的加载链）。
#
# ★**一个 addon、两个平台实现**：三个 TU 在任何平台都参与编译，靠 `#ifdef` 决定谁是真实现：
#   src/host_input.cc   —— 唯一 Init（报 platform/supported + 调 RegisterWin32/RegisterMacos）
#   src/win32_input.cc  —— Windows 实现（非 Windows 上是空的 RegisterWin32）
#   src/macos_input.cc  —— macOS 实现（非 macOS 上是空的 RegisterMacos）
# 为什么不做「按平台选源文件」：**两个 TU 都编**才能在任何平台上把另一平台的**包装层**也过一遍编译
# （真实现体当然还是 #ifdef 掉的），代价只是几个空函数。
#
# cmake-js 注入的三个变量（见 node-addon-api 的 doc/cmake-js.md），**平台差异很大**：
#   CMAKE_JS_INC  —— Node/Electron 的头文件目录（含 node_api.h）—— 所有平台都有；
#   CMAKE_JS_LIB  —— node.lib 导入库 —— **只有 Windows 有**（下面有 guard）；
#   CMAKE_JS_SRC  —— win_delay_load_hook.cc —— **只有 Windows 有**（见下）。
#
# ★最低系统版本（macOS）：**必须在第一个 `project()` 之前设置**。CMake 只在初始化编译器命令行时读它
#   一次（Apple 的 `-mmacosx-version-min`），晚设会「看起来生效、其实没进命令行」，而最低版本又恰恰是
#   预置二进制最容易被悄悄抬高、进而装不上旧系统的地方（`tickets/T-0117` 有守卫钉它）。
#   非 Apple 平台会忽略这个变量，所以不需要 APPLE 判断（而 `if(APPLE)` 在 project() 之前本来就不可靠）。
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0"
    CACHE STRING "macOS 最低支持版本：Electron 44 要求 12+，取 11.0 是更宽的公共子集" FORCE)

project(host_input LANGUAGES CXX)

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
  src/host_input.cc
  src/win32_input.cc
  src/macos_input.cc
)
target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_JS_INC} ${NODE_ADDON_API_DIR})

# 纯 N-API：不引用 node:: 的 C++ 符号，因此**同一个 .node 在 Node 与 Electron 里都能加载**
# （Node-API 的 ABI 稳定性）。NAPI_VERSION 取 8 = Node 16+ / Electron 14+ 的公共子集；
# 抬高它只会收窄能加载的宿主范围，本模块用不到更新的特性。
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)

if(CMAKE_JS_LIB)
  target_link_libraries(${PROJECT_NAME} PRIVATE ${CMAKE_JS_LIB})
endif()

# ★Windows 的延迟加载钩子：`node.lib` 把导入记录写成 **node.exe**，而 Electron 的宿主可执行文件是
#   electron.exe（**没有 node.dll**）⇒ 不加钩子，Electron 里 `require()` 会报
#   「The specified module could not be found / Module did not self-register」。
#   官方口径：<https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>
if(CMAKE_JS_SRC)
  target_sources(${PROJECT_NAME} PRIVATE ${CMAKE_JS_SRC})
  # node-gyp 的 win_delay_load_hook.cc 需要 delayimp.lib（DelayLoad 失败时回调 GetModuleHandle）。
  target_link_libraries(${PROJECT_NAME} PRIVATE delayimp)
  set_target_properties(${PROJECT_NAME} PROPERTIES LINK_FLAGS "/DELAYLOAD:node.exe")
endif()

if(APPLE)
  # ApplicationServices 是总伞头（CoreGraphics + HIServices）：CGWarpMouseCursorPosition /
  # CGAssociateMouseAndMouseCursorPosition（CGRemoteOperation）、CGEvent*（CGEvent）、
  # CGGetActiveDisplayList / CGDisplayBounds（CGDirectDisplay）、AXIsProcessTrusted（HIServices）都在里面。
  target_link_libraries(${PROJECT_NAME} PRIVATE
    "-framework ApplicationServices"
    "-framework CoreFoundation"
    "-framework CoreGraphics"
  )
  # N-API 符号由**宿主进程**（node / Electron）提供 ⇒ bundle 必须允许未定义符号在加载时解析。
  # cmake-js 在 macOS 上一般已经注入了 `-undefined dynamic_lookup`，这里显式再写一遍是为了
  # 「直接 cmake 生成」或 cmake-js 行为变化时不至于悄悄链接失败。
  set_target_properties(${PROJECT_NAME} PROPERTIES LINK_FLAGS "-undefined dynamic_lookup")
elseif(MSVC)
  # `/utf-8`：源码是 UTF-8（含中文注释），不指定时 MSVC 按系统代码页（936）读 → C4819 且注释可能被截断。
  # `/permissive-`：贴近标准；`/W4` 只警告不报错。clang-cl 同样接受这些开关。
  target_compile_options(${PROJECT_NAME} PRIVATE /utf-8 /permissive- /W4)
else()
  target_compile_options(${PROJECT_NAME} PRIVATE -Wall -Wextra)
endif()

# 产物名：build/Release/host_input.node（cmake-js 会把 Release 放进 build/Release）
set_target_properties(${PROJECT_NAME} PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "host_input"
)
