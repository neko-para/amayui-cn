# T-0162 台账补丁交接（scribe-e）—— 机械可应用补丁 + 自证

> 角色：**台账抄写员**。本文件只是**过程文档**；真源仍是 `analysis/*.json`。
> 本会话**未改**任何 `analysis/**`、`docs-new/**`、`src/**`、`test/**`、`tickets/*/ticket.json`
> —— 只写了 `.tmp/scribe-e/**`（机器产物）与本文件（简报允许的"可选过程文档"）。

## 0. 交付物 / 指纹 / 应用顺序

| 文件 | 用途 | 条数 |
|---|---|---|
| `.tmp/scribe-e/plan.json` | `ledger-set.mjs` 用（主） | `ops` **14**（opcode-gaps 1 + opcodes.json semantics 13）+ `appendEntries` **3** |
| `.tmp/scribe-e/patches.json` | `apply.mjs --patches … --no-append` 用（主） | `analysis/functions.json` 补丁 **3** 条 |
| `.tmp/scribe-e/plan-extra.json` | 可选：其余 15 条 `sub_41B640` 宿主 opcode 的同一句 semantics | `ops` **15** |
| `.tmp/scribe-e/patches-optional.json` | 可选：`0x41B640` 的 `evidence` 加宽 | **1** 条 |
| `.tmp/scribe-e/build-plan.mjs` | **生成器**（读盘拼接 + 机械扫描 raw；随时可重跑） | — |
| `.tmp/scribe-e/check-fresh.mjs` | **新鲜度护栏**：计划所依据的"现盘原文"是否被并发改过 | — |
| `.tmp/scribe-e/verify-sandbox.mjs` | 沙箱端到端复核（在 `sandbox/` 里跑真工具 + 真生成器） | — |
| `.tmp/scribe-e/{bases,snapshot}.json` | 生成时的基线 / 输入指纹 | — |

**计划所依据的现盘指纹**（生成时 = 结束时，`check-fresh.mjs` 复核漂移 0）：

| 文件 | 字节 | sha256(前 16) |
|---|---|---|
| `analysis/opcode-gaps.json` | 249722 | `d977cf77b53a9872` |
| `analysis/opcodes.json` | 331502 | `a255e41a8b8ea026` |
| `analysis/functions.json` | 580422 | `2a76243061a8e047` |
| `engine/天结_unpacked.exe_utf8.c` | 5239745 | `0f21fc7f9a88eb45` |

**应用顺序**（`plan.json` 与 `patches.json` 互不重叠，顺序无关；若用可选项，见 §4）：

```bash
# ① 先确认计划没过期（台账是跨 agent 共享可变文件 —— 本会话实测到 opcodes.json 在 3 分钟内被改过两次）
node .tmp/scribe-e/check-fresh.mjs
#    ├─ 通过 ⇒ 直接应用
#    └─ 不通过 ⇒ 先 `node .tmp/scribe-e/build-plan.mjs` 重新生成（生成器全程读盘，不手抄）
node .tmp/settle/ledger-set.mjs --plan .tmp/scribe-e/plan.json
node .tmp/settle/apply.mjs --patches .tmp/scribe-e/patches.json --no-append
# ② 重生成生成物（否则 opcode-gaps.test.ts / doc-model.test.ts 会红）
node scripts/build-opcode-gaps.mjs      # 回填 counts + 重渲染 docs-new/03-engine/opcode-gaps.md
node scripts/build-opcode-table.mjs     # 重渲染 docs-new/03-engine/opcode-table.md（semantics 变了）
# ③ 守卫
cd app/amayui-emulator && npx tsx --test test/opcode-gaps.test.ts test/doc-model.test.ts test/opcode-json-sync.test.ts
```

> `scripts/asm/build-opcodes.js` **不需要**重跑：它只读 `opcode-table.md` 的 `opcode/argc/名称/handler/状态` 五列
> （`scripts/asm/build-opcodes.js:38-54`），不读"语义"列 ⇒ `semantics` 的改动不会改变 `scripts/asm/opcodes.json`。

---

## 1. 补丁条数（按文件分）

