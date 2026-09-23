# G6 组测试审计（存档 / 槽位 / 配置 / 输入 / 宿主 / 数据表）

> 审计范围：`app/amayui-emulator/test/` 下 22 个测试文件 / **160 个用例** / 6231 行。
> 立场：**只读审计**（本报告之外未改任何文件）。判据 = 「实现改坏时它会不会红，且红的理由正确」。
> 审计日期基准：2026-09 本机（macOS / darwin arm64）。

---

## 0. 审计环境实测（先立事实，后面所有"跳过/未跑"都据此判断）

### 0.1 本机真值资产（我只读探测，未改）

| 文件 | 大小 | 头 | 结论 |
|---|---|---|---|
| `.tmp/appdata/Eushully/天結いキャッスルマイスター.overlay/SAVE/SAVE78.DAT` | 1,016,868 | `S4SD`/`460B`/`format=3`/`aux=20` | **真游戏槽**（savedCur=2, 38 条绘制项, int 池 1,015,792） |
| `…overlay/SAVE/SAVE79.DAT` | 1,037,773 | 同上 | **真游戏槽**（savedCur=2, **69 条**绘制项） |
| `…overlay/SAVE/SAVE78.STH` / `SAVE79.STH` | 172,854 ×2 | `BM…` | 320×180 24bpp BMP，`bfSize=172840`（= 像素+40，少写 14） |
| `…overlay/SAVE/SAVE.DAT` | 133,608 | `format=0` / `title=AmayuiEmulator` | **本工程**格式（ints=3044 / strings=5 / usedFileIds=107 / layout=emulator） |
| `.tmp/appdata/Eushully/天結いキャッスルマイスター/`（base） | — | — | **不存在**（没有 `SAVE/`、没有 `SYS4REG.INI`） |
| `LOCALAPPDATA` | — | — | 未设置（macOS） |

⇒ **真槽 78/79 + 真 `.STH` 就在本机磁盘上，但只在 overlay 一侧。** 这一点是本报告最重要的杠杆：
本组有 7 处 E3/E4 断言把闸门写成 `resolveSystemPaths(REPO).baseDir/SAVE` ⇒ 本机**全部静默跳过**，
而它们要找的数据其实就在 `overlayDir/SAVE` 里（`engine-slot.test.ts:268` 的 E4b 是**唯一**读两侧的那条）。

### 0.2 单文件实测（`node --env-file=test/options.test.env --import tsx --test test/<f>.test.ts`）

| 文件 | 用例 | pass | skip | 自报 duration |
|---|---|---|---|---|
| save-data | 16 | 15 | 1 | 2.32 s |
| save-slot | 10 | 8 | 2 | 0.23 s |
| save-slot-chain | 2 | 0 | **2** | 0.20 s |
| save-slot-tdz | 4 | 4 | 0 | 0.22 s |
| save-thumb | 6 | 5 | 1 | 0.22 s |
| slot-save-resume | 7 | 7 | 0 | 0.17 s |
| slot-load-resume | 5 | 4 | 1 | 0.16 s |
| slot-load-transfer | 3 | 2 | 1 | 0.15 s |
| slot-load-screen | 3 | 3 | 0 | 0.17 s |
| slot-load-l2d-reset | 2 | 2 | 0 | 0.14 s |
| config-keys | 3 | 3 | 0 | 0.11 s |
| config-read | 6 | 6 | 0 | 0.13 s |
| config-version-substr | 12 | 12 | 0 | 1.27 s |
| emulator-options | 19 | 19 | 0 | **4.99 s** |
| input | 8 | 8 | 0 | 0.46 s |
| keyboard-mask | 6 | 6 | 0 | 0.13 s |
| wheel | 7 | 7 | 0 | 0.19 s |
| native-host | 13 | 12 | 1 | 1.13 s |
| native-tap | 6 | 6 | 0 | 0.78 s |
| append-packs | 9 | 9 | 0 | 1.89 s |
| ops-cg-digit-clock | 9 | 9 | 0 | 0.34 s |
| xval | 4 | 4 | 0 | 0.39 s |
| **合计** | **160** | **149** | **9** | **≈19 s** |

（按文件串行相加 ≈ 19 s，与 T-0115 记的 `npm test` 全量 51.5 s 不矛盾 —— 本组并行跑时约 5–6 s 墙钟。）

3 个最贵的用例（占本组 40%）：`emulator-options.test.ts:223` **4.81 s**、`append-packs.test.ts:337` 1.65 s、
`save-data.test.ts:501` 1.94 s；再加 `config-version-substr.test.ts:347` 1.01 s。

**9 个跳过全部是"本机没有 base 侧真数据"这一条原因**（见 0.1），不是环境坏了。

### 0.3 本仓库 E 档在测试里的真实形态

- **E4 断言真的存在**，但形态是「**解码真文件 + 断言硬编码观测值**」：E4b 实测解出 2 个真槽 / 107 项；
  `SAVE79.DAT` 的 handle `0x18a88` 我逐字段核过（见 §3.2），与文档/夹具**完全一致**。
  所以 §3 的结论不是"注释里写了 E4"——**是真跑过真机**，但**大部分闸门指错了目录**。
- 真正被**真机对照**过的证据在 **ticket** 里（`T-0062` GUI 目视确认、`T-0063` 用户实测四条症状、
  `T-0072` 用户读档截图+日志、`T-0090` `npm run shot -- --load 79`），不在测试文件里。
  ⇒ 测试文件是这些结论的**回归守卫**，不是发现者。这不减价值，但"注释里写的 E4 强度"不能当测试自身强度。

---

## 1. 22 文件完整判定表

**类别**：core=引擎语义守卫 / ratchet=台账·注册表·同步棘轮 / tool=工具·路径·宿主管线 / scaffold=只测测试自己的假件 / unknown
**oracle**：独立（真语料/真槽/引擎 raw 行号/外部常量/手算期望）| 自造（期望值由被测代码或同源 helper 算出）| 镜像（断言被测实现自己的表/常量）| 无
**cost**：语料=跑真语料/真槽；skip=含条件跳过；慢=>1 s

