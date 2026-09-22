# T-0120 · 笔记（Windows 侧实机核验）

## 1. 这一票要回答的问题

`T-0119` 把 `native/win32-input` + `native/macos-input` 合并成 `native/host-input` 时，
**只动了文件布局与 `Register*` 装配**，但 `CMakeLists.txt` 是重写过的（三个 TU 一起编 + 补 `elseif(MSVC)`）。
当时的核验全在 macOS 上做，于是留下一个只能靠**另一台机器**回答的问题：

> 重写后的工程在 MSVC 下编得出来吗？编出来的 `.node` 在 **Electron** 里能 self-register 吗？

第二条是重点：Windows 的延迟加载钩子（`CMAKE_JS_SRC` + `delayimp` + `/DELAYLOAD:node.exe`）
失效的症状是**静默的** —— Electron 里 `require()` 报 `Module did not self-register`，
主进程只记一行诊断然后降级，玩家只看到「光标没被钉住」。

## 2. 本轮状态（2026-09-23）

**acceptance 5 条全部实测通过**，逐条原始输出在 `changes.md`。要点：

- 合并后的 `CMakeLists.txt` 在 VS 2026 / MSVC 19.51 下四个 TU 全过、`/utf-8 /permissive- /W4` 无 C4819；
- 产品宿主日志出现 `[native] host-input available=true supported=true path=…build\Release\host_input.node`
  ⇒ **延迟加载钩子生效**（这一条是本票存在的理由）；
- 125% 缩放下 `DIP(447,390) → 物理(559,488)` 读回一致、复位一致。

本轮请求（用户）：**构建并把产物复制到对应 `prebuilds` 目录** ⇒
`native/host-input/prebuilds/win32-x64/host_input.node`（与 `build/Release` 同 SHA256），
并实测了「没有 `build/` 时命中预置落点」的兜底。

## 3. 未决项（留给用户裁定，本票不擅自动）

### 3.1 `prebuilds/win32-x64/` 该不该进库（口径问题）

`.gitignore:27` 的例外写作 `!/native/host-input/prebuilds/`（**整目录**取消忽略），
于是本轮的 win32 产物**没有被忽略**（`git ls-files -o --exclude-standard` 列得出它）；
而同一处的注释与 `native/README.md` §3 写的是「唯一的例外是 **macOS 的预编译通用二进制**……
**Windows 维持按需构建**」。三个选项：

| 选项 | 动作 | 代价 |
|---|---|---|
| A 只当本地兜底 | 把例外收窄成 `!/native/host-input/prebuilds/darwin-universal/` | 要 retarget `T-0117` 的 evidence[2]（锚在那行原文上） |
| B 让 win32 也进库 | 什么都不改，`git add` 收进去 | 与 README §3 的自述口径冲突，得先改写那段理由（win32 没有 fat binary ⇒ 要按 arch 分目录，且「Windows 上装了 VS 的概率」与 macOS 不同） |
| C 删掉这份预置 | 只留 `build/Release`（加载链首选） | 就回到「clean 之后 / 换机器要重编」的老状态 |

### 3.2 遗留的旧构建目录 `native/win32-input/`

只剩 `build/` + `node_modules/`（6.3 MB，全被忽略，无跟踪文件）。`T-0119` 的判据写「两个目录不再存在」
—— 在 git 口径上成立，在本工作副本上不成立。删掉即可，但它包含上一轮的旧产物
（`build/Release/win32_input.node`，2026-09-18），留着会让人误以为「本地依然是旧的构建」这一现象还在。

### 3.3 守卫在非 darwin 平台必红 ⇒ 另立 `T-0121`

`test/native-host.test.ts` 的 `★预置产物就是"没编译器也能用"的那条路` 在 Windows 上 dlopen 了
darwin 的 fat Mach-O ⇒ 必红（10 pass / 1 fail / 1 skip），而它自己的注释写「Windows 开发机也不该红」。
这是**合并前就有的**跨平台脆弱性，不是 `T-0119` 的回归；处理落在 `T-0121`。