| 文件 | 类别 | 条数 | 明细 |
|---|---|---|---|
| `analysis/opcode-gaps.json` | **新条目 append** | **3** | `432`(0x1B0 memcpy) / `402`(0x192 set-string) / `403`(0x193 concat) |
| `analysis/opcode-gaps.json` | 既有条目 `set` | **2** | `434`(0x1B2)：`disposition: implemented → partial`、`note` 追加一句（现在时） |
| `analysis/opcode-gaps.json` | 既有条目 `add`（数组 append） | **2** | `434`：`missing[]` ×3、`journal[]` ×1 |
| `analysis/opcodes.json` | `set.semantics`（读盘原文 + 追加段） | **13** | 0x192/0x193/0x194/0x195/0x1A9/0x2C2 + 0x2C5/0x2C6/0x1A6/0x2C7/0x2EC/0x6E/0x204 |
| `analysis/functions.json` | **新条目 append**（末尾 `  }\n\n]\n` 锚点替**换**） | **3** | `0x41A6C0` / `0x41B9B0` / `0x42A420` |
| `analysis/functions.json` | 既有条目 `notes` 追加（整串替换） | **2** | `0x41B640` / `0x42D150` |
| （可选）`analysis/opcodes.json` | `set.semantics` | 15 | 其余 `sub_41B640` 宿主：0x89/0x8D/0xA2/0xA3/0x140/0x144/0x14A/0x14C/0x196/0x1A5/0x221/0x2C8/0x2DE/0x2FE/0x351 |
| （可选）`analysis/functions.json` | `evidence` 整串替换 | 1 | `0x41B640`：`raw 26249-26293` → 完整体 `raw 26249-26360` + 被调信息 |

落盘后的量级（沙箱实测）：`opcode-gaps.json` 条目 **138 → 141**、`partial` **77 → 81**、`implemented` **33 → 32**；
`functions.json` 条目 **602 → 605**。

---

## 2. 自证：确切命令与输出

### 2.1 简报要求的两个 dry-run（**零报错、以"（dry-run，未写盘）"结尾**）

```console
$ node .tmp/settle/ledger-set.mjs --plan .tmp/scribe-e/plan.json --dry
· analysis/opcode-gaps.json: 182517 → 190384 字节
· analysis/opcodes.json: 254998 → 260278 字节
（dry-run，未写盘）
[exit 0]
```

```console
$ node .tmp/settle/apply.mjs --patches .tmp/scribe-e/patches.json --no-append --dry
· analysis/functions.json: 464411 → 469641 字节
（dry-run，未写盘）
[exit 0]
```

（数字是**字符数**（`readFileSync('utf8').length`），不是字节数：`functions.json` 的 460 KB 字符 = 580 KB 字节。）

### 2.2 两个可选文件的 dry-run

```console
$ node .tmp/settle/ledger-set.mjs --plan .tmp/scribe-e/plan-extra.json --dry
· analysis/opcodes.json: 254998 → 261012 字节
（dry-run，未写盘）
[exit 0]

$ node .tmp/settle/apply.mjs --patches .tmp/scribe-e/patches-optional.json --no-append --dry
· analysis/functions.json: 464411 → 464532 字节
（dry-run，未写盘）
[exit 0]
```

### 2.3 新鲜度护栏

```console
$ node .tmp/scribe-e/check-fresh.mjs
  ✅ opcodes.json：28 条 semantics 的基线一致
  ✅ opcode-gaps.json：434 前提 + 432/402/403 未登记
  ✅ functions.json：4 个锚点各 1 次 + 3 个 addr 未占用
✅ 计划与现盘一致（可以应用）
[exit 0]
```

### 2.4 ★端到端沙箱复核（不是"看 dry-run 的行数"就算完）

`.tmp/scribe-e/sandbox/` = `analysis/**` 的**副本** + `src/`、`engine/`、`tickets/` 的 **junction**（不复制 96 MB 语料）。
在沙箱里用**真工具**（非 dry）应用，再用**真生成器**校验：

```console
$ cd .tmp/scribe-e/sandbox
$ node E:/Games/Eushully/天結/.tmp/settle/ledger-set.mjs --plan .tmp/scribe-e/plan.json
✓ analysis/opcode-gaps.json: 182517 → 190384 字节
✓ analysis/opcodes.json: 254998 → 260278 字节
✅ 全部写入并通过 JSON 解析
$ node .../.tmp/settle/apply.mjs --patches .tmp/scribe-e/patches.json --no-append
✓ analysis/functions.json: 464411 → 469641 字节
✅ 全部写入并通过 JSON 解析
$ node .../.tmp/scribe-e/verify-sandbox.mjs
① opcode-gaps 生成器口径
  ✅ buildGapReport.problems = []
    回填后的 counts = {"entries":141,"byDisposition":{"unimplemented":0,"engine-internal":9,
      "engine-internal-unjustified":0,"implemented":32,"deferred":19,"partial":81}}
② partial 棘轮（重放 test/opcode-gaps.test.ts）
  ✅ partial 条数 81 ≥ 20
  ✅ missing 条数 152 ≥ partial 条数 81
  ✅ dispositions.partial 有口径说明
③ 生成物渲染（opcode-gaps.md / opcode-table.md）
  ✅ md 有「部分实现」段
  ✅ opcode-table.md 渲染成功（622 行，无「订正/旧句/历史判据」）
④ functions.json
  ✅ 0x41A6C0 已追加（toFullWidthAscii_41A6C0，status=ANALYZED，journal 1 条）
  ✅ 0x41B9B0 已追加（readStringOperand_41B9B0，status=ANALYZED，journal 1 条）
  ✅ 0x42A420 已追加（coerceOperandToString_42A420，status=ANALYZED，journal 1 条）
  ✅ 0x41B640 的 notes 已追加
  ✅ 0x42D150 的 notes 已追加
  ✅ functions.json 条数 602 → 605
✅ 沙箱复核全部通过
[exit 0]
```

