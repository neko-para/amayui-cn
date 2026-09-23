# T-0134 · 调试观察宿主 Phase 1 —— 接口冻结 + 工作流分工

> 设计来源：`tickets/T-0133/notes.md`（Part B 与 §0.9/§0.10/§0.11）。
> 本文件是**并行开发的协调面**：三条工作流的**写白名单**、**冻结接口**、**必须保住的锚点字面串**、**退出判据**。
> 纪律（`amayui-ticket-ledger` 技能 §5）：`tickets/` 由主 agent **独占写入**；子代理只回报告。

---

## 0. 全局规则（三条工作流共用）

1. **写白名单之外一律只读**。需要改白名单外的文件 ⇒ **停下来报告**，不要动（避免与其它工作流撞车）。
2. **不许跑共享资源命令**：`npm run verify` / `npm run test:all` / `npm run shot` / `npm run record` / `electron` / `npm run build:electron`。
   只允许：`npx tsx --test test/<你的测试>.test.ts`、`npx tsc -p tsconfig.json --noEmit`（必要时 `npx tsc -p tsconfig.test.json --noEmit`）。
   （`verify` 与 Electron 由主 agent 在所有工作流结算后**串行**跑一次。）
3. **锚点字面串必须保住**（下表）。确实必须改的 ⇒ 在报告里**显式申报**（"我改了 `<文件>` 里的 `<串>`"），由 owner（主 agent）retarget。
   **不许**用"删证据/降状态"消红。
4. **零 VM 语义变更**：新增能力只走**可选**缝；opcode 行为、场景模型、`FrameDigest` 口径不变。
5. 报告格式：① 改动文件清单；② 新增/变更的公开 API；③ 你跑的命令 + 观察到的结果；④ 保住的锚点；⑤ **申报破掉的锚点**；⑥ 没做完/不确定的事。

### 必须保住的锚点（`tickets.js --anchors-in <文件>` 的实查结果）

| 文件 | 必须原地保留的字面串 |
|---|---|
| `src/vm/input.ts` | `hitTestPending`、`水平滚轮增量累加器`、`(this.buttons & 1)`、`advanceThrottle = 0;`、`keyEdge = 0;`、`onCursorMove?: (x: number, y: number) => void;`、`releaseAllMouse(): void`、`this.hitTestPending = true; // 等待泵消费它时做一次 sub_403C50` |
| `src/frame/scenario.ts` | `export interface ScenarioSpec`、`kind: 'cursor' \| 'press' \| 'release' \| 'wheel' \| 'keydown' \| 'keyup' \| 'note';`、`export function applyScenarioEvent` |
| `src/vm/debugCommand.ts` | `export const EVENT_KINDS`、`export function parseDebugCommand`、`export type DebugAction` |
| `src/renderer/app/session.ts` | `SAFETY_PER_FRAME`、`PRODUCT_FRAME_POLICY`、`#onAdvanceWait`、`kind: 'tick'`、`texturesIdle`、`#pausedOp`、`error: controlErrorText(` |
| `src/renderer/pixiBackend.ts` | `advanceModel`、`#meshVisible`、`needsRender`、`setWaitFlag`、`advanceModel(nowMs: number): void`、`poolPending(): boolean`、`setSystemCursor(x: number, y: number): void {`、`captureCanvasIntoSlot`、`#captureStageCanvas` |
| `electron/paths.ts` | `RESOURCE_DECISION`、`export const LOG_PATH` |
| `electron/ipc/files.ts` | `read-save-slot`、`ipcMain.handle('write-save-data'`、`function configRatchetOk`、`read-save-data-both` |
| `src/frame/host.ts` | `export interface FrameHost` |

**已知要申报的两处破锚**（实现不可避免，主 agent 会 retarget）：
* `src/frame/scenario.ts` 的 `input.setCursor(x, y, true);`（T-0133 自己的锚，会变成 `input.setCursor(x, y, ev.valid ?? true);`）
* `electron/ipc/files.ts` 的 `const fileSource = new NodeFileSource`（T-0133 自己的锚，单例要搬到宿主服务里）

