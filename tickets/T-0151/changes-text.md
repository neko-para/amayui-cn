# T-0151 · `src/text/**` 子集变更记录（owner：text 子集 agent）

> 本文件是 **`src/text/**` 那 6 条**（审计工作清单 `app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md`
> 的 T-0151 节里锚点为 `src/text/*` 的 6 行）的变更记录。**其余 70+ 条归另一位 owner**，
> 那份记录在 `changes.md`；本文件与它不重叠（也不改名、不合并）。
>
> 纪律：每条 = 对象/现象 → 引擎 raw 证据（**逐行自己读过函数体**，不引用报告结论）→ 改了什么 →
> 守卫名 → 命令与结果 → 未做项。末尾「台账待应用」节列出需要主 agent 应用到 `analysis/*.json`
> 的精确内容（我没有写 `analysis/**` 的权限）。
>
> 未触碰：`src/vm/**`、`analysis/**`、`src/tools/**`、`test/no-dead-writes.test.ts`、
> `test/opcode-gaps*.test.ts`、`test/recall-page-0x1d1.test.ts`、`test/op-1d0-1d1-text-metrics.test.ts`、
> `tickets/T-0151/{ticket.json,changes.md,notes.md}`。

---

## 0. 六条一览

| # | sev | 对象 | kind | 状态 | 落点 |
|---|---|---|---|---|---|
| 1 | P2 | `lazy-gdi-font-set` | missing-behavior | **修（数据 + 纯算术 + 显式缺口登记）** | `src/text/fontSet.ts` |
| 2 | P3 | `text-font-rebuild-cascade` | overreach | **修（台账内容，交主 agent 应用）** | `changes-text.md` §2 + §7-A |
| 3 | P2 | `text-font-rebuild-cascade` | stale-ledger | **修（台账内容，交主 agent 应用）** | `changes-text.md` §3 + §7-A |
| 4 | P3 | `0x2c7` | missing-branch | **修** | `src/text/sjis.ts` |
| 5a | P3 | `0x2c8` | missing-branch | **修** | `src/text/sjis.ts` |
| 5b | P3 | `0x2c8` | missing-branch | **登记为不复制**（判据见 §5b） | `src/text/sjis.ts` |
| 6 | P3 | `0x204` | approximation | **修（纯函数侧）；宿主接线未做（越界文件）** | `src/text/layout.ts` |

改动文件（6 个，全部在允许范围内）：

- `app/amayui-emulator/src/text/sjis.ts`
- `app/amayui-emulator/src/text/layout.ts`
- `app/amayui-emulator/src/text/fontSet.ts`
- `app/amayui-emulator/test/text-sjis-limits.test.ts`（新建）
- `app/amayui-emulator/test/text-204-blank-extent.test.ts`（新建）
- `app/amayui-emulator/test/text-font-rebuild-set.test.ts`（新建）

---

## 1. `lazy-gdi-font-set` / missing-behavior（P2）—— 引擎重建的句柄组与度量缓冲

### 现象（审计原文，`findings-final.json`）

> 引擎在 `sub_459F40` 里重建的不只是 HFONT，还有字形度量/位图缓冲与竖排两面（`lfEscapement=1800`）；
> 重写侧只做 `(family,weight,size)→文件` 的选择，量宽与缩放修正整块缺失。

### 引擎证据（自己逐行读的体）

`sub_459F40` = raw **70940-71188**；`sub_45A6E0` = raw **71192-71273**。

| 事实 | raw |
|---|---|
| 入口守卫 `if (!*(_BYTE *)(_this + 1260)) return;`（主面名为空 ⇒ 整个重建不发生） | 70984 |
| `Font+1232 = Font+101972 = -Font+201684`（两套 LOGFONTA 模板的 lfHeight） | 70987-70989 |
| `sub_456C90(Font, v34, Font+201708, Font+201688)`：参考字度量 + 建 `Font+201784`（面名 `asc_52686C = "ＭＳ ゴシック"`，raw 4671） | 70990 / 68678-68722 |
| 注音两块缓冲 `Font+102092`/`Font+102096` 与字节数 `Font+102100`：`v11 = abs32(4*(Font+101972/4)+4)`、`new[](4*v11*v11)` | 71024-71035 |
| `Font+101852 = CreateFontIndirectA(Font+101972)` + `GetTextMetricsA(HDC, Font+101860)`（★**字形度量面**） | 71041-71045 |
| `Font+1092 = SelectObject(HDC, Font+1084)`（把主面留在度量 IC 上） | 71187 |
| `v35 = Font+1232` 副本、面名 → `"AGE Extend"`；`v38 = Font+101972` 副本、面名 → `"@AGE Extend"` | 71096-71099 |
| 主套两块字形位图缓冲 `Font+1408`/`Font+1412`（`16*(h/4-1)^2`）与 `Font+1416`（字节数） | 71134-71141 |
| `DeleteObject` ×10：`101852`(71039) / `1084` / `1100` / `218624` / `235068` / `235072` / `235076` / `235080` / `235100` / `235104` | 71144-71169 |
| `CreateFontIndirectA` **×10**（→ 见下表） | 71170-71187 |
| ★竖排两面：`v38.lfEscapement = v38.lfOrientation = 1800`（71178-71179）、`v39.* = 1800`（71180-71181）后各建一次 → `Font+235100`(71182) / `Font+235104`(71183) | 71178-71186 |
| 注音套入口守卫 `if (!*(_BYTE *)(_this + 1320)) return;` | 71212 |
| 注音套 `DeleteObject` ×4（`1096`/`218568`/`101856`/`218628`）+ `CreateFontIndirectA` ×4 | 71214-71272 |
| 量宽用哪支句柄：`if (*(_DWORD *)(_this + 201680)) SelectObject(Font+1108, Font+201784);` 否则用当时已选中的 | 10733-10737 |
| 缩放修正：`lf.lfHeight = (int)(Font+1232 * Font+218596 + 0.5)`（`dbl_51D7F8 = 0.5`，raw 4197）、`lfWidth = lfHeight/2`、`lfWidth = (int)(lfWidth / Font+218596 * Font+218592)` | 71055-71060 / 71088-71090 / 71110-71131 / 71240-71254 |
| `Font+201680` 全库**只有两处写**、都是 `= 0`（`Initialize`）⇒ 本 build 恒 0、`<= 1` 那道门恒真 | 78769 / 78895 |

`sub_459F40` 建的 10 支主套句柄（槽号 / 模板 / 面名 / 尺寸 / 1800）：

