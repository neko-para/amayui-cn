# CONTEXT — 天結いキャッスルマイスター Emulator / 引擎逆向进展快照

> 本文件是**会话外恢复用的上下文快照**（新开会话先读我）。记录当前整体进展、关键技术事实、文件清单、
> 待办与阻塞。有歧义处明确标注「待确认」。

---

## 0. 一句话现状

用 **TypeScript + Electron + PixiJS v8** 重写《天結いキャッスルマイスター》的 AGE/System4 引擎 VM
（解释器已能无界面跑启动链到 `TITLE.BIN`，Electron 渲染壳已接通）。**本次会话深入逆向引擎的
「淡入淡出 + 场景切换停留」机制**，以及 `this` 对象布局、opcode 语义、并搭了一套 **32 位 Python 实机内存探测**工具。

---

## 1. 工程位置

- 仓库根：`E:\Games\Eushully\天結`
- 逆向依据：`engine/engine.cpp`（Hex-Rays 反编译，约 18.1 万行）、`engine/天结_unpacked.exe_utf8.c`（同内容，行号略偏）
- 权威文档：`docs-new/`（唯一新来源；含 `03-engine/opcode-table.md`、`rendering.md`、`runtime-memory.md` 等）
- 脚本反汇编：`src/*.txt`（941 个）；容器 `install/SYS4INI.BIN` + `APPEND*.AAI`；游戏数据 `install/DATA*.ALF`
- 实机进程：`天结_unpacked`（= 去壳版，与 `install/AGE_free.EXE` 同布局；用户用调试器以管理员启动）

---

## 2. 引擎关键事实（本次已确认）

### 2.1 架构 / 单线程
- **引擎单线程**：渲染与脚本解释都在同一 `interpreterMainLoop_412290`（line 20291）里交替执行。
  两个 `CreateThread` 分别是**文件异步读**（`sub_47B200`）与 **DirectSound 音频**（`sub_4B5AA0`），**无独立渲染线程**。
- 全局引擎单例 = **`dword_55E1BC`**（＝ `Engine *this`）。**模块基址 = 0x400000（固定，无 ASLR）**。

### 2.2 启动初始化链（WinMain → 进入 VM 主循环）
`WinMain`(139773) → `CoInitialize`/注册窗口类 → `commandConstructor_415640`(22242)（建 `this`+dispatch 表 0xA509C + `srand`）→ 命令行解析 → `sub_4B8D00`(工程名) → `sub_414AC0`(读 sys4ini.bin) → `sub_476190`(配置类) → `sub_40AEE0`(SAVE 存档) → `sub_4084E0`(版本/校名) → `sub_4BA310`(建主窗口) → `-d` 系列(D3D 设备/回缓冲配置) → `sub_417800`(最大 init：读配置/载字体/timeBeginPeriod/建 D3D 设备) → `SetThreadExecutionState` → `loadScriptFrame_40ED40`(140215)（**加载初始脚本帧 = SYSTEM4**）→ `SetTimer(hWnd,2,0x2710,0)`（10s 防睡眠，与版权页无关）→ `interpreterMainLoop_412290`(140221)。

**关键：初始化阶段没有为"等待/渐变"预置任何东西**（无固定 Sleep、无计时器预启动、无 fade/画面字段预写）。`dword_55E1BC` 是 this；`_this[174801]=*(_this+699204)`。

### 2.3 主循环"指令不推进/等待"机制（已确认）
- 主循环 = **10 层嵌套 `while(1)` + 跨层 goto**（LABEL_4/108/126/186/215/216/229）。
- 派发点在 **21036-21047**：`v18=**(_this+120*cur+383128); if>0x3FF goto LABEL_229(sub_418E30); (*handler)(_this); _this[120*cur+383128] += 4*arity;`
- **每层 while 是一道"门"，由 `_this[174801]`(**byte 699204**) 的一个 hold 位控制**：该位=1 → 该层驻留（做异步工作 + present/重绘），**不落派发处 → 脚本 ip 保持当前 opcode**；异步完成清位 → 逐层 break → 才派发并 `ip += 4*arity`。还有最快路径 `if(!v17) goto LABEL_216`（20595）：无任何 flag 时直接派发推进。

