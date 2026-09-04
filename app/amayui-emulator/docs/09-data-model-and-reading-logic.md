# 09 数据模型与读取逻辑（本体 + 扩展包合并；引擎侧读取）

> 状态：**分析完成**。本文件记录对 AGE 引擎「归档/资源 读取」与「纹理映射数据模型」的实证结论，
> 以及模拟器当前已实现的对应代码。用于后续接「真实标题图像渲染」。
> 依据：`engine/engine.cpp`、`engine/engine.hpp`、`scripts/agf/format.js`、`src/script/alf.ts`、
> `tools/alf/unpack_alf/unpack_alf.cpp`、调用图脚本 `.tmp/callgraph.mjs` 产出。

---

## 0. 一句话结论

引擎**不硬编码纹理映射**。资源由「本体 SYS4INI + N 个 APPEND.AAI」在**统一文件 id 空间**合并；
纹理 id→图像 id 的映射表 `_this[5*texid + 81174]` 由 **set-texture(0x1F9)** 与 **数据载入 opcode
(0xAB/0x190/0x19F/0x1A1 → sub_410160)** 在运行时填充。标题背景/版权由 `LOGO.txt` 的 set-texture 设置。

---

## 1. 统一文件 id 空间（本体 + 扩展包合并）

### 1.1 实测：id 与脚本索引共用 ALF 索引

用 `resolveFileEntry` 解析 ALF 索引（`raw/SYS4INI.BIN` → 21109 个文件条目）：

| id | 文件 | 角色 |
|---|---|---|
| `0x5245` | `SO006.AGF` | 标题背景（步骤1） |
| `0x5246` | `SO005.AGF` | 版权/警告（步骤1，叠在背景上） |
| `0x5272` | `SO004.AGF` | 主菜单复合图（1664×1536，步骤3） |
| `0x5273` | `SO004A.AGF` | Live2D 用菜单图（暂不管） |
| `0x5274` | `TITLE.MTN` | 步骤2 视频/动画 |
| `0x5264` | `TITLE.BIN` | 标题脚本 |
| `0x5247` | `LOGO.MPG` | LOGO 场景的视频/动画（`u00420E40 5247 2a 20004`；**修正**：早先备注「SO007 相关」误） |
| `0x5170` | `SETREIGNTEX.BIN` | 纹理设置脚本（REIGN 场景用） |

### 1.2 合并模型（用户预期「本体+每扩展包各一个，整体合并」✓）

- **本体**：`SYS4INI.BIN`（magic `S4IC450`，**包头 300 字节** = `signature_title[240] + unknown[60]`）。
  `sub_414AC0(this,0,"SYS4INI.BIN")` 载入 → `sub_454D30` 解析 TOC → 主资源管理器（`_this+680092`）。
- **扩展包**：`APPEND01..05.AAI`（magic `S4AC`，**包头 268 字节** = 0x10C）。
  `sub_455750` 用 `FindFirstFileA("*.AAI")` 扫全部 `.AAI`，逐个 `sub_401100` 载入，注册到
  `_this[v6[69] + 3082] = pack对象`。
  **包号 = 头部偏移 264（u32）**（实测 APPEND01→1 … APPEND05→5，因此 `v6[69]`=`头部[264]`）。
- **统一 id 命名空间**：
  ```
  id = 0x00000000 .. base文件数-1         → 本体文件
  id = (pack# << 24) | idx                → APPEND0n 里的第 idx 个文件
  ```

### 1.3 引擎侧解析向量 = `sub_4559C0`（读文件 id → 句柄）

```
if (id & 0xFF000000) {                 // 高字节 = 包号
  pack = _this[(id>>24) + 3082];       // 取对应 pack 索引
  sub_401410(pack, hwnd, id & 0xFFFFFF, &len);   // 低24位 = 包内索引
} else {                               // 本体
  entry = files + 80*id;               // 80B/项 S4TOCFILENTRY
  // ① 松散文件优先  CreateFileA(entry.filename)
  // ② 否则归档切片   CreateFileA(archives[entry.archive_index]) + SetFilePointer(entry.offset)
  //    len = entry.length
}
sub_455420(this, h, id, len);
```

`S4TOCFILENTRY`（80B）：`filename[64] + archive_index(u32@64) + file_index(u32@68) + offset(u32@72) + length(u32@76)`。
`S4TOCARCENTRY`：`filename[256]`（所以 `archives[archive_index]` 按 `archive_index << 8` 寻址，正好 256B/项）。

