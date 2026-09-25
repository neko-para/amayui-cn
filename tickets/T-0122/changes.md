# T-0122 变更记录 —— 引擎态快照 / 恢复（调试器第 3 步「存 / 回」）

> 范围：新增 `src/vm/engineSnapshot.ts`（核心）+ `test/engine-snapshot.test.ts`（7 条守卫）；
> 改 `src/vm/debugCommand.ts`（两个命令）、`src/renderer/app/session.ts`（两个 case）、
> `src/renderer/pixiBackend.ts`（一个只读 getter）、`src/vm/route.ts`（`snapshotState/restoreState` 一对方法）、
> `tools/debugsrv.cjs`（`save`/`load` 的落盘/读取）、`tools/dbg.cjs`（用法注释）。
> **不动 `src/*.txt`、不 eval、渲染进程不碰 fs**（承 `T-0114` 的三条硬约束）。

## 第 1 次变更（2026-09-25，`T-0179` 第 70 轮 goal round 4）：核心 + 守卫 + 工具面

### 1. 快照结构（自描述 + 版本头）

`EngineSnapshotV1.header = { format: 'amayui-engine-snapshot', version: 1, at }`；覆盖票面 acceptance 列的全部量：

| 分区 | 内容 |
|---|---|
| `key` / `cur` | DEC/ENC key（int 池里是**编码值**，key 不同则解出来全错）+ 当前帧深度 |
| `globals` / `frames[].locals` | 六个池（int/float/str/ptr/floatPtr/strPtr）—— **按键升序**的 `[k,v]` 数组（同样状态 ⇒ 逐字节相同的 JSON）；`ptr` 族做结构克隆（不与活状态共享对象） |
| `frames[]` | `name` / `scriptId` / `ip` / `caller` / `frameArg` / `curDwordOffset` / `retStack` / `strTable` |
| `engineValues` / `texSlots` / `texSlotFlags` | 三张 Map（同上按键升序） |
| `dispatchQueues` / `scriptRequests` | 派发队列与脚本请求队列 |
| `gates` | `waitFlags` / `effectFlags` / `gateWaitStart` / `gateWaitMs` / `sceneFreeze` / `scenePending` |
| `textItems` | `records` / `pages` / `cursor` / `baseCursor` |
| `routes` | 经 `RoutePanel.snapshotState()` / `restoreState()`（★**不** `structuredClone` 实例：那会丢原型、把实例换成普通对象，而且私有格外部读不到） |
| `scene.render4` | `transitions` / `slotModes`（宿主给了 scene 才有；`vm/` **不** import `renderer/`，用结构化类型传入） |

**「原始值 + 解码值两个口径」**：int 池按**存储原样**（编码值）序列化，`key` 一并带上 ⇒ 读文件的人用 `DEC(x)=ror32(key ^ rol32(x,11),25)` 就能得到解码值 —— 两个口径都在同一份文件里。

### 2. ★核心纪律：`SNAPSHOT_EXCLUDED`（8 条，每条带 `why`）+ 逐条告警

票面把这条列为「本票的核心判据」。清单里的 8 条：池外裸量（`global f8080` 一族）、L2D 运行态、纹理在途/宿主槽对象、
音频队列与设备运行态、门计时器墙钟起点的跨进程口径、`debugEvent`/观察者/`#onWrite` 回调、装载期输入
（`fileSource`/`config`/`native`/`musicTable`/`agerc.loaded`）、`TextItemTable` 的私有 `groupStart` 标记。

`restoreEngineSnapshot` 的返回值 `warnings` **逐条**覆盖它们（外加一条"当前值"现状行）⇒ 调查者不会误信快照是完整的；
`session.ts` 把 `warnings` 同时写 trace 与命令回执（`⚠ …`）。

### 3. 守卫（`test/engine-snapshot.test.ts`，7 条，全绿）

| # | 判据 | 说明 |
|---|---|---|
| ① | **round-trip** | snapshot → 逐类改乱（池/帧/队列/门/文本项/路由/cur）→ restore ⇒ 与未改乱**逐字段相等**；**JSON 往返**也相等（文件形态不丢字段） |
| ② | **正例棘轮** | 11 个「不该为空」的量必须有真值（含 `engineValues`/`texSlots`/`textItems.records`/`retStack`/`strTable`/`key`/版本头/格式名）—— 防"恢复了个空快照也算过" |
| ③ | **源码棘轮 + 告警覆盖** | 清单每条 `what`/`why` 有最小长度、**显式**出现在模块源码里，且 `restore` 的告警**逐条**覆盖它 |
| ④ | **继续跑不撕裂（最强的一条）** | 跑到 300 步抓快照 → 再跑 600 步抓"自然态" → 回灌 300 步那份 → **再跑 600 步** ⇒ 与"自然态"**逐字节相等**（差异即"某个量没回去"；同时钉住"没漏字段"与"没多出字段"） |
| ⑤ | **版本棘轮** | 版本不认识 / 不是快照 / JSON 缺 `frames` ⇒ **响亮拒绝**（不许"尽力而为"地灌一半） |
| ⑥ | **帧边界纪律** | 本模块不 import `renderer/`、无 `eval`、**一处文件 IO 都没有**（IO 留给守护进程/宿主） |
| ⑦ | **命令面** | `snapshot` / `restore <base64>` 的解析（大小写不敏感、UTF-8 含中文逐字节往返、缺参数与坏 base64 都走"当查询回报"口径不抛） |

