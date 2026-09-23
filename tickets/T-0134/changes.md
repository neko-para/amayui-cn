# T-0134 · 变更记录

> 每次变更一条：改了哪些文件、行为怎么变、判据是什么、看了哪些证据。
> 设计来源与接口契约见 `notes.md`；`ticket.json` 只存机器可读的那一半。

---

## 变更 1（2026-09-23）· VM 外层桥接三件套落地（WS-1 + WS-2）+ 默认实例化（半个 WS-3）

### 一、输入桥（WS-1）

| 文件 | 改动 |
|---|---|
| `src/vm/input.ts` | 新增 `export type HostFocus = 'auto'\|'on'\|'off'`；`InputManager.hostFocus`（初值 `'auto'`，**故意不进 `InputSnapshot`**）；`setHostFocus(mode)`（`'off'` 立刻 `releaseAllMouse()+releaseAllKeys()`） |
| `src/frame/scenario.ts` | `ScenarioEvent.valid?: boolean`；`cursor` case → `input.setCursor(x, y, ev.valid ?? true)` ⇒ **能表达"光标出窗"**（`T-0133` §0.11 差异 a 的真缺口） |
| `src/renderer/pixi/inputAttach.ts` | 新增 DOM-free 的 `handleHostBlur` / `handleHostHide`（非 auto 模式忽略宿主噪声并留痕）；原先**两对** blur/visibilitychange 监听收敛成两个薄调用 |
| `src/vm/debugCommand.ts` | `DebugAction` 增 `{a:'focus'; mode:'auto'\|'on'\|'off'}`（本地字面量联合，保持零依赖）+ 帮助两行；`focus` / `focus auto\|on\|off` 解析，非法参数不崩 |
| `src/renderer/app/session.ts` | `#applyDebugAction` 增 `case 'focus'` ⇒ `input.setHostFocus(mode)` + 一行 trace |
| `control/control.ts` | ★**白名单外、由主 agent 补**：面板对 `DebugAction` 的穷尽 switch 在 `focus` 加入后收窄失败 ⇒ 改成 `case 'focus': case 'query': break;` + `const line2 = action.a === 'query' ? action.text : line;`（面板把 `focus …` **原样转给渲染窗的收口点**，不新增第二份命令语义） |

**行为变化**：默认（`auto`）行为与修前**逐字一致**；只有调试器显式 `focus on|off` 才改变"是否因宿主焦点事件释放按住态"。

### 二、帧捕获缝（WS-2）

| 文件 | 改动 |
|---|---|
| `src/frame/host.ts` | `FrameHost` 增可选 `capture?(): Promise<Uint8Array>`；新增 `capturePng(host)`（无能力→`null`；有能力→原样；抛错→**原样抛**） |
| `src/renderer/pixiBackend.ts` | 新增公开 `captureFrame()`：内部**复用既有的私有 `#captureStageCanvas()`**（不改名、不删）→ `toBlob('image/png')` → `Uint8Array`；失败抛带上下文的 Error |

### 三、集成（主 agent）

| 文件 | 改动 |
|---|---|
| `src/renderer/app/session.ts` | ① `#frameHost()` 增 `capture: () => this.#pixi.captureFrame()`；② `onDebugQuery` 改 async 并增 `act.a === 'shot'` 分支（`capturePng` → `{ok, lines, png: base64}`）；③ 新增 `bytesToBase64`（分块 + `btoa`，**不用 `Buffer`** —— 渲染进程没有它）；④ `#applyDebugAction` 增 `case 'shot'` 报错兜底（异步路径不可达） |
| `src/vm/debugCommand.ts` | `DebugAction` 增 `{a:'shot'}` + 解析 + 帮助一行（**`shot` 走页面内 extract，不是 `capturePage`** —— 这正是 B′ 与形态 C 的分界） |

### 四、实例化（WS-3 的前半，主 agent 做）

| 文件 | 改动 |
|---|---|
| `src/host/instance.ts`（新） | `instanceLayout({id, repoRoot, root?, baseDir?, env?})` 纯函数：**默认实例 = 现状三路径**；具名实例 = `<repo>/.tmp/instances/<id>/{base,overlay,log/…}`；★**具名实例不查 `resolveSystemPaths`** ⇒ 不继承玩家真存档（`T-0133` §B.3.3 坑 1）；★`env` 只经参数传、**不改 `process.env`**（坑 2）；`id` 有白名单校验（防路径逃逸） |
| `electron/paths.ts` | `LOG_PATH`/`TRACE_PATH`/`REPLAY_PATH` 改为取自 `DEFAULT_LAYOUT = instanceLayout({repoRoot: REPO_ROOT})`（口径只有一份；三者值与重构前**逐字相同**） |
| `electron/windows.ts` | 新增 `AMAYUI_WINDOW_HIDDEN=1` 档：只 `show:false`、不 `showInactive()`、不摆位（B′ 实验与"真正不出现窗口"用） |