---

## 2. 引擎侧读取逻辑（函数链）

| 函数 | 作用 |
|---|---|
| `sub_414AC0` (0x414AC0) | 打开 SYS4INI/AAI → 判 `S3IN/S4IN`（压缩）或 `S3IC/S4IC` → 解压 TOC → 交 `sub_454D30` |
| `sub_454D30` (0x454D30) | 解析 TOC 建资源管理器：`arcCount + archives[] + filCount + files[]`（files 的 offset 先置 -1 表示「松散」） |
| `sub_455000` (0x455000) | 按名找文件 → 返回文件 id |
| `sub_4559C0` (0x4559C0) | 文件 id → 句柄（本体/APPEND、松散/归档切片，见 §1.3） |
| `sub_455560` (0x455560) | 对文件句柄加锁并定位（线程安全读） |
| `sub_455420`/`sub_455620` | 读/解锁 |
| `sub_410160` (0x410160) | **通用数据文件载入器**：`sub_438120` 取偏移/长度 + `sub_437980` 读入缓冲，把内容拷入全局数组 / 100 角色图 / **1000 纹理表** |

---

## 3. 初始化调用链（WinMain → 主循环前）——调用图实证

用 `callgraph.mjs` 从 `engine.cpp` 提取函数定义+调用（3643 函数 / 7544 边），产出 `.tmp/engine-callgraph.dot/.edges/.svg`。

- **主循环** = `Engine::interpreterMainLoop_412290`（`__noreturn`，`engine.cpp` 20339，WinMain 在 **line 140789** 进入）。
- **边界**：`WinMain(line 140341) → … → line 140789` 之前 = 进入主循环前的初始化。

```
WinMain (0x4BA890)
 ├─ commandConstructor_415640 (引擎构造 0x415640)
 │    └─ sub_40DF10 → sub_499BC0   ★ 纹理表 init：1000×5int，image id 置 -1(空)
 │       (sub_44A9A0/sub_4B8530/sub_465390/sub_4AA180/sub_4AB7A0 … 图形对象构建)
 ├─ sub_414AC0("SYS4INI.BIN"/"SYS3INI.BIN")  ★ 加载 ALF 归档索引（S3IN/S4IC 魔数判断）
 ├─ sub_4084E0 (数据初始化) ── sub_4550B0/sub_4556E0/sub_404820
 ├─ sub_40B3B0 / sub_4350B0 / sub_4350E0 (配置目录/注册表)
 ├─ loadScriptFrame_40ED40  ★ 载入启动脚本(SYSTEM4)
 └─ interpreterMainLoop_412290  ★★ 主循环(之后才执行脚本)
```

**结论**：
- init 只加载 **ALF 索引**（sub_414AC0）+ 把**纹理表初始化为空**（sub_499BC0 置 -1）。
- **纹理 id→图像 id 映射是主循环里运行时填的**：
  - `set-texture`(0x1F9) → `op_set_texture_422CB0` → `sub_4A3800` → `sub_49E9D0`，把 imgid 写进 `[5*slot+466]`。
  - 数据载入 op（0xAB/0x190/0x19F/0x1A1）→ `sub_410160`（读数据文件，也批量加载纹理）。

---

## 4. 纹理 id→图像 id 映射机制（核心）

- **表**：`_this[5*texid + 81174]`（DWORD 索引，= byte 偏移 `324696 + 20*texid`），1000 项 × 20B。
  复制链：`[81174] →(memcpy 0x4E20) [86174] →(memcpy) [151523]`。`sub_430380`(0x216) 读它，
  `sub_4A3800`(set-texture 加载器) 写它。
- **填充者**：
  1. `set-texture imgid slot`：`sub_4A3800` 里 `v7=&_this[5*a4]; v7[466]=a2(imgid)`（`a4`=slot）。
  2. 数据载入 `sub_410160`：从**数据文件**读内容到 `_this[5*texid..]`，并在 `a6` 时跑**纹理预载循环**
     （for texid 0..999：若 `_this[5*texid+151525]==1` 且 `_this[5*texid+151523]>=0` → `sub_4A3800` 载入）。
- **数据载入 opcode 只在 APPEND(DLC) 脚本中出现**（`$1$SC*.txt` 等），**不在启动到 TITLE 的路径**。
  启动链（SYSTEM4→数据表INIT→INIT→TITLE）里没有 0xAB/0x190/0x19F/0x1A1。

---

## 5. 标题图像来源（关键发现）