---

## 1. WS-1 · 输入桥 + focus 手动控制

**写白名单**
```
app/amayui-emulator/src/frame/scenario.ts
app/amayui-emulator/src/vm/input.ts
app/amayui-emulator/src/vm/debugCommand.ts
app/amayui-emulator/src/renderer/pixi/inputAttach.ts
app/amayui-emulator/src/renderer/app/session.ts
app/amayui-emulator/test/bridge-input-focus.test.ts      （新建）
```

**冻结接口**
```ts
// ── src/vm/input.ts ─────────────────────────────────────────────
export type HostFocus = 'auto' | 'on' | 'off';
class InputManager {
  /** 宿主焦点模式（'auto' = 跟随真实 DOM 事件；'on'/'off' = 调试器显式指定）。
   *  ★不进 InputSnapshot：它是宿主/调试状态，不是 VM 输入状态（在注释里写清这个决定）。 */
  hostFocus: HostFocus;                    // 初值 'auto'
  /** 设模式；'off' 时**立刻**执行与 DOM blur 路径完全相同的释放（releaseAllMouse + releaseAllKeys）。 */
  setHostFocus(mode: HostFocus): void;
}

// ── src/frame/scenario.ts ───────────────────────────────────────
export interface ScenarioEvent {
  // …原有字段不动（kind 联合**不许改字面串**，T-0052 锚）
  /** 仅 cursor 用：false = 光标出窗（等价 inputAttach 的 mouseleave）。缺省 true。 */
  valid?: boolean;
}
// case 'cursor': input.setCursor(x, y, ev.valid ?? true); break;

// ── src/vm/debugCommand.ts ──────────────────────────────────────
export type DebugAction = /* 原样 */ | { a: 'focus'; mode: HostFocus };
// 解析：`focus` / `focus auto` / `focus on` / `focus off`（无参 = auto）；帮助文本加一行

// ── src/renderer/pixi/inputAttach.ts ────────────────────────────
// ★该文件是 DOM 绑定代码，Node 测试进不来 ⇒ 把手动模式的判定**抽成 DOM-free 的导出函数**，
//   DOM 监听器只做薄调用（这样 WS-1 的验收 3/4 才能在 Node 里断言）：
/** blur/失焦的共享处理：hostFocus !== 'auto' ⇒ 忽略（调试器说了算）。返回是否真的释放了。 */
export function handleHostBlur(input: InputManager, trace: (line: string) => void): boolean;
/** visibilitychange(hidden) 的共享处理（同上口径）。 */
export function handleHostHide(input: InputManager, trace: (line: string) => void): boolean;
// 两个 DOM 监听器改为调用它们；忽略时写一行 `[input] 失焦被手动焦点模式忽略（mode=…）`。
//   —— 这是「手动模式」的定义：不再由宿主噪声清输入

// ── src/renderer/app/session.ts（registerControlHandlers）───────
//   if (act && act.a === 'focus') this.#e.input.setHostFocus(act.mode);   // 并写一行 traceLog
```

**验收（必须有自己的测试断言）**
1. `{kind:'cursor', valid:false}` 与 `inputAttach` 的 mouseleave **同 `InputSnapshot`**（至少断言 `hasCursor===false`、`x===-100000`、`touchId===0`，且都在移动后成立）。
2. hover 真的发生：构造真 `Engine`（用测试里既有的最小装配方式），把 `onCursorMove` 接上 `routes.hitTest`，在等待态注入 `{kind:'cursor',x,y}` ⇒ 断言命中测试被调用 / `hitTestPending` 被消费 / `routes.cursor` 变化。
3. `focus off` 的 `InputSnapshot` 与"按下若干键+鼠标后触发 DOM blur"的 `InputSnapshot` **逐字段相等**。
4. 非 auto 模式下：`hostFocus='off'` 时调用 blur 处理器 **不**改变 snapshot（这是它与 auto 的唯一区别）。
5. `parseDebugCommand('focus off')` → `{a:'focus',mode:'off'}`；`'focus'` → `auto`；非法参数（`focus xx`）→ 报错且不崩。

