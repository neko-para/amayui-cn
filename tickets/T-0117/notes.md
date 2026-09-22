# T-0117 · 研究结论：darwin 预编译产物能不能直接预置进仓库

> 用户要求：「研究能否将其直接编译好后预置进仓库中。macos 的话 deployment target = 11，双架构」。
> 结论：**能，而且已经做了**。下面把「为什么能 / 代价是什么 / 否掉了哪些替代方案 / 怎么防腐坏」写清。

## 1. 结论：能（三条前提同时成立）

| 前提 | 本仓的事实 | 出处 |
|---|---|---|
| **ABI 不随宿主版本漂移** | 模块**纯 N-API**（`NAPI_VERSION=8`，只用 `napi_*`，不碰 `node::`）⇒ 一份 `.node` 跨 Node 16+ / Electron 14+ 通用，不存在 node-gyp 那种「换 Node 版本必须重编」 | `native/macos-input/CMakeLists.txt` 的 `target_compile_definitions(NAPI_VERSION=8)`；`nm -u -arch arm64/x86_64` 的未定义符号表里只有 `napi_*` + libc++ + 系统框架 |
| **一份文件能覆盖两个架构** | macOS 支持 **fat Mach-O** ⇒ `lipo -archs` = `arm64 x86_64` 的单文件同时服务两种机器，不需要 `prebuilds/<platform>-<arch>` 放两份 | `npm run build:prebuild` 的当场校验输出 |
| **体积与失效代价都可接受** | 123 KB（对比仓库里的 `install/`、`res/`）；缺了它**不会崩**，只静默降级（`host-cursor-warp` 的 `whySilent`），而 macOS 上"装了 Xcode CLT"并非必然 | `ls -l prebuilds/darwin-universal/`；`analysis/engine-capabilities.json#host-cursor-warp` |

**收益**：只装 Node + Electron 的机器（clone + `npm install` 就玩）也能拿到「光标真的被挪过去」这条观感，
而不必为了它去装 CMake + Xcode CLT + 让 cmake-js 下载一套 Node 头文件。

## 2. 否掉的替代方案与各自的代价

| 方案 | 否掉的理由 |
|---|---|
| **维持现状**（`.node` 一律不进 git，按需构建） | 失效是**静默**的：玩家只看到"光标没被钉住"，不会看到任何报错 ⇒ 与"这条能力没做"无法区分 |
| `prebuildify` + `node-gyp-build` 运行时挑选 | 那套机器是为「多 ABI × 多平台 × 多架构」矩阵准备的；本仓只有**一个 N-API ABI**，而 fat binary 已经解决了架构维度 ⇒ 引入两个产品路径依赖换不来新能力（加载器已经把 `prebuilds/<platform>-{arch,universal}/` 排进搜索链，将来真需要接时不用改调用方） |
| 发布时下载 / `postinstall` 拉预编译 | 需要网络 + 一个制品托管处，离线与内网环境直接失败；而本仓的分发形态就是「clone 下来就能跑」 |
| 同时提交 `prebuilds/darwin-arm64/` 与 `prebuilds/darwin-x64/` 两份 | 内容**完全一样**（fat binary），git 虽然会按内容去重（仓库不多占空间），但会暗示"两份不同"；更诚实的表达是给加载器加一条 `prebuilds/<platform>-universal/` 兜底 |

### 2b. 存储：**走 git-lfs**（第一版把它当"否掉"是错的）

第一版本票曾把「放进 git-lfs」列为否掉方案，理由是"走 LFS 就等于要求消费者先装 git-lfs"。
**用户裁掉了这个理由**：`*.node` 应当正常进 LFS —— 「没有 git lfs 是极端情况，没必要为此直接让
git 管理二进制」。事实也站在这一边：本仓 `.gitattributes` 早就在用 LFS 存 `*.png`/`*.exe`/`*.DAT`/
`*.STH` 等 **100+ 个文件**，`git lfs install` 本来就是这份仓库的既定前提；为"万一有人没装"让 git
直接管一个 123 KB 的二进制，换来的是"绕过仓库已有约定"这个更贵的代价。

所以最终口径：`.gitattributes` 里 `*.node filter=lfs diff=lfs merge=lfs -text`（**与既有二进制同一行
格式**）—— 它就是一个普通的 LFS 二进制，拉没拉下来由 git-lfs 自己负责，不再为这件事做任何额外处理。

## 3. 实测过程中踩到的一个"会静默出错"的坑（值得留在案）

第一次 `build:prebuild` 产出的仍是**单架构**，且**没有任何报错**。根因：cmake-js 的 `--CD` 选项
是从 `process.argv` 里按 `indexOf('=') >= 5` 切 key 的 —— 只认 **`--CDKEY=VALUE` 拼成一个参数**，
写成空格分隔的 `--CD KEY=VALUE` 会被静默忽略，于是 cmake-js 自己注入的
`-DCMAKE_OSX_ARCHITECTURES=<本机 arch>` 就赢了。

⇒ 结论写进两处：`native/macos-input/README.md` 的「三个坑」第 2 条、`native/README.md` 的统一口径；
并且 `tools/build-prebuild.cjs` **编译完当场校验** `lipo -archs` 与 `minos`，任一不符即非 0 退出。
（这正是"预置二进制"最典型的腐坏方式之一：以为编了双架构，其实没有。）

## 4. 防腐坏：三道闸

1. **脚本当场校验**（`tools/build-prebuild.cjs`）：`lipo -archs` = `arm64 x86_64`；
   每个 slice 的 `LC_BUILD_VERSION.minos`（旧格式 `LC_VERSION_MIN_MACOSX.version`）= `11.0`。
2. **守卫棘轮**（`app/amayui-emulator/test/native-macos.test.ts`）：预置产物**必须存在**、
   必须双架构、`minos` 必须 11.0 ⇒ 用单架构的本地构建覆盖它、或抬高 deployment target 都会红。
3. **文档写清重跑时机**（`native/macos-input/README.md` 的「预置产物」一节）：改 `src/*.cc` /
   改 `CMakeLists.txt`（编译选项、最低系统版本、`NAPI_VERSION`）/ 换工具链或 Node 头文件之后**必须**重跑。

## 5. 诚实的边界（没能证到的部分）

- **x86_64 slice 只做了静态核验，没跑起来**：本机（Apple Silicon）**没装 Rosetta 2**
  （`arch -x86_64 node -p process.arch` ⇒ `Bad CPU type in executable`）⇒ x86_64 的结论来自
  `lipo -archs`（两个 slice 都在）、`otool -L -arch x86_64`（只链系统框架）、
  `nm -u -arch x86_64`（未定义符号集与 arm64 完全同形，只有 `napi_*` + libc++ + libSystem）
  这三项静态证据 —— 属"结构上可加载"，不等于"在 Intel 机器上实跑过"。**要补这一条需要一台 Intel Mac
  或装 Rosetta 的机器**。
- **签名/公证**：预置产物一旦被替换，之前对它做的签名就失效；本机从源码树加载不校验签名。
  将来打安装包时 `.node` 要随应用一起签（已写进 `docs-new/04-app/native-addon.md` §5）。
- **deployment target = 11.0 是"下限声明"而非"已验证在 11 上运行"**：本机 macOS 26.3。
  取 11.0 的理由是"Electron 44 要求 12+，11.0 是更宽的公共子集"，不是因为我们测过 11.0。