### 五、判据与证据（变更 1）

| 判据 | 证据 |
|---|---|
| 输入桥五条验收 | `npx tsx --test test/bridge-input-focus.test.ts` → **6/6 pass**（主 agent 复跑过）：`valid:false` 与 mouseleave 同快照、真 Engine hover 命中、`focus off` 与 DOM blur **逐字段同快照**、off/on 忽略、parse 四态 |
| 回归：输入/键盘/帧驱动/双宿主一致 | `keyboard-mask` + `frame-loop` + `headless-needs-render` + `harness-convergence` → **26/26 pass** |
| 帧捕获缝 | `npx tsx --test test/frame-capture-seam.test.ts` → **6/6 pass**（含"`#captureStageCanvas` 一字未动"与"headless 不含 capture"两条源码棘轮） |
| 实例隔离 | `npx tsx --test test/host-instance.test.ts` → **9/9 pass**（默认实例=现状公式、具名实例五点两两不同、env 传参且 `process.env` 不变、非法 id 拒绝、seed base 入口） |
| 类型面 | 四个 tsconfig（`tsconfig.json` / `control` / `electron` / `test`）**全 0 error** |
| 测试分类 | `npm run test:org` → 0 问题（R1/R2/R3） |
| 锚点 | 破锚两处：`scenario.ts` 的 `input.setCursor(x, y, true);` **已 retarget** → `input.setCursor(x, y, ev.valid ?? true);`（T-0133/T-0134 各一处）；`electron/ipc/files.ts` 的 `const fileSource = new NodeFileSource` 待变更 2 落地后一并 retarget。另刷新 T-0027 的行号漂移（396→438） |
| 票据自检 | `tickets.js --validate` → 132 张全绿 |

### 六、未完成

* **`HostService`（WS-3 后半）**：`src/host/service.ts` + `electron/ipc/files.ts` / `logging.ts` 的委托化，由子代理进行中；落地后要跑一次**全量 `npm run verify`**（现在跑会是假红/不完整）。
* **B′ 判据实验**：`tools/bprime-shot.cjs` 已写好（语法 + IHDR 口径对真 PNG 校验过），待上方落地后实跑。

---

## 变更 2（2026-09-23）· Phase 2 客户端核心：web 信封 + `window.api` 的 web 实现

> 这一半**不依赖** WS-3 的 `HostService`（它只依赖 `window.api` 的契约），所以并行做掉了。

| 文件 | 改动 |
|---|---|
| `src/web/envelope.ts`（新） | 二进制线格式：`[u32 段数][u32 段长][段] * n`（big-endian）+ `x-amayui-meta`（URL 编码 JSON）。**零依赖**（不用 `Buffer`、不碰 DOM/Node）⇒ 浏览器侧与 Node 宿主**共用同一份**编解码器。严格解码：段数/长度不自洽、截断、尾部多余都抛错 |
| `src/renderer/webBridge.ts`（新） | `window.api` 的浏览器实现：`invoke`→`POST <base>/<method>`（JSON args；二进制走信封）、`send`→`POST <base>/event`、`sendSync`→`sendBeacon`（唯一同步通道 `logLineSync` 的降级）、`on`→SSE（按 channel 派发）。★**可注入 `fetch`/`EventSource`/`beacon`** ⇒ 能在 Node 里守 |
| `test/web-envelope.test.ts`（新） | **9/9**：单/多/零段往返、段边界不串、big-endian、畸形输入六类全抛、元数据头往返、`subarray`（非零 byteOffset）可解 |
| `test/web-bridge.test.ts`（新） | **12/12**：JSON/二进制/多段/写字节（body=信封 + `x-amayui-args`）/单向/beacon/SSE 派发与退订与 `connect()` 幂等/坏帧不炸/**降级项确实不存在**/HTTP 失败必须冒出来 |

**三个刻意的取舍（都写进了文件头，并有守卫钉住）**：
1. **不提供 `audioStreamBase`** ⇒ `streamUrl()` 返回 undefined ⇒ 引擎退回 `load+decode+play`（`T-0133` §B.2 的正式降级）；
2. **不提供 `setSystemCursor`** ⇒ 渲染侧 `?.` 即 no-op（`T-0133` §0.9 订正 2：可做但故意不做）；
3. **字节一律返回 `Uint8Array`**（不是 Electron 的 `number[]`）：`ipcFileSource` 拿到就 `new Uint8Array(x)`，运行期同义且省掉"MB 级数组 → JS number[]"的放大。

**判据/证据**：`npx tsx --test test/web-envelope.test.ts` → 9/9；`npx tsx --test test/web-bridge.test.ts` → 12/12；
四个 tsconfig 全 0 error；`npm run test:org` → 175 文件 / 0 问题（新测试分类头合法）。