`src/LOGO.txt`（启动版权/背景场景，55 行）：
```
set-texture 5245 2a (SO006 → slot 0x2a)   // 背景
set-texture 5246 2b (SO005 → slot 0x2b)   // 版权
draw-texture 30d40 2a 0 0 500 2d0 0 0     // 背景全屏（纹理 id=0x30d40, layer=0x2a）
draw-texture (30d40+1) 2b 0 0 500 2d0     // 版权全屏
u00420480 2a / 2b                          // release
create-texture 2a 500 2d0 0                // 重建背景纹理 id 0x2a
u00420E40 5247 2a 20004                    // SO007 相关
```
`src/TITLE.txt`：`set-texture 5272 4 (SO004→slot 4)`、`set-texture 5273 5 (SO004A→slot 5)`。

**待确认语义**：`set-texture` 的 **slot（0x2a/0x2b/4）** 与 `draw-texture` 的**纹理 id（0x30d40…）**是
**两个索引空间**。LOGO 的 draw 用生成的纹理 id `0x30d40/0x30d40+1`，画在 layer `0x2a/0x2b`（与 set-texture slot 一致）。

---

## 6. ALF/AGF 解压——忽略数据段检查结论

检查「当前解析器跳过但不一定是垃圾」的字段并实际解码：

| 位置 | 当前解析器 | 实际内容 |
|---|---|---|
| **SYS4INI/AAI 头部 `S4HDR.unknown[60]`**（字节 240–300） | `alf.ts`/`unpack_alf.cpp` 跳过 | **引擎初始 INI 配置块**：`[264]=640`（渲染宽，==`_this[699168]`）、`[268]=480`（==`_this[699172]`）、`[272]=16`、`[276]=0x708adc`（全局数组基址/大小）、`[280]=30`、`[284]=0x1fc9d`、`[288/292/296]=2` |
| `S4SECTHDR.original_length2`（+4） | 跳过 | == `original_length`（冗余） |
| AGF meta 头字节 0–19 / 28–55 | `parseWhBpp`/`parsePalette` 只读 20/24/30/56 | 图像格式/尺寸/偏移字段 |
| AGF body 头第一个 u32（`unk`） | `extractAgfToPng` 忽略 | **== bodyUnp**（冗余） |

- **AGF 不是纹理映射自包含**（meta 是 w/h/bpp/调色板+偏移；body 头冗余）。
- **ALF/AAI 头部配置块不是纹理映射**（是分辨率/全局数组布局）。
- ⇒ **纹理映射既不在 AGF 也不在 ALF/AAI 忽略段**，它在 **`sub_410160` 读的那份独立数据文件**里。

---

## 7. 模拟器已实现的对应代码

- `src/script/alf.ts`：`parseSys4Index`(SYS4INI, SYS4_TOC_POS=300) / `parseAppendIndex`(APPEND, 268) /
  `resolveFileEntry`(统一 id 空间)。
- `src/arch/nodeFileSource.ts`（**本次改动**）：新增
  - `#loadAppends()`：解析 `APPEND01..05.AAI`（`parseAppendIndex`）填充 `#appends[1..5]`。
  - `resolveEntry(id)`：`id<base.files.length` → 本体；否则 `pack#=id>>24`、`pos=id&0xFFFFFF` → 对应包（带各自 `archives`）。
  - `readScript`/`#readEntry` 改用该解析（携带所属索引归档表）。
  - 导出 `APPEND_COUNT=5`。
- 验证：`tsc` 干净；`npm test` 12/12 通过（含 `LOGO.BIN` 与 `src/LOGO.txt` 逐条一致）。
- 实测：`resolveEntry(0x5245)=SO006.AGF`(DATA1.ALF)、`resolveEntry(0x1000000)=$1$AUTORUN.BIN`(APPEND01.ALF) 等。

---

## 8. 待办 / 开放问题

1. **set-texture slot ↔ draw-texture 纹理 id(0x30d40) 的生成关系**（决定逐碎片精确渲染）。
2. 标题背景/版权/按钮的纹理 id→图像 id 精确映射仍未完全从引擎侧定位（数据载入 opcode 不在启动链；
   需继续追引擎 init 或采纳 **整页复合图** 方案）。
3. **图像 IPC**（主进程 id→AGF 字节→解码 → renderer `Texture`）+ 操作数解码 + Pixi 真实渲染。
4. 窗口分辨率（背景 1280×720；菜单 SD004 1664×1536 需缩放/定位）。
