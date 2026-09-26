# AGENTS.md —— 在本仓库干活前先读的环境与权限须知

> **本文件只讲"环境/权限/怎么把东西跑起来"**，不讲工程状态。
> 工程状态/判绿口径/台账数字看 `CONTEXT.md`；技能索引（该用哪个技能、读哪份文档）看 `CONTEXT.md` §1；
> 逐条任务看 `tickets/`（真源 `tickets/*/ticket.json`，看板 `tickets/README.md`）。
>
> ★**长期用户要求（未撤销）：不要 `git add` 任何东西。**
> ★**证据不许落 `.tmp/`**（gitignore 的临时区）：结论要么进票据 `tickets/<id>/`，要么进 `analysis/` / `docs-new/`。

---

## 1. ★最重要的一条：沙箱会挡住"管道式子进程"，别把它误判成代码坏了

本仓库的 agent 会话跑在 DSH 文件沙箱下（常见模式 = `workspace-write`）。**受限模式下命名管道被禁**，
而 Node 的 `child_process.spawn`/`exec` **默认 `stdio: 'pipe'`** ⇒ 直接失败：

```
Error: spawn EPERM        errno: -4048, code: 'EPERM', syscall: 'spawn'
```

实测（2026-09-26，node v24.14.0）：

| 形态 | 结果 |
|---|---|
| `spawnSync(process.execPath, ['-e','…'])`（默认 pipe） | `error.code = EPERM` |
| `new Promise(res => { spawn(…默认 pipe…) })` | **reject EPERM**（`spawn()` 在 executor 里同步抛） |
| `spawn(…, { stdio: ['ignore', fd, fd] })` / `'inherit'` / `'ignore'` | **正常** |
| PowerShell 自己的管道（`cmd1 \| cmd2`、`$x = cmd`） | 正常 |

### 1.1 红名单（受限 shell 下**必然**失败，失败面看起来都像"代码写错了"）

| 命令 | 为什么红 |
|---|---|
| `npx tsx …` / `node --import tsx …` | tsx 要起 **esbuild 服务子进程**（pipe）⇒ `ensureServiceIsRunning` EPERM |
| `npm run verify` / `npm run test:all` / `node --test …` | node 测试运行器**每个测试文件起一个隔离子进程**（pipe）⇒ EPERM（表现为整片 `status=null/-1` 的**伪红**） |
| `node plugins/amayui-emulator/smoke.mjs` | 它自己用 `stdio: ['ignore','pipe','pipe']` 起宿主（`smoke.mjs:176`）⇒ EPERM |
| `emu.mjs slotFingerprint()` | 内部 `spawn(node, ['--import','tsx','src/tools/saveDump.ts', …])` 收 stdout ⇒ EPERM（静默降级成"跳过指纹对账"，见 `tickets/T-0192`） |
| `plugins/amayui-emulator/smoke-client.mjs` | ✅ **绿**（纯内存渲染，不起子进程）—— 对照用 |

**症状辨识**：一句 `spawn EPERM` + `syscall: 'spawn'` + 你并没有写错路径/权限 ⇒ 先想"沙箱挡管道"，别再翻代码。

### 1.2 需要更宽权限时的申请口径

* 只有在**确实需要管道式子进程**（上面红名单）时才申请更宽的模式；`danger-full-access` 是唯一能过的那一档
  （两个受限档都禁命名管道）。申请时写清"被拒的是 spawn 的 pipe，不是文件权限"。
* **一次性只读诊断优先走 §2 的钩子路径**，不要为了读一个文件/跑一个脚本去要 `danger-full-access`。

---

## 2. ★跑 TypeScript：用 `scripts/ts-resolve-hook.mjs` + node，**不要**默认上 tsx

Node ≥ 23.6 **自带类型剥离**（`--experimental-strip-types`，本机 v24.14 默认开）⇒ "执行 .ts" 不需要 tsx。
**卡住的只是模块解析**：本仓库 import 全是 NodeNext 口径的 `../x/y.js`（磁盘上是 `y.ts`），
Node 内建解析器**不做** `.js`→`.ts` 改写，本机也没有 `--experimental-ts-module-resolution` 这类开关。