**提示**：`test/harness.ts` 与 `test/engineSlotFixtures.ts` 里有既有的 Engine 装配套路，先读再写测试。

---

## 2. WS-2 · 帧捕获缝（`FrameHost.capture`）

**写白名单**
```
app/amayui-emulator/src/frame/host.ts
app/amayui-emulator/src/renderer/pixiBackend.ts
app/amayui-emulator/test/frame-capture-seam.test.ts      （新建）
```

**冻结接口**
```ts
// ── src/frame/host.ts ───────────────────────────────────────────
export interface FrameHost {
  // …原有成员一律不动
  /** 抓一帧当前合成结果为 **PNG 字节**（可选能力：headless 不实现 = 没有像素）。 */
  capture?(): Promise<Uint8Array>;
}
/** 桥的**唯一**调用点：宿主没有 capture 就返回 null（调用方据此降级，而不是抛错）。 */
export async function capturePng(host: FrameHost): Promise<Uint8Array | null>;

// ── src/renderer/pixiBackend.ts ─────────────────────────────────
/** 公开：抓一帧当前舞台合成结果为 PNG。★复用既有的私有 `#captureStageCanvas()`（不改名、不删）。 */
async captureFrame(): Promise<Uint8Array>;   // 内部：canvas.toBlob('image/png') → arrayBuffer
```
* `src/renderer/headlessFrameHost.ts` **不**加 `capture`（无像素语义；那是它的定义）。
* **不要**动 `src/renderer/app/session.ts`（属 WS-1）——主 agent 负责把 `capture` 接进 session 的帧宿主。

**验收**
1. 用桩宿主断言：有 `capture` ⇒ `capturePng()` 原样返回字节；无 ⇒ 返回 `null`（不抛）。
2. **源码棘轮**（Node 里没有 WebGL，不能实例化 Pixi）：读 `src/renderer/pixiBackend.ts` 文本断言 ①`#captureStageCanvas` 仍在 ②`captureFrame` 存在且函数体里调用了 `#captureStageCanvas`。仓库已有 `test/guardAnchor.ts` 的同类做法，可参考。
3. `headlessFrameHost` 的源码文本**不含** `capture`（防止将来有人顺手加上）。
4. 类型断言：`FrameHost` 的实现方（Pixi 侧）满足带 `capture` 的形状（用 `satisfies`/类型测试即可，别真的实例化）。

---

## 3. WS-3 · 宿主服务去单例 + 实例隔离

**写白名单**
```
app/amayui-emulator/src/host/instance.ts     （新建，零 electron import）
app/amayui-emulator/src/host/service.ts      （新建，零 electron import）
app/amayui-emulator/electron/paths.ts
app/amayui-emulator/electron/logging.ts
app/amayui-emulator/electron/ipc/files.ts
app/amayui-emulator/test/host-instance.test.ts   （新建）
```