★④ 的写法值得记：**"恢复后跑 N 步再抓一份快照，与自然跑到的逐字节比"** 比"不抛异常"强得多 —— 它把
「漏一个字段」和「多灌一个字段」两类错都变成确定性红。

### 4. 工具面（`tools/dbg.cjs` → `tools/debugsrv.cjs`）

- 渲染窗侧的两个纯内存动词：`snapshot`（只读导出 JSON）/ `restore <base64>`（灌回 + 逐条告警）。
- **带路径的整件事在守护进程**：`save <路径>`（取 `snapshot` 的 JSON 落盘）/ `load <路径>`（读文件 → `restore <base64>`）。
  ★为什么在这一层：渲染进程**没有 fs**，而守护进程同时"够得到渲染窗的答案"且"够得到磁盘"。
- `dbg.cjs` 的用法头 + `DEBUG_COMMAND_HELP` 都补了这几条。

### 5. 真源/文件清单

新增：`src/vm/engineSnapshot.ts`、`test/engine-snapshot.test.ts`。
改：`src/vm/debugCommand.ts`、`src/renderer/app/session.ts`、`src/renderer/pixiBackend.ts`（+ `get sceneForSnapshot`）、
`src/vm/route.ts`（+ `snapshotState`/`restoreState`）、`tools/debugsrv.cjs`、`tools/dbg.cjs`。
★改了 `src/vm/**` 与 `src/renderer/**` ⇒ 已跑 `npm run build:electron` 重建 `dist/web/renderer.js`（否则页面里拿不到新命令）。

## 仍未做（如实登记，下一轮/后续切片）

1. **真语料版本的对照（E3 级）**：现有 ④ 用的是 `harness.ts` 的合成确定性脚本（E2 级）。要按票面写"真脚本跑到某帧再回灌"，
   需要接 headless 启动链（`gameStartChain`/`scenarioRun` 一族）—— 那是另一个切片。
2. **非帧边界恢复的安全点集合**：票面 acceptance 允许"若允许非帧边界恢复，必须写清能安全恢复的时刻集合"。
   本切片**只支持帧边界**（`session.ts` 的调用时机就是命令到达时；`stepOnce` 是原子的、handler 内无 await 点，
   所以"命令到达时"天然落在指令边界上，但**不在**帧边界上）⇒ 这条口径要下一轮写清或在调用点加帧边界门。
3. **L2D / 纹理 / 音频**：仍按 `SNAPSHOT_EXCLUDED` 披露（不是本票范围）。

## 第 2 次变更（2026-09-25，goal round 5）：**帧边界门**（票面 acceptance 的最后一条 ⚠）

票面写「★优先只在帧边界做（避开在途态）」，第 1 次变更只做到"命令到达时"——而那一瞬落在**指令**边界
（`stepOnce` 是原子的、handler 内无 await 点），**不在帧边界**：可能正处在"本帧画了一半 / 池在双缓冲交换中 /
纹理屏障在途"的中间态。

**改法**（`src/renderer/app/session.ts`）：
- 新增 `#boundaryWaiters: (() => void)[]` + **`#atFrameBoundary(timeoutMs = 5000)`**；
- **帧末统一放行**：`#onFrameEnd` 末尾把全部等待者 resolve（注释里写明"帧边界到了"）；
- `snapshot`/`restore` 移进 `onDebugQuery` 的**异步分支**：先 `await this.#atFrameBoundary()`，
  再走同步的 `#applyDebugAction`（这样"取/灌"两个动作都发生在确定的帧边界上）；
- **超时响亮失败**：5s 内没等到帧边界（帧循环没在跑）⇒ `ok:false` + 原因，**拒绝在中断态就地做**；
- 同步 switch 里给这两个命令留「必须走异步分支」的桩（防止有人接到同步派发上、绕过这道门）。

**守卫 ⑧**（源码棘轮，四处代码形状各对应一个真实故障：① 必须先 await；② 超时变成失败且有上界；
③ 同步路径留桩；④ 帧末必须放行）。
**红→绿实测**：摘掉 `await this.#atFrameBoundary();` ⇒ **7/8**（守护 ① 红），恢复 ⇒ **8/8**。

⇒ 票面 acceptance 现在**只剩「真语料 E3 对照」一条**（现有 ④ 用的是合成确定性脚本，E2 级）。

## ★落地时被"工程的棘轮"绊到的两处（值得记，都是**守卫挣回成本**的实例）

1. **测试文件的分类头**：新加的 `test/engine-snapshot.test.ts` 缺首行 `/** @tier T0 @kind core @subsystem vm */`
   ⇒ `npm run test:all` **不是**报某个用例失败，而是在 `test/run.ts:81` 抛 `Cannot read properties of null (reading 'tier')`
   —— 看起来像"运行器坏了"，其实是"新文件没登记分类"。**教训**：加测试文件的第一件事是抄分类头。
2. **宿主新增方法必须入清单**：给 `PixiBackend` 加只读 getter `sceneForSnapshot` 后，
   `test/native-tap.test.ts` 的「★桥能力面：宿主的方法要么在桥里，要么在"非桥"清单里登记过（T-0013）」当场红。
   ⇒ 已在 `NON_BRIDGE['pixiBackend.ts']` 按**字典序**登记并写明「调试器只读访问器，不是『VM 让宿主做事』」。
   **教训**：动 `src/renderer/**` 的宿主类时，"加一个方法"= "要在 `NativeBridge` 或 `NON_BRIDGE` 里回答一次它是什么"。

