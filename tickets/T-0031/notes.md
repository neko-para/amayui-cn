# T-0031 · 过程文档（notes.md）

## 2026-09-14

## 与本条相关的已核实事实（供实现时直接引用，不必重查）

### 1. 两个载体、两种恢复时机

| | SAVE.DAT（脚本表） | SYS4REG.INI（配置注册表） |
|---|---|---|
| 谁写 | 脚本 `save-int`/`save-string`（`0x1A2`/`0x1A9`） | 配置族 `0x141/0x1B5/0x1B9/0x2CD/0x2E7/0x2E8` → `setConfigValue()` |
| CONFIG 界面里的量 | `CONFIG1.txt` 29 个 save-int + 5 个 save-string | `CONFIG1.txt` 9 处配置族写 |
| 启动装载 | `SYSTEM4.txt:73-74` `LOADCONFIG` + `LOADCHARM`（`load-int` 同名槽 ⇒ 回到**脚本全局量**） | `applyConfigToEngine` 按 `CONFIG_FIELD_BINDINGS`（8 键）灌**引擎字段** |
| 现状 | T-0030 已修：首次运行也落盘、重启走 LOADCONFIG（E4 日志在 `tickets/T-0030/evidence/`） | **本票**：无 INI 时不写 ⇒ 引擎字段层跨会话丢失 |

槽位一一对应的证据（可直接引用）：`CONFIG1.txt` 的 `save-int (global-int …)` 集合
`a9ce a9cd a9d5 a9d0 b1b6 a9e4 a9d6 a9cb a9cc a9e2 a9de a9dd a9dc a9d4 a9da a9d9 a9e3 a9d2 a9df a9e0 a9db a9e1`
与 `LOADCONFIG.txt` 的 `load-int (global-int …)` 集合相同（另有 `139b` 与 3 个 `load-int (local-ptr 0)`）。

### 2. 缺 INI 时 `SetConfig` 的实际行为（决定了"生成"是可行的）

`src/vm/handlers/msgwin.ts` 的 `setConfigValue()`：`if (!e.config) e.config = { values:new Map(), sections:[], order:new Map() };`
再 `values.set(key, value)`、补 `sections`/`order`、最后 `e.onConfigChanged?.(e.config)`。
⇒ **注册表可以凭空长出来**，只差把 `onConfigChanged` 在无 INI 时也接上。

### 3. 需要单独定的三件事（这就是"另一条需求"的实质）

1. **部分键集可接受吗**：脚本侧没有任何"完整键集"来源（`INITCONFIG0..5` 写的是 save-int，不是配置族；随包资源也没有 INI），
   所以首跑生成的 INI 只含"玩家碰过的键"。需要论证"缺键 ⇒ 引擎取默认"与我们当前行为等价（或列出不一致键）。
2. **`formatIni` 的往返**：`test/engine-config.test.ts` 里 `formatIni：往返不丢键、不改分节/键顺序` 目前**是失败的**（既存 7 个失败之一）
   —— 生成 INI 之前应先把它修绿，否则"写出去再读回来"不可信。
3. **写盘时机的差异**：引擎在关窗时写整份注册表；我们现在是"改一次写一次"（T-0030 之前的既有设计）。
   配合主进程的 `configRatchetOk`（新键数不得少于现有）需要确认不会把残缺配置固化。

## 2026-09-14

## 「ADV 速度」这条路逐行走（回答"选项变更时应该会写入吧？"）

**结论：写是写了（内存注册表 + 引擎字段），但落盘那一步被"没有 INI"卡住；重启后也没人把它推回引擎字段。**

```
CONFIG1.txt:2286  sub (local-int 7f2) 64 (local-int 57bc)   ; 值 = 0x64 + 滑条位置
CONFIG1.txt:2287  i1b5 (local-int 7f2)                      ; ★SetMessageSpeed（字段 + 注册表）
CONFIG1.txt:2327  save-int (global-int a9df)                ; 同一批：SAVE.DAT 侧（T-0030 已修通）
        │
        ├─(内存) msgwin.ts:1047-1051  engineValues[21668]=v  +  setConfigValue('message:messagespeed', v)
        │                              └─ msgwin.ts:75  e.onConfigChanged?.(e.config)
        │                                              ↑
        │                              configBoot.ts:71 才赋值 —— 而它在 `if (!ini) return` **之后**
        │                              ⇒ 无 INI 时这里恒为 undefined ⇒ **磁盘上什么都没有**
        └─(下次启动) LOADCONFIG.txt:24  load-int (global-int a9df)  → 只回到**脚本全局量**
                      引擎字段 21668 **没人写**（INI 也没有）⇒ messageSpeedOf 兜底 0 = 立即全显
```

