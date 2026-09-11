# 03-engine · 消息 / ADV 路径上的配置门（未走到分支清单）

> 为什么单独一份：ADV 相关 handler 里有大量 `if (GetConfig("..."))` 分支。**随包 `SYS4REG.INI` 的取值
> 决定了哪些分支走不到**（例如 `message:ReadTextSkip=0` 会让"逐字显示"整条路径不执行）。
> 这些分支不是"不存在"，而是"当前配置下不执行"；**设置界面能改它们**，所以：
>
> - 复刻时必须按**读到的门**实现（不能假设某个分支永远不走）；
> - 反向：如果某个分支当前走不到，**必须在这里登记**，说明"什么配置会让它走到、走到后要做什么"。
>
> 数据层对应条目：`analysis/engine-capabilities.json` 的 `msgwin-config-gates`。
> 取值来源：`app/amayui-emulator/SYS4REG.INI`（随包副本，与真实安装目录同构）。
> 扫描方式：从 `engine/天结_unpacked.exe_utf8.c` 的字符串常量（779 条 `char aXxx[] = "..."`）
> 反查各函数里的 `GetConfig` 实参，再人工核对分支体。

---

## 1. 会直接改变 ADV 行为的键（优先关注）

| 键 | 随包值 | 门控位置 | 值为「真」时走的分支 | 值为「假」时（=当前）走的分支 |
|---|---|---|---|---|
| `message:ReadTextSkip` | **0** | `0x6E` sub_41EB20 / `0x71` sub_41ED80 / `0x72` sub_41EEF0 | 调 `sub_48E870`/`sub_48F000` 判定"文本还在不在显示"；**在显示中才置 `effect_flags |= 0x8000000`（ADV）** | 直接清 `122455`（不置 ADV）——**emulator 走这条** |
| `message:MesWinAlpha` | **8** | `0x6E` sub_41EB20 的 else 分支（`MesWinAlpha != 0`） | 每段文本之间置 `effect_flags |= 0x20000000` + `sub_453A60(…, α)` ⇒ **每段 α ms 节流**（emulator 走这条，映射到 `SLEEP_GATE`） | 不节流 |
| `set:CancelMesSkipOnClick` | **缺失** | `sub_411900` | 跑「取消消息/跳读」三态机（`122370` 0→1→2，松开时清 ADV + 复位 `ReadTextSkip`） | **整个三态机不走**（emulator 用 `cfgInt` 缺省 0 同样不走） |
| `set:WheelKeyUp` / `set:WheelKeyDown` | **缺失** | `sub_411BC0`（等待门每帧） | 把配置值当作**掩码位序号**，与输入掩码比较 ⇒ 滚轮可推进消息 | 滚轮键位比较分支不成立（`1 << 0` = bit0，实际恒不命中） |
| `message:AdvanceMesOnWheel` | **0** | `sub_409400`、`sub_411BC0`；另经 `0x2CC` 回读给脚本 | 滚轮允许翻页 | 滚轮不翻页（脚本可读到 0） |
| `set:ReDrawTextOnKey` | **缺失** | `sub_411BC0` | 按键时整屏重绘 | 不重绘 |
| `set:ControlDisibleCursor` | **缺失** | `sub_411BC0`、`sub_411900` | 隐藏光标（`sub_4051A0`） | 不隐藏 |
| `display:UseIVideoWindow` | **1** | `sub_411BC0` | 走 IVideo 窗口相关分支 | —— |
| `system:EffectSkipOnClick` | **0** | `sub_411BC0`；另经 `0x306` 回读给脚本 | 点击可跳过特效 | 不跳过 |
| `set:IsReggist` | **缺失** | `sub_411BC0` | 未注册提示（60s 后弹 `E_0`） | 无提示 |
| `message:AutoMessageOption` | **0** | `sub_411BC0`、`sub_41EEF0`；经 `0x2EA` 回读 | 自动播放（按下面 4 个时间/间隔） | **自动播放关闭**（`122455` 不会被自动推进） |
| `message:AutoMessageTime0/1` | 500 / 2000 | 同上；经 `0x1B8` 回读 | 自动播放的等待时长 | 仅作为数值存字段 |
| `message:AutoMessagePitch0/1` | 0 / 0 | 同上；经 `0x2E6` 回读 | 自动播放的行间隔 | 同上 |
| `message:MessageSpeed` | 5 | `sub_409400`（`_this[86672]`） | 消息窗**对象布局**节流（每 `MessageSpeed` ms 重算一次布局） | 0 时改为立刻连续重算 |
| `message:MessageFade` | 250 | 启动灌字段 → `engineValues[320424]` | 消息淡入时长（渲染侧） | —— |

## 2. 这些键是怎么"被改"的（设置界面闭环）

- **读回给脚本**：`0xC5`（音量）/ `0xC7`（开关）/ `0x1B8`（自动播放时间）/ `0x2CC`（滚轮翻页）/
  `0x2E6`（自动播放间隔）/ `0x2EA`（自动播放总开关）——**都是"读配置 → 写回操作数"**，
  在 CONFIG1 里被存进 local 供后续 `jcc`/显示使用。**当 no-op 跳过 = 脚本读到旧值**（静默错误）。
- **写入**：`0x131`（`message:MesWinAlpha` getter）、`0x1CA`（`message:ReadTextSkip` setter）、
  `0x1CB`/`0x1CA` 一族经 `sub_404F80` 的 SetConfig vtable；设置界面的"确定"路径会写回配置注册表。
- **启动灌注**：`engineConfig.ts` 的 `CONFIG_FIELD_BINDINGS`（`message:MesWinAlpha → _this[21668]`、
  `message:MessageSpeed → _this[86672]`、`message:MessageFade → _this[320424]` 等）。

## 3. 当前 emulator 的处理（哪些已按门实现、哪些仍是近似）

| 门 | emulator 状态 |
|---|---|
| `message:ReadTextSkip` | ✅ 已实现（`0x6E/0x71/0x72` 的门 + `0x1CA` 运行期覆盖） |
| `message:MesWinAlpha` | ✅ 已实现（`0x6E` 每段 `SLEEP_GATE`）+ `0x7F` getter 读字段 |
| `set:CancelMesSkipOnClick` | 🟠 三态机已实现但按 `cfgInt` 门控 ⇒ 当前休眠（与引擎一致） |
| `set:WheelKeyUp/Down`、`set:ReDrawTextOnKey`、`set:ControlDisibleCursor` | ❌ 未建模（见台账 `adv-advance-route-table` 的 note） |
| `message:AutoMessage*` | ❌ 自动播放未建模（只作为配置值存在） |
| `message:MessageSpeed` | ❌ 消息窗对象布局节流未建模（`sub_409400`） |
| `message:AdvanceMesOnWheel` | ✅ 经 `0x2CC` 可被脚本读到 |
| `system:EffectSkipOnClick` | ✅ 经 `0x306` 可被脚本读到 |

## 4. 记录纪律（后续遇到新门时照此办）

1. **读到门就照门实现**，不要用"当前配置不会走到"当借口写死一个分支；
2. **走不到的分支必须登记**：键名 + 随包值 + 门控函数 + 走到的分支要做什么 + 什么配置会让它走到；
3. **配置回读类指令（写操作数的）一律不得当 no-op**：它们不报错、只让脚本读到旧值——这是闸门 B 的定义；
4. 新键先查 `SYS4REG.INI` 是否真有；**缺失**（`GetConfig` 返回 0）本身也是一种"当前配置"，
   要在表里写成「缺失 ⇒ 走 X 分支」，不要写成"该键不存在"。
