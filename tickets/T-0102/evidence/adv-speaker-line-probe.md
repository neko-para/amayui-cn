# T-0102 判据 5 取证：真语料链路上"有发言人的 ADV 帧"到底能不能采到

**结论：采不到。** 这不是探针坏了 —— 链路把 ADV 跑到了**序章旁白**，而"有发言人"的行（`3f37 >= 0`）
在序章里**根本不存在**；`3f37` 的**设置点**（`mov (global-int 3f37)`）全在 `SC*/SG*/SP*/NOVEL/HMODE/GAMECLEAR/DEBUGADV`
里，`SN0000.txt` 只有三处 `sub (global-int 3f37) 0 1`（递减，1093 / 2027 / 2097 / 3013 行）与若干读点。

## 命令

```powershell
cd app/amayui-emulator
npx tsx ../../.tmp/t0102-speaker.mts        # 临时件，跑完已删
```

探针本体（临时件，见文末"探针口径"）：`runGameStartChain({ continueAfterTarget: true, advanceAfterTarget: 'force', sampleAdvSpeakerLines: true, onStep })`。

## 实测输出

```text
链路（全 279 段）：SYSTEM4.BIN → INITCONFIG.BIN → … → LOGO.BIN → INIT.BIN → TITLE.BIN →
  SETL2DMOC.BIN → $1..$5$SETL2DMOC.BIN → GAMESTART.BIN → INITGAME.BIN → UNITECH.BIN →
  CALCCC.BIN → CCINIT.BIN → $1..$5$CCINIT.BIN → ADDITEM.BIN → SETFATE.BIN → SETCHARM.BIN →
  SC0000.BIN → SETWEATHER.BIN → NOVEL.BIN → SN0000.BIN → DRAWCHARM.BIN → CHARMEDIT.BIN
帧 1841883 / 步 1422799 / unknown 0
消息窗：[{"win":8,"text":"由両个世界融合而生的\n『迪爾-利菲娜』的世界上，曾経髪生過一場决定世界命\n運的諸"}]
SC*/SG* 里碰 3f37 的步（前 40）：0
有发言人的样本 0 条
```

## 这三行各自证明了什么

| 观察 | 事实 | 对判据 5 的意义 |
|---|---|---|
| 链路第 269-273 段 | **`SC0000.BIN` 被进入了**（`SETCHARM → SC0000 → SETWEATHER → NOVEL → SN0000`） | 修正此前"SC0000 不可达"的表述：**进入 SC0000 是可达的**；不可达的是 SC0000 的**对话段**（`3f37` 设置点在 SC0000.txt:1688 起，位于序章之后） |
| `win 8` 的整页文本 | 屏上是**序章旁白**（"由両个世界融合而生的『迪爾-利菲娜』…"），`3f37 = -1` | 采到的这一态与 `tickets/T-0102/evidence/e4-load-adv.md` 的 `--load` 态一致（旁白、白字、无白底） |
| `3f37` 的写点统计 | 全库 `mov (global-int 3f37)` 出现在 `$n$SC####` / `SG####` / `SP####` / `NOVEL` / `HMODE` / `GAMECLEAR` / `DEBUGADV` / `SYSTEM4:264`；**`SN0000.txt` 0 处**（它只有 `sub` 递减 1093/2027/2097/3013） | 序章里不可能出现"有发言人"的行 ⇒ **判据 5 的取样点（有角色名的那一行）在"启动链 + 序章"这条路上不存在**，必须在真正的对话场景（如 SC0000 的对话段）里取 |

## 探针口径（本轮新增的**持久**能力，落在库里而不是临时件）

`src/tools/gameStartChain.ts` 新增（`tickets/T-0102` 判据 4/5 的取样口）：

- 选项 `sampleAdvSpeakerLines`（默认关）：在**帧末**采样"有发言人的 ADV 帧"，按消息号去重（≤24 条），
  产出 `GameStartResult.advSpeakerLines[] = { frame, script, ip, msg, c14acda, f807b, f807c, fill, outline, text }`。
- 选项 `advanceAfterTarget: 'pump' | 'force'`：`continueAfterTarget` 那一段 20000 帧的推进档
  （采样用 `'force'` 才翻得动页；判据断言仍走 `'pump'`）。
- ★**踩过的坑（已写在代码注释里）**：脚本把旁白存成 `0xFFFFFFFF`，`dec()` 不归一 ⇒
  **必须 `| 0` 转有符号 32 位**，否则旁白会被当成 `msg = 4294967295` 的"有发言人"（第一次跑就中招，
  采出一条 `WDINIT.BIN:ip=288` 的假样本）。

## 判据 5 的剩余口径（写给下一轮）

两条路，任选其一：

1. **走到 SC0000 的对话段**：链路的 `'force'` 推进会在序章中途被菜单劫持（本次终态是 `CHARMEDIT.BIN`）
   ⇒ 需要一个"ADV 专用前进"驱动（只推进 ADV、不点侧边栏），这一条与 `T-0103` 的"走到那一帧"同源。
2. **强制值 + 消息表 oracle**：用 `src/tools/config1Chain.ts` 的 `advReturnProbe`（可设 `cfg.msg = 3f37`）
   把"一句有发言人的 ADV"铺出来，再用脚本的**消息表**（`f612[3f37]` / `14acdc` / `52a49c`）算出**期望下标**，
   与实测 `14acda` 比 ⇒ 判定"青 vs 橘"是不是下标派生错。**不需要**跑到 SC0000。
