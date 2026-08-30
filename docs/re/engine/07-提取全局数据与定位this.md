# 从运行进程提取 global 数据：与「定位 `this`」的方案（engine）

> 级别：**已确认（数据路径）/ 方案建议（实现路线，待实操）**。
> 目标：从运行中的游戏进程里读出引擎 VM 的**全局数据**（global-int/float/string/ptr 数组，尤其是掉落 item/rate 区段 `0x53cd7c..0x53f48c`）。
> 前置：`05-操作数访问原语.md`（读/写 accessor、`DEC`/`ENC`）、`docs/re/src/03-掉落数据.md`、`docs/re/src/04-存档与内存.md`。

---

## 1. 数据路径（已确认）：global 数据是「间接 + 编码」的

脚本里的 `(global-int 0x53f48c)` 是 **VM 抽象索引**，不是进程地址（`04-存档与内存.md` §3）。真实取值路径（来自 `sub_41BF50` case 3 / 9）：

```
real_mem  = global_int_base + index*4          // index = VM 抽象索引，如 0x53e104
value     = DEC( *(DWORD*)real_mem )           // DEC(x) = ROR4( key ^ ROL4(x,11), 25 )
global_int_base = *(this + 0x5D800)            // ★ 指针在 this 里
key             = *(this + 0x5EC8C)            // ★ 解混淆 key 也在 this 里
```

- `sub_41BF50`/`sub_42B4B0` 已实读 confirm：int 槽（global/local int、ptr、数组元素）都过 `DEC`/`ENC`；float 槽直接存/取。
- 各数组基址在 `this` 里的偏移：global-int `0x5D800`、global-float `0x5D808`、global-string `0x5D810`、global-ptr `0x5D818`、global-float-ptr `0x5D820`（每脚本局部数组在 `this + 120*cur_script + 0x957…`）。
- **陷阱（重要）**：`.lst` 的 `.data:0053E104 / 0053CD7C` 是 `dd 0` 的**无关静态全局**，并非掉落表；`0x53F48C` 处是 `??_R3Sound@@8`（RTTI）。**千万不要把 VM 抽象索引值与 `.data` 区地址混为一谈**——掉落表真实位置 = `global_int_base + 0x53e104*4`。

---

## 2. 为什么必须定位 `this`（而不只是算地址）

- **key 是 per-instance 的**：`sub_415640` 构造器里 `mov [esi+5EC8Ch], edx`（`edx` = 调用者传入的局部变量），**不是编译期常量** → 没有 `this` 拿不到 key。
- **数组基址是间接指针**：`*(this+0x5D800)` 是指针，其值（无论指向静态 `.bss` 还是运行时分配）只有读到 `this+0x5D800` 才知道。
- `this` 对整局游戏通常是**单一实例**（`this + 120*cur_script + …` 用 `cur_script` 区分脚本上下文），**定位一次即可**。

> 结论：**必须拿到 `this`（或其指向的两个字段 `0x5D800`/`0x5EC8C`）**。这正是用户说的卡点。

---

## 3. 定位 `this` 的候选方案（按可靠性排序）

### 方案 A（最推荐）：`__thiscall` 函数入口捕获 ECX
`sub_41BF50`/`sub_42B4B0`/`sub_412290` 都是 `__thiscall`，**入口时 `this` 在 ECX**。在入口下断/挂钩，读到 ECX = `this`。
- **实现**：inline hook 或硬件断点（`DRx`）打在这些函数的首个指令；或注入 DLL 用 Detours/IAT 挂钩。
- `sub_41BF50` 被每个 opcode handler `call`，**频率极高**，打一次即可；`sub_412290` 是主循环更稳定但只在入口进一次。
- 需要把**unpacked 构建的 VA** 映射到运行时：`runtime_addr = module_base + (static_VA − preferred_base)`（见 §4 坑）。

### 方案 B（无注入，纯内存扫描）：dispatch 表指纹
`this + 0x0A509C` 是一维 handler 函数指针表，已知 544 条（`06-opcode到handler映射表.md`）。任取几条**特征 handler**（如 opcode `0x50`→`sub_42C5E0`、`0x54`→`sub_42C6E0`），其运行时地址 = `module_base + RVA`。扫描进程内存找「`*(x) == runtime(sub_42C5E0)` 且 `*(x+4) == runtime(sub_42C620)` …」的连续区段，则 `this = x − 0xA509C`。
- 优点：不需要代码注入/挂钩，只 `OpenProcess`+`ReadProcessMemory`。
- 缺点：要列出足够多的特征指针以避免误报；需先解析 image base。
- **只要运行时仍是**（解包后的）同一构建，`RVA = static_VA − 0x400000` 成立。