| 层 | hold 位 | 驻留做的事 |
|---|---|---|
| L5 | **0x2000（影片/媒体）** | 画影片帧、检测结束/跳过、重排 0x2000 |
| L2 | 0x8000000（消息） | sub_411900 显示消息+重绘 |
| L4 | 0x80 / 0x400（系统特效/按键等待） | sub_447810 / sub_407E20 |
| L7 | 0x4000000（输入/脚本处理） | sub_478090 读输入→699208 |
| L9 | 0x400000（窗口消息泵） | WaitMessage/GetMessage |
| L8 | 0x1000000（影片结束清理） | 清影片 + Sleep(5) |
| L6 | 0x100000 | sub_411590 + Sleep(5) |
| L3 | 0x40 | sub_408F10 |
| L1 | 0x20/0x1/0x10000000/0x800000/0x80000000 | 本帧不派发 |

- **`play-movie`(0x20F, sub_4237B0) 用 0x2000 hold 脚本**：函数尾 `*(_this+699204)|=0x2000; *(_this+675972)=1;`（31226-31227）；L5 的 0x2000 分支（20723-20799）读按键、用 `(_this+7912)+12` 画影片帧，LABEL_126（20743-20768）遍历媒体槽：**只要还有存活对象就重排 0x2000** → 20724 的 break 永不成立 → L5 一直驻留、ip 不推进；影片对象全销毁才推进。`675972` 只是驱动媒体帧更新（20504-20563）。

### 2.4 淡入淡出（结论）
- **引擎唯一的"整屏黑幕渐变"图元 = fade opcode 族（0x20-0x38）**：`_this[174801]|=bit0x8` → `sub_453A60` 启动 `_this+429844` 计时器 → 主循环 `sub_453AF0` → `sub_441E10` 用 `_this+8120`(α) + `_this+7912` vtable+36 画整屏纯色矩形（`sub_498B60` 先 D3D Clear 黑）。
- **但版权页/菜单的渐变不是它**：54 个 boot 脚本全指令流无 fade opcode；且 `_this+8120/+8128`/bit0x8/FadeTimer/gamma/D3D 实机实测**全 0**。
- ⚠️ **旧推测「渐变感 = present 的"清黑→逐帧绘出新场景"」已基本排除**：`present`(`sub_4B4040`) 的 ClearTarget(`sub_498B60`) 被 `(_this+46460)&1` 守卫，而 `_this+46460` 只在图形设备 ctor（raw.c 128412）被置 0，**全文件无任何 `|=1`/非零写入** → present **从不**无条件清黑；且 present 只在 `sub_40BE10(_this+322832)==1`（图形池脏/挂起）时执行（主循环 line 20581-20583），并非每帧都跑。
- **版权页/菜单过渡渐变（未完全定论）最可能是引擎内建的「场景切换/加载」暗场渐变**，独立于 fade opcode 族与 present 的清黑：主循环 0x1000 过渡门（line 20663-20683，`sub_421AA0` 置 0x1000 + 启动 `_this+430096` 场景 FadeTimer）+ 场景内容分帧提交；`u00420D50`(0x20B, `sub_4A4C70`)=纯色+α 填充、`set-vertex-color-alpha`(0x323)=静态网格遮罩（均无逐帧计时，非动画）。
- **`_this+8128`**（byte 0x1FC0）是整屏淡入 α（`sub_4A2D50` 用），而 **`_this+8120`(0x1FB8) 只是淡出步进计数**（`+=_this[8232]` clamp 256）。
- **`_this+8128`**（byte 0x1FC0）是整屏淡入 α（`sub_4A2D50` 用），而 **`_this+8120`(0x1FB8) 只是淡出步进计数**（`+=_this[8232]` clamp 256）。