**冻结接口**
```ts
// ── src/host/instance.ts（Node 侧，**不许** import electron）────
export interface InstanceLayout {
  id: string; root: string; baseDir: string; overlayDir: string;
  logPath: string; tracePath: string; replayPath: string;
}
export interface InstanceOptions {
  id?: string;                 // 缺省 'default'
  root?: string;               // 缺省 <repo>/.tmp/instances/<id>
  baseDir?: string;            // 覆盖 base（seed 模板/真存档）；缺省沿用 resolveSystemPaths 的结果
  resourceDir?: string;        // 缺省沿用现有决策（RESOURCE_DECISION）
  env?: NodeJS.ProcessEnv;     // ★传给 resolveSystemPaths 的第二参，**不改 process.env**
}
export function instanceLayout(opts?: InstanceOptions): InstanceLayout;
export const DEFAULT_INSTANCE_ID = 'default';

// ── src/host/service.ts（Node 侧，零 electron import）──────────
export interface Appender { write(text: string): void }
export interface GzAppender extends Appender { close(): Promise<void> }
export class HostService {
  constructor(layout: InstanceLayout, resourceDir: string);
  readonly layout: InstanceLayout;
  readonly log: Appender;       // 每实例独立
  readonly trace: Appender;
  readonly replay: GzAppender;
  close(): Promise<void>;
  // ↓ 与 electron/ipc/files.ts 现有 handler **一一对应、返回同一数据形状**
  readScript(index): Promise<{index:number;name:string;data:number[]} | null>
  readScriptByName(name) / readFile(p) / appendPackNumbers() / readConfigIni() / saveConfigIni(text)
  readSaveData() / writeSaveData(data) / readSaveDataBoth() / readSaveFlags()
  readSaveSlot(slot) / writeSaveSlot(slot,data) / deleteSaveSlot(slot) / copySaveSlot(from,to)
  readSlotThumb(slot) / writeSlotThumb(slot,data)
  image(id) / readById(id) / audio(key) / musicTable() / font(file)
}
export function createHostService(opts?: InstanceOptions): HostService;
export function defaultHostService(): HostService;   // 进程内默认实例（Electron 用）
```
* `electron/ipc/files.ts`：**保留** `registerFileIpc()`、全部 channel 名、全部日志行文案（`[main] …`），
  handler 体改为委托 `defaultHostService()` ⇒ Electron 行为零变更。
* `electron/logging.ts`：appender 的创建与路径改为向实例模块要（`log-line-sync` 的**同步**语义必须保持）；
  `electron/paths.ts` 的 `LOG_PATH`/`TRACE_PATH`/`REPLAY_PATH` **保留为默认实例的路径**（锚不破 + 现状不变）。
* `function configRatchetOk` 必须**留在 `files.ts`**（T-0031 锚）：真实现移进 service，files.ts 里保留同名薄壳委托（一行注释说明为什么保锚）。
* `RESOURCE_DECISION` / `RESOURCE_DIR` / `SYSTEM_PATHS` / `EMULATOR_OPTIONS` 保持导出（锚 + 现状）。

**验收**
1. 两个不同 `id` 的 `instanceLayout` ⇒ `baseDir/overlayDir/logPath/tracePath/replayPath` **两两不同**；`id:'default'`（或缺省）时 `logPath` **等于** `electron/paths.ts` 的 `LOG_PATH`（锚 + 现状一致）。
2. `env` 参数生效：给 `env` 传 `AMAYUI_SYSTEM_DIR`/`AMAYUI_OVERLAY_DIR` ⇒ layout 跟着变，且**断言 `process.env` 未被修改**。
3. `HostService` 的 `saveConfigIni` 防丢键棘轮行为不变（沿用既有测试口径：新文本键数 < 现有 ⇒ 拒绝）。
4. 写盘只落该实例的 `overlayDir`（用一个临时实例目录跑 writeSaveData/writeSaveSlot，断言文件出现在实例目录里）。
5. `electron/` 下除白名单三个文件外**零改动**；`src/host/**` 里 `grep electron` 零命中。

---

## 4. 新测试文件的硬规矩（**踩过就知道会红 verify**）

`test/run.ts` 按**分类头**选文件，`test/organization.test.ts` 是守卫。新加的 `*.test.ts` **首行必须**是：

```ts
/** @tier T0 @kind core|ratchet|tool @subsystem <下列之一> */
```