| 槽 | 模板 | 面名 | 尺寸 | 1800 | raw |
|---|---|---|---|---|---|
| `Font+101852` | `@main`（`Font+101972`） | `@`+主面名 | base | – | 71042 |
| `Font+1084` | `main`（`Font+1232`） | 主面名 | base | – | 71171 |
| `Font+1100` | `main` | 主面名 | scaled | – | 71172 |
| `Font+218624` | `@main` | `@`+主面名 | scaled | – | 71173 |
| `Font+235068` | `main` | `AGE Extend` | base | – | 71174 |
| `Font+235076` | `@main` | `@AGE Extend` | base | – | 71175 |
| `Font+235072` | `main` | `AGE Extend` | scaled | – | 71176 |
| `Font+235080` | `@main` | `@AGE Extend` | scaled | – | 71177 |
| `Font+235100` | `@main` | `@AGE Extend` | base | ★ | 71182 |
| `Font+235104` | `@main` | `@AGE Extend` | scaled | ★ | 71183 |

注音套 4 支：`Font+1096`（ruby/base, 71229）、`Font+218568`（ruby/scaled, 71265）、
`Font+218628`（`@ruby`/scaled, 71266）、`Font+101856`（`@ruby`/base, 71269）。

### 改了什么（`src/text/fontSet.ts`）

新增一节「引擎 `sub_459F40` / `sub_45A6E0` 建的 GDI 句柄组与度量缓冲」，全部是**可断言的纯数据/纯算术**：

| 导出 | 内容 |
|---|---|
| `GdiFaceSlot` / `GDI_FACE_REBUILD` | 上表逐格落成数据（`slot`/`raw`/`template`/`face`/`size`/`rotated1800`/`role`），主套 10 + 注音 4 |
| `AGE_EXTEND_FACES` | `['AGE Extend', '@AGE Extend']`（`aAgeExtend[]` raw 4455 / `aAgeExtend_0[]` raw 4678），并写明引擎在 `0x1A5`/`0x2FE` 里对它**豁免白名单警告**（raw 41385 / 41613） |
| `glyphBitmapBufferBytes(stage, size)` | 引擎两族字形位图缓冲的**字节数**（主套 `16(h/4−1)²`、注音 `4(4(h/4)+4)²`，各两块）——即"位图缓冲"那一半 |
| `aspectScaledLfHeight(lfHeight, scale)` | raw 71055 的 `(int)(h × 218596 + 0.5)`；★C 向零截断 ⇒ **scale=1 也不是恒等**（−30 → −29） |
| `aspectCorrectedLfWidth(w, scale, base)` | raw 71088 的纵横比修正 |
| `metricFaceSlot(fontMetricsFlag)` | ★审计点名的"量宽用哪个句柄"这一关键格：非 0 ⇒ `Font+201784`，否则 `Font+101852` |
| `GDI_FACE_REBUILD_NOT_MODELED` | 6 条**有据缺口**（每条 `raw`/`what`/`why`/`recheck`）：TEXTMETRICA ×2、字形位图缓冲 ×2、缩放因子对、`AGE Extend` 落地字族 |

**判据（为什么这样切）**：引擎这一节里"同构"的部分（面名 + 字号/字重/竖排参数 → 用哪支面、量宽用哪支、
缓冲多大、缩放怎么算）可以照抄成数据/纯函数；"不同构"的部分是 GDI 设备资源（`TEXTMETRICA` 快照、
`GetGlyphOutline` 输出缓冲、位图掩码位移表 `sub_4745A0` raw 89204-89498），浏览器宿主**结构上没有对应物**
⇒ 登记为缺口并写 `recheck`，而不是编一个等价物。`AGE Extend` 的落地字族**未证**（GDI 找不到该面会静默
替换默认字体，体里读不出"渲染成什么"）⇒ 保持 `resolveFace` 回退 + `unknown` 日志，登记缺口。

### 守卫

- `test/text-font-rebuild-set.test.ts`（新建，7 例）：
  - `★主套 = CreateFontIndirectA **10** 次（不是台账旧写的 ×8）…`
  - `★竖排两面：只有 Font+235100 / Font+235104 带 lfEscapement=1800，且都由 "\@AGE Extend" 面派生`
  - `★面名替换：主套有两族派生面 "AGE Extend"（v35/v37）与 "@AGE Extend"（v38/v39）…`
  - `★量宽用哪支句柄（审计点名的关键格）：Font+201680 非 0 ⇒ Font+201784，否则 Font+101852`
  - `★字形位图缓冲尺寸（纯算术，冻结字面量）：主套 16(h/4−1)²、注音 4(4·(h/4)+4)²，各两块`
  - `★缩放修正（审计说"整块缺失"的那部分）：lfHeight 加 0.5 后向零截断；lfWidth 按 218592/218596 纵横比修正`
  - `★缺口登记：重写侧没有等价物的那几格必须逐条写明（不许沉默掩盖）`

### 红→绿

```
# 红（实现前：模块根本没有这一节 —— 审计说的"整块缺失"就是这个状态）
$ node --import tsx --test test/text-font-rebuild-set.test.ts
SyntaxError: The requested module '../src/text/fontSet.js' does not provide an export named 'AGE_EXTEND_FACES'
✖ test\text-font-rebuild-set.test.ts (266.4963ms)
ℹ tests 1  ℹ pass 0  ℹ fail 1

# 红（中途：先按**旧口径**把模型建出来 —— 只列 7 支 HFONT、无 1800 面、metricFaceSlot 指 1084、
#     位图缓冲按 size*16 拍、缩放修正当恒等 —— 用来证明守卫真的能分辨"照抄旧口径"）
✖ ★主套 = CreateFontIndirectA **10** 次…            AssertionError: 7 !== 10
✖ ★竖排两面：只有 Font+235100 / Font+235104…        AssertionError: raw 71178-71186
✖ ★面名替换：主套有两族派生面…
✖ ★量宽用哪支句柄…
✖ ★字形位图缓冲尺寸…
✖ ★缩放修正…
✖ ★缺口登记…
ℹ tests 7  ℹ pass 0  ℹ fail 7

# 绿
$ node --import tsx --test test/text-font-rebuild-set.test.ts
✔ 7 例全绿   ℹ tests 7  ℹ pass 7  ℹ fail 0
```

### 未做项

- 没有给宿主加"按 `GDI_FACE_REBUILD` 真建 10+4 支字体"的通路：`renderer/pixi/textLayer.ts` 是
  **别的 owner 的文件**（`src/renderer/**` 不在我的范围），且浏览器没有"句柄"概念 —— 数据表的作用是
  让"缺哪一支"可核对 + 给后续接线当规格，不是模仿 GDI。
