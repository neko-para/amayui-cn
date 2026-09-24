# T-0144 · E4 现场证据：新游戏路径的 TITLE 立绘节点**已被拆场擦掉**（D1 落地后）

> 来源：本机 headless 调试实例 `t0103e4`（`node --import tsx src/web/host.ts --instance t0103e4 --port 0 --attach-headless --idle-sec 0`），
> **重建产物后**（`node build-electron.mjs`；web 形态下 VM 跑在页面的 bundle 里，不重建就还是旧代码 —— 这一步本轮踩过），
> 驱动 = `debug-query`：`click 1180 372`（TITLE「Game Start」）→ `click 811 605`（GAMESTART「ゲーム開始」）→ 等到 `SN0000.BIN`。
> 原日志在 `.tmp/instances/t0103e4/log/amayui-emulator.log`（**临时区，不是证据落点**）⇒ 关键片段摘录在此，行号保留。

## 1. 关键那一行：TITLE 退场例程的 `i1f6` 真的擦掉了 1 个立绘节点

```
9538:   [call-script] 0x51e5 -> SETFATE.BIN (129 instr)          ← GAMESTART.txt:1339（新游戏支）
9539: [frame-hold] 跳过本次 present（剩 59 帧）
9540: [input-state] hasCursor=1 pos=(811,605) ...                 ← 我们点的是「ゲーム開始」
9541: [frame-hold] 跳过本次 present（剩 58 帧）
9542: [frame-hold] clearDrawContainer → 继续留帧（最多 60 帧，等新内容）
9543: clearDrawContainer: 释放 drawItems=29 meshes=1 l2dNodes=1 文本窗=1→0（保留纹理槽）   ★★这一行
9544: releaseTexture layer=4
9545: releaseTexture layer=5
9546: detachTexture h=0x19258 count=1 REMOVE (drawItems=0, meshes=0)
```

* 这一条 `clearDrawContainer` = **`src/TITLE.txt:810` 的 `i1f6`**（由 `:822` 调用、主循环按 `local 3fc == 1` 触发），
  它与 `:811-812` 的 `release-texture 4/5`（日志里紧跟着的 `releaseTexture layer=4/5`）在同一条例程里 ⇒ 行号相邻可互证。
* `l2dNodes=1` = **TITLE 的 572B 立绘节点（key `0x14`，`TITLE.txt:590` 的 `i344 14 0`）被擦掉**；
  引擎依据 = `0x1F6` 清四张表，其中 `Scene+1096` 就是这张表（`sub_4AB7A0` raw **130766** `result = sub_4A9D10(v1 + 274);`）。

## 2. `[present …] l2d=` 字段：清之前是 `节点1`，清之后是 `节点0`（**实例槽保留**）

| | 出现行号范围 | 条数 | 取值 |
|---|---|---|---|
| 清之前（TITLE / GAMESTART） | 455 .. 9516 | 668 | `{槽1 节点1 可画1 纹理3 缓存60}` |
| 清之后（SN0000 等） | 9636 .. 10182 | 69 | `{槽1 节点0 可画0 纹理3 缓存60}` |

* ★**槽仍是 1、节点是 0** —— 与引擎分工一致：拆场（`0x1F6`）只擦节点表，**不动 10 个实例槽**
  （清槽是 `0x342` 与读档装载段 `sub_410160` raw 19387-19388 的事）。
* 对照（修复前，同一驱动方式，见 `tickets/T-0103/evidence/l2d-residual-gamestart-vs-load.md`）：
  进 SN0000 后 **513 条** present 带 `节点1 可画1` ⇒ 那个节点会在"本该黑"的章节切换处露出来（用户口径的症状）。

## 3. 这一条为什么必须靠"重建产物 + 真跑"才能证

web 形态下 **VM 活在渲染页的 bundle 里**（`dist/web/renderer.js`）。只改 `src/` 不重建就起实例，
读到的仍是旧代码（本轮实测：不重建时 `l2d=` 依旧是 `节点1`；`node build-electron.mjs` 之后重起实例才变成 `节点0`）。

## 4. 复现配方

```bash
cd app/amayui-emulator && node build-electron.mjs        # ★必须先做（否则跑的是旧 bundle）
node --import tsx src/web/host.ts --instance <id> --port 0 --attach-headless --idle-sec 0
B=http://127.0.0.1:3080/dsh-emulator/<id>/api/debug-query
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["click 1180 372"]}'   # TITLE Game Start
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["click 811 605"]}'    # GAMESTART ゲーム開始
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["frame"]}'            # 期望 ←cur = SN0000.BIN
# 判据：实例日志里 TITLE 退场那条 clearDrawContainer 报 l2dNodes=1，之后的 present 都是 节点0
```

★更省事、可进 CI 的那一条在 `test/game-start-chain.test.ts`：真语料跑完「启动 → Game Start → ゲーム開始 → SN0000 首文案」之后
断言 `scene.l2d.nodes === 0 && scene.l2d.slots >= 1`（撤销 D1 即红：`实际 1`）。