| # | 文件 | 类别 | oracle | 强度 | cost | Verdict |
|---|---|---|---|---|---|---|
| 1 | save-data | core | 独立 | 强 | 语料 ✓ / skip ✓ / 慢 ✓ (2.3 s) | **upgrade** |
| 2 | save-slot | core | 独立 | 强 | skip ✓ | **keep-ratchet**（+ 移植 overlay 闸门） |
| 3 | save-slot-chain | core | 独立 | 强 | **语料全跳（2/2）** | **merge → slot-load-transfer** |
| 4 | save-slot-tdz | ratchet | 独立 | 中 | 无 | **keep-ratchet** |
| 5 | save-thumb | core | 独立 | 强 | skip ✓ | **keep-ratchet**（+ 移植 overlay 闸门） |
| 6 | slot-save-resume | core | 独立 | 强 | 无 | **keep**（建议拆 1 文件，见 §4.4） |
| 7 | slot-load-resume | core | 独立 | 强 | skip ✓ | **upgrade** |
| 8 | slot-load-transfer | core | 独立 | 强 | skip ✓ | **keep**（并掉 ③） |
| 9 | slot-load-screen | core | 独立 | 强 | 无 | **upgrade** |
| 10 | slot-load-l2d-reset | core | 独立 | 中 | 无 | **keep** |
| 11 | config-keys | ratchet | 独立 | 强 | 无 | **keep-ratchet** |
| 12 | config-read | core | 自造 | 中 | 无 | **keep** |
| 13 | config-version-substr | core+ratchet | 独立 | 强 | 语料 ✓ / 慢 ✓ | **keep** |
| 14 | emulator-options | tool | 独立 | 强 | 语料 ✓ / 慢 ✓ (5.0 s) | **keep** |
| 15 | input | core | 独立 | 强 | 语料 ✓ | **keep** |
| 16 | keyboard-mask | core | 独立 | 强 | 无 | **keep** |
| 17 | wheel | core | 自造 | 中 | 无 | **merge 出竖直滚轮用例 → input** |
| 18 | native-host | tool | 独立 | 强 | skip ✓ / 慢 ✓ | **keep-ratchet** |
| 19 | native-tap | ratchet | 自造 | 中 | 无 | **keep-ratchet** |
| 20 | append-packs | core | 独立 | 强 | 语料 ✓ / skip ✓ / 慢 ✓ | **keep** |
| 21 | ops-cg-digit-clock | core | 独立 | 强 | 无 | **keep** |
| 22 | xval | ratchet | **独立** | **强** | 语料 ✓ | **keep-ratchet** |

**没有任何一个文件够 `drop`。** 下面 §2 给出 6 条"无意义/可疑"条目 + 8 条"可升级"条目，它们的共同形态是
**"守卫的方向是对的，但断言只覆盖了实现的一半/期望值来自自己"**，而不是"整体可以删"。

---

## 2. "无意义 / 可疑"清单（逐条带 `file:line` + 反例实验）

### 2.1 同义反复（arrange 即 assert）

**① `save-data.test.ts:94` —— 把刚算出的值再比一次**

```ts
91:  const msb = crc32MsbFirst(v);
92:  assert.notEqual(msb, crc32(v));
94:  assert.equal(crc32MsbFirst(v), msb);   // ← 同一输入、同一函数、同一进程
```
两个 `crc32MsbFirst(v)` 之间没有任何写入 ⇒ 这条断言**恒真**；它标着"防手改表"，但手改表会让
两个调用**同时**变（同义反复）。
**反例实验**：把 `src/util/crc32.ts:33` 的 `(i << 25)` 改成 `(i << 24)`。
→ `:85`（ISO-HDLC golden）仍绿、`:92`（msb != crc32）仍绿、`:94` 仍绿；`crc32MsbFirst` 的**表整个坏了却不红**。
**正解**：这一格其实**有**独立 golden。我实测本实现：`crc32MsbFirst('123456789') = 0xfc891918`、`msb(空) = 0`。
把它写成字面量即可（0x4C11DB7 + 非标准索引位反转 ⇒ 任何"随手改一下"都会离开这个值）。

**② `config-version-substr.test.ts:331` —— 只断言"交集不变"**

```ts
331:  assert.deepEqual(b.filter((x) => a.some((y) => y.key === x.key)), a, '原文件里那些键的绑定结果不变');
336:  assert.ok(b.length >= a.length, '全量导出后绑定只增不减');
```
`a` 是 `applyConfigToEngine(parseIni(text), …)` 的输出，`b` 是 `applyConfigToEngine(parseIni(formatIni(cfg)), …)`，
断言把 `b` 过滤成"与 `a` 同 key 的那些"再与 `a` 比 ⇒ **只测了"旧 key 的值没变"**，而这本来就由
`formatIni` 不丢键保证；`applyConfigToEngine` 自己的**任何**映射错误（a 和 b 一起错）都不会红。
**反例实验**：把 `configRegistry.ts` 里某一个 `{key, field}` 的 field 号改错。
→ `a`/`b` 同步改变、交集仍相等 ⇒ 绿。这条用例真正测的只有"`formatIni` 没把值改坏"。

### 2.2 镜像实现（断言被测代码自己的常量/表/映射）

**③ `config-keys.test.ts:68-77` —— CFG 与 CONFIG_REGISTRY_KEYS 互比**

```ts
69:  const known = new Set(CONFIG_REGISTRY_KEYS.map((k) => k.key.toLowerCase()));
70:  for (const [name, key] of Object.entries(CFG)) assert.ok(known.has(key.toLowerCase()), `CFG.${name} = ${key} 不在 …`);
```
`CFG` 与 `CONFIG_REGISTRY_KEYS` 都在 `src/configRegistry.ts` 里、由同一个人的同一次手写产出
（`configRegistry.ts:183` 的 `soundKeepMusicVolume: 'set:KeepMusicVolume'` vs `:89` 的 `{ key: 'set:KeepMusicVolume' }`）。
⇒ 这条断言"两处拼写一致"，**不测任何产品行为**。
**反例实验**：把 `CONFIG_REGISTRY_KEYS` 里的 `set:KeepMusicVolume` 那**整条删掉**、`CFG` 里也删掉。
→ `known` 变小、`CFG` 也不含它 ⇒ **绿**；而 `src/vm/handlers/audio.ts:257` 的 `cfgEquals(cfg, CFG.soundKeepMusicVolume, 1)`
会编译失败（这是 tsc 的功劳，不是这条用例的）⇒ **该用例可删，价值为 0**。
★注意：同文件 `:46`（扫 `src/**` 里所有 `'section:key'` 字面量）是**真棘轮**（手打键名拼错的唯一机器发现点），
不能跟着删 —— 详见 §5.1。

**④ `config-read.test.ts`（全文件）—— 断言的是"INI 里写的值被读出来"，不是"读了哪个键"**

```ts
29-47: const INI = `[sound] … Volume0=80 … AutoMessageTime0=500 …`;   // 期望值的唯一来源
83:  step(0xc5, [im(0), li(0x20)]); assert.equal(rd(e, f, 0x20), 80, 'Volume0');
```
期望值 = 我自己写的 INI。`config-read.ts` 的 `0xC5` 表（`op1 → sound:VolumeN`）与 `INI` 的键名**同源手写**。
**反例实验**：把 `src/vm/handlers/config-read.ts` 的 `0xC5` 表里 `Volume2` 与 `Volume3` 对调。
→ 测试只走 `op1 = 0/1` ⇒ **绿**。（而在真机 CONFIG1 里"音量 3 滑条"会静默读到错值。）
**正解**：至少补一条 `op1 = 2/3` 的断言，或让期望值来自随包 `SYS4REG.INI`
（`app/amayui-emulator/SYS4REG.INI` 是**产品**文件，不是测试自己写的）—— 那样"读错键"会红。