- `TEXTMETRICA` / 位图缓冲 / `sub_4745A0` 位深位移表 **不复制**（理由与 `recheck` 见
  `GDI_FACE_REBUILD_NOT_MODELED`）。
- `AGE Extend` 落地字族未定（不许猜成 `Amayui CN`；保持回退 + `unknown`）。

---

## 2. `text-font-rebuild-cascade` / overreach（P3）—— `engine.fns` 的"并列级联"没有调用关系证据

### 现象（审计原文）

> engine.fns 把 `sub_45A6E0` 与 `sub_4185F0`/`sub_418680`/`sub_4328F0`/`sub_432DD0`/`sub_428990`
> 并列为"字体参数 → 句柄重建级联"，但 raw 70940-71273 区间里只有 `sub_459F40`（70940）与
> `sub_45A6E0`（71192）；其余四个函数的体不在该区间，条目没有给出它们与级联的调用关系证据。

### 自己是读出来的调用关系（每条都给了调用点 raw）

| 成员 | 体 raw | 与级联的关系（**调用点** raw） |
|---|---|---|
| `sub_459F40` | 70940-71188 | 主套重建体（**级联的汇**） |
| `sub_45A6E0` | 71192-71273 | 注音套重建体（**级联的汇**） |
| `sub_4185F0`（0x75 主字号） | 24058-24082 | → `sub_459F40`（**24081**） |
| `sub_418680`（0x197 注音字号） | 24085-24154 | → `sub_45A6E0`（**24153**） |
| `sub_4328F0`（0x1A5 主面名） | 41345-41566 | → `sub_459F40`（**41403**）；并调 `sub_428990`（**41385**） |
| `sub_432DD0`（0x2FE 注音面名） | 41569-41800 | → `sub_45A6E0`（**41631**）；并调 `sub_428990`（**41613**） |
| `sub_428990`（可选字体一览线性查名） | 35125-35168 | **被调**方，不是并列成员：调用点 41385 / 41613（白名单警告判据） |
| 0x2BD `sub_426200` | 33384-33402 | → `sub_459F40`（**33401**） |
| 0x2BE `sub_426260` | 33404-33422 | → `sub_45A6E0`（**33421**） |
| 0x2DB `sub_426500` | 33523-33532 | 写 `_this[71744]`（`font_metrics_mode`）→ `sub_459F40`（**33531**） |

⇒ **不是"6 个函数并列"，而是"5 个参数 setter + 1 个查名被调 → 2 个重建体"**。
`engine.raw` 的 `70940-71273` 本身**没错**（正是两个重建体的完整区间）—— 错的是"把它们并列却不给方向"。

### 改了什么

**代码没改**（这条是台账表述问题）。精确的台账修正内容见 §7-A.1。

### 守卫

无（台账条目表述；由 `test/capability-ledger.test.ts` 与 `capabilities.js --validate` 把关）。
本条的"可核对性"由 §7-A.1 里逐条附的**调用点 raw 行号**承担。

---

## 3. `text-font-rebuild-cascade` / stale-ledger（P2）—— guard/note 的行号锚点指错

### 现象（审计原文）

> guard 与 note 的行号锚点指向别的东西：note 的 `msgwin.ts:1146-1189` 是窗对象 range/`0x25D`/`pre48`
> 一族，`test/text-layout.test.ts:248-264` 是逐字显现游标用例 —— 真正的 op 体/派发/断言在
> :1493-1554、:1796-1850、config1-chain.test.ts:92-94。

### 我自己核的结果（**行号已变**，故另给稳定锚点）

- `src/vm/handlers/msgwin.ts` 现在（本 agent 读时的磁盘状态）：
  - `op_msgwin_obj_range`（0x213）`:1466`、`op_msgwin_obj_range2`（0x25D）`:1477`、
    `op_msgwin_obj_pre48`（0x7A）`:1508` ⇒ **审计说它指错了，成立**：`:1146-1189` 是窗对象 range 一族
    （现在漂到了 :1466-1525），与字号/字重/面名无关。
  - 7 条字体参数面的 op 体（**稳定锚点 = 函数名**）：
    `op_set_main_size`(0x75)`:1816`、`op_set_ruby_size`(0x197)`:1825`、`op_set_main_face`(0x1A5)`:1834`、
    `op_set_ruby_face`(0x2FE)`:1842`、`op_set_main_bold`(0x2BD)`:1850`、`op_set_ruby_bold`(0x2BE)`:1859`；
    `0x2DB` **没有专用 handler**：走字段存储计划 `src/vm/operandPlan.ts` 的 `declarePlan(0x2db, …)`:401
    \+ 字段 id `src/vm/engineFieldIds.ts`:`font_metrics_mode`（0/1/2，`_this[71744]`）:209。
  - 派发表：`export const MSGWIN_OPS` `:2136`。
  - ⇒ 审计写的 `:1493-1554` / `:1796-1850` **在今天的磁盘上已过期**（文件因其它票的工作增长）；
    这就是为什么本条修正值一律给**标识符锚点**、行号只作参考。
- `test/text-layout.test.ts`：`:246-253` = `逐字显现游标：按跨行累计的字形序号决定每行画几个`；
  `:255-270` = `面名映射：剥竖排 "@" 前缀 + 未知面名回退并标记`。整份文件里**没有任何**
  0x75/0x197/0x1A5/0x2BD/0x2BE/0x2FE/0x2DB 的 handler 断言 ⇒ 审计说 guard 指错文件，成立。
- **真正的断言**：`test/config1-chain.test.ts:93-94`
  （`assert.equal(w.mainSize, 30)` / `assert.equal(w.rubySize, 10)`），
  所属用例名 = `★CONFIG1 的 ADV 样例窗口：排版结果进入渲染模型（一行横排 / 30px / 注音 10px）`（`:86`）。
  该文件 pragma = `@tier T1 @kind core @subsystem config`。

### 改了什么

**代码没改**。精确的台账修正内容见 §7-A.1（`emulator.guard` 改成带用例名的 guard spec）。

### 守卫

`test/config1-chain.test.ts#排版结果进入渲染模型`（真实存在的用例名片段；`checkGuard` 会核字面串）。

---

## 4. `0x2c7` / missing-branch（P3）—— 负起点的错误路径缺失

### 现象（审计原文）

> 引擎只把 `v3 >= v13 || v4 <= 0` 判成空串（`v3` 是 signed），`v3 < 0` 且 `v4 > 0` 时会继续执行到
> `sub_40C120`，那里的 `if ( v6 < a3 )` 是**无符号**比较 ⇒ 必然抛 `std::out_of_range`；
> emulator 在 `sjisSubstr` 里把 `start < 0` 与 `start >= total` 合并成静默空串。

### 引擎证据（自己逐行读过）