沙箱跑的 `buildGapReport(root, {syncCounts:true})` 落在**沙箱**的 counts 上；真源的 counts 由 §0 的
`node scripts/build-opcode-gaps.mjs` 回填（我不写 `analysis/**`）。
`③` 的"无禁词"检查 = `doc-model.test.ts` 的 I9 棘轮口径（`03-engine/opcode-table.md`、`opcode-gaps.md` 里不许出现「订正」）。

**只读复核**（未打补丁的现盘）：`buildGapReport(REAL)` 只读运行 → `docs-new/03-engine/opcode-gaps.md`
与 `renderGapMd` 逐字一致、§7 的 140 条 missing 全部在 md 里（0 漏）⇒ 我的补丁不会引入 §7 渲染缺口。

### 2.5 生成器的机械自检（`build-plan.mjs` 内置，不通过就 exit 1）

- `functions.json` 的 `  }\n\n]\n` 尾锚点出现次数 = **1**；`0x41A6C0/0x41B9B0/0x42A420` 现均**不存在**（先核 ✓）；
- `opcode-gaps.json` 里 `432/402/403` 现均**不存在**（append 前提 ✓）、`434` 存在且 `disposition=implemented`、无 `missing[]`；
- 每条 `missing[]`：`what` ≥ 8 字、`ticket ∈ {T-0162, T-0082}` 且 `tickets/<id>/ticket.json` 真实存在、`raw` 匹配 `^\d+(-\d+)?$`；
- `plan.ops` 的每个 `match` 在现盘**恰好命中 1 条**（用 JSON.parse 定位，与 `ledger-set.mjs` 同口径）；
- 13 条 `semantics` 的追加段逐个 grep「订正/旧句/历史判据」= 0 命中；
- `patches.json` 的每个 `old` 在现盘**恰好 1 次**，且替换后 `JSON.parse` 成功、能查到新增的 `0x41A6C0`；
- 列出的 opcode 必须真的是该原语的**机械扫描**宿主（否则报错）。

---

## 3. 逐条摘要

### 3.1 `functions.json` 新增 3 条（§5 转写）

| addr | semantic_name | op | status | evidence | 与 §5 的差异 |
|---|---|---|---|---|---|
| `0x41A6C0` | `toFullWidthAscii_41A6C0` | `""` | ANALYZED | raw 25539-25593 | `fields_used` 改为 `[]`（见 §5.10）；`notes` 写"调用点 8 处"并点出 `0x7D`；`journal` 记沿革 |
| `0x41B9B0` | `readStringOperand_41B9B0` | `0x1B2` | ANALYZED | raw 26366-**26549** | evidence 尾部 +1（函数收尾 `}` 在 26549）；其余照抄 |
| `0x42A420` | `coerceOperandToString_42A420` | `0x192/0x193/0x194/0x195/0x1A9/0x2C2` | ANALYZED | raw 36318-36544 | `fields_used` 由占位串改为按体读出的字段表；其余照抄 |

三条都带 `journal: [{at: "2026-09-25（T-0162）", what: …}]`（`functions.json` 已有 36 条先例，形式 `{at, what}`）。

### 3.2 `functions.json` 既有 2 条 notes 追加

- `0x41B640`：`notes` 追加「每条数值路径返回前都过 `sub_41A6C0`（raw 26331/26347）做 ASCII→全角…；数组 tag（`0x8003` 族）与 float 指针族 7/13 无 case ⇒ default 抛（raw 26355-26357）…」（§5 的建议原文）。
- `0x42D150`：`notes` 追加「跨类型裸拷贝在 emulator 显式抛错（缺口见 `tickets/T-0162`）」。