### 2.3 无独立 oracle（期望值由被测代码或同源助手算出）

**⑤ `save-thumb.test.ts:155-178` —— "E4" 的期望值全是**同一份文件**自我印证**

```ts
162:  assert.equal(bytes.length, 54 + 320 * 180 * 3, '长度 = BMP 头 + 像素（E4：172,854）');
175:  const bfSize = new DataView(bytes.buffer).getUint32(2, true);
176:  assert.equal(bfSize, 320 * 180 * 3 + 40, 'E4：真槽头里的 bfSize = 像素 + 40（不是文件长度）');
177:  assert.equal(bytes.length - bfSize, 14, '差正好是 14 字节文件头');
```
`bfSize` 是从**被测文件本身**读出来的 + 一个从注释搬来的 `40`。`:162` 的 `54+320*180*3` 是算式、
`:176` 的 `320*180*3+40` 是同一算式的另一个写法 —— 两式之差 14 是**算术恒等式**，不构成对照。
**反例实验**：把 `src/vm/bmp.ts` 的 `decodeBmp` 改成"只读宽高、像素全填 0"。
→ `:162/:176/:177` 仍绿（都没碰像素），`:164-166`（宽高）仍绿，只有 `:168-173`（非均匀像素）会红。
**这条断言真正的价值**只在 `:168-173`（"真缩略图不是常量"），而它是从**同一个 decoder 的输出**里采样的。
**升级**（本机可做，我已实测）：改成对真文件做**逐字节**对照 —— 例如断言
`SAVE79.STH` 的前 54 字节的 DIB 字段（`biWidth@18=320`、`biHeight@22=180`、`biBitCount@28=24`）
用人手读出的字面量写死，并用 `t.diagnostic` 打出**文件 mtime**（我实测 = 头 +264..+276 的年月日时分秒，
`slot-save` 要的正是这件事，但 `save-thumb` 完全没做）。

**⑥ `slot-save-resume.test.ts:279-292` —— `encodeSlotState` ↔ `decodeSlotState` 自洽**

```ts
287:  const enc = encodeSlotState(state);
289:  assert.deepEqual(decodeSlotState(enc), state, '编解码自洽');
```
`encodeSlotState`（`src/save/saveSlot.ts:228`）就是 `TextEncoder(MAGIC + JSON.stringify(state))`，
`decodeSlotState` 就是 `JSON.parse` ⇒ 这条断言在测 `JSON.stringify/parse` 是否互逆（ECMAScript 保证）。
**反例实验**：把 `encodeSlotState` 与 `decodeSlotState` 的 `SLOT_STATE_MAGIC` **都**改成 `'AMYS2\n'`。
→ 绿（跨版本不兼容的格式破坏不会被发现）。
**保留的只有 `:290-291`**（`decodeSlotState([1,2,3,4]) === null` / `undefined === null`）——
那是"别家的尾块 ⇒ null"的真行为。建议把 `:287-289` 降级为 smoke，并新增一条
**字面量 golden**：`encodeSlotState(state)` 的前 6 字节 === `'AMYS1\n'`、且第 7 字节是 `{`。

**⑦ `wheel.test.ts:64-71, 73-95` —— 0x10D 的期望值由测试自己 `addWheel` 喂进去**

```ts
78:  assert.equal(input.wheelDelta, 360, '渲染器注入的多格应累加');
81:  assert.equal(read(), 360, 'op1 应拿到累计增量');
82:  assert.equal(input.wheelDelta, 0, '★读后必须清零');
```
`addWheel(120)` 三次 ⇒ `360` ⇒ `0x10D` 读 `360`。`:78` 测的是 `addWheel` 的加法、`:81` 测的是
"读出来 == 刚才存的"，`+120/格` 与 `上滚正` 这两个**引擎口径**都靠注释（`:8-9` 引 raw 29191 一带）
而没有可执行对照。
**反例实验**：把 `src/vm/input.ts` 的 `addWheel` 改成 `wheelDelta += v * 2`。
→ `:78` 变 720 会红 ✅（好）；但把 `0x10D` handler 的方向反过来（取负）→ `:81` 变 −360 也会红 ✅。
所以**这一条不是无意义，是"自造 oracle 但有判别力"**；它的问题在 §4：竖直滚轮的用例其实属于 `input.test.ts`。

### 2.4 重复覆盖

见 §4 的矩阵。要点：**`save-slot-chain` 2/2 用例全跳（= 本机 0 判别力）**，而它与
`slot-load-transfer.test.ts:114` 是**同一条链路**；`engine-slot.test.ts:112/116` 与
`slot-load-resume.test.ts:143-151` 是**同一个不变量**（见 §4.2 第 5 行）。

### 2.5 测脚手

**⑧ `native-tap.test.ts:19-86`（前 4 例）—— 只测测试自己造的假件**

```ts
22:  const inner = { log: (m) => void m, playSound: (id) => void id };
33:  tapped.setLight(3, false);
39:  assert.equal(list.length, 2, '两个未实现方法各记一条');
```
`inner` 是测试自己写的对象、`tapped` 是 `withNativeTap(inner, rec)` ⇒ 断言"没实现的方法被记下来了"。
**反例实验**：把 `src/vm/nativeTap.ts` 的 `DropRecorder.count()` 改成恒返回 0。
→ `:46`（totalCalls）会红 ✅ —— 所以它测的是 `DropRecorder` 自己的计数器，**不是"宿主真的缺了方法"**。
★真正有判别力的是 `:178-217`（桥能力面清单 T-0013）：把 `PixiBackend` 上新增一个不登记的方法会红，
且 `headOnly === []` 钉住"差异只允许一个方向"。**结论**：前 4 例可降级，后 2 例 keep-ratchet。

---

## 3. ★E4 审计：逐条判定"真对照"还是"注释里的 E4"

我把本组所有 E4/E3 标记逐条落到**可执行闸门**上（`file:line` → 闸门 → 本机实测）：