```
sub_433FD0   raw 42260-42376
  raw 42299   if ( v3 >= v13 || v4 <= 0 )      // v3 = op3(signed int v3)，v13 = strlen(signed int)
  raw 42319   if ( v3 > 0 ) { …起点对齐修正… }  // v3 < 0 ⇒ 跳过（不做修正）
  raw 42360   v12 = sub_429F60((const void **)v19, (const void **)v16, v15, v14);  // v15 = v3
sub_429F60   raw 36146-36153
  raw 36151   sub_40C120(a2, _this, a3, a4);   // 形参：a3 = unsigned int
sub_40C120   raw 16209-16273
  raw 16220   v6 = (unsigned int)a2[4];        // = 源串长度（unsigned）
  raw 16221   if ( v6 < a3 ) std___Xout_of_range(aInvalidStringP);   // ★负起点 → 0xFFFFFFFF ⇒ 必抛
```

`v4 <= 0`（长度非正）**先**成立 ⇒ 写空串、不抛（raw 42299 的短路顺序，42301-42315 写空串）。

### 改了什么（`src/text/sjis.ts`）

- 新增 `class SjisSubstrOutOfRangeError extends RangeError`（带 `start`/`len`/`srcBytes`，错误串里点名
  `0x2c7` 与 raw 16221）。
- `sjisSubstr`：判据从 `if (start >= total || start < 0 || len <= 0) return { text: '' }`
  拆成 **`len <= 0` → 空串 → `start < 0` → throw → `start >= total` → 空串**（顺序 = 引擎的短路顺序）。

### 守卫

`test/text-sjis-limits.test.ts` 的
`★0x2C7 负起点：`start < 0 && len > 0` 必须走引擎的 std::out_of_range 路径（修前静默返回空串）` 与
`★0x2C7 负起点：`len <= 0` 仍走空串（引擎的 `v4 <= 0` 判据在负起点之前，不许把两者合并成抛）`。

### 语料风险 = 0

`src/*.txt` 全 941 个脚本里 `i2c7` 只有 **3 行**（`Select-String -Path src/*.txt -Pattern '^\s*i2c7\b'`），
op3 全是立即正数 `0` / `2` / `5` ⇒ 新抛错路径在语料里不可达（不会把正常脚本打断）。

---

## 5a. `0x2c8` / missing-branch（P3）—— op2 的 256 字节栈缓冲上限

### 现象（审计原文）

> 引擎把 op2 经 `strcpy_s(Destination, 0x100u, v3)` 拷进 256 字节栈缓冲——而 `strcpy_s` 对
> 『会发生截断』（源串含结尾 0 超过 0x100）是**运行时约束违例**：调用 invalid parameter handler，
> MSVC 默认即终止/快速失败，**不是静默截成 255 字节**。…… emulator 既无 255 字节上限也无该失败路径。

### 引擎证据

```
sub_434260   raw 42379-42457
  raw 42394   char Destination[256];                        // BYREF 栈数组
  raw 42399   v2 = (unsigned __int8 *)Destination;
  raw 42401   strcpy_s(Destination, 0x100u, v3);            // ★约束违例点（在下面所有读之前）
  raw 42404   v11 = _mbstrlen(v4);                          // 重新取的**完整** op2（与缓冲无关）
  raw 42405   v9 = sub_41BF50(_this, 3);                    // op3
  raw 42406   v5 = v9 + sub_41BF50(_this, 4);               // op4
```

⇒ 上限钉在 `strlen(op2) <= 255`（255 字节 + 结尾 0 = 0x100 恰好放得下；256 字节需 0x101 ⇒ 违例），
且因为 `strcpy_s` 在**读 op3/op4 之前**，超长时"请求长度为 0/越界"也照样硬失败。

### 改了什么（`src/text/sjis.ts`）

- 新增 `export const SJIS_SUBSTR_CHARS_BUFFER = 256` 与
  `class SjisSubstrSourceTooLongError extends RangeError`（错误串点名 `0x2c8` 与 raw 42401）。
- `sjisSubstrChars` 开头按 `sjisByteLength(src) > 255` 抛（用 `layout.ts` 的 `sjisByteLength` =
  引擎 `strlen` 的等价物：ASCII/半角片假名 1 字节、其余 2 字节）。

### 守卫

`test/text-sjis-limits.test.ts` 的
`★0x2C8 缓冲上限：op2 的**字节长 > 255** 必须硬失败（引擎 strcpy_s(Destination, 0x100, op2) 的约束违例）`
（含边界：255 OK / 256 抛；全角 127 字 OK / 128 字抛；半角片假名 255 OK / 256 抛；"超长 + 越界请求也抛"）。

### 语料风险 = 0

`i2c8` 在 941 个脚本里 **0 处**（`(Select-String -Path src/*.txt -Pattern '^\s*i2c8\b').Count` = 0）。

---

## 5b. `0x2c8` / missing-branch（P3）—— 缓冲下界外的那一读：**登记为不复制**

### 现象（审计原文）

> 引擎在 256 字节 `Destination` 缓冲之外还有一次**缓冲下界外的读**：逐字节循环的第一步就对 `v2[-1]`
> 调 `_mbbtype`（`_mbbtype(*(v2 - 1), 0) == 1 && _mbbtype(*v2, 1) == 2`），而 `v2` 初值就是 `Destination`
> 首地址，此处读的是栈上数组前一个字节（未定义值）。

### 引擎证据

```
sub_434260
  raw 42399   v2 = (unsigned __int8 *)Destination;
  raw 42418   do {
  raw 42420     if ( _mbbtype(*v2, 0) == 1 && _mbbtype(v2[1], 1) == 2
                   || _mbbtype(*(v2 - 1), 0) == 1 && _mbbtype(*v2, 1) == 2 )   // ★第一轮 v2-1 = Destination[-1]
```

### 判据：为什么"按体照抄"在这里做不到，而不是偷懒

1. **值未定义**：`Destination[-1]` 是 `[esp+3Ch]` 之前的栈字节（上层调用/上一轮的残留），
   没有确定值 ⇒ 复刻它等于**编一个字节**，违反"不许猜"。同理，`*(v2-n)` 的字节序依赖这个值。
2. **它的语义后果可界定**：只有当那个字节恰是 SJIS 前导字节（0x81-0x9F / 0xE0-0xFC）**且**
   `*v2` 恰是合法续字节时，引擎才会把**首字符**判成"双字节字的后半字节"从而少切一个字；
   `v2` 之后各轮 `v2-1` 都在缓冲内、是**已建模**的部分（`v2` 总落在字符边界上 ⇒ 该子句对
   良构 SJIS 串恒假，即第一轮之外它实际是死分支）。emulator 的 `[...src]` 逐字符模型与该子句
   在"第一轮、那个字节不是前导字节"时**逐字一致**。
