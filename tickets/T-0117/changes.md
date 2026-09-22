# T-0117 · 变更记录

## 第 1 次变更：把 darwin 通用二进制预置进仓库 + 三道防腐坏闸（2026-09-22）

### 新增文件

| 文件 | 内容 |
|---|---|
| `native/macos-input/tools/build-prebuild.cjs` | 只在 macOS 上可跑；用 `--CDCMAKE_OSX_ARCHITECTURES=arm64;x86_64`、`--CDCMAKE_OSX_DEPLOYMENT_TARGET=11.0` 构建到 `build-universal/`，**当场校验** `lipo -archs` 与两个 slice 的 `minos`，再拷到 `prebuilds/darwin-universal/macos_input.node` |
| `native/macos-input/prebuilds/darwin-universal/macos_input.node` | **预置产物本体**：fat Mach-O（arm64 + x86_64）、`minos` = 11.0、123 KB、只链 ApplicationServices/CoreFoundation/CoreGraphics |

### 修改文件

| 文件 | 改动 |
|---|---|
| `.gitignore` | ① 新增 `/native/*/build-*/`（`build-universal/` 也是构建目录）；② 为 `!/native/macos-input/prebuilds/` 开**唯一例外**，并在注释里逐条写清"为什么只有这一处"（纯 N-API ABI 稳定 / fat binary / 缺了是静默降级 / macOS 上未必有编译器） |
| `.gitattributes` | `*.node binary`（-diff -merge -text）且**明确不走 LFS** —— 走 LFS 会把"没工具链也能用"换成"还得装 git-lfs" |
| `app/amayui-emulator/test/native-macos.test.ts` | 第 5 条守卫：预置产物存在性 + 双架构 + `minos=11.0`；第 6 条：加载器在 `build/` 不存在时命中 `prebuilds/`（按 arch 与 universal 两个落点都验） |
| `native/macos-input/index.js` | 搜索链补 `prebuilds/<platform>-universal/` 兜底（唯一加载点认它，调用方不用改） |
| `native/win32-input/index.js` | 同一条兜底（只为两模块口径一致；win32 命中不了） |
| `native/README.md` | 统一口径第 3 条改写为「默认不进 git + **唯一例外与论证要求**」；第 4 条补 `-universal` 落点 |
| `native/macos-input/README.md` | 新增「预置产物」一节：落点/加载优先级/为什么可以预置/**什么时候必须重跑**/手工核对命令 |
| `docs-new/04-app/native-addon.md` | §5 打包表改写（darwin 已预置、win32 仍按需构建）+ 新增「预置产物的腐坏面」段（保留 `T-0058` 锚点） |

### 判据与实测

- `cd native/macos-input && npm run build:prebuild` ⇒
  `[lipo] … → arm64 x86_64`、`[otool] arm64 minos = 11.0`、`[otool] x86_64 minos = 11.0`、写出 122.9 KB（exit 0）；
- **只有预置产物时可用**：把 `build/` 移走后
  ① `node native/macos-input/tools/smoke.cjs`（含 `MOVE_TEST=1`）⇒ 加载路径变成
  `prebuilds/darwin-universal/macos_input.node`，挪动 + 复位一致（exit 0）；
  ② `AMAYUI_CURSOR_VERIFY=1 npx electron tools/verify-cursor.cjs` ⇒ 同上，结论不变（exit 0）；
- 守卫 `npx tsx --test test/native-macos.test.ts` ⇒ 7 pass / 0 fail（含双架构与 `minos` 棘轮）；
- `git check-ignore -v native/macos-input/prebuilds/darwin-universal/macos_input.node` ⇒ 非忽略；
  `git check-attr binary -- …` ⇒ `binary: set`；
- `git status --untracked-files=all native/macos-input` ⇒ 只有源码/脚本/文档/预置产物，
  `build/` 与 `build-universal/` 都不在列。

### 未证到的（写在 notes.md §5）

x86_64 slice **没跑起来**（本机无 Rosetta 2）⇒ 只有静态核验（`lipo`/`otool -L`/`nm -u` 三件套）。

## 第 2 次变更（2026-09-22）—— 存储口径反转：`*.node` 改走 **git-lfs**

**用户裁定**：「正常进 lfs 即可，没有 git lfs 是极端情况，没必要为此直接让 git 管理二进制」
⇒ **推翻第 1 次变更里的那一行**（原 `.gitattributes`：`*.node binary`，明确"不走 LFS"）。
理由：本仓 `.gitattributes` 早就用 LFS 存 `*.png`/`*.exe`/`*.DAT`/`*.STH` 等 **100+ 个文件**
（`git lfs ls-files` 实测 102 条，`git lfs install` 是这份仓库的既定前提），为"万一有人没装 LFS"
让 git 直接管二进制，换来的是"绕过仓库已有约定"这个更贵的代价。

### 改了什么

| 文件 | 改动 |
|---|---|
| `.gitattributes` | `*.node binary` → **`*.node filter=lfs diff=lfs merge=lfs -text`**（与既有二进制**同一行格式**） |
| `native/macos-input/README.md` / `native/README.md` / `docs-new/04-app/native-addon.md` | 撤掉"不走 LFS"那套论证，改成一句"与既有二进制同口径"（`docs-new/04-app` §5 另加一行「仓库里怎么存」） |
| `tickets/T-0117/ticket.json` | acceptance 的存储条、`.gitattributes` 的 evidence note 同步（history 记 scope 变更） |

★ **没有**为"LFS 对象没拉下来 / `lipo` 出问题"这类情况加任何防御：`.node` 与 `*.png` 一样是 LFS 里的
普通二进制，拉没拉下来由 git-lfs 自己负责（用户口径：这类极端情况不值得专门处理）。守卫仍然是
**存在性 + 双架构 + minos=11.0** 三条，只在非 macOS 上跳过（`lipo`/`otool` 是 macOS 工具）。

### 判据

- `git check-attr filter diff merge text -- native/macos-input/prebuilds/darwin-universal/macos_input.node`
  ⇒ `filter: lfs` / `diff: lfs` / `merge: lfs` / `text: unset`（= 与 `*.png` 等既有 LFS 文件同形）；
- 守卫 `npx tsx --test test/native-macos.test.ts` ⇒ **7 pass / 0 fail**；`git status` 里 `native/macos-input/`
  仍只含源码/脚本/文档/预置产物。


## 2026-09-22

★2026-09-22 路径变更（`tickets/T-0119`）：本文件里提到的 `native/win32-input/**`（或 `native/macos-input/**`）现在合并成了 `native/host-input/**` —— 一个 addon、两个平台实现；产物名与 env 分别是 `host_input.node` 与 `AMAYUI_HOST_INPUT_NODE`，预置产物在 `prebuilds/darwin-universal/host_input.node`，守卫并成 `test/native-host.test.ts`。下文按当时的记录保留。