**排除的其它通路**（都不是"启动时回灌"）：
- `INITREGMES`（`i1b5 19` / `i1b9 0 5dc` / `i2e7 …` / `i2e8 0` / `i2cd 3` = 一整套默认注册）**只被设置界面调用**：
  `CONFIG1.txt:889`、`CONFIG1.txt:941`、`CONFIG2.txt:856` —— 即"恢复默认"按钮，启动链上不出现。
- `GSMES` 是**临时覆盖**：`i07f (local-int 0)` 先读存现值 → `i1b5 0`（立即显示）→ 显示一段说明文字 → `:122 i1b5 (local-int 0)` 还原。
- `i074`（只写字段、不持久化）用于"这段立即出字"，全库 206 处都成对还原。

**复现（产品路径）**：进 CONFIG 把消息速度调慢 → 退出 → 重启 ⇒ 逐字速度回到"瞬间全出"（因为无 INI，`messageSpeedOf` 读到兜底 0）。

## 2026-09-14

## 订正（2026-09，用户指正 + raw 复核）：导出是「固定顺序 + 全量」；引擎不写 INI

### 1. 我此前写错的两点（已改）

- ❌「`CONFIG1.txt` 同时写两处」→ ✅ **每一行设置只走一个载体**（逐行核对）：
  - 走 **SAVE.DAT**：颜色（`a9df`/`a9dd`/…，场景脚本里确实当颜色用：`set-vertex-color … (global-int f807d)` 而 `f807d ← a9df`）、字体名（`save-string bbd/bbe/bbf/bbb/bbc`）、部分开关；
  - 走 **配置注册表/INI**：`i1b5`（**消息速度**）、`i2e7`/`i1b9`（自动翻页时长）、`i2e8`（自动翻页选项）、`i2cd`（滚轮推进）—— 这 9 处附近**没有**配套的 `save-int`。
- ❌「`LOADCONFIG` 的 `a9df` 就是消息速度」→ ✅ `LOADCONFIG` 那批槽恢复的是 **SAVE.DAT 侧**的设置；**消息速度根本不在其中**
  （实测：速度值 `local 7f2` 只在 `i07f`(读) / 滑条换算 / `i1b5`(写) 三处出现，无任何 `save-int` 配对）

⇒ 所以"改 ADV 速度 → 重启失效"是**纯 INI 侧**症状，SAVE.DAT 里没有兜底副本 —— 这正是本票最干净的复现。

### 2. 引擎侧的权威事实（raw）

| 事实 | 证据 |
|---|---|
| 键表 + 默认值 + **顺序**全部静态写死在注册表对象构造里 | `sub_491880`（raw 111338-111845）：`&Reg___vftable_` 后逐条 `sub_434D00`/`sub_434E00`，实测 **104 int + 17 string** 键 |
| 导出 = **固定顺序全量枚举** | `sub_490590`（raw 110734-110963）：**53 次 `GetConfig` 的直线序列**，无分支 |
| 导出的目标 = **HKCU 注册表**（不是 INI 文件） | 同函数 `RegCreateKeyExA(HKEY_CURRENT_USER,…)` + `RegSetValueExA`；读回只在 `sub_492CB0` 的 `set:SaveWinPos==1` 分支 |
| **INI 是只读输入** | `sub_492CB0`：`sub_4963E0` 打开解析 + `sub_4957F0`/`sub_495950` 取 `section:key` + `sub_434D00` 叠盖默认；`aSys4regIni` 全 exe 只在 `sub_4900F0` 出现，而它只做 `CreateFileA(OPEN_EXISTING)` 存在性检查 + 建目录 |

### 3. 对实现的直接后果（验收已按此改）

- `formatIni` 的目标从"保持原文件键序 + 局部编辑"改为 **“按引擎键序全量导出”**：
  键表/默认取 `sub_491880`（可机械抽取：`sub_434D00`/`sub_434E00` 调用序列），顺序即构造顺序（与 `sub_490590` 的导出一致）。
- 这样首跑生成的 INI **天然全量**，"部分键集会不会固化残缺配置"的顾虑消失（只需论证：我们导出的键值 = 引擎内建默认 + 文件叠盖后的值）。
- `test/engine-config.test.ts` 的那条既存失败（`formatIni：往返不丢键、不改分节/键顺序`）应按新语义**改写**为固定顺序全量导出的断言。

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

定因=无 INI 早退使配置注册表改动不落盘；已按「固定顺序全量导出」修完并 E4 验证（写入/读回两半）。证据：evidence/generated-SYS4REG.ini（115 键产物）、run1-first-change-creates-ini.log（[main] config ini <-）、run2-boot-reads-ini.log（引擎字段按 INI 恢复）。★引擎侧订正：INI 只读、导出写 HKCU（见 capability note）。★工具坑：record.cjs 的 --out 按仓库根解析，传 cwd 相对路径会 EPERM 弹窗 —— 见 T-0032。