3. **可观测性为零**：`i2c8` 语料 0 处（`src/*.txt` 941 个脚本里 `^\s*i2c8\b` 命中 0）。

⇒ 结论：**登记为不复制**（`SJIS_SUBSTR_CHARS_NOT_COPIED`，1 条，`raw: '42420'`），带 `recheck`：
"当语料出现 `i2c8`，或 E4 真机抓到 op2 首字符被吞/切点整体前移一格时，再回来定那个字节"。
**不**加 `phantomLeadByte` 之类的宿主缝：没有消费者、也没有可复现输入，加了就是死代码。

### 改了什么（`src/text/sjis.ts`）

- 新增 `export const SJIS_SUBSTR_CHARS_NOT_COPIED: readonly { raw; what; why; recheck }[]`（1 条）。
- `sjisSubstrChars` 的 jsdoc 增补缓冲上限与"下界外读不复制"两段（指向上面的常量）。

### 守卫

`test/text-sjis-limits.test.ts` 的
`★0x2C8 下界外读：登记为不复制（未定义栈字节），但建模的那条子句不许被顺手删掉`
—— 断言登记表锚点/理由/`recheck`，**并**断言建模子句的行为后果（首字符是独立全角字，永不被吞）。

---

## 6. `0x204` / approximation（P3）—— 直绘路径的空白字前进量

### 现象（审计原文）

> 引擎在 `set:BlankExtentMode == 1` 且 `Font+201680 <= 1` 时对全角空格 `0x8140` / 半角空格 `0x20`
> 调 `sub_404EE0` 逐字 GDI 量宽，emulator 的 `drawStringGlyphs` 一律用 `advance(ch, size)`
> （纯算术网格）⇒ 该模式下空格前进量与串落点整段偏移。

### 引擎证据（自己逐行读过；这里**修正了审计摘要的一处**）

```
0x204 → sub_423390 → sub_456710（raw 68470）
  raw 68490-68493  if (*(_DWORD *)(_this + 1372)) sub_471180(_this, a2, a4, v8, Font+1236, tm.tmAscent, a3, Font+1372);
                   else                          sub_46F2D0(_this, a2, a4, v8, Font+1236, tm.tmAscent, a3);

sub_471180（描边档位 1/2/3）
  raw 87255-87268  逐字节取字，空白字（32 / 0x8140 / <0x20）⇒ LABEL_26
  raw 87269-87272  if ( *(int *)(_this + 201680) <= 1 && GetConfig("set:BlankExtentMode") == 1 )
  raw 87274-87275    { sub_404EE0(_this, &psizl, v16); cx = psizl.cx; }
  raw 87279        else cx = *(_DWORD *)(_this + 201684) / (((unsigned __int16)v16 < 0x100u) + 1);
  raw 87289-87291  若 Font+218520 非 0：cx = (int)(Font+218592 * cx + 0.5)

sub_46F2D0（描边档位 0）
  raw 86057-86059  if ( GetConfig("set:BlankExtentMode") == 1 )      // ★没有 Font+201680 那道门
  raw 86061-86062    { sub_404EE0(_this, &psizl, v14); cx = psizl.cx; }
  raw 86066        else cx = (__int16)(_this + 201704) / (((unsigned __int16)v14 < 0x100u) + 1);
```

★**两条与审计摘要的差异**（都以体为准）：

1. 审计摘要只提了 `Font+201680 <= 1` 那道门；体里**只有描边路径（`sub_471180` raw 87269）有它**，
   档位 0 那条（`sub_46F2D0` raw 86057）**没有** ⇒ 两条路要分开。
2. 直绘路径的空白字**一律取 `psizl.cx`（全角也取 cx）**，与消息窗排版路径（raw 85129-85132 全角取
   `psizl.cy`）**口径不同** ⇒ 照搬 `layout.ts` 的 `blankAdvance`（全角取 cy）会把全角空格算错。

另：`Font+201680` 全库只有 raw 78769 / 78895 两处写、都是 `= 0` ⇒ 那道门在本 build 恒真。

### 改了什么（`src/text/layout.ts`）

- `BlankExtent` 增可选字段 `fontMetricsFlag?: number`（引擎 `Font+201680`，= `Font` 对象 +0x313D0；
  **不是** `Engine+0x46100` 的 `font_metrics_mode`）。省略 = 0；doc 里写明"全库只有两处写、都 0"。
- 新增 `drawStringBlankAdvance(ch, size, outlineMode, blank)`：按体实现两条路（档位 0 无 `Font+201680` 门；
  档位 ≠ 0 有该门）与"mode 1 取 `cx`（全角也是 `cx`）"。
- 新增 `drawStringAdvance(ch, size, outlineMode, blank)`：非空白字仍走网格（引擎那条走字形外框，
  属另一条未建模项），空白字走上面那条。
- `drawStringGlyphs(..., blank?)` 增第 8 个**可选**参（旧 7 参调用逐字不变），推进改用 `drawStringAdvance`。
- 文件尾「缺口」节更新：`0x204` 纯函数侧已补齐、**宿主接线未做**（`renderer/pixi/textureCache.ts:375` 的
  调用点仍在 7 个实参、`native.drawString` 参数面没有 `blankExtent` —— 两者都不在我的范围）；
  另补「量宽用哪支句柄已查清（`fontSet.metricFaceSlot`）」「缩放修正未建模（`aspectCorrectedLfWidth`）」。

### 守卫

`test/text-204-blank-extent.test.ts`（新建，5 例）：

- `★mode 1：直绘空白字前进量 = 量宽的 **cx**（全角也取 cx，不许照搬消息窗的 cy）`
- `★mode 0 / 未接线：空白字仍走字号网格 …，且**一次都不去量**`
- ``★`Font+201680 <= 1` 这道额外门只在描边路径上（raw 87269），档位 0 那条没有（raw 86057）``
- ``★接线：`drawStringGlyphs` 的落点随空白字前进量整段平移（mode 1 vs mode 0 可分辨）``
- `★无度量来源时显式回退到网格（回退可见，而不是编一个数）`

用"`cx = 44` / `cy = 99` 故意差得远"的合成度量，保证"取 cx 还是取 cy"一望可知。

### 红→绿