* 允许值：`tier ∈ T0|T1|T2`；`kind ∈ core|ratchet|tool`；`subsystem ∈ frame|vm|ops|adv|text|render|texture|transition|l2d|save|audio|config|input|host|ledger|tool`。
* 三条规则（`test/orgRules.ts` 的 `checkOrganization`）：
  **R1** 分类头齐全合法；**R2** 声明 T0 就**不得**依赖未入库真资产（不许 import corpus loader / 读 `install/`·`raw/`）；
  **R3** 不许 `console.warn('[skip]…') + 裸 return`（零断言会被记成 pass）—— 要跳过就用 `t.skip()`。
* 本票三个新测试文件的指派：
  `test/bridge-input-focus.test.ts` → `/** @tier T0 @kind core @subsystem input */`；
  `test/frame-capture-seam.test.ts` → `/** @tier T0 @kind ratchet @subsystem frame */`；
  `test/host-instance.test.ts` → `/** @tier T0 @kind core @subsystem host */`。
* 自检命令（很快，不算"共享资源"）：`npm run test:org`（= `node --import tsx test/run.ts check`）。

---

## 5. 主 agent 的集成与结算（子代理不做）

1. 把 `capturePng`/`captureFrame` 接进 `session.ts` 的帧宿主（WS-2 不许碰该文件）。
2. 跑 `npm run verify`（**串行**，一次）→ 绿。
3. 跑票据自检与守卫：`tickets.js --validate` + `test/ticket-ledger.test.ts`；破锚的两处 retarget。
4. 更新 `T-0133` 的 evidence（若实现改变了它的锚点）与 `T-0134` 的 `tests[]`/`changes.md`，刷新看板。

---

## 6. Phase 2 预案（本轮只记录，不动手）

### 6.1 DSH 插件 Host 半的现成模板（读 `plugins/uimap/lib/index.js` 得到的确切口径）

* `export const inject = ['tools','fs','shell','webServer']` —— **`webServer` 必须在 inject 里**（否则 base 阶段挂载、路由被静默跳过，T-0133 §2.4 记过）；
* `ctx.effect(() => webServer.register({ kind:'prefix', path:'/dsh-emulator', handler }))`，path **不带尾斜杠**；
* `ctx.get('sandboxPolicy')?.workspaceRoot` 拿仓库根（HTTP 请求没有 session 上下文）；
* 静态资源用 `ctx.fs.resolve/stat/readBytes` 读+回；JSON 用 `res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'})`；
* Client 半沿用 `plugins/htmlcard/lib/client.js` 的 `window.__ModuleLoader__.load({id,factory})` + `shell.overlay` / `conversation.session.header.actions`。
* 注意：插件的 `lib/*.js` 是**手写 ESM**，没有构建步骤 ⇒ **不能直接 import emulator 的 TS 源码**。这决定了 6.2 的分叉。

### 6.2 两个待选形态（Phase 2 开工时定）

| 形态 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **P1 子进程 + 同源反向代理**（倾向） | 插件 Host 半 `spawn` emulator 的 web 宿主（`npx tsx app/amayui-emulator/src/web/host.ts`，或先用 `build-electron.mjs` 同款 esbuild 打一个 `.mjs`），监听 127.0.0.1:<port>；插件把 `/dsh-emulator/*` **代理**到它 | iframe 与 DSH **同源**；emulator 在**独立进程**（崩溃不拖 GUI ⇒ 符合"更强的 isolation"）；插件侧保持零构建 | 要写 ~40 行代理（`http.request` + `pipe`）；**WS 升级代理**更麻烦 ⇒ 优先用 **SSE + POST**（T-0133 §2.5 已实测 SSE 在本 server 上可用），把 WS 推迟 |
| **P2 同进程 import 构建产物** | 插件 Host 半直接 `import('<repo>/app/amayui-emulator/dist/web/host.mjs')`，用 `webServer.register` 原生挂路由 | 无代理、无第二端口、真正的同源原生路由 | DSH 进程内跑 emulator 代码（崩溃面共享，与 isolation 诉求相反）；插件会依赖 repo 里的构建产物路径 |