| # | 断言位置 | 声明的档位 | 实际闸门 | 本机实测 | 判定 |
|---|---|---|---|---|---|
| 1 | `save-data.test.ts:582` | **E4** 真游戏 `SAVE.DAT` | `process.env.LOCALAPPDATA`（**不用 systemPaths**） | **跳过**（macOS 无 LOCALAPPDATA） | **真 E4，但本机休眠** |
| 2 | `save-slot.test.ts:120` | **E4** 真槽头 = 文件 mtime | `baseDir/SAVE/SAVE00.DAT` | **跳过** | **真 E4（有独立 oracle），指错目录** |
| 3 | `save-slot.test.ts:145` | **E4** 引擎槽只读头 | 同上 | **跳过** | 真 E4，指错目录 |
| 4 | `save-thumb.test.ts:155` | **E4** 真 `.STH` | `baseDir/SAVE/SAVE00.STH` | **跳过**（overlay 有 78/79，尺寸完全相同 172,854） | 真 E4，指错目录 |
| 5 | `engine-slot.test.ts:210` | **E4** 真槽全解 + 落点自洽 | `baseDir/SAVE/SAVE??.DAT` **only** | **跳过** | 真 E4，指错目录 |
| 6 | `engine-slot.test.ts:262` | **E4b** 真槽绘制项逐条解码 | **`baseDir/SAVE` 与 `overlayDir/SAVE`** | **✅ 跑了**：`真槽 2 个（带绘制项清单 2 个），逐条解码 107 项` | **本组唯一活着的 E4** |
| 7 | `slot-load-resume.test.ts:318` | **E3** 真 `SAVE00.DAT` 续跑 | `baseDir/SAVE/SAVE00.DAT` | **跳过** | 真 E3，指错目录 |
| 8 | `slot-load-transfer.test.ts:114` | **E3** 真游戏槽控制转移 | `baseDir/SAVE` 第一个 `SAVE??.DAT` | **跳过** | 真 E3，指错目录 |
| 9 | `slot-load-resume.test.ts:396` | **E4** 续跑后跑帧循环 | 依赖 #7 | **跳过** | 真 E4 |
| 10 | `save-slot-chain.test.ts:47/207` | **E3** TITLE→Load Data 全链路 | `baseDir/SAVE/SAVE??.DAT` / `.STH` | **2/2 跳过** | 真 E3，指错目录 |
| 11 | `slot-load-screen.test.ts:25` 注释"真槽 79，清单 69 条" | 注释声明 E4 | **无闸门**（用 `buildBody` 合成 2 条） | 跑的是合成夹具 | **注释里的 E4，但有真实溯源**（见下） |
| 12 | `slot-load-transfer.test.ts:242` | **E3** 真语料脚本侧棘轮 | 读 `src/SAVE.txt` / `SBUNKI.txt` 正文正则 | **跑了** | 真 E3（静态语料） |
| 13 | `save-data.test.ts:501` | **E3** 真语料启动链两分支 | `install/SYSTEM4.BIN` + 400k 步 | **跑了**（1.94 s） | 真 E3 |
| 14 | `config-version-substr.test.ts:347` | **E3** 真语料跑到 TITLE 看数字条 | 同上（200k 步） | **跑了**（1.01 s） | 真 E3 |

### 3.1 判定结论（这就是本组最重要的判定）

**"注释里写了 E4、期望值仍是自算"的只有一处**：`slot-load-screen.test.ts`。
它的 3 条用例全部用 `buildBody(...)` 合成槽（`:111`、`:208`、`:282`），但注释 `:25` 写着
"★实证（真槽 79，`SAVE79.DAT`）：清单 69 条，第 1 条就是 SN0000 的背景 —— handle `0x18A88`、slot 4、
src (0,0,2048,1152)、dst (−768,−272)"，而夹具 `:126` 写的正是这组值。
**它的期望值到底哪来的？我实测了真文件**：

```
SAVE79.DAT  handle 0x18a88 → tex=4 src=[0,0,2048,1152] pos=[-768,-272] flags=3
            scaleWork=(1,1,1) transWork=(0,0,0) transTarget=(768,0,0)
SAVE79.DAT  handle 0x19835 → tex=17 src=[182,794,134,736] pos=[1148,0] flags=1
```
⇒ **`0x18a88` 那一条是从真槽 79 逐字段抄下来的**（`flags=3`、`transTarget=768` 都对得上），
`engineDrawItem.ts:57` 的注释"实测（真槽 79 的 0x18A88 那条）…`transTarget=(768,0,0)`"也一致。
**所以它不是"注释里的 E4"，而是"E4 观测值被冻成了合成夹具"**：溯源真、但**判别力只剩解码器自洽**
（`decodeEngineDrawItem` 的 740 B 偏移改了，夹具会跟着改坏而**不会红**）。
另一个小偏差：`:127` 的第 2 条写 `src: [182, 794, 316, 1530]` ⇒ 宽=134/高=736；真槽里
`0x19835` 是 **left=182,top=794,right=316,bottom=1530**，即 `srcW=134, srcH=736`（夹具的写法是把
right/bottom 当 width/height 用了），碰巧与 `drawItemRecord` 的 `srcW/srcH` 语义**同值**，所以不红。

### 3.2 为什么"指错目录"这件事是可以低成本修好的（本机可验证）

`engine-slot.test.ts:268` 已经示范了正确写法：

```ts
268:  const dirs = [path.join(system.baseDir, 'SAVE'), path.join(system.overlayDir, 'SAVE')];
279:  if (found.length === 0) { t.skip(…); return; }
312:  assert.ok(slots >= 1, `至少解出一个真槽（实际 ${slots}）`);
```
实测：`slots = 2`、`items = 107`。**把另外 7 处闸门（表中 #1–#5、#7–#10）按同一口径改成"两侧都看"，
本机立刻从"9 个沉默跳过"变成"9 个真断言"**，且不需要任何新数据、不需要 Electron、不增加墙钟。
唯一的取舍是"某些机器的 overlay 里放的是本工程槽（`format=0`）"——那由
`parseSlotFile`/`decodeEngineSlot` 的 `format` 分支天然处理；真正需要的只是把
`if (!fs.existsSync(base)) t.skip(...)` 换成"两侧合起来有没有真引擎槽"。

---

## 4. 重复覆盖矩阵

### 4.1 本组内部