### 3.3 `opcode-gaps.json` 新增 3 条（全部 `disposition=partial`、`source=audit-partial`、`ticket=T-0162`）

| opcode | mnemonic/name | handler | handlerBodyLine | argc | missing[] |
|---|---|---|---|---|---|
| 432 | `i1b0` / memcpy | `sub_42D150` | 37984 | 3 | 1：跨 kind 裸拷贝不可表达（`raw 37991-37995`，票 T-0162） |
| 402 | `i192` / set-string | `sub_433660` | 41935 | 2 | 3：`0x8005/0x800B` pointer-in-string（`36394-36411`，T-0162）+ `.` 全角近似（`25574-25576`，T-0162）+ 数组操作数模型（`36825-36888`，**T-0082**） |
| 403 | `i193` / concat | `sub_433710` | 41951 | 3 | 3：同上（`36394-36411` 是 `sub_42A420` 的区间，0x193 正走它 ✓） |

`handler`/`argc`/`docStatus` 取自 `analysis/opcodes.json`；`handlerBodyLine` 取自 raw 的函数标记行
（现盘 132 条里 **129 条**用这个惯例）⇒ 与 §4 给的 `37985` 差 1（见 §5.3）。

### 3.4 `opcode-gaps.json` 既有 434（0x1B2）改判

- `disposition`：`implemented` → **`partial`**（理由：§4 缺口②③④ 对 0x1B2 同样成立 ⇒ 必须落 `missing[]`；
  而 `partial` 的前提"已在 emulator 注册"已核：`scanRegistrations` 实测 `0x1b2 registered=true`）；
- `note`：追加一句**现在时**结论（"★相对引擎体仍缺 3 条…逐条见 `missing[]`"）；
- `missing[]`：3 条（**raw 按 0x1B2 自己的原语校正为 `26538-26547`**，见 §5.5）；
- `journal[]`：1 条记改判（`field: "disposition"`）。

### 3.5 `opcodes.json` 的 13 条 `semantics`（读盘拼接）

追加段分两式（按**该 opcode 实际调用的原语**，由机械扫描决定，不是按 tag）：

- **`sub_42A420` 组**（0x192/0x193/0x194/0x195/0x1A9/0x2C2）：
  「★T-0162：本条读串走 `sub_42A420`（体 raw 36318-36544；**本条体内调用点** raw …），其数值族 tag（0/1/3/4/6/9/10/12）
  与数组族 `0x8003`/`0x8009` 的转串结果都经 `sub_41A6C0`（raw 25539-25593；在 `sub_42A420` 体内的调用点 raw
  36376/36421/36509/36530）做 ASCII→全角（本机 exe = 中文版 ⇒ GBK `0xA3xx`）⇒ 脚本给本条 int/float 操作数时得到的是全角串。
  `sub_42A420` 无 case 7/13（float 指针族）⇒ 抛 `Command_Type_Exception`（raw 36389-36392）；
  **`0x1B2` 不在此列**（走 `sub_41B9B0`，体零处调 `sub_41A6C0` ⇒ 半角）。」
- **`sub_41B640` 组**（0x2C5/0x2C6/0x1A6/0x2C7/0x2EC/0x6E/0x204）：同上，改成
  「…走 `sub_41B640`（体 raw 26249-26360；本条体内调用点 raw …）…在 `sub_41B640` 体内的调用点 raw 26331/26347…
  `sub_41B640` 对数组 tag（`0x8003` 族）与 float 指针族 7/13 **无 case ⇒ 抛**（raw 26355-26357）…」

逐条长度（现盘 → 打补丁后，字符）：0x192 147→556、0x193 131→546、0x194 186→601、0x195 220→635、
0x1A9 171→580、0x2C2 **0→419**、0x2C5 139→537、0x2C6 298→696、0x1A6 383→781、0x2C7 372→770、
0x2EC 68→466、0x6E 1140→1550、0x204 533→931。13/13 都满足 `新值.startswith(现盘原文)` ✓。
`0x2C2` 现盘 `semantics` 为空串 ⇒ 不补分隔符，追加段自成一格（它是"仅映射"条目，这句正好第一次说明它的串操作数原语）。

---

## 4. 故意没做 / 跳过的，以及为什么

