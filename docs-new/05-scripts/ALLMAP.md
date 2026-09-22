---
kind: generated
state: live
home: analysis/scripts.json
generated_by: scripts/build-scripts.mjs
---

# 脚本台账 · `ALLMAP`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `ALLMAP.BIN`（真源 `src/ALLMAP.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 大地图/章节点入口：登记本场景的请求分派表、按 `b22a` 决定是否置章号 `3f3d = 1`，再走「章节跳转处理链」（`SETADVFLAG` → 跳转表逐个 `call-script`，其中含 `SCJUMP`） |
| 怎么进/出 | `src/SYSTEM4.txt:429` 的开机预载（`call-script 5265`）；运行期由章节点/大地图触发。它末尾的跳转表循环会 `call-script` 到 `<包>$SCJUMP` 等脚本 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `28-60` | `label_000001a0` | 入口主体：清 `3f50`/`9346a`/`b226`/`5cd87`；**`b22a == 0` ⇒ 落下句 ⇒ 置 `3f3d = 1`**（`jcc local566, ffffffff, label_000003f4`：cond 真 = 落下句）；随后 `call label_000065cc`（= SETADVFLAG）并按 `global 708996` 的跳转表逐个 `call-script` |
| `35-43` | `mov (global-int 3f3d) 1` | ★置章号：`b22a == 0` 时 `3f3d = 1`（= "第 1 章"），于是后续 `SCJUMP` 进"最近一章"的分派段；紧接着 `call label_000065cc`（SETADVFLAG） |
| `43-59` | `call label_000065cc` | SETADVFLAG 之后解跳转表：`f807f` 从 0 递增到 20，`lookup-array (global 708996)` 取脚本 id 并 `call-script` ⇒ 这就是 `$n$SCJUMP` 一族被调起的路径 |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global b22a` | ★置 `3f3d = 1` 的门：**`== 0` 才置**（`src/ALLMAP.txt:35-37`）；运行期实测在本票那条链上是 `0`（未写过） |
| `global 3f3d` | ★目标章号：本文件置 1（第 1 章）或 b（另一支，见 :153/:198） |
| `global 708996` | 跳转表基址（`INIT2.txt:106` 登记；第 12 项 = 0x5224 = SCJUMP） |
| `global f807f` | 跳转表游标（0..20） |

## 不变量（拿它做回归断言）

- `mov (global-int 3f3d) N` 与 `call label_000065cc`（SETADVFLAG）**成对出现**：每置一次章号就先把 `f8080` 抬到 INT_MAX
- 跳转表循环上界固定 20（`lt local566, f807f, 20`）

## 坑（踩过一次，别再踩）

- ★**`b22a` 门的极性**（2026-09-23 订正）：`eq local566, b22a, 0` + `jcc local566, ffffffff, label_000003f4` = **`b22a == 0` 才置 `3f3d = 1`**（cond 真 ⇒ 落下句）。旧条目写成"`b22a != 0` 时置 1"，是读反了
- ★`label_000065cc` 就是 `call-script 512f (SETADVFLAG)`：它把 `global f8080` 写成 INT_MAX ⇒ `SCJUMP` 的 `gr f8080, 10` **必然放行**；真正决定"选中哪一节"的是 `13d7/13d8/…` 那组"已演"标志（`tickets/T-0102` 轮 19 订正）
- 本文件是「大地图 + 章节跳转」共用的入口，读它时要区分 `3f3d=1`（第 1 章）与 `3f3d=b` 两支

## 缺口

- 只读了入口段（行 28-60）与三处 `call label_000065cc` 的调用点；其余分支（行 60 起，含 `3f3d=b` 支）未读

## 相关

- 主题文档：`docs-new/03-engine/scene-start-flow.md`
- 守卫测试：`app/amayui-emulator/test/t0102-chapter-chain.test.ts`

## 证据与备注

- 证据：src/ALLMAP.txt:28-60（入口 + b22a 门 + 置 3f3d + SETADVFLAG + 跳转表循环）；:153/:198（另一支置 3f3d=b）；运行期取值（b22a=0 ⇒ 3f3d=1）见 tickets/T-0102/evidence/chapter-chain-runtime-trace.md
- 备注：2026-09-23 订正：`b22a` 门的极性（`== 0` 才置）与"`f8080` 必然放行"这条因果。未读：行 60 之后的全部分支与大地图绘制/选择逻辑。