### 方案 C：已知数据锚点反推（次优/不稳定）
若确认 `global_int_base` 指向**运行时分配**的确定性起始符（如数组前缀有固定 `{begin,end}` 头、或 drop 数据是静态表载入），可逆推 `this`。不稳定，仅作校验。

### 方案 D：跨进程调试器一次性抓取
用 x64dbg/CheatEngine 在 `sub_41BF50` 下断，看 ECX；适合**人工确认一次**，不适合做成工具。

---

## 4. 关键坑（务必先解决）

1. **运行进程是打包壳**：`raw/AGE.EXE`/`install/AGE.EXE` 是 ASProtect 打包（见 `01-加壳与拆壳.md`）；本分析基于 `rain/天结_unpacked.exe`。运行时挂钩/扫描需：
   - 拿到**运行时 image base**（`GetModuleHandle`/`Module32First`），
   - `runtime_addr = image_base + (static_VA − preferred_base)`，
   - 确认解包后的**代码布局与 `_unpacked` 一致**（IAT/重定位警告见 01 文档 §2；解包后通常恢复原布局，可先用 `SYS4450` 之类已知串验证）。
2. **ASLR/重定位**：若系统对本进程启用 ASLR，`image_base` 每局变化，**必须动态获取**，不能写死 0x400000。
3. **DEC 必须配 key**：读出的是编码值，`value = ROR4(key ^ ROL4(raw,11),25)`；key 从 `this+0x5EC8C` 取。float 槽不编码。
4. **索引映射**：掉落数据在 global-int 数组的 VM 索引 `0x53cd7c..0x53f48c`（item 在 `[0x53cd7c,0x53e104)`、rate 在 `[0x53e104,0x53f48c)`，各 5000 槽 = 1000 单位×5 槽）。

---

## 5. 落地示例（读掉落 rate）

```text
in:  this
base = *(this + 0x5D800)        // global_int_base
key  = *(this + 0x5EC8C)
for unitId 140..750, slot 0..4:
    idx = unitId*5 + slot
    raw = *(base + (0x53e104 + idx)*4)   // rate 区段
    rate = ROR4(key ^ ROL4(raw,11), 25)  // 解码
    raw2 = *(base + (0x53cd7c + idx)*4)  // item 区段
    item = ROR4(key ^ ROL4(raw2,11), 25)
```
（`rate/100` = 掉落数量；`item` = 物品 id，见 `docs/re/src/03-掉落数据.md`。）

---

## 6. 原型实测：dispatch 表指纹定位 `this` 已跑通（已确认）

用 `scripts/re/extract_global_test.ps1`（Approach B，纯 `OpenProcess`+`ReadProcessMemory`，只读不改）在真实运行进程上验证成功：
- **用法**：`pwsh -File scripts/re/extract_global_test.ps1 -ProcId <pid> -Unit 140 -To 145`（或 `-ProcessName 天结_unpacked`）。**只检查已运行进程，不自动启动游戏**。
- **定位 `this` 的原理（RVA 相对关系）**：`this + 0x0A509C` 是 dispatch 表。用签名（opcode 0x0/0x2/0x3/0x50-0x5F/0x6E/0x8C/0x8F/0xA0/0x12C/0x1C8/0x2C5/0x2D8 共 30 条的 handler RVA，见 `scripts/re/dispatch_signature.json`）逐区扫描；期望指针 = `module_base + RVA`（兼容 ASLR）。找到整表后 `this = table_addr − 0x0A509C`，**命中一次即停**（`this` 为单实例）。
> ⚠️ 工具已从 `.tmp/` **移入 `scripts/re/`**（`extract_global_test.ps1`、`extract_global_data.ps1`、`dispatch_signature.json`），本节下文引用以新路径为准。
- **实测结果 A**（pid 19632，`天结_unpacked`，WS=230MB）：
  ```
  module base = 0x400000   image size = 0x1B2000
  this            = 0x2850020
  global_int_base = 0x40002154   (heap ptr @ 0x4000_2154 —— 注意不是 image base 0x00400000!)
  decode key      = 0x4197761F
  unit 140: S0:item=2813/rate=100  (rate/100 = 1 个), 其余 slot 空
  unit 142: S0:2806/100 ; unit 145: S0:2813/100
  ```