1. **只改了简报列的 13 条 semantics；`sub_41B640` 的另外 15 条宿主没并进主计划**（改放 `plan-extra.json`）。
   理由：简报逐条点名了 13 条并要我"列出漏掉/跳过的及理由"。机械扫描的**完整**宿主集合是
   `sub_42A420` = 6 条、`sub_41B640` = **22 条**、`sub_41B9B0` = 1 条（= 29 条），
   所以剩下 15 条（`0x89/0x8D/0xA2/0xA3/0x140/0x144/0x14A/0x14C/0x196/0x1A5/0x221/0x2C8/0x2DE/0x2FE/0x351`）
   **同样成立**，只是不在简报清单里。可选项已备好、已 dry-run（254998 → 261012），父 agent 可自主合并。
   > ★注意：若合并 `plan-extra.json`，请**先**应用 `plan.json`（两者都 set `analysis/opcodes.json` 的 `semantics` 字段，
   > 但目标 opcode 不重叠 ⇒ 顺序其实无关；不过 `plan-extra.json` 的追加段同样是"读盘原文 + 追加"，
   > 所以两者都必须在**同一份现盘**上生成/应用）。
2. **`0x1B2` 没有加"全角化"那句** —— §6.3 的枚举里把它列进去了，但它按 §1/§3 的结论是**半角**（`sub_41B9B0` 体零处调 `sub_41A6C0`）。
   我把"（`0x1B2` 除外）"写成**其它 13 条句尾的一个分句**，而不是给 0x1B2 加句子。见 §5.8。
3. **`0x1C8`（`sub_433820`）没有加那句**：它是"专用 int→串"，体 raw 41990-42010 只有 `%d` 格式化 + SSO 组装，
   **不调** `sub_41A6C0` ⇒ 半角。它的 `semantics` 现盘已写"`sprintf("%d")`"，无需补。（`0x7D` 反而**该**补一句
   —— 它经 `sub_41A780` raw 25625 过全角化 —— 但简报的 13 条清单里没有 `0x7D`，我没扩面；见 §5.1。）
4. **没有改 `analysis/opcode-gaps.json` 的 `counts`**：`counts` 是 `build-opcode-gaps.mjs` 的唯一口径（写模式回填、
   只读模式把漂移报成 problem）⇒ 由父 agent 跑 `node scripts/build-opcode-gaps.mjs` 一次到位（沙箱已验证回填值：
   `entries 141 / partial 81 / implemented 32 / deferred 19 / engine-internal 9`）。手改会和工具打架。
5. **没有动 `docs-new/**`**（生成物）⇒ `opcode-gaps.md`、`opcode-table.md` 需要父 agent 重跑生成器（§0 的 ②）。
6. **没有动 `src/**`**：`src/vm/operand.ts` 的头注（line 196/198/222/227）与 doc §3 一样写着"共 30 条 / 其余 23 条"
   （实测 29 / 22）—— 这是**代码注释**，不在我的白名单。既然要改，建议顺手把 `toFullWidthNumber` `export` 出去
   让 `handlers/msgwin.ts` 的 `toFullWidth` 改成 import（§6.2 的建议），但那都是 `src/**` 的活。
7. **没有把 §2 的 emulator 侧新结论**（`readFloatOperand`/`writeFloatOperand` 的 float 指针族、`operand-missing-slot-zero`、
   `0x1B0` 方向修复本身）写进任何台账 —— 它们是 `src/**` 的实现事实，台账侧只落"缺口"（已落）。
8. **没有新建 `engine-capabilities.json` / `fields.json` 条目**：本轮结论全部是"某个 `sub_XXXXXX` 是什么"
   （第一层）与"某条 opcode 缺什么"（`opcode-gaps`），没有"引擎每帧/持续做某事"的常态行为，
   也没有新的字段/偏移（`sub_41A6C0` 用的 `dword_55C8E0/55CCF0/55D128` 是**调用方**的全局缓冲，
   已在 `0x41A6C0` 的 `notes` 里点明；若要进 `fields.json`，形态是 `scope=engine` 的 1024B 数字缓冲 ×3 ——
   建议先确认它们是否已在 `fields.json` 里再决定，我未擅自新增）。
9. **没有碰 `test/ptr.test.ts:110-113` 的注释**（§6.5 建议）与 `test/menu-string-key.test.ts:60`（§6.1，T-0158 进行中）
   —— 都在 `test/**`，不在白名单，且 T-0158 的 retarget 归属别人。

---

## 5. ★与 `tickets/T-0162/changes-c162.md` 不符之处（逐条给证据）

> 读体 = `engine/天结_unpacked.exe_utf8.c`；机械扫描 = 按 `//----- (ADDR)` 标记切函数体 +
> dispatch 表 `*(_DWORD *)(_this + 675996 + 4*op) = sub_X;` 反查 opcode（脚本见 `.tmp/scribe-e/probe7.mjs`/`probe8.mjs`）。