### 2.5 版权页"等几秒"（已收敛：0x400 卫门）
- **不是脚本 wait 指令**：`src/LOGO.txt` 无 0x1F4/0x1F5/0x20C/sleep/wait；`u00420270`(0x1F7) 是同步图形池区间重排（`sub_422BC0`→`sub_4ABB60`，ip 无条件推进，非等待点）。
- **等待 = 主循环 0x400 卫门**：`LOGO.txt:46 u00416270`(0x21C, `sub_41A260`) 置 `_this[174801]|=0x400`（并 `[30*cur+95805]=1`）。主循环 0x400 分支（line 20934-20977）在 `0x400` 置位时**每帧驻留**：调 `sub_407E20(_this+322832)`（图形池"挂起/计时"检查，byte 369356=时长/369352=起始/369344=强制结束标/11627=脏）或 `v95`(影片标志)为真则 `goto LABEL_186` 不落派发、脚本 ip 停在 `LOGO.txt:47`；当 `sub_407E20` 返回 0 且 `!v95` 时清 0x400 → 才派发 `u00420270` 并推进。**这解释了实机观察的 ip=47 / effect_flags=0x400。**
- **"几秒"的量**（已收敛）：不是脚本计时。`sub_407E20`(12679) 的 `_this[11631]`(+46524) **恒为 0**（全文件只被清零，从不设正值）→ 它恒返回 `_this[11629]`(=+46516 图形池挂起旗标)。而 `_this[46516]` 由 **mesh 颜色动画**在动画窗口每帧置 1（mesh 绘制 `sub_4AF1C0` glob码 131503），帧始 `sub_4B4040` 清 0（134752）。⇒ **等待时长 = 版权页两个 mesh 的 CalcDiffuse 动画窗口**（`sub_4AF1C0` 里 `_this[46500]` 帧钟从 `entry[11]` 推进 `entry[11]+entry[12]` 的 tick 数）。动画完成（`_this[46500]>=start+count` 或 `_this[46512]` 强制快进 `sub_407EA0`）即 `_this[46516]` 不再置位 → `sub_407E20` 返 0 → 清 0x400 放行。**不是异步纹理装载/场景 FadeTimer。**
- **`sub_407E20`/`sub_40BE10` 同属图形池"挂起"检查**（`sub_40BE10` 还查 `_this[11627]` 脏位与链表 `_this[259]`、`_this[12676]`）、`sub_41B180`/`sub_41B1C0`（0x243/0x305）以 `[369344]=1;[369352]=0;[369356]=0` 强制"结束挂起"，非脚本级 sleep。脚本级"等待"原语 = `0x1F4`/`0x1F5`/`0x20C`，LOGO.txt 未用。

### 2.6 `this` 对象布局新增信息（byte 偏移）
| 对象/字段 | byte 偏移 | DWORD 下标 | 说明 |
|---|---|---|---|
| 消息窗对象（台词窗） | **0x14D30** | `_this[21324]` | ⚠️ 修正！之前误写 `0x534C`；正确 `0x14D30`。`show-text`(0x6E)/`end-text-line`/`wait-for-input` 与 `0x70-0x79/1C1/197/1A5/2BD/2DB/2FE/303` 都打它；`sub_459F40` 重建字体 |
| 图形/纹理池 | **0x4ED10** | `_this[80708]` | `draw-texture`/`set-vertex-color`/`create-texture`/`sub_4ACE50`/`sub_4AE330`/`sub_4ADFE0` 经它；`[11627]`=重画位（byte 46508） |
| 图形设备对象 | **0x1EE8** | `_this[1978]`(byte 7912) | `sub_441410`/`sub_441E10`/`vtable+36`；present 的渲染对象 |
| 资源路径解析 | **0xA609C** | `_this[340023]` | `sub_454FA0/4559C0/455560` |
| 配置/接口对象 | **0xAA514** | `_this[174405]` | vtable 派发 `"message"/"readtex"/"MessageAutomes_1"/"set:SaveVersion"` |
| effect/movie 标志位图 | **0xAAB44** | `_this[174801]` | = byte 699204；bits 见 2.3 |
| fade α(步进计数) | 0x1FB8 | `_this[8120]` | 淡出步进计数 |
| fade α(整屏淡入) | 0x1FC0 | `_this[8128]` | `sub_4A2D50` 用 |
| fade type / 目标 / 步进 | 0x1FBC/0x1FC4/0x2028 | 8124/8132/8232 | `sub_441410` 写 |
| 命令级 FadeTimer | **0x68F14** | (=429844) | bit0x8 步进源 |

