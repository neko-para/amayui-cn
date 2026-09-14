# T-0027 · 过程文档（changes.md）

## 2026-09-14

# 变更记录（T-0027）

## 第 1 次变更（2026-09-14）：拆「两把输入刷子」+ 按住态自愈

### 改了什么

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/vm/input.ts` | `flush()` 一分为二：`flushPending()`（= `sub_478090`，只并 `mouseEdge`/`joyEdge`，**不含 `buttons`**）与 `flushHeld()`（= `sub_4780D0`，含按住态）；新增 `syncButtons(mask)`（按 DOM `MouseEvent.buttons` 真值重建按住态）与 `releaseAllMouse()`（失焦/隐藏兜底） |
| `app/amayui-emulator/src/vm/engine.ts` | 等待泵 `serviceAdvanceWait` → `flushPending()`（★修复点）；ADV 分支 `serviceAdv()` → `flushHeld()`；`eatAllInput()`、`hoverDispatchAllowed()` → `flushPending()` |
| `app/amayui-emulator/src/vm/handlers/input.ts` | `0x101 poll-input` → `flushPending()`；`0x100 input dispatch`、`0xFF input reset` → `flushHeld()` |
| `app/amayui-emulator/src/vm/handlers/msgwin.ts` | `0xFA poll-msg-advance` 的 `(mask & 0x40)` 判据 → `flushHeld()`（raw 24963 用 0D0）；随后的吸收仍由 `consumeEdges()` 等价 |
| `app/amayui-emulator/src/renderer/pixi/inputAttach.ts` | `mousemove`/`mousedown`/`mouseup` 都按 `e.buttons` **重同步按住态**（引擎"每帧轮询真值"的 DOM 等价物）；新增 `blur` / `visibilitychange(hidden)` → `releaseAllMouse()` |
| `app/amayui-emulator/test/adv-msgwin.test.ts` | +3 例守卫（见下） |
| `app/amayui-emulator/test/input.test.ts` | +2 例（两把刷子语义 / `syncButtons` 自愈） |
| `analysis/functions.json` | +3 条：`0x411BC0 advWaitPump_411BC0`（PARTIAL）、`0x478090 inputBrushPending_478090`、`0x4780D0 inputBrushHeld_4780D0`（ANALYZED） |
| `analysis/engine-capabilities.json` | `adv-input-pump-perframe` 升级为 `modeled-verified / E2 / guard=test/adv-msgwin.test.ts`，note 写清两把刷子的归属与仍未建模项 |

### 消费者归属（按 raw 逐个核对；★首版验收里把 `0x100` 与 `0xFA` 前半写错了，这里订正）

| 消费者 | raw | 刷子 |
|---|---|---|
| `serviceAdvanceWait`（等待推进泵 `sub_411BC0`） | 20238 `sub_478090` | **消费刷** |
| `0x101 poll-input`（`sub_419CC0`） | 25069 `sub_478090` | **消费刷** |
| `0xFA` 后半（`sub_4199B0`） | 24983 `sub_478090` | **消费刷** |
| `eatAllInput`（`sub_4053C0`） | 11052 `sub_478090` | **消费刷** |
| `serviceAdv`（ADV 分支 `sub_411900`） | 20111 `sub_4780D0` | **实时刷** |
| `0x100 input dispatch`（`sub_419AF0`，不调刷子，读 ADV 分支 20111 用 0D0 填好的字段） | 25009 读字段 | **实时刷** |
| `0xFF input reset`（`sub_419A90`） | 25004 `sub_4780D0` | **实时刷** |
| `0xFA` 前半的 `(mask & 0x40)` 判据 | 24963 `sub_4780D0` | **实时刷** |

### 判据（先红后绿）

- **E2（棘轮）**：`test/adv-msgwin.test.ts` 的「★等待推进门只吃挂起事件：按住左键不放也只推进一页」。
  把 `flushPending()` 临时改回旧的"含 `buttons`"实现跑一次 ⇒ **红：`10 !== 1`**（一次按下放行 10 次）；改回修复实现 ⇒ **绿：1 次**。
- 同帧 down+up 不丢（快速点击仍推进恰好一次）、ADV 分支仍读按住态（`set:CancelMessageKey` 三态机进 stage2）。
- **E2（单元）**：`test/input.test.ts` 两把刷子语义 + `syncButtons(0)` 把丢失 mouseup 后卡住的按住态拉回真值。

### 回归证据

- 全量 `npm test`：489 例 / 478 通过。8 个失败**全部与改动前逐条相同**（`git stash` 对照复跑）：
  7 个是既存的平台/配置类失败（`overlay.test.ts`×2 的 Windows 路径断言、`char-reveal`/`config1-chain`/`engine-config`/`config-version-substr` 共 5 例），
  第 8 个是本票 evidence 锚点随代码改名而变红（已按棘轮要求刷新锚点）。
- **真实脚本 E2E**：`npm run scenario -- --scenario tools/scenarios/gamestart.json`（jp 资源、真 `runFrameLoop` + pump）
  改动前后输出的 9000 帧轨迹 **逐字节相同**（`cmp` 无差异）⇒ 修复对未被等待泵覆盖的路径零影响。
  ★该 spec 在 headless 下停在 `TITLE.BIN`（改动前也一样，属既存问题，与本次无关），所以它只证明"无附带损伤"，不构成推进门本身的场景级断言。

### 仍未做（本票不 done 的原因）

- **E4 手测**（验收第 6 条）：在 macOS + jp 资源的产品路径上确认「一次普通单击只前进一页、按住不再连续翻页」。
  步骤见 `repro.md` §B；本环境无法启动 GUI 产品路径，留给人工确认。确认后把本票置 `done`。