### 5.1 §3「调用点（全库 8 处，机械扫描）」只枚举了 7 处，漏 `raw 25625`（**会漏掉 `0x7D` 也全角化**）

实测 8 处：`12315` / **`25625`** / `26331` / `26347` / `36376` / `36421` / `36509` / `36530`。
§3 line 42-43 列的是 7 处（`26331/26347 + 36376/36421/36509/36530 + 12315`），§5 的注解更把它写成
"**6 处数值转串 + 1 处数字绘制**"（= 7 处）。漏掉的 `25625` 在 **`sub_41A780`** 体内（= `0x7D` 的十六进制原语）：

```
25595: //----- (0041A780) -----      ← 0x7D 的原语（dispatch: 0x7d → sub_41F580 → sub_41A780）
25624:   _itoa_s(*(_DWORD *)(v8 + 4 * v7), Buffer, 0x400u, 16);
25625:   return sub_41A6C0(Buffer);   ← ★全角化（第 8 个调用点）
```

⇒ 结论：**`0x7D` 的十六进制输出也过全角化**，而 §3 line 73 只说"`0x7D` 另走 `sub_41A780`（十六进制形态，
emulator 未实现 ⇒ 仍硬报错）"，没提这一点。我的落法：写进 `0x41A6C0` 的 `notes`（"调用点是 8 处…`sub_41A780`
（= `0x7D` 的十六进制形态）raw 25625"），`journal` 记差异。

### 5.2 §3「经三条原语读串的共 30 条」/「其余 **23** 条 = `sub_41B640`」计错；实测 **29 / 22**

- `sub_41B640`：**22 个宿主 opcode / 33 个调用点**
  = `0x6e 0x89 0x8d 0xa2 0xa3 0x140 0x144 0x14a 0x14c 0x196 0x1a5 0x1a6 0x204 0x221 0x2c5 0x2c6 0x2c7 0x2c8 0x2de 0x2ec 0x2fe 0x351`
- `sub_42A420`：**6 个**（`0x192 0x193 0x194 0x195 0x1a9 0x2c2`）✓ 与 §3 一致
- `sub_41B9B0`：**1 个**（`0x1b2`）✓ 与 §3 一致
- ⇒ 合计 **29**（不是 30），`sub_41B640` 是 **22**（不是 23）。

**§3 line 72 的枚举清单本身完全正确、无遗漏**（22 条逐条命中，且没有第 23 条宿主）—— 只是计数写成 23/30。
同源的错误也抄进了 emulator：`src/vm/operand.ts:196/198/222/227`（"共 30 条"、"其余 23 条"、"`sub_41B640`（23 条）"）。

### 5.3 §4 缺口① 的 `handlerBodyLine: 37985` 与现盘惯例差 1

现盘 132 条里 **129 条**的 `handlerBodyLine` = 该 handler 的 `//----- (ADDR)` **标记行**；
`sub_42D150` 的标记行 = **37984**（37985 是函数签名行）。例：`434` 的 `handlerBodyLine=36550` = `//----- (0042A9B0)`
在 raw 36550 ✓。我按惯例写 **37984**。（该字段的渲染值由 `scanEngineTable` 重算覆盖，真源里求一致。）

### 5.4 §4 缺口① 的 `note` 里带沿革话术（"★T-0162（2026-09-24）：**方向已修**…"）

按纪律③（沿革不许进被渲染字段）我把这句移进该条 `journal[]`，`note` 改写成**现在时**的体证描述。
另：§4 的 `missing[0].raw = "37991-37995"` 含 37991，而 37991 是 `_this[30*cur+95805] = 7`（arity 槽），
memcpy 的三个实参读取在 **37992-37994**、调用在 **37995**；作为"缺口证据区间"仍合法（单段 ✓），故原样保留。

### 5.5 §4 缺口② 给的 `raw: 36394-36411` 挂到 **434（0x1B2）** 上不成立

`36394-36411` 是 **`sub_42A420`** 体内的行区间；而 `0x1B2`（`sub_42A9B0`）走的是 **`sub_41B9B0`**，
`sub_42A420` 与它无关（机械扫描：`sub_42A420` 的宿主里没有 `0x1b2`）。⇒ 我给 434 用 **`26538-26547`**
（`sub_41B9B0` 里 `atoi → vector → [0]` 的那段；对应 `0x8005` case raw 26502-26509、`0x800B` case raw 26525-26532
共用的收尾 26538-26548）。402/403 才用 `36394-36411`。

### 5.6 §3 表 `sub_42A420` 列 `0x8003/0x8009` 的第二个行区间指错