**FadeTimer 结构**（28B）：`vtable / elapsed / step(计步,初1) / leftover / stop / startTime(timeGetTime) / stepDur(周期ms)`。实例集群在 byte 0x68F14(429844)/0x69010(430096 场景切换)/0x69208(430600 轮播)/0x68FBC(430012 BGM) 等。

**帧模型**：`frames[40]`，`frame[0]` 其实是 SYSTEM4（inspector 之前显示错了）；boot 主要跑 `cur_script=1`。帧 ip 在派发处**无条件推进**；`frames[cur].ip 指针` = `this + 120*cur + 383128`（读 opcode 用）。

---

## 3. opcode 分析（本次补了 25 个 SYSTEM4/LOGO 缺口）
`docs-new/03-engine/opcode-table.md` 已把这 25 个"仅映射"补成"已核对"（含语义+raw.c 行号）：
`0x1F4`(帧计时)/`0x1F5`(帧倒计+派发)/`0x20B`(颜色+α 填充)/`0x1CE`(消息点击-跳读状态机，置 0x40000000+430600)/`0x1CF`(消息跳读态)/`0x19C`/`0x19B`(ADV 进/出)/`0x1BC`/`0x1BF`/`0xD9`(清 0x1000)/`0x93`(显示态切换)/`0xB6`(声音)/`0x1FD`(缩放)/`0x217`(变换)/`0x20E`(图形提交)/`0x1F6`(清图形链)/`0x23D`/`0x259`(纹理清理)/`0x229`(绘制模式)/`0x215`/`0x216`(getter)/`0x1B2`/`0x1B3`/`0x1B4`(调试/错误)/`0x1`(抛 Exit)。
此前已确认 64 个 boot→TITLE 执行 opcode（含 0x6 load-into-frame、0x1F9 set-texture、0x1FB draw-texture、0x1A3 string-lookup-set、0x2D5 float mov 等）。

---

## 4. 实机探测工具（本次搭好）

**32 位 Python**（`C:\Program Files (x86)\Python313-32\python.exe`）在 **`tools/fade_probe_proj/`**：
- `age_query.py <PID>`：提权+dispatch 扫描定位 `this` → 读 `frame(cur)`/当前 VM 指令(opcode+参数)/`effect_flags`，并**写 `proc_state.json`**。
- `age_thread_eip.py <PID>`：枚举线程 + `GetThreadContext` 读 **EIP**，按已知函数地址猜所在函数。
- `age_fade_wait_probe.py <PID> <this> [间隔] [时长] [csv]`：提权附加，连续采样 `effect_flags`/fade α/各计时器/纹理槽。
- `age_spawn_wait_probe.py [时长] [间隔]`：**自己 CreateProcess 启动游戏** + 扫描 `this` + 采样（避免"事后 attach 太晚"）。
- **Node 映射器** `app/amayui-emulator/age_map_src.mjs`：读 `proc_state.json` → 复用 emulator 的 `dist/script/alf.js`(SYS4INI scriptIndex→文件名) + `dist/script/bin.js`(OPCODE_TABLE) → 输出 `src/<名>.txt` + 当前指令行（尽力）。

**C# 探测**（`tools/fade_probe_proj/`）：`age_free_fade_probe.cs` + `fade_probe_proj.csproj`（`dotnet build -c Release` → `bin/Release/net10.0/age_free_fade_probe.exe`）。`--spawn` 自启动/`--debug` 断点法；提权读取用 `Start-Process -Verb RunAs`（或用户管理员终端直接跑）。

**实机关键数据（进程 9544，`天结_unpacked`）**：
- `this=0x27CA020`，`cur=0x1`（frame[1]），`effect_flags=0x400`（0x21C 置的每脚本槽位）。
- 版权页暂停时脚本 ip 指向 `LOGO.txt:47 u00420270 30d40 4`（0x1F7，同步重排，**非等待**）；播放 Stage2 时 ip=**第53行 release-texture 2a**（play-movie 后一行 → play-movie 已执行并推进）。
- 主线程 EIP 在 `sub_4B4040`(present)。
- 游戏进程为**管理员**提权 → py/C# 需 `SeDebug` 或 `RunAs` 才能读。