```bash
# ✅ 首选：纯 node + 钩子（同线程解析钩子；不起 worker/子进程 ⇒ 受限沙箱也能跑）
node --import ./scripts/ts-resolve-hook.mjs app/amayui-emulator/src/tools/saveDump.ts ".tmp/instances/<id>/base/SAVE/SAVE78.DAT"

# ❌ 别默认用（受限 shell 下必红）：npx tsx <file>
# ✅ 需要类型检查时（tsc 不起子进程，受限下可用）：
npx tsc -p app/amayui-emulator/tsconfig.json --noEmit        # 或 cd app/amayui-emulator && npm run typecheck
```

钩子只改写一种说明符：**相对 + `.js` 结尾 + 同名 `.ts` 存在**；package 名 / 真 `.js` / `.json`（本仓库那处带
`with { type: 'json' }`）/ `.node` 一律原样交给内建解析器。`TS_RESOLVE_QUIET=1` 可静音它的改写日志。

**什么时候仍要 tsx 或要落盘产物**：

* 需要 esbuild 的**语法转换**（`enum` / `namespace` / 参数属性 / decorator）——原生剥离会拒。
  实测 `app/amayui-emulator/src/**` 里 **0 处**，日常用不到；真遇到就 `node --experimental-transform-types …` 或 tsx。
* 要一份 JS 产物给别的进程用：`npx tsc -p app/amayui-emulator/tsconfig.json --outDir <dir>`（**别写进 `dist/`**，
  那会与 `build-electron.mjs` 的产物混在一起；用 `.tmp/<job>/` 之类）。
  ★仓库里现成的 `app/amayui-emulator/dist/tsc/**` 是**历史产物**，不一定跟得上 `src/`（实测 09-21 的 JS
  对 09-25 的 `save/saveSlot.ts`）⇒ 拿它当"当前口径"会得到**陈旧结论**。

---

## 3. 常用入口速查

| 要做什么 | 入口 |
|---|---|
| 起/驱动调试实例（agent 自足） | DSH 工具 **`amayui_emulator`**：`action=instances/start/stop/query/capture/input/profile/wait`（日志/参数见工具描述）；`action=start` 缺省 `--attach-headless` + 静音 |
| 查/跑/新建**操作脚本（ops）** | 同一个工具的 `action=ops`（列：用例/前置/判据/副作用/状态）、`action=op {name,args}`（执行 + 回日志尾部）、`action=op-create {name,purpose}`（用模板生成新用例） |
| ops 的**真源** | `app/amayui-emulator/tools/ops/*.mjs` + 索引 `ops/README.md`；原语库 `app/amayui-emulator/tools/emu.mjs`（**纯 node**，脱离 DSH 也能跑） |
| 手跑一条 op（不经 DSH） | `node app/amayui-emulator/tools/ops/load-from-title.mjs --instance <id> --slot 79` |
| 引擎/脚本语义、三层数据层 | 技能 `amayui-engine-analysis` / `amayui-script-analysis`（别在这里重述） |
| 开票/改票/收尾 | 技能 `amayui-ticket-ledger`（收尾三连：`build-tickets.mjs` → `tickets.js --validate` → `test/ticket-ledger.test.ts`） |
| 判"什么算绿" | `CONTEXT.md` §6；★`npm run verify` 需要**能起子进程**的 shell（见 §1.1） |

**同时只跑一个**：`npm run shot` / `npm run record` / `npm run verify` / 真人打开的实例 —— 它们抢 Electron 窗口、
共用 `.tmp/amayui-emulator.log` 与 overlay。

---

## 4. 其它易踩的环境事实（与本仓库强相关）

* 渲染页跑的是**构建产物** `dist/renderer.js`：改了 `app/amayui-emulator/src/vm|renderer/**` 之后要
  `npm run build:electron` **并刷新页面**，否则"新命令在页面里不存在"（实测回执 `未知查询：set-array`）。
  宿主侧（`node --import tsx src/web/host.ts`）才直读 `src/`。
* 渲染进程**没有** `process.env`（`renderer/**` 里读它会把窗口打白）。
* `tools/shot.cjs --load N` **不会**载入第 N 槽（只标记，实际载入列表当前行）—— 要载槽用 ops。
* 玩家数据（`SAVE.DAT`、`SYS4REG.INI`）不是测试夹具：要改运行期状态就用 `debug-query` 的 `set-global`/`set-array`
  （只改内存、不写回），见 `T-0189`。
* `git`：**不要 `git add`**；工作区常有多个 agent 的在途改动，动文件前先看 `git status --porcelain`。