原文："…否则 `_itoa_s(DEC(vec[0]))` **+全角**（**36524-36541 / 36510-36524**）"。
实测：`0x8003`（32771）走 else-分支 = **36524-36541** ✓；但 `0x8009`（32777）在 **36366-36385**（`case 32777` 起手，
其中 36375-36376 是 `sub_47D200` + `sub_41A6C0`）；**36510-36524 是 `LABEL_8/LABEL_9`**（字符串族的落点，不是数组族）。
（这条只影响 §3 表本身；我的 `missing[].what` 没引这两个区间。）

### 5.7 §3 tag 表把 `sub_41A6C0` 的字符域写小了一半

原文："`'0'..'9'` / `'A'..'Z'` / `'a'..'z'` ⇒ `{ 0xA3, c+0x80 }`"。体（raw 25560）：

```
25560:     else if ( v6 < 48 || v6 > 90 )      ← 条件取反后 = 48..90 全段走 A3 支
25562:       if ( v6 < 97 || v6 > 122 )        ← 第二支 = 97..122（a-z）
```

⇒ 第一支是 **0x30..0x5A 整段**（除 `0-9`/`A-Z` 外还含 `: ; < = > ? @ [ \ ] ^ _`），第二支是 `a`-`z` ✓。
对 emulator（`operand.ts:180` 的 `/[0-9A-Za-z+\-#]/`）而言这是**收窄**（更保守），已在缺口③的 `what` 里
保留了 §4 的原文措辞（"只转 `[0-9A-Za-z+-#]`、`.` 留半角"），此处仅登记口径差。

### 5.8 §6.3 的枚举把 `0x1B2` 列进去了，与 §1/§3 自己的结论矛盾

原文："`0x192`/`0x193`/`0x194`/`0x195`/`0x1A9`/`0x2C2`/`0x1B2`/`0x2C5`… 都值得补一句'数值操作数经
`sub_41A6C0` 全角化（**0x1B2 除外**）'" —— 括号里说除外，枚举里又列进去。⇒ 我按"除外"办：不给 `0x1B2` 加那句
（它的 `semantics` 现盘已写"`v2 = sub_41B9B0(_this, 1)`"）；"（0x1B2 除外）"作为其它 13 条句尾的分句出现。

### 5.9 §3「`0x1C8` … 全文只有 `sub_408050(Buffer,256,"%d",v)`」不准确（结论仍对）

体 raw 41990-42010 全文除 `sub_408050(Buffer, 256, "%d", v2)`（42000）外，还有 `_this[30*cur+95805]=5`（41998）、
`sub_41BF50(_this,2)`（41999）、`sub_40C210` 组装 SSO 串（42004）、`sub_433310(_this,1,v3)` 写 op1（42006）。
⇒ "全文只有"应改为"数值格式化只走 `%d`（**不调** `sub_41A6C0`）"；结论（`0x1C8` 半角）**正确** ✓。

### 5.10 §5 的 `0x41A6C0` 条目 `fields_used` 列的是**调用方**的缓冲

`dword_55C8E0` / `dword_55CCF0` / `dword_55D128` 在 `sub_41A6C0` 体（raw 25539-25593）内**零处引用**
（体里只有 `a1`、`GlobalAlloc/GlobalFree`、`sub_407F60`、`strlen`）；它们是各调用方持有的 1024B 数字缓冲
（`sub_41B640` 26309/26345、`sub_42A420` 36420/36474/…、`sub_41A780` 25624、`sub_4072F0`）。⇒ 我把
`0x41A6C0.fields_used` 写成 `[]`，并在 `notes` 里点明这三个缓冲属调用方。

### 5.11 §5 的 `0x42A420.fields_used: ["同 sub_41B640"]` 是**占位串**而不是字段清单

`functions.json` 的 `fields_used` 是"体里用到的语义字段"列表（552/592 条有）。我按体（36318-36544）填成：
帧池基址 `_this[30*cur+95781..95794]`、全局池 `_this[95744..95754]`、`this->key(_this[97059]，DEC/ENC)`、
`asc_5205D4`（raw 4438 = 全角 `０`）、`byte_51EA3C`（raw 4302 = 空串）、`dword_55D128`（本函数持有的数字缓冲）。
（`0x41B9B0` 的 §5 清单同样漏了 `_this[97059]`（key）与 `dword_55CCF0`；我**保留 §5 原文**，只在此登记。）

### 5.12 §5 的 `0x41B9B0.evidence = raw 26366-26548`：函数收尾在 **26549**

raw 26548 是 `LABEL_37` 的 `return result;`，26549 才是 `}`。我写 **26366-26549**（同 §5.3 的"完整体"口径）。