**仍未做**：Node 侧 `src/web/host.ts`（HTTP + SSE 服务端，用 `HostService` + 信封）与 DSH 插件（`plugins/amayui-emulator`）—— 等 WS-3b 的 service 完成后接。

---

## 变更 3（2026-09-23）· 宿主服务去单例（WS-3 后半）+ 修正命名冲突 + **B′ 实验实跑 PASS**

### 一、`HostService`（WS-3b 子代理，主 agent 复核）

| 文件 | 改动 |
|---|---|
| `src/host/service.ts`（新，562 行） | 传输中立、**每实例一份**的宿主服务：`Appender`/`GzAppender`（含 gzip close-flush）、`HostService`（`layout`/`resourceDir`/`fontDir` + 三个 appender + `logSync`/`close` + 22 个方法，逐字搬自 `electron/ipc/files.ts`/`logging.ts` 的 handler 体）、`createHostService`、`defaultHostService`（memo）。**零 `electron` import**、**零 `process.env` 写入** |
| `electron/ipc/files.ts` | 薄委托层：22 个 channel 名、22 条 `[main] …` 文案、数据形状全不变；`function configRatchetOk` 保留为委托薄壳（T-0031 锚） |
| `electron/logging.ts` | appender/路径取自默认服务；`log-line-sync` **仍同步**（`svc.logSync` → `fs.appendFileSync`） |
| `test/host-service.test.ts`（新） | 6/6：实例隔离写盘、防丢键棘轮、双实例并行、零 electron import + `process.env` 不变、memo、锚点棘轮 |

### 二、命令改名 `shot` → `capture`（避免与旧路撞名）

`tools/debugsrv.cjs:215` 在**主进程**就截获了 `shot`/`screencap`（走 `capturePage()`）⇒ 渲染窗那条新命令
**永远收不到**同名命令。⇒ `DebugAction` 的 `{a:'capture'}`、帮助文本、`session.ts` 的分支与文案、
`tools/bprime-shot.cjs` 全部改为 `capture`，并在注释里写清"为什么不叫 shot"。

### 三★ **B′ 判据实验：PASS**（真实运行证据）

```bash
cd app/amayui-emulator && node tools/bprime-shot.cjs --shots 3 --interval-ms 2500
# AMAYUI_WINDOW_HIDDEN=1（只 show:false、从不 showInactive、不摆位）+ 静音
```

| 判据 | 结果 |
|---|---|
| ① PNG 魔数/可解码 | **PASS**（3/3） |
| ② 尺寸 1280×720 | **PASS** |
| ③ 字节数 > 20KB（非纯色） | **PASS**（1788564 / 1781821 / 1778610 B） |
| ④ 帧间有差异（活的） | **PASS**（去重后 3/3） |

* 取帧路径：渲染窗 `capture` → `FrameHost.capture` → `PixiBackend.captureFrame()` → `#captureStageCanvas()`
  → `renderer.extract.canvas`（**页面内读回**），**全程不经过 `capturePage()`**。
* 目视核对 `evidence/bprime-hidden-window-title.jpg`：完整 TITLE（logo + 五个菜单 + 立绘 + 槽位指示）。
* ⇒ **形态 B′ 成立**：隐藏窗口里 Pixi 仍在跑、`extract.canvas` 仍能读回 ⇒ Phase 2 的 B 形态**不需要 OSR**。

### 四、Phase 1 收口：全量 `npm run verify` **EXIT=0**

```
ℹ tests 1134   ℹ pass 1132   ℹ fail 0   ℹ skipped 2   + check:dead-writes 干净
```

期间被两条**真守卫**拦下并修好（都是新代码触发的既有棘轮，不是放水）：
1. `test/native-tap.test.ts`（T-0013）：`PixiBackend` 的公开方法必须"入桥或登记 `NON_BRIDGE`" ⇒
   把 `captureFrame` 登记进 `NON_BRIDGE` 并写明理由（帧宿主能力，与 `advanceModel` 同类，没有 opcode 调它）；
2. `test/harness-convergence.test.ts`（T-0020）：新测试不得自造 `mk()`/`ctx` 变体 ⇒
   `bridge-input-focus.test.ts` 的局部 `mk()` 改为**走 harness 的 `mkEngine([]).input`**（真用 harness，未登记例外）。

### 五、台账

* retarget：`const fileSource = new NodeFileSource`（`electron/ipc/files.ts`）→ `this.#fileSource = new NodeFileSource({`（`src/host/service.ts:164`），T-0133/T-0134 各一处；
* 行号刷新：T-0030/T-0069/T-0018 的 `read-save-slot`/`write-save-data`/`read-save-data-both`（files.ts 因委托化变短）；
* `tickets.js --validate` → 132 张全绿。
