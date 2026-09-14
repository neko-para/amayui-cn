# T-0031 · 过程文档（changes.md）

## 2026-09-14

# 变更记录（T-0031）

## 第 1 次变更（2026-09）：配置导出改为「固定顺序 + 全量」，并在无 INI 时也接线回写

### 依据（raw 复核，见 ticket.json 的 evidence）

| 事实 | 证据 |
|---|---|
| 引擎的**键表 + 默认值 + 顺序**静态写死在注册表对象构造里 | `sub_491880`（raw 111338-111845）：`&Reg___vftable_` 后逐条 `sub_434D00`(int)/`sub_434E00`(string)；实测 **104 int + 17 string** |
| 引擎的**导出**是固定顺序全量枚举 | `sub_490590`（raw 110734）：**53 次 `GetConfig` 的直线序列**（无局部编辑）→ 写 HKCU 注册表 |
| `SYS4REG.INI` 在引擎里是**只读输入** | `sub_492CB0`（raw 111846）：`sub_4963E0` 打开解析 + `sub_4957F0`/`sub_495950` 取 `section:key` + `sub_434D00` 叠盖默认；`aSys4regIni` 全 exe 只在 `sub_4900F0` 出现，而它只做存在性检查 + 建目录 |

⇒ 我们"写回 INI"是**跨平台替代**；既然替代，形态对齐引擎：**固定顺序 + 全量**（不再"保持文件原序 + 局部编辑"）。

### 改了什么

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/src/configRegistry.ts`（**新增**） | 由 `sub_491880` **机械抽取**的权威键表：`CONFIG_REGISTRY_KEYS`（115 条：键名/类型/内建默认，顺序 = 构造顺序）+ `CONFIG_REGISTRY_DEFAULTS`。文件头写清抽取口径（勿手改、改就重抽） |
| `app/amayui-emulator/src/engineConfig.ts` | `formatIni` 重写为**固定顺序全量导出**：① 先按键表顺序输出（缺值写引擎默认）② 再追加 `cfg` 里不在键表内的自定义键（原大小写照旧，保证不丢）③ 分节顺序 = 键表首现顺序，文件原有分节名大小写优先保留；键表里的键一律用**键表拼写**（`setConfigValue` 存的小写键不再决定文件名拼写）。输出对同一配置**确定** |
| `app/amayui-emulator/src/renderer/app/configBoot.ts` | `loadConfigIni` 不再"无 INI 就早退"：改为「有则解析、无则只记 trace」，**然后把配置回写接线照常挂上** ⇒ 玩家第一次改设置（`setConfigValue` 按需建注册表）即生成全量 INI |
| `app/amayui-emulator/test/config-version-substr.test.ts` | ① 把那条**既存失败**的 `formatIni：往返不丢键…`（依赖本机真游戏 INI，无该文件时假红）改写为**自带 fixture** 的新语义用例（全量/固定顺序/不丢自定义键/确定性/值格式）；② +1 例「★无 INI 时也接线 onConfigChanged：首次改设置即按引擎键表全量生成」；③ `applyConfigToEngine` 往返用例改为"原键绑定结果不变 + 绑定只增不减"（全量导出会让更多键参与绑定） |

### 判据

- `npx tsx --test test/config-version-substr.test.ts`：**12/12 通过**（含上述三例；原既存失败已消失）。
- 全量 `npm test`：**492 例 / 482 通过**，失败 7 项与改动前**同类**（6 项既存 + 期间 T-0030 的锚点棘轮已修）。
- 类型检查（三份 tsconfig）+ `check:dead-writes` 通过。

### E4（Electron 产品路径，jp 资源）

1. **写入半**（清空 overlay 后跑一次）：
   ```
   [record] press（ホイールメッセージ送り 的 OFF（i2cd 行））
   [main] config ini <- …/天結いキャッスルマイスター.overlay/SYS4REG.INI (1962 bytes)
   ```
   生成物 `evidence/generated-SYS4REG.ini`：**115 键 / 6 分节**，顺序 `sound → debug → display → system → message → set`，
   未碰过的键写引擎默认（`MessageSpeed=5`、`MessageFade=0`…），本次改的 `AdvanceMesOnWheel=0`。⇒「首跑生成即全量」。
2. **读回半**（把带 `MessageSpeed=42` 的同款全量 INI 放回 overlay 后启动）：
   ```
   [config] …overlay/SYS4REG.INI（overlay）分节=[sound,debug,display,system,message,set] 键=115 个；
   写入引擎字段 8 个：… _this[21668]=42(message:messagespeed) …
   ```
   ⇒ 重启后 **ADV 速度（只走 INI 的设置）确实恢复到引擎字段**（`messageSpeedOf` 读的就是 21668）。

### 顺带修掉的一个隐性问题

无 INI 时 `message:MessageSpeed` 会兜底到 **0（= 立即全显）**；现在首跑就生成 `MessageSpeed=5`（引擎内建默认）⇒ 首次启动的逐字节拍与引擎一致。

### 工具坑（本次踩到，已另行开票）

`tools/record.cjs` 的 `--out` 是**按仓库根**解析（`path.resolve(ROOT, argOf('out', …))`），传 cwd 相对路径（如 `--out ../../.tmp/x.jsonl.gz`）会去 `mkdir /Users/<user>/Documents/.tmp` ⇒ EPERM，Electron 直接弹 **"App threw an error during load"**。见 T-0032。

## 2026-09-14


### 收尾（最终全量验证）

- `npm test`：**492 例 / 484 通过 / 5 失败**，失败项全部是既存跨平台/配置类
  （`applyConfigToEngine`×1、`resolveSystemPaths`×2、`CONFIG1 ADV 样例窗口`×2 —— 与改动前的基线同类）。
- ★**顺手修掉了 2 条既存失败**：① `formatIni：往返不丢键、不改分节/键顺序`（被本轮新语义用例取代、不再是失败）；
  ② `★CONFIG 消息预览的 0x300 闸门`（本轮复跑转绿；此前多次记录为失败，疑与运行时长/时序有关，未深究）。
- `npm run typecheck`（三份 tsconfig）+ `npm run check:dead-writes`：通过。
- 票据/能力台账守卫：`tickets.js --validate`（32 张）、`capabilities.js --validate`（108 条）、
  `test/ticket-ledger.test.ts`、`test/capability-ledger.test.ts` 全绿。

### 已知副作用（有意）

首跑生成的 INI 会带上**引擎内建默认**，因此 `message:MessageSpeed` 由原来的"缺键兜底 0（立即全显）"变为 **5**、
`system:EffectSkipOnClick` 由兜底 1 变为引擎默认 0 —— 都是向引擎默认值对齐，不是回归。