```
# 红（实现前 —— 把 0x204 也照搬消息窗的 blankAdvance）
$ node --import tsx --test test/text-204-blank-extent.test.ts
✖ ★mode 1：直绘空白字前进量 = 量宽的 **cx**…
    AssertionError: 全角空格 ⇒ cx=44（不是 cy=99）
    actual: { value: 99, measured: true }   expected: { value: 44, measured: true }
✖ ★`Font+201680 <= 1` 这道额外门只在描边路径上（raw 87269）…
✖ ★接线：`drawStringGlyphs` 的落点随空白字前进量整段平移…
ℹ tests 5  ℹ pass 2  ℹ fail 3

# 绿
$ node --import tsx --test test/text-204-blank-extent.test.ts
✔ 5 例全绿   ℹ tests 5  ℹ pass 5  ℹ fail 0
```

### 未做项

- **宿主接线**（`renderer/pixi/textureCache.ts` 与 `vm/native.ts` 的参数面）—— 越界文件，未动；
  已写进 `layout.ts` 文件尾缺口节，并在 §7-A.3 提示台账。
- `(int16)Font+201704`（档位 0 的 mode-0 除数，由 `sub_456C90` raw 68697-68718 用参考字 `0x8C83`
  量出来的度量字）未建模 ⇒ 统一用 `size`（标准字号下相等）；已写进 `drawStringBlankAdvance` 的 doc。
- `Font+218520` 的后置缩放（raw 87289-87291）未建模 ⇒ 登记在 `fontSet.GDI_FACE_REBUILD_NOT_MODELED`
  的 `71028` 条。

---

## 7. 验证（命令 + 实测结果）

全部在 `app/amayui-emulator/` 下执行。

| 命令 | 结果 |
|---|---|
| `node --import tsx --test test/text-sjis-limits.test.ts test/text-204-blank-extent.test.ts test/text-font-rebuild-set.test.ts` | `tests 16 / pass 16 / fail 0` |
| `node --import tsx --test test/text-sjis-limits.test.ts test/text-204-blank-extent.test.ts test/text-font-rebuild-set.test.ts test/text-layout.test.ts test/text-aa.test.ts test/text-style-snapshot.test.ts test/draw-string.test.ts test/op-205-blank-extent.test.ts test/op-205-no-writeback.test.ts test/config-version-substr.test.ts test/op-1cb-2c8-2c9.test.ts` | `tests 95 / pass 95 / fail 0`（★含全部既有文本/直绘/空白字守卫，**未删未放宽任何断言**） |
| `npm run typecheck`（tsc ×3） | exit 0 |
| `npm run typecheck:test` | **1 条红，与本票无关**：`test/recall-page-0x1d1.test.ts(500,7): error TS2339: Property 'scene' does not exist on type 'Engine'`（另一位 owner 正在写的 `0x1D1` 票） |
| `npm run test:org` | **1 条红，与本票无关**：`[R2-tier] save-delete-slots.test.ts — 声明 T0 但有真资产证据`（另一位 owner 的新文件） |
| `npm run check:dead-writes` | 新增死写 = `Engine.l2dMotionCache`、`Engine.recallRepaint`（T-0160 / T-0170 的，非本票）；本票新增的是 `src/text` 的**导出数据/纯函数**，不进 Engine 模型字段扫描 |
| `node --import tsx --test test/harness-convergence.test.ts` | **1 条红，与本票无关**：新增自造帧循环 `recall-page-0x1d1.test.ts`（T-0170）。本票 3 个新测试文件**没有** `mk()`/`mkEngine()`/`makeCtx()`/自造帧循环（已核 `test/harnessScan.ts` 的正则） |
| `npm run test`（T0 快档） | `tests 1001 / pass 979 / fail 21` —— 21 条红**全部来自并行中的其它 owner**：`src/renderer/pixi/textureCache.ts:582` 当前是**语法错误**（`Expected ")" but found "sub_4A4C70"`，T-0153 的 texture 票正在改），连带 `draw-string/texture-*/transition-render-wiring/gfx-*/native-tap/msg-text-range` 一批文件级红；另加 `save-delete-slots`（T0 pragma）、`recall-page-0x1d1`（棘轮）、死写棘轮。**判绿口径 = 不新增本票范围内的红**：本票涉及的全部用例（上表第 2 行 95/95）绿。 |

> ★关于 `npm run test` 里的 `test\draw-string.test.ts` 红：改前它 pass，现在红的原因是
> `textureCache.ts` 被别人改出了语法错误（`esbuild` TransformError），**不是本票改动**——
> 本票只给 `drawStringGlyphs` 加了第 8 个可选参（旧 7 参调用逐字不变，`test/draw-string.test.ts` 的
> `drawStringGlyphs('A窗', 5, 6, 30, 0, 1, 1)` 等调用与断言一个都没动）。
> （收尾时再跑一次，`textureCache.ts` 已被其 owner 修好，`draw-string.test.ts` 与上面 95 例一起全绿。）

### 票据台账侧

- `node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate` → `✅ 票据自检通过（170 张，44 条警告）`
  （警告全是别人文件的行号漂移）。
- `npx tsx --test test/ticket-ledger.test.ts` → **1 条红，与本票无关**：
  `看板与真源同步 … 看板里缺这些票：T-0170`（主 agent 结算时跑一次 `node scripts/build-tickets.mjs` 即消）。
  ★注意：本文件（`changes-text.md`）会让 T-0151 的过程文档列从 `changes.md` 变成 `changes.md changes-text.md`
  ⇒ 那一次 rebuild 同时把本文件的登记带上看板。我按纪律**没有**跑 `build-tickets.mjs`（生成物只由 owner 结算时 build）。
- 本 agent **没有**改 `tickets/T-0151/ticket.json`（状态 / `tests[]` / `history` 一律未动），
  也没有改 `changes.md`/`notes.md`。

---

## 8. 台账待应用（需要主 agent 应用到 `analysis/*.json`）

> 我按纪律**没有**写 `analysis/**`。下面是可直接套用的精确内容：条目 id、字段、新值、raw 锚点、
> guard 测试名。行号是"读时的磁盘状态"的参考值，**稳定锚点一律用标识符/字面串**。

### 7-A.1 `analysis/engine-capabilities.json` → `entries[id = "text-font-rebuild-cascade"]`

（对应本文件 §2、§3）

