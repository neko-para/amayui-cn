# T-0091 evidence —— 第④项 E4：转场可达路径 + 截图（2026-09-25 实测）

## 结论（一句话）

**转场在 emulator 里可达、可复现、可自动驱动**：从 TITLE 读档到槽 78（`cur = SN0000.BIN`，`ip=2168/2793`）后
**点 4 次消息区**即进入切章转场，日志出现 `[transition]` —— 本次命中 **类别 0（交叉淡化，`id=0x18a9e t=0.401 → 槽 9`）**；
同一路径早前一轮还命中过**类别 3（Slideblur，`id=0x18aee → 槽 63`）**。

## 复现（三条命令）

```bash
# 1) 起一个带无头渲染页的实例（SAVE78 已 staged 在 .tmp/instances/t0103/{base,overlay}/SAVE/）
cd app/amayui-emulator && AMAYUI_AUDIO_ENABLED=0 node --import tsx src/web/host.ts \
    --instance t0103 --port 0 --attach-headless --idle-sec 0

# 2) 读档到槽 78（判据 = 日志出现 [slot-load]）
node .agents/skills/amayui-remote-debug/scripts/load-slot.mjs --instance t0103 --slot 78

# 3) 驱动到切章：反复点消息区（本次 4 次命中），日志出现 [transition] 即命中
curl -X POST http://127.0.0.1:3080/dsh-emulator/t0103/api/debug-query \
     -H 'content-type: application/json' -d '{"args":["click 640 620"]}'
```

★**踩坑（写下来，免得下次又花时间）**：`debug-query` 的 body **整条命令必须放在 `args[0]` 这一个字符串里**
（`src/web/host.ts:644` 的 `const text = String(args[0] ?? '')`）——
写成 `{"args":["click","640","620"]}` 只会把 `"click"` 当命令，回一句 `未知查询：click：用法 click <x> <y> [左|右]`。
★同一次踩坑的副产物（口径澄清）：本 build 的 `debug-query` **只读**（`global`/`local`/`frame`/`flocal`/`slot`/`l2d`/`barrier`/`run`/`help` + `capture`），
**输入注入不在 `runQuery` 里**，而在渲染页对同一条文本的 `parseDebugCommand`（`src/vm/debugCommand.ts` 的 `move/click/press/release/wheel/key/keyup`）。

## 判据与实测

| 项 | 值 |
|---|---|
| 判据 | 实例日志（`.tmp/instances/t0103/log/amayui-emulator.log`）出现 `[transition]` |
| 本次命中行 | `[transition] id=0x18a9e cat=0 t=0.401 → 槽 9（交叉淡化；源=A(1项)/B(1项)）` |
| 读档后落点 | `frame` 查询：`cur=2 SN0000.BIN scriptId=0x74 ip=2168/2793 caller=1`（帧链 0=SYSTEM4 → 1=NOVEL → 2=SN0000） |
| 切章时的日志尾巴 | `releaseTexture layer=63`、`gate 0x400 WAIT (scene anims pending)`、`detachTexture h=0x19a28 count=500 RANGE-REMOVE` |

## 截图

| 文件 | 是什么 |
|---|---|
| `save78-loaded.png` | 读档完成、转场**之前**的画面（ADV 正文 + 角色立绘 + 消息窗） |
| `chapter-transition-0..7.png` | 命中 `[transition]` 后**逐帧连拍**的 8 张（转场只有一两帧，故连拍保覆盖） |

## ★如实披露：这组证据属于哪一档

**它证明的是"可达路径"（第④项），不是"像素级真机对照通过"。**
本机跑的是 emulator 自己的渲染页 ⇒ 这组截图是 **E3 语境**（"转场确实在跑、画面确实出来了"的可视证据，
可与 `test/transition-corpus-e3.test.ts` 的窗口级断言互证）。
E4 的最高一档（与**真机**同一时刻的像素对照）**仍缺** —— 那需要真机侧的可自动化通道，本机没有。
⇒ 能力条目 `clock-read-transition-window` 的 `evidence` 保持 **E3** 不变（不因本组截图升级）。

★另：验收原文写的是 `npm run shot` 截图。本次改用**无头实例 + `capture`**，理由有两条 ——
① `shot` 会抢 Electron 窗口并**覆盖同一个 `.tmp/amayui-emulator.log`**（本工程纪律：同一时刻只跑一个）；
② 无头实例是 agent 自足的通道，且**不会**与用户的实例共用日志/overlay。语义等价（都是"拿到该实例该帧的画面"）。
