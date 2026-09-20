# T-0100 · 现场证据：SN0000 → 第一个 SC 场景（`SC0000`）的边界

> 来源：用户轮 7 的 GUI 实测会话日志 `.tmp/amayui-emulator.log`（988,687 B / 13,668 行；GUI 交互，含 `[input-state]` 鼠标事件）。
> ★`.tmp/` 是 gitignore 的临时区，**不是证据落点** ⇒ 关键片段摘录到这里（原文行号保留）。
> ★**该日志只截取了片段**：完整 `[present ...]` 行极长（一行的 items 列表可达数千字符），下面按需截断。

## 1. 第一个 SC 场景是 `SC0000`

```
7969:   [call-script] 0x73 -> SC0000.BIN (24501 instr)
```

（日志里 `SC*` 的 call-script 只有 `SCINIT`/`SCJUMP`/`SC0000` 三类；`SCINIT` 在 boot 与每次场景初始化时反复调用，`SCJUMP` 是跳转表，**`SC0000.BIN` 只在 7969 出现一次** ⇒ 这就是"第一个 SC 场景"。）

## 2. 进入 `SC0000` **之前**的收尾（7951-7968）

```
7951: detachTexture h=0x19258 count=1 REMOVE (drawItems=0, meshes=0)
7952: [frame-hold] clearDrawContainer → 继续留帧（最多 60 帧，等新内容）
7953: clearDrawContainer: 释放 drawItems=0 meshes=0 文本窗=1→0（保留纹理槽）
7954: [frame-hold] createMesh 0x19258 颜色仍透明 → 继续留帧（剩 60 帧）
7955: createMesh h=0x19258 v=4 layer=0 rect=(0,0)..(1280,720) base0=0xffffffff
7956: [frame-hold] setVertexColor 0x19258 → 新内容可见，解除留帧（剩 60 帧）
7957: setVertexColor h=0x19258 idx=0 a=255 rgb=0x0 → state0=0xff000000
7958:   [call-script] 0x3a -> SETCHARM.BIN (14 instr)
7959: detachTexture h=0x19640 count=2 RANGE-REMOVE [0x19640,0x19642) (drawItems=0, meshes=0)
7960: detachTexture h=0x19834 count=25 RANGE-REMOVE [0x19834,0x1984d) (drawItems=0, meshes=0)
7961: detachTexture h=0x19708 count=6 RANGE-REMOVE [0x19708,0x1970e) (drawItems=0, meshes=0)
7962: detachTexture h=0x1976c count=3 RANGE-REMOVE [0x1976c,0x1976f) (drawItems=0, meshes=0)
7963: detachTexture h=0x19a28 count=500 RANGE-REMOVE [0x19a28,0x19c1c) (drawItems=0, meshes=0)
7964: detachTexture h=0x1a9c8 count=100 RANGE-REMOVE [0x1a9c8,0x1aa2c) (drawItems=0, meshes=0)
7965: detachTexture h=0x1976c count=3 RANGE-REMOVE [0x1976c,0x1976f) (drawItems=0, meshes=0)
7966: detachTexture h=0x19a28 count=500 RANGE-REMOVE [0x19a28,0x19c1c) (drawItems=0, meshes=0)
7967: detachTexture h=0x1a9c8 count=100 RANGE-REMOVE [0x1a9c8,0x1aa2c) (drawItems=0, meshes=0)
7968: unhandled 0x308 i308                      ← ★★注意：进 SC0000 **前一条**就是未处理的 `0x308`
7969:   [call-script] 0x73 -> SC0000.BIN (24501 instr)
7970: clearSlotRecords：丢掉 1 条 槽→imgid 记录（保留纹理对象/画布）
7971: [frame-hold] 满屏幕布 0x19258 被撤 → 留帧最多 60 帧（等新内容）
7972: detachTexture h=0x19258 count=1 REMOVE (drawItems=0, meshes=1)
7973: setDrawPivot h=0x18b00 (640,720,0) [建空项]
7974: bindTexture imgid=0x76 slot=44
7975: image 76 -> AE910AA.AGF (256x128)
...
7982: createTexture slot=64 1280x720 mode=1 @1.25x (新建空白表面)
7984: setTransition id=0x18b02 writes=[[0,3],[1,0],[2,0],[3,1500],[4,64],[5,101120],[7,1],[13,1],[16,64],[17,500],[18,216],[19,0],[20,0],[21,400],[22,216],[23,0]]
```