| # | 不变量 | 出现在 | 强度对比 | 去重动作 |
|---|---|---|---|---|
| 1 | `0x1AE`/`0x1AF` 的 `.STH` 往返 | `save-slot.test.ts:249-277`（只断言 op1，内存 Map）、`save-thumb.test.ts:199-236`（断言 BMP 字节 + 像素逐点） | `save-thumb` **严格更强** | **`save-slot.test.ts:261-270` 可删**（2 条断言），保留 `:249-259`（复制/删除） |
| 2 | "写槽只写 overlay、base 一字节不动" | `save-slot.test.ts:297`、`save-data.test.ts:458`（`SAVE.DAT` 同型）、**`overlay.test.ts:127`（`SAVE.DAT`）**、`overlay.test.ts:82`（通用写） | 三处都是同一层 `NodeFileSource` | **与 `overlay.test.ts` 重复**；建议在 `overlay.test.ts` 扩一条 `writeSaveSlot`，删 `save-slot.test.ts:297` 与 `save-data.test.ts:458` 的同半段（保留各自"槽/表"特有的那半） |
| 3 | "调用方帧被放弃、ip 不前进"（`Depth が不正です` 回归） | `slot-load-transfer.test.ts:148`、`slot-load-resume.test.ts:125`、`slot-save-resume.test.ts:127`、`slot-load-transfer.test.ts:239` | 4 处同型 | 保留 `transfer:148`（真槽）与 `save-resume:127`（本工程槽）；`load-resume:125` 可并入 transfer |
| 4 | "读档后走栈跑到 `savedCur` 收尾（门 1→0）+ 轨迹不含 TITLE" | `slot-load-resume.test.ts:396-449`、`slot-load-transfer.test.ts:153-203` | transfer 多了"CALLER.BIN 不在轨迹里"；load-resume 多了"必须活到存档脚本里" | **合并为一条共享 fixture 的两组断言**（见 §4.2） |
| 5 | "真槽解析出的 `savedCur/savedRet/frames` 自洽" | `engine-slot.test.ts:112`（合成 3 条 handle）、`engine-slot.test.ts:210`（真槽）、`slot-load-resume.test.ts:143-151`（合成） | 真槽那条最强 | 合成两条保留（它们各自喂不同的下游），但**真槽闸门必须打开**（§3.2） |
| 6 | "配置键的权威表" | `config-keys.test.ts:46`（扫 src 字面量）、`config-keys.test.ts:68`（CFG vs 键表）、`engine-config.test.ts` 多处 | 只有 `:46` 是独立 oracle | 删 `:68-77`（见 §2.2③） |
| 7 | "InputManager 两把刷子（消费刷 vs 实时刷）" | `input.test.ts:76-89`、`keyboard-mask.test.ts:45-64`、`keyboard-mask.test.ts:116-126` | keyboard-mask 那两条更强（带键盘位） | `input.test.ts:76` 可缩到 1 条鼠标断言 |
| 8 | "`0x2E6` 读 AutoMessagePitch" | `config-read.test.ts:99-109`、`config-version-substr.test.ts:183-208` | version-substr 的**更强**（写了越界选择器、`0x2E7` 写→读闭环） | `config-read.test.ts:99-109` 的 `0x2E6` 半段可删，只留 `0x1B8` |

### 4.2 存档这一族：哪几件可以合并、合并后剩几个用例

现状（去重前的"存档核心"）＝ **10 个文件 / 60 个用例**（`engine-slot`(9 例) 是**本组邻居**、不在 22 文件清单里，
但它与 `slot-load-*` 共用 `engineSlotFixtures.ts`，去重时必须一起看）：

```
save-data 16 · save-slot 10 · save-slot-chain 2 · save-thumb 6
slot-save-resume 7 · slot-load-resume 5 · slot-load-transfer 3 · slot-load-screen 3 · slot-load-l2d-reset 2
（+ 邻居 engine-slot 9）
```

**建议合并成 7 个文件 / 54 个用例（净减 3 文件、6 例）：**

1. **`save-slot-chain` → 并入 `slot-load-transfer`**（减 1 文件 / 2 例 → 0 例）
   - 二者是同一条 `TITLE→Load Data→SAVE.BIN` 真链路的两次重跑（`save-slot-chain.test.ts:47` 与
     `slot-load-transfer.test.ts:114`），都断言"零未实现 opcode + 到达 SAVE + 真读了槽"。
   - `slot-load-transfer` 的判据**严格更强**（多一条 `Depth が不正です` 回归 + 控制转移 + E3 脚本棘轮）。
   - `save-slot-chain.test.ts:207`（缩略图 320×180）是**独有**的 ⇒ 保留这 1 例，搬进 `slot-load-transfer`。
   - 合并后：`slot-load-transfer` 4 例，删掉 `save-slot-chain.test.ts` ⇒ **10 文件/60 例 → 9 文件/59 例**。
   - ★前提：把两者的**真链路 fixture 抽成一个 helper 并缓存一次运行**（现在各跑一次 4000+4000+6000 帧）。

2. **`slot-load-resume` 的 E3 段与 `slot-load-transfer` 的真槽续跑段共享一次运行**（不再另算用例）
   - `slot-load-resume.test.ts:396-449` 与 `slot-load-transfer.test.ts:161-203` 都是"读真槽 → 跑帧循环 →
     门 1→0 → 看轨迹"，差别只在末端断言（前者查"活到存档脚本"、后者查"没撞 CALLER.BIN 守卫"）。
   - 做法：一条 `runRealSlotResume(slot)` 返回 `{ e, trail, unknown, sawGate }`，两个 `test()` 各自断言。
   - 用例数不变，**省掉一次 300 帧真槽循环**（这是 §5.2 候选①的直接兑现）。

3. **`save-thumb` 的 `.STH` 往返两例并入 `save-slot`**（减 1 文件 / 2 例）
   - `save-slot.test.ts:261-270`（0x1AE/0x1AF 往返）与 `save-thumb.test.ts:199-236` 是同一个不变量，
     后者更强 ⇒ 删前者；`save-thumb` 的 BMP 编解码 2 例（`:108-149`）搬进 `save-slot`。
   - 合并后：`save-slot` = 8（原 10 − 重复的 2）+ 2（搬来的）= 10 例、`save-thumb` 消失
     ⇒ **9 文件/59 例 → 8 文件/57 例**。
   - **不建议**把 BMP 编解码与 `save-slot` 的槽族混成一个大文件 —— 它是独立主题；这里只是并掉重复的那 2 例。

4. **`slot-load-screen` + `slot-load-l2d-reset` → `slot-load-presentation.test.ts`**（减 1 文件 / 0 例）
   - 两者都在断言"装载点必须把**上一屏**的东西换掉"：前者换 `drawItems`、后者换 L2D 节点/槽/动作缓存。
   - 用例数 3 + 2 = 5 全部保留（其中 `l2d-reset:85` 那条"没 L2D 不记日志"与 `screen:178` 的
     `releaseFrameHold` 合成一组，但仍是两条独立断言）⇒ **8 文件/57 例 → 7 文件/57 例**。

5. **`save-slot-tdz` 保持独立**（不并）
   - 它的价值是"**import 顺序本身**是断言"（`save-slot-tdz.test.ts:24-26`），合并会让这条失效
     （`node --test` 每文件独立模块图）。**这是必须保留独立文件的唯一一个**。

**合并后的存档族**（G6 的 10 个文件内）：

