# T-0192 · 过程文档（notes.md）

## 0. 现象与复现（2026-09-26 实测，**不改任何代码**）

在**本会话的 agent shell**（DSH 文件沙箱 = workspace-write）里，**管道式子进程 stdio** 会被拒：

```powershell
# 形态①（spawnSync）
node -e "const {spawnSync}=require('node:child_process'); const r=spawnSync(process.execPath,['-e','console.log(42)']); console.log('status=',r.status,'stdout=',JSON.stringify(String(r.stdout)),'error=',r.error&&r.error.code);"
# → status= null stdout= "undefined" error= EPERM

# 形态②（Promise 包 spawn，与 emu.mjs 的写法同构）
node -e "const {spawn}=require('node:child_process'); new Promise((res)=>{const p=spawn(process.execPath,['-e','console.log(7)'],{windowsHide:true}); let b=''; p.stdout.on('data',d=>b+=d); p.on('close',()=>res('closed:'+b)); p.on('error',()=>res('error-event'));}).then(v=>console.log('RESOLVED',v),e=>console.log('REJECTED',e.code));"
# → REJECTED EPERM      （★spawn() 在 Promise executor 里**同步抛出** ⇒ 走的是 reject，不是 'error' 事件）
```

同一环境里**双进程 spawn 的失败面**不止这一处（顺带量到的，用于说明"这是沙箱边界、不是我写错了"）：

```powershell
cd app/amayui-emulator
npx tsx --test test/ticket-ledger.test.ts
# → ✖ test\ticket-ledger.test.ts  Error: spawn EPERM  （at node:internal/test_runner/runner:415 = 测试文件的隔离子进程）
node --test --experimental-test-isolation=none test/ticket-ledger.test.ts
# → Error: spawn EPERM（at node_modules/esbuild/lib/main.js:2272 ensureServiceIsRunning = tsx 的 esbuild 服务）
```

## 1. 后果链（判据④静默失效 + 归因错）

`emu.mjs` 的 `slotFingerprint()`（`:848-867`）就是形态②：

```js
const p = spawn(process.execPath, ['--import', 'tsx', 'src/tools/saveDump.ts', rel], { cwd: appDir, windowsHide: true });
let buf = ''; p.stdout.on('data', (d) => (buf += d)); …   // ← 默认 stdio:'pipe'
```

于是：

1. `spawn` 同步抛 ⇒ Promise **reject**（EPERM）；
2. `verifyLoadedSlot()` 里 `const fp = await slotFingerprint(id, slot).catch(() => null);`（`:679`）**吃掉**它；
3. 打印 `⚠ 槽 N 的文件读不到（不在实例可见目录？）⇒ 跳过指纹对账`（`:681`）—— **归因错**：
   槽文件就在 `.tmp/instances/<id>/overlay/SAVE/SAVE<NN>.DAT`；
4. op 仍 `exit 0` 并打印 `✔ [ops] 已载入槽 N` ⇒ **「载错了槽」与「根本没能对账」在输出上不可区分**。

影响：`T-0188` / `T-0189` 的**判据④（槽指纹对账）在受限 shell 里等于不存在**，而它的用途恰恰是
`ops/README.md:53` 写的"选行对不对"的唯一机读口径（引擎日志不回槽号）。

## 2. 影响面（已逐处核过：受影响的只有这一处 spawn）

| 落点 | stdio | 受限 shell 下 |
|---|---|---|
| `emu.mjs:854` `slotFingerprint` 的 `tsx src/tools/saveDump.ts` | **默认 pipe**（`p.stdout.on('data')`） | **EPERM ⇒ 判据④静默跳过** |
| `emu.mjs:719-725` `startInstance` | `['ignore', out, out]`（文件 fd） | 正常 |
| `emu.mjs:761` `stopInstance` 的 `taskkill` | `'ignore'` | 正常 |
| `load-slot.mjs:43` 转发壳 | `'inherit'` | 正常 |
| `lib/tools.js:463-469` 工具 `start` | 文件 fd | 正常 |
| `lib/tools.js:587` 工具 `killTree` | `'ignore'` | 正常 |

⇒ `reset` / `start` / `stop` / 两帧点击 / 读帧与全局 **不受影响**；坏的只有"槽指纹对账"这一步。

## 3. 修法权衡（本票验收第 2 条要求二选一）

1. **不自起子进程（首选）**：把 `src/tools/saveDump.ts` 的槽头解析抽成可 `import` 的纯函数，
   `slotFingerprint` 进程内直接读 —— 顺带消掉 tsx 冷启（现在每次对账要起一个 tsx 进程），
   且**根除**这类"读不到但报成目录问题"的假阴性。
2. **保留子进程但换通道**：`stdio:'inherit'` + shell/文件重定向到临时文件，再读回那份文件
   （**不许用 pipe**）。代价是仍然依赖 `tsx`（esbuild 服务本身在受限 shell 里也起不来，
   见 §0 的实测）⇒ 若走这条路，"谁来起 tsx"必须一起回答。

两种都要保留原语义：**槽文件真的不存在时**继续打原来的跳过文案（两种情形必须可区分）。

## 4. 与 T-0191 的关系

`T-0191`（工具面 × ops）若选方案 A（工具 spawn `ops/*.mjs` 并读结果），必须从这条坑出发设计通道：
**不要用 pipe 抓子进程 stdout**。本票只修 `emu.mjs` 自己那一处，不作为 T-0191 的前置（两票可各自独立收口）。