---

## 5. 关键文件清单（本次涉及）
- 文档：`docs-new/03-engine/opcode-table.md`（+89 行已核对）、`rendering.md`（§3 fade/等待结论待最终定稿）、`runtime-memory.md`（§1.1 消息窗对象；`this` 增量待补）、`engine/engine.hpp`（**待更新**：`this` 新信息 + 消息窗偏移 `0x534C→0x14D30`）。
- 工具：`tools/fade_probe_proj/*.py`、`tools/fade_probe_proj/age_free_fade_probe.cs`、`tools/fade_probe_proj/fade_probe_proj.csproj`、`app/amayui-emulator/age_map_src.mjs`。

---

## 6. 待办 / 未解
1. **版权页"等几秒"** — ✅ 已收敛为**主循环 0x400 卫门**（`LOGO.txt:46 0x21C`→`sub_41A260` 置 `|=0x400`；主循环 line 20934-20977 驻留，`sub_407E20(_this+322832)` 图形池挂起/计时检查为真即不落派发，脚本 ip 停 LOGO:47；`sub_407E20` 返 0 且 `!v95` 才清 0x400）。**唯一未收敛项：`sub_407E20` 挂起时长（byte 369356）的具体设值来源**（候选：set-texture 异步纹理装载 / 场景载入 FadeTimer）。
2. **版权页/菜单「黑渐变」的画面原语** — 已排除 fade opcode 族与 present 清黑（present 的 ClearTarget 被 `_this+46460&1` 守卫、字段恒 0；present 仅图形池脏时执行）。未定论：是否为 0x1000 过渡门（`sub_421AA0` 置 0x1000 + `_this+430096` 场景 FadeTimer）+ 场景内容分帧提交（推荐下轮用实机在**过渡瞬间**采样 `effect_flags`/`_this+430096` FadeTimer/`_this+46460` 或逐帧截图确认）。
3. **落盘**：`engine/engine.hpp`（`this` 新信息 + 消息窗偏移 `0x534C→0x14D30` 修正）、`runtime-memory.md` 定稿。`rendering.md` §3 本轮已更新（等待=0x400 卫门；渐变=引擎内建场景切换/加载暗场渐变，非 fade 计数、非 present 清黑）。
4. 其余（emulator 侧）：角色立绘、视频(LOGO.MPG/TITLE.MTN)、Live2D、输入。

---

## 7. 运行方式
```bash
# 解释器/emulator
cd app/amayui-emulator && npm run run      # tsx src/run.ts（无界面跑到 TITLE）
# 32 位 Python 实机探测（管理员）
& "C:\Program Files (x86)\Python313-32\python.exe" tools/fade_probe_proj/age_query.py <PID>
node app/amayui-emulator/age_map_src.mjs
```

---

## 8. 注意点 / 坑
- 游戏进程为**管理员**提权；py/C# 读取需 `SeDebugPrivilege`（若进程本身非管理员则失败）或 `Start-Process -Verb RunAs` 提权启动探测。
- `engine.cpp` 中 `_this` 有 byte 偏移（`*(_DWORD*)(_this+N)`）与 DWORD 下标（`_this[N]`，×4=byte）两种形态，跨函数换算须按各自 `_this` 类型确认（**易踩坑**：消息窗我一度误写成 `0x534C`，实为 DWORD 下标 21324 → byte `0x14D30`）。
- 主循环是**含跨层 goto 的嵌套状态机**；子代理对个别 goto 目标作用域仅按大括号推断，未单步。
- 32 位 Python 读线程上下文须用 `GetThreadContext`；`CreateToolhelp32Snapshot` 枚举线程用 `TH32CS_SNAPTHREAD=0x4`（0x2 是进程快照）。
- 提权进程的控制台输出不易被父会话捕获 → 探测结果靠**写文件**（`probe_run.log`/`proc_state.json`/`*_stdout.txt`）。
