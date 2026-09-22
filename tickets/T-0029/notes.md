# T-0029 · 过程文档（notes.md）

## 2026-09-14

## 现状（已核实）

`src/renderer/app/boot.ts`

```ts
21: const PRELOAD_IMAGES = [0x5245, 0x5246, 0x5272, 0x5273];   // 注释：「引擎启动流程里会立刻用到的那几张」
78: for (const imgid of PRELOAD_IMAGES) { await native.preloadImage(imgid); }
```

实测这 4 个 id 的映射（Electron 启动日志 `.tmp/amayui-emulator.log` 第 8/10/11/12 行）：

| imgid | 文件 | 尺寸 |
|---|---|---|
| `0x5245` | `SO006.AGF` | 1280×720 |
| `0x5246` | `SO005.AGF` | 1280×720 |
| `0x5272` | `SO004.AGF` | **1664×1536** |
| `0x5273` | `SO004A.AGF` | 740×700 |

## 正统路径（已存在，不需要新造）

```
0x1F9 set-texture → PixiBackend.bindTexture → TextureCache.bind
    命中缓存 → 立刻可画；未命中 → void this.preloadImage(imgid).then(...)   // textureCache.ts:174/183
帧末 → PixiBackend.texturesIdle()  // 纹理帧屏障：等本帧新绑定到位再合成（pixiBackend.ts:285）
```

⇒ 删掉预载后，这 4 张图与其它图走**同一条**按需路径；唯一要盯的是"绑定后同帧读尺寸（`0x208`）"那条已知缺口
（能力 `texture-bind-synchronous-then-query`）是否被屏障覆盖住 —— 这也正是本条改动顺带验证的事。

## 为什么不能靠"多预载一点"解决

预载是无依据的第二入口：headless 侧（`bootHeadless`/两份 chain/scenario）**没有**它 ⇒ 改动前两宿主的图文就绪时机天然不同；
而且预载会在启动期无条件解码 `SO004.AGF`（1664×1536），与"用哪张载哪张"的正统语义相反。
若真有"绑定前就要用"的图，正确落点是能力台账（`analysis/engine-capabilities.json`）而不是 boot 的硬编码清单。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

预载的 4 张图的实测映射见 why；本条是'删掉第二套入口'的整理需求，不需要新守卫，判据是启动日志 + 三屏截图 + G3 逐帧相等。

## 2026-09-22 · 轮 12：E4 三屏 + record/replay 收尾（**本票可以结了**）

### 1. 本轮把 E4 通道打通了（这是之前一直卡着的部分）

`npm run shot -- --gamestart --name t0029-gs` 在本机**能跑**（Electron 真界面，窗口 1603×903）⇒ 判据 ③ 的
"三屏目视"有了真素材。**一个坑先记下来**（下次省 10 分钟）：`npm run record` 默认会把窗口贴到屏幕外
（`[window] 贴边档=bottom … 只留 32px 可见`）⇒ `record.cjs` 报 `未找到游戏窗口`、trace 只有 1565 B；
**必须加 `--centered`**。另外两个路径口径不同：`--out` 按**仓库根**解析，`npm run replay -- <trace>` 按**包目录 cwd** 解析。

### 2. 判据逐条（证据都在 `evidence/`）

| 判据 | 结论 | 证据 |
|---|---|---|
| ① `PRELOAD_IMAGES` 与预载循环删除 | ✅（更早轮次） | 守卫 `test/no-boot-preload.test.ts`（4 条） |
| ② 这 4 张图改在 `0x1F9` 绑定时按需装载 | ✅ **本轮补 E4** | `evidence/startup-bind-log.txt`：全文里四条 id 只有 **0x5272** 出现一次，且紧跟在 `bindTexture imgid=0x5272 slot=4`（TITLE.BIN 内）之后 ⇒ 按需装载；**0x5245/0x5246/0x5273 本场景 0 次**（用哪张载哪张） |
| ③ 首帧不缺图（三屏目视） | ✅ **本轮补 E4** | `evidence/e4-title.png` / `e4-gamestart.png` / `e4-sn0000-first-text.png` / `e4-sn0000-next.png` + 索引 `e4-screenshots.md`（含 sha256）。TITLE 与改动前基准 `.tmp/b5E-0-title.png`（2026-09-19）**目视一致**（同构图、立绘/背景/按钮/版权全在；字节数差 0.08% = PNG 编码/AA 噪声）；GAMESTART 面板与立绘全在；SN0000 背景全屏出图、推进一页后正文与等待光标正常 |
| ④ `texturesIdle` 覆盖这些绑定（record+replay 逐帧相等） | ✅ **本轮补 E4/G3** | `evidence/record-replay.txt`：`npm run record -- --scenario tools/scenarios/gamestart.json --out .tmp/t0029-record-centered.jsonl --centered` → `npm run replay` ⇒ **`✅ engine 段逐帧相等（比对 2614 帧）`** |
| ⑤ 若真有"启动期必需图像"就登记进能力台账 | ✅ 无需登记 | 本场景只用到 0x5272，且按需装载即可 ⇒ **没有**"绑定前就要用"的图被确认；`analysis/engine-capabilities.json` 的 `texture-bind-synchronous-then-query` 那条已覆盖"绑定后同帧读尺寸"的机制（`T-0102` 轮 14 的 H2 修的就是它） |

### 3. 副产物（给别的票用）

- **E4 通道可用**：`npm run shot` / `npm run record --centered` 在本机都能跑 ⇒ `T-0054`（E4 真界面截图）、
  `T-0067`（存档流程的真界面复跑）、`T-0103`（`SN0000 → SC0000` 的帧级连拍）此后都不再"卡在没法真跑"。
- **副作用要记住**：产品路径会把 overlay 的 `SAVE/SAVE.DAT` 回写一次（178413 B）。本轮前后 **`SYS4REG.INI` 的
  sha256 逐字节不变**（已核对）；`SAVE.DAT` 是引擎/模拟器都会写的表文件（`SAVE00.DAT` 等真实存档槽 **未动**，mtime 仍是 2026-05-08）。