```jsonc
{
  "engine.fns": ["sub_459F40","sub_45A6E0","sub_4185F0","sub_418680","sub_4328F0","sub_432DD0","sub_428990"],
  "engine.raw": "70940-71273",
  // ★新增字段：给"并列"补上**方向与调用点**（审计 `text-font-rebuild-cascade`/overreach 要的就是这个）
  "engine.calls": [
    "sub_4185F0(raw 24058-24082) → sub_459F40：调用点 raw 24081",
    "sub_418680(raw 24085-24154) → sub_45A6E0：调用点 raw 24153",
    "sub_4328F0(raw 41345-41566) → sub_459F40：调用点 raw 41403",
    "sub_432DD0(raw 41569-41800) → sub_45A6E0：调用点 raw 41631",
    "0x2BD sub_426200(raw 33384-33402) → sub_459F40：调用点 raw 33401",
    "0x2BE sub_426260(raw 33404-33422) → sub_45A6E0：调用点 raw 33421",
    "0x2DB sub_426500(raw 33523-33532) 写 _this[71744](font_metrics_mode) → sub_459F40：调用点 raw 33531",
    "sub_428990(raw 35125-35168) ← sub_4328F0 raw 41385 / sub_432DD0 raw 41613（可选字体一览线性查名；是**被调**不是并列成员）"
  ],
  "emulator.status": "partial",        // 不变
  "emulator.evidence": "E2",           // 不变
  "emulator.guard": "test/config1-chain.test.ts#排版结果进入渲染模型",
  "emulator.note": "★审计 P1 订正：7 条参数面（0x75/0x197/0x1A5/0x2BD/0x2BE/0x2FE/0x2DB）与面名映射/竖排都**已落地并接线**。★T-0151 第二次订正（P2 stale-ledger）：原 note 的 `msgwin.ts:1146-1189` 与 `test/text-layout.test.ts:248-264` 两个锚点都指错——前者是窗对象 range 一族（现在 `op_msgwin_obj_range`:1466 / `op_msgwin_obj_range2`:1477 / `op_msgwin_obj_pre48`:1508），后者是「逐字显现游标」与「面名映射」两个用例，**整份文件里没有一条字体参数 handler 断言**。真正的锚点（用标识符，行号仅参考）：op 体 `op_set_main_size`(0x75):1816 / `op_set_ruby_size`(0x197):1825 / `op_set_main_face`(0x1A5):1834 / `op_set_ruby_face`(0x2FE):1842 / `op_set_main_bold`(0x2BD):1850 / `op_set_ruby_bold`(0x2BE):1859（均在 src/vm/handlers/msgwin.ts）；0x2DB 无专用 handler，走字段存储计划 src/vm/operandPlan.ts 的 declarePlan(0x2db,…):401 + src/vm/engineFieldIds.ts:209 的 font_metrics_mode；派发 = MSGWIN_OPS:2136；断言 = test/config1-chain.test.ts:93-94（mainSize=30 / rubySize=10，用例名「★CONFIG1 的 ADV 样例窗口：排版结果进入渲染模型」）。★T-0151 第三次订正（P3 overreach）：engine.calls 补上 5 个 setter → 2 个重建体的**调用点 raw**（24081/24153/41403/41631/33401/33421/33531），并说明 sub_428990 是 sub_4328F0(41385)/sub_432DD0(41613) 的**被调**；engine.raw 70940-71273 本身正确（正是两个重建体的完整区间），错的是「并列而不给方向」。真正缺的只有 GDI HFONT 句柄层与字体级联（见 lazy-gdi-font-set）。"
}
```

> ★`engine.calls` 是**新增字段**。`capabilities.js --validate` 不拒未知字段（只查 schema 里那几项），
> 但 `build-capabilities.mjs` 只渲染 `engine.fns`/`engine.raw`/`emulator.note` —— 所以若 owner 不愿
> 引入新字段，等价做法是**把上面 8 行原样并进 `emulator.note` 的第三段**（内容一字不改），
> `engine.fns`/`engine.raw` 保持不动。**两条路选一条即可**；不要只删 `engine.fns` 里的 5 个函数
> （它们确实在级联里，删了会丢掉"谁来触发重建"）。

### 7-A.2 `analysis/engine-capabilities.json` → `entries[id = "lazy-gdi-font-set"]`

（对应本文件 §1；这是本票修的 P2）

```jsonc
{
  "name": "消息窗字体句柄组的重建（主套 CreateFontIndirectA ×10 / 注音套 ×4）——含字形度量面与两张 lfEscapement=1800 竖排面",
  "engine.fns": ["sub_465390","sub_459F40","sub_45A6E0","sub_456C90","sub_456DF0","sub_459A20","sub_459C50","sub_4745A0"],
  "engine.raw": "70940-71273",
  "reads": ["Font+1084","Font+1096","Font+1100","Font+101852","Font+101856","Font+101860","Font+1168",
            "Font+1232","Font+1292","Font+101972","Font+102032","Font+1408","Font+1412","Font+1416",
            "Font+102092","Font+102096","Font+102100","Font+201680","Font+201684","Font+201784",
            "Font+218508","Font+218512","Font+218584","Font+218592","Font+218596",
            "Font+235068..+235104"],
  "emulator.status": "partial",
  "emulator.evidence": "E2",
  "emulator.guard": "test/text-font-rebuild-set.test.ts",
  "emulator.note": "★T-0151 处置（审计 P2 missing-behavior）：参数面（面名映射 resolveFace / 字号 0x75·0x197 / 字重 0x2BD·0x2BE / 竖排 0x261 / msgwin.font + textLayer.ensureFont）此前已建模；本轮把**句柄组与度量缓冲**也落成可核对的数据与纯算术：① `src/text/fontSet.ts` 的 `GDI_FACE_REBUILD` 逐格列出 `sub_459F40`(raw 71170-71187) 的**主套 10 支**与 `sub_45A6E0`(raw 71263-71272) 的**注音套 4 支**（槽号/模板/面名/尺寸/是否 1800/作用，各带 raw）；② `metricFaceSlot(flag)` = 审计点名的『量宽用哪支句柄』（flag 非 0 ⇒ Font+201784，否则 Font+101852；raw 10733-10737）；③ `glyphBitmapBufferBytes` 给出两族字形位图缓冲的字节数（主套 raw 71138-71141 的 16(h/4−1)²、注音 raw 71028-71035 的 4(4(h/4)+4)²）；④ `aspectScaledLfHeight`/`aspectCorrectedLfWidth` 复刻缩放修正（raw 71055-71090；★scale=1 时因 +0.5 后向零截断也**不是**恒等）；⑤ `AGE_EXTEND_FACES` 登记引擎内部派生面名 \"AGE Extend\"/\"@AGE Extend\"（raw 71097/71099，并被 0x1A5/0x2FE 豁免白名单警告 raw 41385/41613）。★**仍无等价物**的 6 格逐条登记在 `GDI_FACE_REBUILD_NOT_MODELED`（TEXTMETRICA ×2 raw 71045/71232、字形位图缓冲 ×2 raw 71029/71138、缩放因子对 raw 71028、AGE Extend 落地字族 raw 71097），每条带 what/why/recheck —— 它们是 GDI 设备资源，浏览器宿主结构上不同构，不是『忘了做』。★已核：`Font+201680` 全库只有 raw 78769/78895 两处写、都是 0 ⇒ 恒 0。守卫 `test/text-font-rebuild-set.test.ts`（7 例）。原 name 里的 『CreateFontIndirectA ×8』是错数（审计 P3 overreach 已点名，实为 10+4）。"
}
```