★`0x308` 是 `STUB_NATIVE_OPS` 的 unhandled 桩（`test/opcode-operands.test.ts` 的 `ALLOW_UNDERRUN` 白名单原话：「`0x308`：STUB_NATIVE_OPS 的 unhandled 桩（op1/`Engine[1954]` 未建模；见 `stubs.ts` 注释）」）。它出现在**进 SC0000 的前一条**，必须排查它是不是"本该清场/交接"的那一步。

## 3. 画面上绘制项集合在边界前后的变化（关键反证）

| | 最后一个 `[present]`（边界前） | 第一个 `[present]`（边界后） |
|---|---|---|
| 时刻 | t=**74129 ms** | t=**76649 ms** |
| 项数 | **26** | **4** |
| 前几个 ID | `101100 104501 104502 104503 104504 104505 104506 104500 104507 104508 104509 104510 …` | `101120 101122 101140 101142` |

⇒ **`Scene+0x408` 的绘制项确实被清掉了**（26 → 4），而且清的动作在日志里有明确痕迹：`detachTexture … RANGE-REMOVE`（7959-7967）+ `clearDrawContainer … 文本窗=1→0`（7953）+ `clearSlotRecords`（7970）。边界后那 4 项是新场景自己的（`AE910AA.AGF` / `AE910AB.AGF` 对应的 `101120/101122/101140/101142`）。

### ⇒ 由此得到的**关键推论（待 T-0100 核验）**
「SN0000 中心的文字没被清除」**很可能不是绘制项残留**（绘制项已经 26→4 被清干净），而是：
1. **宿主文本层 / 消息窗（`Font` = `Engine+85296`）侧的残留** —— 即 pixi 的 `textLayer` 仍按旧的 `msgwin` 状态在画字；或
2. **`0x308` 这条未处理指令本该做的清场/交接没做**（它在边界前一条），导致某张表/某个标志没被复位；或
3. 用户看到的是"新场景自己的文字"（`SC0000` 起始就有文字）而误判为 SN0000 残留 —— 需要拿边界后的截图/快照比对。

★这三条必须由**体证据**判定，不许凭症状猜。

## 4. 会话里其它可用线索

- `0xAE: 续跑走栈 1 → 2：装载 SN0000.BIN(id=0x74)` ×3、`0xAE: 续跑收尾 —— cur=2 落点=794（SN0000.BIN）` ×3、`=== advance-wait handled → click ===` ×3 ⇒ 用户走了 3 次 SN0000 续跑路径（与 `T-0066` 的 `0xAE` 直落语义一致：`i0ae` 与落点之间被跳过）。
- `[call-script]` 全量里 `SCINIT.BIN` 反复出现（每次场景初始化），`SCJUMP.BIN`（16059 instr）是跳转表。
- 帧统计（最后一条 present）：`帧间隔 avg=1102.0ms max=261973ms 丢帧=1%(n=240) 最慢帧 间隔=38ms 合成=1.1ms 批=0 wait=0x20000000`。
- 该会话开头 60-78s 段是 `items=142` 的稳定画面（菜单/配置类），t=341s 段是 `items=141`。

## 5. 本文件的性质

**证据摘录**（owner 从用户实测日志摘出）。★原日志在 `.tmp/`（临时区）⇒ 若后续需要完整日志，请让用户重跑并另存；本摘录只保留与 T-0100 相关的片段与行号。