```
save-data 16 · save-slot 10 · slot-save-resume 7 · slot-load-resume 5 · slot-load-transfer 4
· slot-load-presentation 5 · save-slot-tdz 4
（save-slot-chain 并入 slot-load-transfer：−2 例；save-thumb 的两例重复被删、BMP 两例搬进 save-slot：净 0）
= 7 文件 / 51 例（原 10 文件 / 60 例，净减 3 文件、6 例）
（★邻居 engine-slot(9 例) 不参与合并，但它应当跟着一起打开 §3.2 的双侧闸门）
```
（我先前草稿写"8 文件/52 例"是把 `save-thumb` 与 `slot-load-*` 的前后步骤重复计数了；以上是逐文件核过的数。）
再叠上 §3.2 的"闸门统一"（不改用例数但把 9 个 skip 变成真跑），这一族的**有效判据数**从
「51 真跑 + 9 静默」变成「60 真跑」，墙钟因共享 fixture 反而**下降**。

### 4.3 与全仓其它测试的重复

| 本组 | 仓内重复对象 | 处理 |
|---|---|---|
| `save-thumb.test.ts:155`（真 `.STH` E4） | `engine-slot.test.ts:262`（E4b，已在跑真槽目录）、`save-slot-chain.test.ts:207`（链路上的 `.STH`） | 保留 1 条"文件级 E4"，其余走链路 |
| `save-data.test.ts:458`（SAVE.DAT overlay 纪律） | `overlay.test.ts:127`（同名同名） | 删本组这条 |
| `save-data.test.ts:582`（真 `SAVE.DAT` E4 的 `LOCALAPPDATA\Eushully` 扫目录） | `gallery-bgm-list.test.ts:194`（`★E4：真机系统存档` 经 `readSaveFlags` 并 overlay/base） | **后者更强且本机在跑**；可把 `save-data` 的 `INITCONFIG` 键断言搬进 `gallery-bgm-list` 那条 |
| `config-version-substr.test.ts:347`（E3 跑到 TITLE 看版本号） | `config1-chain.test.ts`（TITLE→CONFIG→CONFIG1，13 例）、`game-start-chain.test.ts`（启动→SN0000） | 三条都跑真链；`config1-chain` 是 T-0115 的最慢文件 ⇒ 值得统一"跑一次链路，多处断言"的共享 fixture |
| `emulator-options.test.ts:223`（`showLogo=false` 的 E3，4.81 s） | `game-start-chain.test.ts`（默认链路，14.4 s） | 文件内注释 `:236` 已声明"默认方向只跑一次" —— **这个做法应当推广** |
| `input.test.ts:106`（TITLE 真语料）/ `:295`（CHARMEDIT 真语料） | `keyboard-scenario-menu.test.ts`（24.5 s，T-0115 最慢第二） | 三者共享"真语料 fixture"是 T-0115 候选①的现成落点 |

### 4.4 顺带发现：本组有 13 处各自造的构造函数（`T-0020` 的 17 处里占 13）

`save-data`(mk)`save-slot`(mkEngine+memoryFs)`save-thumb`(mkEngine+thumbFs)`slot-save-resume`(mkSource+mkEngine)
`slot-load-resume`(mkEngine+fakeFileSource)`slot-load-transfer`(mkScriptBinary+putCaller)`slot-load-screen`(fakeSource+Screen)
`slot-load-l2d-reset`(fakeSource+fixture)`config-read`(mk)`config-version-substr`(mk)`wheel`(wheelScript/hwheelScript/oneInstr)
`ops-cg-digit-clock`(script/globalInts)。其中 **`mkEngine(fsLike)` 在 `save-slot`/`save-thumb` 里几乎逐字相同**
（差异只有 `localVars`/`tables`/`raw[0x3c+12]` 三处常数）—— 是 `harness.ts` 该收的下一个候选
（`harness.ts:41-42` 自己也说"17 处 mk() 变体…只服务新增的守卫"）。
`slot-load-l2d-reset.test.ts:19-27` 更是留了一段**已失效的历史注释**（"必须先 import `vm/ops.js`"，
但 `T-0089` 之后那条环已消）⇒ 那两行 `import '../src/vm/ops.js'` 现在是纯装饰。

---

## 5. 可被新调试能力替代或增强的测试：探针型 vs 守卫型

**分类口径**
- **守卫型** = 断言"某条不变量在**任意**输入下都成立"（改坏实现必红）⇒ 不该被 `dbg` 替代，只能被增强。
- **探针型** = 断言"**这一份具体数据**下状态长这样"（= 把一次人工勘察固化成断言）⇒ `dbg`/`save:dump`
  能在**真会话**里直接给出同一批数字，且能给出测试给不了的东西（宿主侧、时序、真窗口）。

| 文件 | 型 | 说明 |
|---|---|---|
| `engine-slot` E4b / `slot-load-resume` E3 / `slot-load-transfer` E3 / `save-slot` E4 / `save-thumb` E4 | **探针型** | 都可以用 `npm run save:dump <槽>` 一次拿到 `savedCur/savedRet/帧记录/池规模/落点`，或 `dbg 'slot 11'` 查 `texSlots/texSizes` |
| `save-data:501`（E3 两分支）、`config-version-substr:347`（E3 数字条）、`emulator-options:223`（E3 跳过 LOGO） | **半探针** | 它们断言的是"**链路走到哪/分支选哪**"，`dbg` 能实时看（`dbg run` / `dbg frame` / `dbg log`），但"零未实现 opcode"这种**全称**性质仍要靠跑完一遍 |
| `save-slot-tdz`、`config-keys:46`、`emulator-options:205`（源码棘轮）、`native-host:419/439/448`（源码棘轮）、`xval` | **守卫型** | 与调试器无关，绝不能被 `dbg` 替代 |
| `slot-load-screen`、`slot-save-resume`、`slot-load-l2d-reset`、`input`、`keyboard-mask`、`wheel`、`config-read`、`ops-cg-digit-clock` | **守卫型**（合成输入下的不变量） | 同上 |

### 5.1 ★`dbg` 对存档链的价值：能否改成"共享长活会话"

**现状**（`slot-load-resume.test.ts:318-451`、`slot-load-transfer.test.ts:114-203`、
`save-slot-chain.test.ts:47-289`）：每例都**从零起一个 Engine + 装载真 `SYSTEM4.BIN` + 跑 300–14000 帧**，
只为了在末端读 3–5 个字段（`cur`、帧脚本名、`loadInProgress`、`trail`）。这正是 T-0115 的根因。

**`dbg:srv` 能做到的**（我核过 `tools/debugsrv.cjs:1-60` + `tools/dbg.cjs:1-30` + `src/vm/debugQuery.ts:125-245`）：