### 5.13 简报（不是 doc）说"`functions.json` 的条目**没有** `journal` 字段的先例"——**不成立**

实测 **36/592 条**带 `journal`，形式是 **`{at, what}`（2 键，没有 `field`）**，例 `0x42FBC0`：
`{"at":"2026-09","what":"★订正：原注记的体区间 raw 33570-33612 **有误**…"}`（沿革在该文件里还带「订正」二字，
因为 `functions.json` 没有渲染物、不在 I9 棘轮范围内）。⇒ 我把三条新条目的沿革写进 `journal[]`（严格采用
`{at, what}` 同形），**没有**塞进 `notes`。

### 5.14 简报/§4 缺口③ 的 emulator 侧描述已复核为真（非"不符"，是确认）

`src/vm/operand.ts:179-186` 的 `toFullWidthNumber` 确实只映射 `[0-9A-Za-z+\-#]`、`.` 留半角 ✓，
且它在 `operand.ts` 里是**模块私有**（未 `export`，与 §6.2"建议 export"一致）。

### 5.15 其它（读体确认，不是不符）

- §2 行 5「`LABEL_40` 只属于数组族」✓（`sub_42A420` 36396 `goto LABEL_40` = 36408-36411 空串）；
  「case 6/12（int 指针）没有任何 null 检查」✓（`sub_41B640` 26305-26307 / 26340-26343）。
- §3 的字节常量换算 ✓：`-21085`=`A3AD`、`-21597`=`A3AB`、`-23645`=`A3A3`、`-93`=0xA3、`(-127,72)`=`{0x81,0x48}`；
  `a0[2]="0"` raw **4399** ✓、`byte_51EA3C[4]={0,0,0,0}` raw **4302** ✓、`asc_5205D4[3]="０"` raw **4438** ✓。
- §2 新结论「`SETPOLYGON.txt:40/43` 两个操作数都是 float 指针」✓ 实测
  `40: i2d3 (local-float-ptr 1) (local-float-ptr 0) (local-float 0)`、`43: … (local-float 1)`。
- §3「`sub_41B9B0` 一次都不调 `sub_41A6C0`（raw 26366-26548 区间零命中）」✓（`sub_41A6C0` 的 8 个调用点无一在该区间）；
  「`sub_41B9B0` 唯一调用点是 `0x1B2`（raw 36556）」✓。
- §5 建议的 `0x41B640` 补 `notes` 的两句（数组 tag 无 case ⇒ default 抛；float 指针族 7/13 同样抛）✓ 与体相符
  （26355-26357 default；case 7/13 不存在）。

---

## 附录 A：机械扫描结果（`plan.json` 的追加段就是按这张表逐条生成的）

| 原语 | 宿主 opcode 数 | 调用点 | 体内是否调 `sub_41A6C0` |
|---|---|---|---|
| `sub_41B640`（raw 26249-26360） | **22** | 33 | 是（26331/26347；数值族 tag 0/1/3/4/6/9/10/12） |
| `sub_42A420`（raw 36318-36544） | **6** | 11 | 是（36376/36421/36509/36530；数值族 + 数组 0x8003/0x8009） |
| `sub_41B9B0`（raw 26366-26549） | **1**（`0x1B2`） | 1（36556） | **否** ⇒ 半角 |
| `sub_41A780`（raw 25595-25626） | **1**（`0x7D`） | 2（28750/28757，宿主 `sub_41F580`） | 是（25625；`_itoa_s(...,16)` 十六进制） |

`sub_41A6C0` 的 8 个调用点 → 宿主函数：
`12315→sub_4072F0`｜`25625→sub_41A780`｜`26331,26347→sub_41B640`｜`36376,36421,36509,36530→sub_42A420`。

## 附录 B：`.tmp/scribe-e/` 里的可复跑脚本

| 脚本 | 作用 |
|---|---|
| `build-plan.mjs` | 从现盘生成 `plan.json`/`plan-extra.json`/`patches.json`/`patches-optional.json`/`bases.json`/`snapshot.json`（含 §2.5 的全部自检） |
| `check-fresh.mjs` | 校验计划所依据的 28 条 semantics 基线、434 前提、functions.json 的 4 个锚点 —— 过期即 exit 1 |
| `verify-sandbox.mjs` | 在 `sandbox/`（cwd）里跑生成器/棘轮/渲染物的端到端复核 |
| `probe{1..13}.mjs` / `dump-final.mjs` | 读盘取证脚本（原语调用点、dispatch 反查、sentinel 定义、惯例统计、diff 输出） |