- **实测结果 B（加壳进程，关键验证）**（pid 27848，`AGE.EXE`，ASProtect，WS=308MB）：
  ```
  module base = 0x400000   (AGE.EXE)   # 解包后与 _unpacked 同基址、同 handler RVA
  this            = 0x2BFF020
  global_int_base = 0x41007700
  decode key      = 0x221D01E6
  unit 140: S0:2813/100  unit 141: S0:2813/100  unit 142: S0:2806/100
  unit 145: S0:2813/100  unit 150: S0:282/100   其余空
  ```
  **与结果 A 完全一致**（140-145 逐槽相同）→ 证明 **ASProtect 只是启动时解包一次，运行期不对解包镜像再加密**，故 RVA-相对签名对**同布局**的 `_unpacked` 与带壳运行进程**通用**（`module_base` 均为 0x400000，handler RVA 相同即可命中）。这正是"依赖相对关系、不依赖实际地址"所要的复用性。
- **正确性要点**：读到的是**编码值**，必须 `DEC(x)=ROR4(key ^ ROL4(x,11),25)` 解码；item/rate 均解码到合理小值（item 编号、rate=100）。`rate/100`=掉落数量与 `docs/re/src/03` 一致。
- **两个坑（本次踩到，记录以避免再犯）**：
  1. **`$M32 = [int64]0xFFFFFFFF` 是错误的** —— PowerShell 把 `0xFFFFFFFF` 解析成 Int32 → 溢出为 `-1` 再转 int64，`-band` 掩码失效，导致 `DEC` 符号扩展成 64 位垃圾。**必须用 Int64 字面量 `$M32 = 0xFFFFFFFFL`**。
  2. **`global_int_base = 0x40002154` 不是 image base `0x00400000`** —— 它是 `0x4000_0000 + 0x2154` 的高位堆指针（约 1GB 处），在 image 范围 `[0x400000, 0x5B2000)` 之外；不要把 8 位十六进制 `0x4000xxxx` 与 image base `0x00400000` 混淆。
- **跨位数读取可用**：64 位 pwsh 直接读 32 位游戏进程（`OpenProcess(0x0410)`+`ReadProcessMemory`+x64 `MEMORY_BASIC_INFORMATION`），扫 162 个 region 正常。
- **前提**：游戏必须**已初始化**（脚本已载入、解释器已运行）。在只有裸 `raw/` 无数据文件的环境里进程只有 ~16MB/31 region，`this` 未初始化 → 扫不到（脚本会正确报 not found）。用户在**有游戏数据**的完整进程上跑即可拿到结果。

---

## 7. Todo（实现路线，engine 域）

- [x] 方案 B 原型跑通（`this` 定位 + `base/key` 读取 + `DEC` 解码 + 掉落 item/rate 实测）。（本次已解，见 §6）
- [ ] 把 `module_base + RVA` 改造成**无需知道 module_base** 的相对模式（用「表内各 handler 的差值」做签名），使 `_unpacked` 运行进程上直接复用、无需先枚举模块。
- [ ] 扩大验证：与 `data/EBINIT.txt` 全量对照（解析静态表 → 与运行时解码值比对），并验证 `this` 稳定性（两次 `dump`）。
- [ ] 确认**加壳运行进程**解包后的 RVA 布局与 `_unpacked` 一致（`SYS4450` 已知串验证后，同一工具可直接用于加壳进程）。
- [x] 数据路径 + `DEC`/`ENC` + 数组基址偏移 + `0x53e104` 为 VM 索引（非 .data 地址）——已确认（本文档 §1）。

---

## 8. 全量导出工具与掉落区检查（`scripts/re/extract_global_data.ps1`）

**用法**：`pwsh -File scripts/re/extract_global_data.ps1 -ProcId <pid> [-From <n> -To <n>] [-OutFile <csv>]`
- 默认导出**整个 global 表**（到数组区末尾，~7.38M 槽，实测 `8M` 内）。
- 输出格式 `type,index,value`：`int,<HEX>,<value>`；`empty,<HEX>` 或 `empty,<HEXstart>~<HEXend>`（**连续空折叠**）；索引为**无 `0x` 的十六进制**、无十进制；`empty` 是 **type** 而非 int 的 value。
- 解引用 `this` 用 dispatch 表指纹；解码 = `DEC`；写文件在 C# 内完成（4M 行 ~14s）。

**三次导出（空闲 / 战斗存档 / COMMITBTL 掉落瞬间）的结论**：
- 掉落表 `[0x53CD7C..0x53F48C)` **零变更** → 静态数据（与 `docs/re/src/03` 一致）。
- 游戏状态标志大量变动（与掉落无关）。
- `0x53f48c` / `0x928a7` / `0x546e04` 是**数组区段基址**，非单值；X/Y 在偏移 `+b*5` / `+c` 处（见 `engine/04-引擎侧运行时数组.md`）。Y 数组在掉落瞬间被填充（224 个非零 per-unit 值）；X 与 `0x546e04` 为瞬态（快照时为 0）。

