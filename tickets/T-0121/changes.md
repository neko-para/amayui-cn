# T-0121 · 变更记录

## 第 1 次变更：把「预置产物兜底」用例改成平台中立（2026-09-23）

### 改了什么（一个文件）

`app/amayui-emulator/test/native-host.test.ts`：

| 改动 | 内容 |
|---|---|
| ★新增测试缝 `resolvedCandidate(r)` | 「加载器**实际落到的候选**」= `addonPath`，否则取 `tried` 里第一条**不是"不存在"**的候选（`tried` 的格式是 `<path> (不存在)` / `<path> (加载失败: …)`）。它把原来混在一起的两问拆开：① 搜索链落到哪条候选（**平台中立**，任何机器都能断言）；② 那个文件在本平台能不能真加载（只有平台对得上时才断言） |
| 修 `★预置产物就是"没编译器也能用"的那条路` | 非 darwin 上不再断言「异平台 Mach-O 加载成功」——`platform:'darwin'` 只影响**路径选择**，`process.dlopen` 仍跑在宿主平台上 ⇒ 必红；darwin 上仍断言 `available === true` |
| 修同一用例的后半段 | 「x64 上应命中通用落点」原来写死 `arch:'x64'` 且**不**移走按 arch 的目录 ⇒ 只在 arm64 宿主成立（x64 宿主的按 arch 目录恰好就叫 `darwin-x64`）。现在**先把按 arch 的目录移走**再问同一个 arch —— 这才是「按 arch 的目录不存在 ⇒ 落到 fat 产物」的语义 |
| ★新增 `★win32 预置产物棘轮` | 在库 + PE `Machine = 0x8664`（纯字节读 PE 头，任何平台都能验）+ win32 上按预置落点**真加载**；别的平台 `t.skip`（口径同上）。**归属是 `T-0120`**（那是它的政策裁定：win32 产物随仓库分发），只是与本次修改同处一个文件、一次编辑 |
| 头部断言清单 | 第 6 条补上 win32 那份棘轮 |

### 判据（Windows 11 实测）

```
$ npx tsx --test test/native-host.test.ts        # 改后
ℹ tests 13     ℹ pass 12     ℹ fail 0     ℹ skip 1     # skip = darwin 的 lipo/otool 那条

$ npx tsx --test test/native-host.test.ts        # 改前（同一台机器）
ℹ tests 12     ℹ pass 10     ℹ fail 1                 # 红：… is not a valid Win32 application.
```

- ★**没有削弱任何既有棘轮**：`★预置产物棘轮`（存在 + 双架构 + `minos=11.0`）原文未动；降级契约 /
  搜索链顺序 / 门面空实现 / `★E3` 只读探测 / 平台专有函数 / `0x10A` 缝 / 三条源码棘轮全部原样。
  条数 **12 → 13**（新增 win32 棘轮），改前改后都记在这。
- Windows 上撞到的一个坑（写进代码注释）：win32 棘轮会把预置 `.node` **dlopen 进本测试进程**
  ⇒ `rmSync` 临时目录必 `EPERM`（DLL 在进程存活期间被锁）⇒ 该处改成 best-effort 清理并写明原因；
  POSIX 上照常删除。

### 锚点 retarget（`--validate` 抓到的，按口径处理而不是删证据）

改这句断言时，本票 `evidence[0]` 锚的正是**改前那串**（`按 arch 的落点应能加载`）⇒ 守卫当场红：
`T-0121: 证据锚点已消失 —— "按 arch 的落点应能加载" 不在 app/amayui-emulator/test/native-host.test.ts`。
处置 = **retarget 到同义新串**（`按 arch 的落点必须是搜索链的第一命中`，`line: 290`），并把新增的
win32 棘轮补成 `evidence[1]`；原句仍留在 `tickets/T-0120/changes.md` 的实测原文里（**没有删任何一条证据**）。

### 全量 `npm run verify`（本票 acceptance 的最后一条，Windows 11 实测）

```
$ npm run verify            # typecheck && test && check:dead-writes
ℹ tests 1066     ℹ pass 1064     ℹ fail 0     ℹ skipped 2     # exit 0
# 死写检测（扫描 13 个文件；字段 48 个）：当前死写 0 个：无  ★ 无新增死写
```

（改前同一条命令是 **1 fail**：红的就是这条锚点棘轮 —— 它正确地抓到了本票自己改掉的锚点串，
见下节 retarget。⇒ Windows 现在是「本机全绿」，这条信号重新可用。）

### 关联

- 现象与定因的原始记录：`tickets/T-0120/changes.md` §顺带实测 1；
- 本票是 `T-0120` 的「`npm run verify` 在 Windows 上转绿」那条验收的前置（否则那条永远红）。