```
npm run dbg:srv                                   # 常驻（TCP 127.0.0.1:39427，默认静音）
node tools/dbg.cjs click … / clickimg …           # 远程驱动：TITLE → Load Data → 点槽 → 确认
node tools/dbg.cjs run                            # cur / 当前帧 / waitFlags / playSeconds / engineValues 条数
node tools/dbg.cjs frame                          # 活帧：name / scriptId / ip / caller / retStack / local.int 条数
node tools/dbg.cjs 'b event global-int-write idx == 3318'   # 事件断点（真槽读档的 global 写入点）
node tools/dbg.cjs slot 11                        # texSlots / texSizes（+ 宿主是否就位看 [present] 日志）
```
⇒ **"读档 → 查询关键 global/slot → 断言"是可行的，而且比现在更真**：它跑的是**产品入口**（真窗口、
真 `frame/loop.ts`、真宿主），而单测跑的是"手工装的 Engine"。

**但它不能整体替代守卫**，原因（都是实测得到的事实，不是猜）：
1. **`dbg` 只读查询覆盖不到本组一半的断言面**：`dbg` 有 `global/local/frame/flocal/slot/run`，
   而本组的核心断言大多是**宿主/场景侧**（`scene.drawItems`、`mesh`、`slotImgid`、`l2dNodes`、
   `loadHold`、`dropFrameItems` 的调用序）—— 这些 `debugQuery` **没有**查询入口（`slot` 自己都写了
   "宿主侧槽表是后续步"）。
2. **`dbg` 需要 Electron 窗口 + 前台/节流三开关**（`debugsrv.cjs:52-55` 明确警告"窗口不在前台
   ⇒ rAF 极低频 ⇒ 启动链走不完"）⇒ 天生**不能进 `npm test`/CI**，只能进 `test:deep` 档。
3. **它是"一次会话一份状态"**：`slot-load-*` 里那些"两个干净 Engine 交叉验证"的判据
   （`slot-save-resume.test.ts:106-136` 的跨实例读档、`:168-206` 的 A/B 画面一致）在单会话里做不了。

**因此正确的关系是分工，而不是替代**：

| 用途 | 工具 | 理由 |
|---|---|---|
| 判据**为什么**红、某 global 何时被写 | `dbg:srv` + 事件断点 | 单测给不出"哪一条指令写的" |
| 真窗口下的端到端目视（E4） | `npm run shot -- --load <槽>` | 已有 `shot.cjs:206-287` 的完整流程（`savedCur=2` 判据都在），T-0090/T-0083 就是这么取证的 |
| 一份槽/存档**内容**核对 | `npm run save:dump <文件>` | `saveDump.ts:66-140` 直接打头/帧记录/池/落点（含 `.STH` 非黑像素统计） |
| **不变量**的日常回归 | 现有单测 | 唯一能进 CI 的形态 |

### 5.2 与 T-0115 的关系（可执行的收敛方案）

T-0115 的三条候选路径里，本组能具体贡献两件事：

1. **候选①（共享 fixture）在本组有现成落点，且比"缓存 Engine 状态"更安全**：
   `slot-load-resume` / `slot-load-transfer` / `save-slot-chain` 三条真链路，抽一个
   `runRealLoadChain({ slot })` helper，**只读共享结果对象**（`{trail, unknown, slotReads, thumbs, gate}`）。
   三条合计现在 ≈ 0.5 s（帧数不大），真正省下的是**将来把 §3.2 的 overlay 闸门打开之后**的增量。
2. **候选③（减少重复链路）在本组的最大标的不是文件数而是"每例各起一次真会话"**：
   `save-data:501`（1.94 s）+ `config-version-substr:347`（1.01 s）+ `emulator-options:223`（4.81 s）
   + `append-packs:337`（1.65 s）**共 9.4 s / 本组 19 s**，四条都是"从 `SYSTEM4.BIN` 跑到某个界面"。
   建议**先在单测里合并**（同一进程里跑一次 `runGameStartChain`，多处断言 —— `emulator-options.test.ts:236`
   与 `game-start-chain.test.ts` 已经在用这个模式）。
3. **`dbg:srv` 应作为"候选②的分档出口"而不是日常档**：把 §3.2 的 overlay 闸门做进
   `test:deep`（需要真槽/真窗口的 E4 用例），`npm test` 只跑"任何机器都能跑"的部分。
   ⇒ 判据强度**不降**（E4 从"静默跳过"变成"deep 档必跑"），墙钟不涨。

**一句话**：`dbg` 对存档链的价值是**"把人从 4 分钟手动重现里解放出来"**（`T-0114` 的原话），
不是"替掉单测"；它最适合承接的是本组**现在正静默跳过的那 9 条 E4**——让它们有地方真跑。

---

## 6. 本组最该改的 3 件事（可执行，带文件行号）

### ① 统一 E4 闸门到"两侧都看"——本机 9 个沉默跳过 → 9 个真断言（零成本、零墙钟）

按 `engine-slot.test.ts:268-282` 已跑通的写法，改 5 处闸门：

| 文件:行 | 现在 | 改成 |
|---|---|---|
| `save-slot.test.ts:121-126`、`:146-151` | `path.join(paths.baseDir, 'SAVE', 'SAVE00.DAT')` | `[baseDir, overlayDir].map(d => path.join(d,'SAVE')).find(有 SAVE??.DAT)` |
| `save-thumb.test.ts:156-160` | `baseDir/SAVE/SAVE00.STH` | 同上（本机 overlay 有 78/79，尺寸 172,854 = 断言值） |
| `engine-slot.test.ts:211-222` | `dir = baseDir/SAVE` | 直接用 E4b 的 `dirs` 数组（`:268`） |
| `slot-load-resume.test.ts:319-324` | `baseDir/SAVE/SAVE00.DAT` | 同上，并断言"选中的那份 `format===3`" |
| `slot-load-transfer.test.ts:117-122`、`save-slot-chain.test.ts:52-63` | 同上（`.DAT` / `.STH` 两种） | 同上 |

**验证方式**（不需要跑全量、不抢窗口）：单跑这几个文件，`skipped` 应从
`save-slot 2 / save-thumb 1 / engine-slot 1 / slot-load-resume 1 / slot-load-transfer 1 / save-slot-chain 2`
降到 **0 / 0 / 0 / 0 / 0 / 0**，且 `pass` 数不变（`save-data` 的 `LOCALAPPDATA` 那条在 macOS 上仍会跳，
它是**另一类**：它扫的是 Windows 的玩家目录，见 §7.5）。反例检查：把 `decodeEngineSlot` 的
`SLOT_FRAME_STRIDE_DWORDS` 从 261 改成 260，**至少** `engine-slot:210/:262` 必须红。

