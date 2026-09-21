---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `INITGAME`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `INITGAME.BIN`（真源 `src/INITGAME.txt`） |
| 状态 | ⚪ 仅登记 |
| 是什么 | 新游戏的初始状态写入（全局表初值）。 |
| 怎么进/出 | GAMESTART 的「ゲーム開始」分支 `call-script 51e4` 进入；TITLE 的 DEBUG 路径也会调它。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-11` | `call-script 5d  // SHOWPOP` | 若 global 0 != 1（新游戏）则置 70801f=0 / 708020=1 并 call-script SHOWPOP（开局提示） |
| `13-18` | `call-script 5e  // UNITECH` | 置 546ddf / 546de7 / 546dff 初值并 call-script UNITECH，然后 exit |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `—` | 只写全局量初值，无局部槽 |

## 缺口

- 每一行写的全局量语义未逐条读（只确证它在「ゲーム開始」分支被调用）

## 相关

- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 守卫测试：`app/amayui-emulator/test/game-start-chain.test.ts`

## 证据与备注

- 证据：src/INITGAME.txt:1-18；调用点见 src/GAMESTART.txt:1338 与 test/game-start-chain.test.ts 的 reachedInitGame
- 备注：只登记「谁调它 / 它在链路里的位置」；正文未读（stub）。
