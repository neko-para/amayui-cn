# 脚本台账 · `CALLBACK_LOAD`

> 由 `analysis/scripts.json` 生成（`node scripts/build-scripts.mjs`）—— **勿手改本文件**。

| 项 | 值 |
|---|---|
| 脚本 | `CALLBACK_LOAD.BIN`（真源 `src/CALLBACK_LOAD.txt`） |
| 状态 | 🟠 部分 |
| 是什么 | 引擎读档收尾装载到帧 0 的**回调脚本**（名字在引擎里是全局常量 `String2[] = "CALLBACK_LOAD.BIN"`，raw 4342）：消息跳过全解除 + 10 个 SE 通道重装 + **BGM 重播** + LOADCHARM/魅力显示，最后 exit。 |
| 怎么进/出 | `sub_410160` 的读档收尾按名解析它并装进帧 0（raw 19916 `sub_455000(FileDB, String2)`；解析不到才退回 `sub_40F750(3)` 直接装存档记录的脚本）；它 exit 时 `frames[0][95795] == -11` ⇒ `sub_41A820` 走 `sub_40F750(SaveVersion1, SaveVersion2)` 把**存档记录里的脚本**装进帧 0。语料里没有任何脚本 call-script 它。 |

## 结构（读了哪些段）

| 行区间 | 锚点（必须出现在该区间内） | 职责 |
|---|---|---|
| `6-19` | `savemesskip callback_load` | 消息跳过全解除 + 文本/贴图清理（i088 0 / i1ca 0 / i19b / i20d / i20e / detach-texture 1adb0 7d0 / i324 / i2fa 0，global 3f36 归零） |
| `20-21` | `i0b7 0` | ★**BGM 重播**：`i0b7 0` = 用 `Music[259]`（读档刚装回的当前曲 id）起播、循环位 = 1（`sub_489F80` 的 `a2 == 0` 分支）—— 读档后音乐回来的唯一一步 |
| `21-40` | `jcc (global-int 3f53) ffffffff label_00000244` | 跳读态恢复：按 global 3f53/3f52 置 i1cf 并 i0c2 淡变（与场景里的同形习语） |
| `41-49` | `i2f6 0` | 3 路语音通道复位（i2f6 0/1/2）+ 按 global 4fd7 走两个子程序（global 14acda 一族的恢复） |
| `50-77` | `play-sound-effect (global-int 3f51) 9` | ★10 个 SE 通道全停（i0b6 0..9）后按 global 3f51/4fd8 **重装第 9 通道的音效**（`play-sound-effect <id> 9` + `i0ba 9`） |
| `78-93` | `i1bb 1` | 消息态复位（i1bb 1 / i080 / i303）并按 global 0 分支 |
| `124-173` | `call-script 51c3` | LOADCHARM + 循环 0..a 按 global 3f91/3f54/3fe1/3ff5/3fa5/3fb9/4009 建/挂纹理与多边形（i241/i236/call-script ca SETPOLYGON） |
| `175-183` | `loadmesskip callback_load` | 收尾：poll-input / i19c / exit（引擎据 exit 码转 `sub_40F750(3, sv2)` 装存档记录的脚本） |
| `249-281` | `DRAWCHARM` | 魅力显示（label_00000fa4 → `call-script 46  // DRAWCHARM`；按 global 1397/1399 分支） |
| `355-375` | `label_0000195c` | 魅力条颜色选择（global f801f/a9ba ⇒ global f807d = a9df/a9e0/a9e1） |

## 关键槽 / 局部量

| 名字 | 含义 |
|---|---|
| `global 3f51` | 存档时的 SE id（重装到第 9 通道） |
| `global 4fd8` | 另一路 SE id（同一通道的备用路径，global a9da 分叉） |
| `global 3f53 / 3f52` | 跳读态与跳读速度（i1cf / i0c2 用） |
| `global 1397 / 1399` | 魅力界面 / 立绘状态分支 |
| `global f801d / 3f91 / 3f54 / 3fa5 / 3fb9 / 4009` | charm 表下标与纹理/坐标表 |
| `global f807d` | 魅力条颜色（由 label_0000195c 选） |

## 不变量（拿它做回归断言）

- 第 20 行恒为 `i0b7 0`（重播当前曲）—— 读档后 BGM 的唯一来源
- 它由引擎按名装载，语料里没有 call-script 站点

## 坑（踩过一次，别再踩）

- 开头的 i088/i1ca/i19b/i20d/i20e/detach-texture/i324 都是「设备重建后的清理」，与 emulator 的抽象不对应 ⇒ 不能当普通场景脚本跑
- `i0b7 0` 的语义是**重播当前曲**（不是播曲号 0）：emulator 修前当曲号 0 发 ⇒ 读档还原与换曲习语全静音（`tickets/T-0064`）

## 缺口

- emulator 已接（`tickets/T-0072`）：读档时按名装进帧 0（返回帧 -11 哨兵），它 exit 时 `handlers/control.ts` 的 `op_exit` 走 -11 分支装记录 0 的脚本 —— BGM 重播仍由 `replaySavedBgm` 补一次
- 本脚本用到的最后两条「仅映射」指令已登记（`tickets/T-0072`）：`0x137`（`i137 0`，ResetStack —— int 栈家族全库只此 1 处、无人压栈 ⇒ 观测等价 no-op）与 `0x244`（`i244`，批量清 `flags & 2` 绘制项的 `anim_start` —— emulator 先 no-op，窗推进语义不完全同构，缺口如实记着）。登记后整条读档链 **零未实现指令**（headless 实测）

## 相关

- 引擎常态能力：`music-runtime-current-track-lifecycle`（见 `docs-new/03-engine/engine-capabilities.md`）
- 函数结论：`0x489F80`（见 `analysis/functions.json`）
- 函数结论：`0x489B50`（见 `analysis/functions.json`）
- 函数结论：`0x420C00`（见 `analysis/functions.json`）
- 主题文档：`docs-new/03-engine/save-data.md`
- 主题文档：`docs-new/03-engine/sound-system.md`
- 守卫测试：`app/amayui-emulator/test/slot-save-resume.test.ts`

## 证据与备注

- 证据：src/CALLBACK_LOAD.txt:6-20（BGM 重播）/41-76（SE 通道）/124-173（charm 表）；引擎侧 raw 4342（全局名常量）、19916（按名装帧 0）、17469-17471 + 19911（当前曲 id 存档往返）、25749 附近的 -11 出口
- 备注：读了全文 375 行；未深读 `call-script 51c3`（LOADCHARM）与 `46`（DRAWCHARM）的内部。★read档链路实测（headless）：`CALLBACK_LOAD → SYSTEM4 → … → NOVEL → SN0000`（落点 794）；接它之前 ADV 文字会落进 1 号窗（(190,557) 小矩形），接上后与「正常走到同一句话」一致 = 8 号窗 (0,0,1280,720)。