### ② 合并 `save-slot-chain` → `slot-load-transfer` 并抽出"一次运行、多处断言"的真链路 fixture

- 删 `save-slot-chain.test.ts`（`:47`、`:207` 两例），把 `:207-289`（缩略图 320×180）搬进
  `slot-load-transfer.test.ts`（新 `test()`，复用同一 `runChain()` 结果）；
- 抽 `test/realLoadChain.ts`：`runRealLoadChain({ slot, frames })` → `{ e, trail, unknown, slotReads, thumbs, gate }`，
  供 `slot-load-transfer`（控制转移 + 零缺口）与 `slot-load-resume`（活到存档脚本，`:396-449`）共用；
- 同时在 `test/harness.ts` 收 `mkEngine(fsLike)`（`save-slot.test.ts:50-70` 与 `save-thumb.test.ts:38-69` 逐字重复，
  差异只有 3 个常数），兑现 `harness.ts:41-42` 自己的 TODO（`T-0020`）。
**验证**：本组用例数 160 → 158；`slot-load-transfer` 的墙钟不增、`save-slot-chain` 的 0.20 s 归零。

### ③ 修掉 3 条"恒真/镜像"断言，并给它们换成可执行 golden

| 位置 | 现在的问题 | 换成 |
|---|---|---|
| `save-data.test.ts:89-96` | `:94` 同义反复（§2.1①） | 删 `:94`；加 `assert.equal(crc32MsbFirst(v), 0xfc891918)`（本实现实测值，见 §0 附注）+ 保留 `:95`（空串=0）。验证：把 `src/util/crc32.ts:33` 的 `i << 25` 改成 `i << 24` ⇒ 必须红 |
| `config-keys.test.ts:68-77` | 镜像比对（§2.2③），删掉也不影响任何产品行为 | **删整条**；把预算换成"`CFG` 的每个键在 `src/` 里**至少被用一次**"（扫 `CFG.<name>` 的出现；现在有 `audio.ts:257`、`engine.ts:782/805/1224/1288` 等真实调用点），这样"键表里躺着一个没人用的键"会红 |
| `config-read.test.ts:80-109` | 只走 `op1 = 0/1`，键表对调不红（§2.2④） | 补 `0xC5` 的 `op1 = 2/3/4`、`0xC7` 的 `op1 = 1/3`、`0x1B8`/`0x2E6` 的越界 `op1 = 2`，期望值改从产品自带的 `app/amayui-emulator/SYS4REG.INI`（`[sound]Volume2/3/4`、`[message]AutoMessagePitch0/1`）读；验证：对调 `config-read.ts` 的 `Volume2/3` ⇒ 必须红 |

**为什么是这 3 件而不是"修 E4"**：① 是把已有真值**接上**（投入 1 人时、收益是 9 条真断言）；
② 是降 T-0115 墙钟的**唯一可持续**手段（"共享一次真链路"，不是"改弱断言"）；
③ 是唯一能**提升**判别力的一类（其余 19 个文件已经够强，问题在"期望值来源"而不在"覆盖不够"）。

---

## 7. 附注（审计过程中实测得到、可复用的事实）

1. `crc32MsbFirst` 的 golden：`crc32MsbFirst(UTF8("123456789")) = 0xfc891918`，`crc32MsbFirst(空) = 0`
   （`crc32(UTF8("123456789")) = 0xcbf43926`，= CRC-32/ISO-HDLC 标准值 ⇒ `save-data.test.ts:85` 是**真独立 oracle**）。
2. 真槽 `SAVE79.DAT` 的绘制项 key：`0x18a88 → tex=4 src(0,0,2048,1152) pos(−768,−272) flags=3 scale(1,1,1) transTarget(768,0,0)`；
   `0x19835 → tex=17 src(182,794,134,736) pos(1148,0) flags=1`。**`slot-load-screen` 的夹具值来自这里**。
3. 真槽 `SAVE78.DAT`：38 条绘制项、首位 handle = 101100 (`0x18aec`, tex=43)；`SAVE79.DAT`：**69 条**、首位 handle = 101000 (`0x18a88`)。
   ⇒ `slot-load-screen.test.ts:25` 注释里的 "69 条 / 第 1 条 0x18A88" **与真文件一致**（是 79 不是 78）。
4. 真 `.STH`（78/79）：172,854 字节，`bfSize=172,840`，与 `save-thumb.test.ts:162/176` 的断言值**逐字节吻合**。
5. overlay 的 `SAVE.DAT` 是**本工程格式**（`format=0`、ints=3044、strings=5、usedFileIds=107、`layout=emulator`、`title=AmayuiEmulator`）
   ⇒ 本机的 `decodeSaveData` 的**引擎 format=1/2/3 + Crypt + LZSS** 分支**没有任何真样本覆盖**
   （`save-data.test.ts:265-301` 是自造载荷，`:582` 的 E4 在 macOS 跳过）。
   这是本组**真实存在的一个覆盖空洞**，也是 §6.① 之外值得单列的一条。
6. `overlay/SYS4REG.INI` 里有 `[set]` 段且 `GameVersion=`（**空值**）、`SaveVersion1=1`；本工程的
   `effectiveIniText()`（`src/arch/systemPaths.ts:60`）**读 overlay 优先**，而
   `config-version-substr.test.ts:62-68` 的同名 helper 只读 **base**（`REAL_INI`）⇒ 两者口径不一致。
   本机结果：E3 走 `DEFAULT_GAME_VERSION='1.07.0019'` 通过（`config-version-substr.test.ts:400`），
   但**测试自己的 helper 名与产品同名却语义不同**，值得改名为 `baseIniText()` 或直接改用产品的 `effectiveIniText`。
7. 本组 13 处自造 fixture 里，`save-slot-tdz` 必须保持独立文件（import 顺序即被测对象），
   `emulator-options` 的 `:181/:196-200` 会**读本机私有** `emulator.config.json` 与 `.gitignore`
   （用的是 `{}` 空环境而非被钉住的 `process.env`，所以结果依赖开发机 —— `:195` 注释已声明只断"能解析"，
   属于可接受的弱断言，但仍是"测试读私有配置"的唯一残留）。

---

**审计结论一句话**：G6 组**没有一个文件该删**；它的真实问题不是"测了没意义的东西"，而是
**"真值就在本机磁盘上（overlay 的真槽 78/79 + 真 `.STH`），却有 7 处 E4/E3 闸门盯着一个不存在的基础目录"**——
把它们统一到 `engine-slot.test.ts:268` 的双侧口径，是本组性价比最高的一改；
紧随其后的是 `save-slot-chain`/`slot-load-transfer` 的真链路去重（T-0115），
以及 3 条恒真/镜像断言的替换（`save-data:94`、`config-keys:68`、`config-read` 的键选择面）。