⇒ **倾向 P1**（隔离优先），并把"控制面推送"用 **SSE** 实现，避开 WS 升级代理这一整块。

### 6.3 Phase 2 的验收口径（预告）

1. 浏览器（DSH 内 iframe）里能跑到 TITLE、能进菜单、能读档；
2. agent 侧：`dbg` 的 `click/move` 走**纯 VM 外层桥**（不再依赖 `sendInputEvent`）、`shot` 走 `FrameHost.capture`；
3. `focus auto|on|off` 可用；
4. 两个实例并行时 log/trace/saves 互不干扰；
5. 全程**不出现 Electron 窗口**（Phase 2 用浏览器宿主；Electron 路径保持原样可单独跑）。

---

## 7. B′ 判据实验（决定 Phase 2 走 A 还是 B）+ `shot` 契约

### 7.1 为什么需要它

`T-0133` §B.4.4 提出 **B′**：若"隐藏窗口里的 Pixi 页仍能跑帧循环、`extract.canvas` 仍能出图"，
形态 B 就**不需要 OSR**（一次绕开整串 OSR 专属坑）。它与形态 C（`capturePage()` 窗口截图管线）
是**两条不同的管线**，必须用"页面内读回"来区分。

### 7.2 链路（三处，全部走既有协议，不新增通道）

| 层 | 改动 | 归属 |
|---|---|---|
| 窗口档 | `AMAYUI_WINDOW_HIDDEN=1` ⇒ 只 `show:false`、不 `showInactive()`、不摆位（与贴边档互斥） | ✅ 主 agent 已做（`electron/windows.ts`，T-0040 的锚未动） |
| 命令 | `debugCommand.ts` 增 `{ a:'shot' }`（文本 `shot`） | WS-1 落地后由主 agent 加（WS-1 拥有该文件） |
| 执行 | `session.ts` 的 `onDebugQuery` 分支：`capturePng(this.#frameHost())` ⇒ `{query:'shot', ok:true, lines:[尺寸/字节数], png:'<base64>'}`；宿主无能力 ⇒ `ok:false, lines:['shot: 宿主没有 capture 能力']` | 同上 |
| 集成 | `#frameHost()` 加 `capture: () => this.#pixi.captureFrame()`（WS-2 报告给的接法） | 同上 |

### 7.3 实验步骤与判据

```bash
# ① 隐藏档起守护（Electron；默认静音；veriy 与它必须串行）
AMAYUI_WINDOW_HIDDEN=1 npm run dbg:srv            # 后台
# ② 抓两帧：A = 稳定态；中间注入一次输入（触发画面变化）；B = 之后
node tools/dbg.cjs --json --wait 3000 shot > /tmp/a.jsonl
node tools/dbg.cjs click 807 621
node tools/dbg.cjs --json --wait 3000 shot > /tmp/b.jsonl
```

判据（四条，缺一不可）：
1. 两帧都能拿到 `png` 字段且 base64 可解码（PNG 魔数 `89 50 4E 47`）；
2. **尺寸 = 1280×720**（读 IHDR：偏移 16 起的 width/height 大端 32 位）；
3. 字节数显著大于"纯色 PNG"的量级（空图会压到几 KB 以内）；
4. **A ≠ B**（注入输入后画面真的变了）—— 这是"帧是活的"的强证据，不依赖解码。

判定：四条全过 ⇒ **B′ 成立**（Phase 2 的 B 形态不需要 OSR）；否则退回 `T-0133` §B.4.1 的 OSR 方案。
★注意本实验**只回答"隐藏窗口能否出图"**，不代表形态 A（浏览器宿主）的结论。

### 7.4 实验不做的事

* 不测 `capturePage()`（那是形态 C，`T-0133` 已足够证据否定它当主方案）；
* 不改 `dist/` 之外的构建产物语义（`build:electron` 只是为了让守护进程能 require 主进程 bundle）。