> ★注意：`emulator.status` 由 `modeled-verified` 改 `partial` 的理由 —— 参数面已核验，但审计点名的
> **句柄组/度量缓冲/缩放修正**这一半只做到"数据 + 纯算术 + 缺口登记"，没有渲染侧消费者
> （`renderer/pixi/**` 不归本票）。若 owner 认为"数据 + 显式缺口登记"已够，可保留 `modeled-verified`，
> 但**必须**把上面 note 的 ①-⑤ 与 6 格缺口写进去（否则这条会再次被下一轮审计判成 stale）。
> 无论选哪个 status，`emulator.guard` 都改成 `test/text-font-rebuild-set.test.ts`（它真实存在且用例名含
> `第 10 支 / 1800 / metricFaceSlot / 位图缓冲 / 缩放修正 / 缺口登记` 六件事）。

### 7-A.3 `analysis/engine-capabilities.json` → `entries[id = "text-blank-extent-mode-gate"]`

（对应本文件 §6）

```jsonc
{
  "emulator.status": "partial",   // 不变
  "emulator.evidence": "E2",      // 不变
  "emulator.guard": "test/op-205-blank-extent.test.ts",   // 不变（0x205 那半没动）
  "emulator.note": "……（前半原文保留）…… ★T-0151 订正（审计 P3 `0x204`/approximation）：**0x204 直绘路径的纯函数侧已按体补齐** —— `src/text/layout.ts` 的 `drawStringBlankAdvance`/`drawStringAdvance` 复刻了两条路的空白字分支：描边档位 ≠ 0 走 `sub_471180`（raw 87269-87280，门 = `Font+201680 <= 1 && set:BlankExtentMode == 1`）、档位 0 走 `sub_46F2D0`（raw 86057-86067，**没有** `Font+201680` 那道门）；两路 mode 1 都取 `psizl.cx`，**全角也取 cx**（与消息窗排版路径全角取 `psizl.cy`，raw 85129-85132，口径不同）；`drawStringGlyphs` 增第 8 个可选参 `blank?: BlankExtent`。守卫 `test/text-204-blank-extent.test.ts`（5 例，含 mode 1 取 cx 而非 cy、两道门分开、mode 0 零回归）。★**仍未接线**：宿主调用点 `src/renderer/pixi/textureCache.ts:375` 仍是 7 实参、`src/vm/native.ts` 的 `drawString` 参数面没有 `blankExtent` ⇒ 玩家把 `BlankExtentMode` 设 1 时，直绘文本的空白字前进量仍走网格（排版路径那半已接线，见前文）。★另两处仍未建模：`(int16)Font+201704`（档位 0 的 mode-0 除数，由 `sub_456C90` raw 68697-68718 用参考字 0x8C83 量出）与 `Font+218520` 的后置缩放（raw 87289-87291）。"
}
```

### 7-A.4 （建议，需 owner 决定）`analysis/opcode-gaps.json` → 新增 `0x2c8` 条目

`0x2c8` 的下界外读是**修不掉的、有据保留**的行为 ⇒ 按 `tickets/T-0149` 的 `partial` 口径它应有一等登记位
（`0x2c7` 已修完，**不需要**登记；`0x204`/`0x205` 由能力台账 §7-A.3 覆盖）。

```jsonc
{
  "opcode": 712,
  "mnemonic": "i2c8",
  "name": "substr-chars（按字符取子串）",
  "handler": "sub_434260",
  "handlerBodyLine": 42379,
  "argc": 4,
  "docStatus": "已核对",
  "source": "was-gap",
  "disposition": "partial",
  "ticket": "T-0151",
  "note": "★T-0151：本轮按体补齐了**缓冲上限硬失败**（op2 的 SJIS 字节长 > 255 ⇒ 引擎 `strcpy_s(Destination, 0x100u, op2)` raw 42401 是运行时约束违例（invalid parameter handler，MSVC 默认终止），emulator 现抛 `SjisSubstrSourceTooLongError`；边界 255 字节含结尾 0 恰好 0x100）。**唯一仍不复制**的是逐字节循环第一步的缓冲下界外读（raw 42420 的 `_mbbtype(*(v2-1), 0)`，`v2` 初值 = `Destination`）—— 那个字节是栈上未初始化值，没有确定行为可照抄，判据与重新评估条件见 `src/text/sjis.ts` 的 `SJIS_SUBSTR_CHARS_NOT_COPIED`。守卫 `test/text-sjis-limits.test.ts`。",
  "missing": [
    {
      "what": "逐字节循环第一步对 `Destination[-1]`（栈上未初始化字节）的 `_mbbtype(*(v2 - 1), 0) == 1 && _mbbtype(*v2, 1) == 2` 子句不复制：值未定义 ⇒ 无法照抄；后果仅当该字节恰为 SJIS 前导字节且首字节为合法续字节时，引擎会把首字符判成双字节字的后半字节而少切一个字（emulator 永把首字符当独立字符）",
      "ticket": "T-0151",
      "raw": "42420"
    }
  ]
}
```

> 加完要：`node scripts/build-opcode-gaps.mjs`（md 生成物）+ `test/opcode-gaps.test.ts`（棘轮）。
> `raw` 形如 `^\d+(-\d+)?$` ⇒ `"42420"` 合法。

### 7-A.5 不需要改的（已核，避免下一轮重复判 stale）

- `entries["text-blank-extent-mode-gate"].guard` 保持 `test/op-205-blank-extent.test.ts`（该文件 227 行全绿，
  且本票**没有**改动 `blankAdvance`/`numberCellExtent` 的语义 —— `0x204` 走的是新函数）。
- `entries["text-layout-wrap-ruby"]` 不动（`test/text-layout.test.ts` 仍绿，`layoutWindow` 语义未变）。
- `entries["adv-text-reveal-progress"]` / `entries["lazy-gdi-font-set"].reads` 的 `Font+235068..+235104` 保留
  （本票只在 §7-A.2 里加了 `Font+235100/+235104` 的具体角色说明，未删任何 reads 项）。
- `docs/06-function-status-registry.md`（0x2C8 那行说 "2026-09 转真实现"）：未动，也没过期 ——
  本轮是给它的真实现补了上限与错误路径，`rewritten` 状态仍成立。