## 5. 追加（同日，另一路独立证据 + 不需要提权的等价路径）

**另一路证据（另一个 agent 的现场）**：并行任务为跑 `npx tsx src/tools/saveDump.ts "…\SAVE78.DAT"` 申请提权
（理由 = "tsx/esbuild 需要起子进程（默认 stdio: pipe），被沙箱的命名管道限制挡住（EPERM）"）。
这与本票**同源**：`slotFingerprint` 起的正是同一条命令（`emu.mjs:853-854`，形态 = `node --import tsx …`，
手工版 = `npx tsx …`），死的也是同一处（tsx → esbuild 服务，实测红在 `node_modules/esbuild/lib/main.js:2272
ensureServiceIsRunning`）。⇒ 机制描述成立；`danger-full-access` 也确实是唯一能过的档（两个受限档都禁命名管道；
`inherit`/`ignore` 不受影响 —— 这也解释了为什么 `npx` 本身能起、而 esbuild 服务起不来）。

**但它不是必需的（本票实测的等价路径，全程不提权、且不产出任何构建物）**：

★首选：**Node 自带类型剥离直接跑 `.ts`**（本机 v24.14 实测）。裸跑**不行** —— `node src/tools/saveDump.ts …`
红在 `ERR_MODULE_NOT_FOUND: …\src\arch\overlay.js`：Node 的内建解析器**不把** `.js` 改写成 `.ts`，
而本机 node 也没有 `--experimental-ts-module-resolution` 这类开关（`node --help` 只列
`--experimental-strip-types` / `--experimental-transform-types`）。补一个 15 行的**同线程**解析钩子即可：

```powershell
# 钩子已**固化进仓库**（不再是 .tmp 探针）：scripts/ts-resolve-hook.mjs
node --import ./scripts/ts-resolve-hook.mjs app/amayui-emulator/src/tools/saveDump.ts ".tmp/instances/<id>/base/SAVE/SAVE78.DAT"
# → 0.2s、exit 0；输出与"tsc 产物 + node"那条路**逐行一致**（savedCur=2 / 池：int=1015792（非零 2269） …）
```

★钩子本来是 `.tmp` 里的 15 行探针（`module.registerHooks` 把相对 `…js` 改写成同名 `.ts`，不起 worker/不起子进程）；
本轮已按用户要求固化进仓库并写进 **`AGENTS.md` §2**（连同"哪些命令在受限 shell 下必红"的红名单）。
`TS_RESOLVE_QUIET=1` 可静音它的改写日志。

为什么这条路更合适：**零构建产物**（tsc 那条要铺 323 个文件，已清理）；不起 tsx/esbuild（绕开本票的 EPERM）；
`src/**` 只有一处 JSON import 且写法合法（`src/opcodes.ts:12` 带 `with { type: 'json' }`）；
全 `src/` **无 `enum`/`namespace`** ⇒ 默认的 strip-types 就够，不需要 `--experimental-transform-types`。

备选（需要"不依赖 `.tmp` 的一次性产物"时）：`npx tsc -p tsconfig.json --outDir ../../.tmp/tsc-probe`
（6.6s、exit 0；tsc 不起子进程 ⇒ 沙箱放行）→ `node ../../.tmp/tsc-probe/tools/saveDump.js …`。
★**不要**直接用仓库里已有的 `dist/tsc/tools/saveDump.js`：那份是 **09-21 23:34** 的产物，
而 `src/save/saveSlot.ts`（09-25 01:40）、`src/vm/engineSlot.ts`（09-24 00:26）都比它新
⇒ **解析器陈旧**（engineSlot 正是槽解码那一环），拿去判"还原范围"有风险。

**对本票修法的推论（收窄选项①的边界）**：`ops/*.mjs` 是用**纯 node** 跑的（不带 tsx），而
`src/tools/saveDump.ts` 的 import 全是 `../save/saveData.js` 这种 `.ts`→`.js` 改写（见其 `:20-25`）
⇒ 选项①"抽成可 import 的纯函数"必须**同时**满足"纯 node 可加载"，三条路：① 落成 `.mjs`/`.js` 模块（最简）；
② 用 `--import` 那个解析钩子、或把它固化成一个提交进仓库的 loader，让纯 node 直接 import `.ts`（本次实测可行）；
③ 走"先 `tsc` 出 `.tmp` 再用 `node` 跑"——否则只是把 tsx 依赖挪了个位置。

## 6. 待核（不作为本票判据）

* ~~插件宿主进程（DSH server 内部）是否也受同一条沙箱约束~~ —— ★**2026-09-26 已答：不受**。
  证据 = `T-0191` 的真机端到端：工具（插件宿主）spawn 的 op 内部又 `spawn(tsx src/tools/saveDump.ts)`（默认 pipe），
  **成功**读回槽指纹（`槽指纹对账：槽 78 文件 savedCur=2/帧记录 3 条 vs 日志 … ⇒ ✔ 一致`，
  归档 `tickets/T-0191/evidence/e2e-action-op-load78.log`）⇒ 这条限制只覆盖 **agent shell 的后代进程**。
  ★实务推论：同一个 op，**用工具 `action=op` 跑**判据④工作；**在受限 agent shell 里直接 `node …/ops/x.mjs` 跑**则判据④静默跳过。
* `npx tsx --test` 在**不受限**的终端（用户自己开的 pwsh）里是否正常 —— 预期正常，
  本票只登记本会话观测到的事实。
