# T-0119 · 调查与设计（把两个平台模块合并成一个 addon）

## 0. 从哪来

`T-0058`（Windows 落地）与 `T-0116`（macOS 落地）各建了一个模块，各自带全套文件：

```
native/win32-input/   CMakeLists.txt  index.js  index.d.ts  README.md  package.json  src/win32_input.cc  tools/smoke.cjs
native/macos-input/   CMakeLists.txt  index.js  index.d.ts  README.md  package.json  src/macos_input.cc  tools/smoke.cjs  tools/build-prebuild.cjs
```

逐项对比后的重复面：

| 文件 | 重复程度 |
|---|---|
| `index.js`（加载器 + 降级门面，~140 行） | **逐行同构**，只差 `ADDON_BASENAME`、env 变量名与 `AMAYUI_*_INPUT_MODE` 注释 |
| `index.d.ts` | 同名三函数逐行同构，只是各多了一组平台专有声明 |
| `README.md` | 「为什么必须是原生模块」「构建」「统一口径」「排障」大段同构 |
| 守卫 | `native-win32.test.ts`（7 条）与 `native-macos.test.ts`（7 条）里 **3 条完全一样**（降级契约 / 搜索链 / 门面空实现） |
| 主进程 | `HOST_MODULE = win32 ? 'win32-input' : darwin ? 'macos-input' : null` + `LOAD_SUMMARY_PREFIX` 映射表 |

## 1. 用户裁定

> 这里能否直接合并两个 input 模块？逻辑上就是一个 native addon 在两个平台上的实现，没必要取两个名字。

采纳。**模块 = 一个能力；平台实现 = 模块内部的事**。拆成两份的隐性代价是：把「平台」编码进了
目录名与调用方 ⇒ 每多一个平台就要多一个模块 + 多改一次主进程分派。

## 2. 合并后的结构（一个 Init + 每平台一个 TU）

```
src/host_input.cc    ← ★唯一 NODE_API_MODULE(host_input, Init)：报 platform/supported + 调两个 Register*
src/host_input.h     ← Register 声明 + 口径（同名 API 必须同语义 / 平台专有只在自己平台注册）
src/win32_input.cc   ← Win32 实现 + RegisterWin32（#else 分支 = 空的 Register）
src/macos_input.cc   ← macOS 实现 + RegisterMacos（#else 分支 = 空的 Register）
```

★**为什么不做「按平台选源文件」**（CMake 里 `if(WIN32) ... elseif(APPLE) ...`）：三个 TU 都参与编译，
另一平台的**包装层**也会过一遍编译（真实现体当然还是 `#ifdef` 掉的），代价只是几个空函数与几百字节。
顺带一个好处：合并时顺手删掉了每个函数里那套 `#ifdef _WIN32 / #else return Null` 的桩分支
（现在整个实现体都在 `#ifdef` 之内），代码比合并前更短。

## 3. 平台专有函数怎么办（不硬凑同名）

| 函数 | win32 | darwin | 处理 |
|---|---|---|---|
| `getCursorPos` / `setCursorPos` / `getVirtualScreenRect` | ✅ | ✅ | 跨平台同名同义（只有坐标单位不同：物理像素 vs 点） |
| `getSystemMetrics` / `getAsyncKeyState` / `showCursor` | ✅ | ❌ 不注册 | 门面兜成 `null` |
| `postMouseMove` / `isAccessibilityTrusted` | ❌ 不注册 | ✅ | 门面兜成 `false` |

「同名不同义」（例如把 macOS 的 `CGEventSourceKeyState` 硬叫 `getAsyncKeyState`，键码表完全不同）
比"没有"更危险 ⇒ 只注册、不硬凑；调用方（主进程）只关心 `available`/`supported` 两个常量，不必分平台。

## 4. 不改的东西（显式列出，免得合并时手滑）

- 坐标换算链路：`getContentBounds()` 之后的 **Windows 才有**的 `dipToScreenPoint`「有则用」；
- 降级语义：`available === false`（没产物）/ `supported === false`（本平台无实现）⇒ 门面全 `null`/`false`，
  主进程只记一行诊断；
- 平台特有的构建细节：延迟加载钩子（`CMAKE_JS_SRC` + `/DELAYLOAD:node.exe` + `delayimp.lib`）、
  `CMAKE_OSX_DEPLOYMENT_TARGET=11.0` 早于 `project()`、`-undefined dynamic_lookup`、
  `if(CMAKE_JS_LIB)`/`if(CMAKE_JS_SRC)` 守卫、cmake-js `--CD` 的拼写坑（这些一条都没丢，全在合并后的
  `CMakeLists.txt` 与 README 的「四个坑」里）；
- 预置产物：仍然是 `darwin-universal` 的 fat Mach-O（`minos` = 11.0，走 git-lfs），只是改了产物名与路径。

## 5. 锚点代价（先量后动）

| 票 | 受影响的 evidence | 处置 |
|---|---|---|
| `T-0053` | `tests`、`links.docs` | 指向 `test/native-host.test.ts` / `native/host-input/README.md` |
| `T-0058` | 7 条（加载摘要串 / CMakeLists / win32 TU / index.js / 守卫 / smoke / README） | retarget 到同义新串 |
| `T-0116` | 7 条（macos TU ×2 / 加载摘要串 / index.js / 守卫 / README / win32 TU） | 同上 |
| `T-0117` | 5 条（build-prebuild / CMakeLists / .gitignore 例外 / 守卫 / README） | 同上 |
| `T-0118` | 1 条（预置产物棘轮守卫） | 同上 |
| 能力台账 | `host-cursor-warp.guard` = `test/native-win32.test.ts` | 改成 `test/native-host.test.ts`；note 里的两段"分平台模块"叙述合并成一段 |

**没有删任何一条 evidence**（`--validate` 与 `test/ticket-ledger.test.ts` 的棘轮就是为这种时候准备的：
路径一变就红，红了就回来核对并 retarget）。

## 6. 遗留

- Windows 侧本轮**没有实机重跑**（本机是 macOS）：合并只动了文件布局与 `Register*` 装配，
  `win32_input.cc` 的实现体逐行未变；`CMakeLists.txt` 里 Windows 的那三行（`CMAKE_JS_SRC`/`delayimp`/
  `/DELAYLOAD:node.exe`）也逐字未变。⇒ 形态上是"搬家"，但**严格说 Windows 的加载需要一台 Windows 机器
  再确认一次**（`npm run build` + 产品宿主日志里出现 `[native] host-input available=true`）。
  这一点记在 `changes.md` 的「未证到的」里，不假装已经验过。
