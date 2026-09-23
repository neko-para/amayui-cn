# T-0132 · 变更记录

## 第 1 次变更（2026-09-23，本会话）：方案 1 —— `all`/`verify` **不含 T2**，落首个 T2 真机文件

用户选定**方案 1**（见 `notes.md` §2 的两条路）：`all` = T0 + T1，T2 只能显式 `npm run test:e4` 跑。

### 1. 改了什么

| 物 | 改动 |
|---|---|
| `test/run.ts` | `case 'all'` 由 `pick(() => true)` 改成**只选 T0/T1**（与文件头注 `all = T0 + T1` 一致）；头注补 `e4` 一行 + 一整节写明"为什么不含 T2"与"什么时候必须跑 e4" |
| `tools/shot.cjs` | `shot()` 的产物行新增 **`colors=N`**（对 `capturePage()` 的 bitmap 自适应采样 ~2 万点、数不同 RGB 三元组）+ 保留原有 `★几乎全黑` 旗标。原来只有"全黑"这一个像素信号 ⇒ 白块/纯色帧抓不到 |
| `test/e4-gamestart-shot.test.ts`（**新增**，`@tier T2 @kind tool @subsystem host`） | 真 Electron 跑 `--gamestart`，判据 = 三个 `waitLog` 标记 + 标题帧/ADV 首文案帧的 `colors ≥ 64` 且非全黑；含**纯函数判据自检**（喂合成 stdout）+ 前置探测/`t.skip()` |
| `test/organization.test.ts` | ①档位不变量由 `t0 + t1 === files.length` 改成 `t0 + t1 + t2 === files.length`（原式等于把"T2 必须为空"当规则）；②新增 **T2 档位诚实**（声明 T2 必须真有 `electron` 依赖证据）+ **T2 不许回到 0** |

### 2. 口径对照实验（本机 2026-09-23，原始数字）

| 口径 | 文件 | 用例 | 墙钟 | 机器要求 |
|---|---|---|---|---|
| `npm run verify`（= typecheck + `typecheck:test` + `test:all` + 死写） | 169 | **1086** | **36.6 s** | 无 |
| `npm run test:e4`（T2） | 1 | 2 | **42.1 s** | ★真 Electron + GUI 会话 |
| 对照：把 T2 临时并回 `all` 后 `npm run test:all` | 170 | 1088 | **52.6 s** | 同上 |

★**修正我自己的估数**：并回 `all` 的边际墙钟只有 **+16 s**（node:test 按文件并行 ⇒ 那 42 s 与 T0/T1 重叠），
不是最初估的"数十秒"。**决定口径的仍然不是这 16 s，而是失败模式**：本轮实测在自动化 shell 里
Electron 直接 `Failed to initialize sandbox: Operation not permitted` → GPU 进程 SIGTRAP →
run 起不来（要显式 `--no-sandbox`）。提交闸门红在"宿主环境"上而不是"代码"上，是不可接受的假红来源；
T2 的合理位置是"改动渲染宿主/输入/帧时序时显式跑"。

### 3. 判据与真机实测数字

| 类别 | 判据 | 实测 |
|---|---|---|
| 链路深度 | `[shot] TITLE=true` / `GAMESTART=true` / `SN0000=true`（`waitLog` 等日志标记，**不睡固定秒数**） | 三个都 `true` |
| 像素本身 | 标题帧 / ADV 首文案帧 `colors ≥ 64` 且无 `★几乎全黑` | 标题 **14985**、首文案 **13737**、gamestart 11877、next 7299、hover-out 7805、hover-in 7382；**纯色/黑屏帧 = 1** ⇒ 阈值有 ~100× 余量 |
| 尺寸 | 只钉"≥ 逻辑 1280×720 + 16:9" | `capturePage()` 给**物理像素**：本机 DPR=2 ⇒ **2560×1440**（钉死 1280×720 会换机假红） |

### 4. 反例实验（判别力证据）

| 改动 | 期望 | 实测 |
|---|---|---|
| `session.ts` 的 `present` 改成不合成（`if (false) this.#native.present?.(…)`） | `test:e4` 红 | **fail 1**（39.2 s），失败信息同时点出两帧 `colors=1` —— 而 `TITLE/GAMESTART/SN0000` **仍为 true** ⇒ 像素判据有**独立**判别力 |
| 还原 `session.ts`（逐字节 `cmp` 一致） | 绿 | ✅ `2/2 pass` |
| 判据自检（不需要 Electron）：合成 stdout「好帧 / 纯色帧 / 缺标记」 | 三种结论不同 | ✅ 三种分别得到：无问题 / 报 `colors=1` / 报"链路未到达 SN0000" |

### 5. 前置探测 + skip 策略（缺什么说什么，不当 fail）

`node_modules/electron` 缺 / `dist/electron/main.cjs` 缺 / `resources` 根缺 / 非 macOS 且 `DISPLAY` 未设
⇒ `t.skip('T2 前置不满足：…')`。★本机（darwin）实测走的是**真跑**，不是 skip（`test:e4` = 2 例 0 skip）。

### 6. 收尾

`npm run verify` 全绿（见 §2；`test:org` = 170 文件 T0 124 / T1 45 / T2 1、0 问题）；四份台账 `--validate` 绿；
`docs-new/04-app/test-organization.md` 新增 §8.3（口径对照 + 判据表 + 反例实验）并更新 §5/§7/§9；
`docs-new/04-app/emulator.md` 的现状表与命令节同步。
