# T-0162 变更记录（c162）：操作数与内存原语 —— 含字符串族转串根因

> 本文件是**给主 agent 照抄的交接件**：§3 的片段可直接落三层台账 / `analysis/opcode-gaps.json`。
> 一切结论以读体为准，raw = `engine/天结_unpacked.exe_utf8.c` 行号。

---

## 1. 一句话结论

`0x1B0` 的 memcpy **方向确实反了**（`memcpy(dest=op2, src=op1, 4*op3)`，raw 37991-37995）；
`readStringOperand` 的**真正根因不是"没做数值转串"（T-0165 已修），而是"少了三条原语的分叉"**——
`sub_41B640`/`sub_42A420` 的每条数值路径都过 `sub_41A6C0`（**ASCII → 全角**，本机 exe 是中文版 ⇒ GBK `0xA3xx`），
而 `0x1B2` 走 `sub_41B9B0`**不**过它。逐 tag / 逐原语的对照表已落进 `src/vm/operand.ts` 的头注并逐条有守卫。

## 2. 逐条处置（清单 6 条 + 读体新发现）

| # | sev | 对象 | 清单原口径 | 读体后的处置 |
|---|---|---|---|---|
| 1 | P3 | `0x1B0` | 方向反（不只是"异构即抛"） | **✅ 修**（`memory.ts`）：源 = op1、目标 = op2。**异构限制保留但改口径**（理由见 §4） |
| 2 | P2 | `0x192` 第 2 格转串 | 缺 int 族转串 | **⚠前提部分推翻**：数值转串 T-0165 已修；**真缺口是全角化** ⇒ 本轮补（`＋全角`）。指针族"解引用后转换"已在 T-0165 修好（复核） |
| 3 | P2 | `0x1B2` 第 1 格整数转串 | 缺 int 族转串 | **✅ 复核后已修（T-0165）+ 本轮加关键分叉**：0x1B2 必须**半角**（`sub_41B9B0` 不调 `sub_41A6C0`）。守 v 钉住 `"42" vs "４２"` |
| 4 | P3 | `0x192` case 2 | 内嵌字面量是**逐 dword 取反**存储 | **✅ 修**：tag 2 只取解析期解出的 `a.str`，**未解码即抛**；tag 2 与 tag 0xB（局部串变量）**两套池**不再混用 |
| 5 | P3 | `0x192` 指针族 fallback | 「case 8/14 有容器空则写 `byte_51EA3C`；case 6/12 同」 | **❌前提被推翻（体证 raw 36363-36411 / 26502-26532 / 26538-26547）**：`LABEL_40` 只属于**数组族**（`0x8005`/`0x800B` ⇒ 空串）；`0x8003`/`0x8009` 的哨兵是 `０`（全角，`asc_5205D4` raw 4438）与 `0`（半角，`a0` raw 4399）。**case 6/12（int 指针）没有任何 null 检查** ⇒ 空指针就是解 NULL。⇒ 本轮改的是数组族，指针族保持"空引用抛错"（见 §4） |
| 6 | P2 | `0x193` float 族丢真值 | 引擎 case 1/4/10 走 `%lf` | **✅ 复核后已修（T-0165）**：`floatToLf` = 默认精度 6。本轮再加全角（`%lf` 结果也过 `sub_41A6C0`，raw 36421/36509） |
| 新 | P2 | float 指针族（tag 7/13）读 | — | **✅ 修**：`readFloatOperand` 修前经 `readRef` 的 `(raw)\|0` **丢小数**；引擎 case 7/13 是 `*(float*)ptr`（raw 26441-26445 / 26475-26480 / `sub_42BA00` raw 37222-37226 / 37245-37249）。**语料真命中**：`src/SETPOLYGON.txt:40/43` 的 `i2d3 (local-float-ptr 1) (local-float-ptr 0) (local-float K)` 两个操作数都是 float 指针 ⇒ 修前每次 `fdiv` 都在除**截断后的整数** |
| 新 | P2 | float 指针族（tag 7/13）写 | — | **✅ 修**：`writeFloatOperand` 修前走 `default: writeIntOperand(…, v \| 0)` ⇒ **写侧也截断**（`i2d3` 的 op1 就是 float 指针） |
| 新 | P3 | 数组族转串 | — | **✅ 修**：`0x8003`/`0x8009` 取首元素 + 全角，空数组哨兵与引擎逐字相等；`0x8005`/`0x800B` **结构上不可复现 ⇒ 显式抛**（见 §4 缺口②） |
| 新 | P3 | 未建模 tag 的兜底 | `default: return String(a.raw)` | **✅ 修**：引擎对任何非 0..14 + 非四数组 tag 都抛 `Command_Type_Exception`（raw 26355-26357 / 36389-36392）⇒ emulator 改成抛（不再静默给槽号） |

## 3. 备份：全角化的体证（新增结论，供台账引用）

`sub_41A6C0`（raw **25539-25593**）= **ASCII 数字串 → 双字节全角**：

```
逐字符写 2 字节（a1[2*i]=首字节, a1[2*i+1]=次字节）：
  '0'..'9' / 'A'..'Z' / 'a'..'z'  ⇒ { 0xA3, c+0x80 }     // 0→A3B0、9→A3B9、A→A3C1、a→A3E1
  '-' ⇒ { A3, AD }   '+' ⇒ { A3, AB }   '#' ⇒ { A3, A3 }
  其余任何字符 ⇒ { 0x81, 0x48 }                            // raw 25574-25576
a1[2*i] = 0 收尾；v4 = GlobalAlloc 的输入副本；返回 a1（原地扩写）
```

调用点（全库 8 处，机械扫描）：`sub_41B640` raw **26331 / 26347**、`sub_42A420` raw **36376 / 36421 / 36509 / 36530**、
`0x205` 的格式化落点 raw **12315**（`formatNumberCell` 的 x 前进量那一段）。
★**`sub_41B9B0` 一次都不调它**（raw 26366-26548 区间零命中）⇒ `0x1B2` 是半角。

本机这份 exe 是**中文版（心愿屋）** ⇒ 内部字符集 GBK（`docs-new/03-engine/save-data.md:178`：存档串 `b3c7edce…` 解作「城砦与结缘之力共存」）
⇒ `0xA3xx` 正是 GBK 的全角 ASCII 区（`0-9`→`A3B0-A3B9`、`A-Z`→`A3C1-A3DA`、`a-z`→`A3E1-A3FA`、`－`→`A3AD`）。
同一个 `sub_41A6C0` 在日文版里会是 SJIS `0x82xx`。

**对照：`0x1C8`（专用 int→串指令）不调它**（`sub_433820` raw 41990-42010 全文只有 `sub_408050(Buffer,256,"%d",v)`）
⇒ 「0x192 拿 int 得全角、0x1B2 / 0x1C8 得半角」是引擎真实分叉，不是实现随性。

### tag → 语义对照表（三条原语，tag 值从体里数出来）

| tag | 形态 | `sub_41B640`（23 条指令） | `sub_42A420`（6 条） | `sub_41B9B0`（仅 `0x1B2`） |
|---|---|---|---|---|
| 0 | 立即 int | `_itoa_s(payload,10)` **+全角** | 同（raw 36419-36424） | 同数值，**半角**（26400-26402） |
| 1 | 立即 float | `%lf` **+全角** | 同（36425-36427→36492） | `%lf`，半角（26403-26404→26478-26480） |
| 2 | 内嵌字面量（逐 dword 取反） | 解倒置（26276-26287） | 同（36428-36449） | 同（26405-26418） |
| 3 / 9 | global / local int | `_itoa_s(DEC,10)` **+全角** | 同（36450-36458 / 36481-36489） | 同数值，半角（26419-26427 / 26450-26457） |
| 4 / 10 | global / local float | `%lf` **+全角** | 同（36459-36461 / 36490-36494） | 同，半角（26428-26430 / 26458-26461） |
| 5 / 11 | global / local string | 取串（SSO cap≥0x10 解堆指针） | 同（36462-36469 / 36495-36502） | 同（26431-26436 / 26462-26467） |
| 6 / 12 | int 指针 | `_itoa_s(DEC(*ptr),10)` **+全角** | 同（36470-36475 / 36503-36509） | 同数值，半角（26437-26440 / 26468-26474） |
| **7 / 13** | **float 指针** | **抛** `Command_Type_Exception` | **抛**（无 case 7/13） | **支持** `%lf(*ptr)` / `%lf(**ptr)`（26441-26445 / 26475-26480） |
| 8 / 14 | string 指针 | 解引用取串（SSO） | 同（36476-36480 / 36516-36519） | 同（26446-26449 / 26481-26485） |
| 0x8003 / 0x8009 | int 数组 | **抛** | 空/null ⇒ **`０`**（`asc_5205D4` raw 4438）；否则 `_itoa_s(DEC(vec[0]))` **+全角**（36524-36541 / 36510-36524） | 空/null ⇒ **`0`**（`a0` raw 4399）；否则 `_itoa_s(DEC(vec[0]))`，半角（26490-26498 / 26510-26524） |
| 0x8005 / 0x800B | 字符串数组 | **抛** | 串槽内容 `atoi` → 向量 → `[0]`；串空/向量空 ⇒ **空串**（`byte_51EA3C` raw 4302）（36363-36411） | 同（26502-26509 / 26525-26532） |
| 其它 | — | **抛** | **抛**（36389-36392） | **抛**（26486-26487 / 26533-26537） |

**opcode → 原语**（机械扫描 544 条 handler；经三条原语读串的共 30 条）：
`sub_41B9B0` = **仅 `0x1B2`**；`sub_42A420` = `0x192`/`0x193`/`0x194`/`0x195`/`0x1A9`/`0x2C2`；其余 23 条 = `sub_41B640`
（`0x6E`/`0x204`/`0x2C5`/`0x2C6`/`0x2C7`/`0x2C8`/`0x2EC`/`0x2DE`/`0x2FE`/`0x1A5`/`0x1A6`/`0x196`/`0x89`/`0x8D`/`0x140`/`0x144`/`0x14A`/`0x14C`/`0x221`/`0x351`/`0xA2`/`0xA3` …）。
`0x7D` 另走 `sub_41A780`（十六进制形态，emulator 未实现 ⇒ 仍硬报错）。

## 4. 缺口登记（**做不到 / 有意保留** —— 写成 `analysis/opcode-gaps.json` 的 `missing[]` 片段）

### 缺口① `0x1B0` 的跨类型裸拷贝（disposition 建议 `partial`，opcode 432）

```json
{
  "opcode": 432,
  "mnemonic": "i1b0",
  "name": "memcpy",
  "handler": "sub_42D150",
  "handlerBodyLine": 37985,
  "argc": 3,
  "docStatus": "已核对",
  "source": "audit-partial",
  "disposition": "partial",
  "ticket": "T-0162",
  "note": "★T-0162（2026-09-24）：**方向已修**（源 = op1、目标 = op2，体 raw 37991-37995 的 memcpy(v2=addr(op2), v4=addr(op1), 4*op3)）。语料 `^i1b0` 命中 0 处（941 个 src/*.txt）⇒ 只由合成守卫钉住（test/operand-memcpy-direction.test.ts）。",
  "missing": [
    {
      "what": "引擎的 memcpy 是**裸 4*n 字节拷贝、不看边类型**（`sub_42D150` 只调 `sub_42AEA0` 取两个基址）；emulator 的池是带类型的（int 池存 ENC(值)、float 池存 JS number、str 池 step 28）⇒ 跨 kind 的裸拷贝**没有可表达的值** ⇒ 显式抛错。扩展点 = 引入"按 dword 视图"的池访问器；重新评估条件 = 语料出现跨 kind 的 i1b0（当前 0 处）。",
      "ticket": "T-0162",
      "raw": "37991-37995"
    }
  ]
}
```

### 缺口② 字符串数组 `0x8005`/`0x800B` 的转串（建议挂在 `0x192`=402 / `0x193`=403 / `0x1B2`=434 的 `missing[]`）

```json
{
  "what": "字符串数组 tag 0x8005/0x800B 的转串**结构上无法复现**：引擎把"数组地址"以**十进制字符串**存在该串槽里（sub_42AEA0 raw 36858-36888 的自动建数组分支），转串时 atoi 解回指针再取 vector<string>[0]（sub_42A420 raw 36394-36411 / sub_41B9B0 raw 26538-26547）；emulator 的串池里没有"指针型字符串"这种值 ⇒ 显式抛错（登记为缺口，不再静默返回槽号）。扩展点 = 若将来建模"串槽里存地址"这种值；重新评估条件 = 语料出现 0x8005/0x800B 操作数（当前 0 处）。",
  "ticket": "T-0162",
  "raw": "36394-36411"
}
```

### 缺口③ 全角化的 `.` 近似（建议写成同上的 `missing[]` 第二条，或只进 `notes`）

```json
{
  "what": "`sub_41A6C0` 对 `.`（0x2E）落的是 `{0x81,0x48}`（raw 25574-25576）—— 该码位在 GBK 里不是全角句点（`A3AE`）而是 CJK 扩展区的怪字。emulator 只转 `[0-9A-Za-z+-#]`、`.` 留半角（与既有 handlers/msgwin.ts 的 toFullWidth 同一口径）。受影响面 = 只含 float 族转串（`%lf` 的输出含 `.`）。",
  "ticket": "T-0162",
  "raw": "25574-25576"
}
```

### 缺口④ 数组族在 emulator 的"元素排布"与引擎不同（**已有模型，本轮不动**，如实登记）

```json
{
  "what": "引擎的 int 数组操作数语义是"该池槽存一个指向 vector<int> 的指针"（sub_42AEA0 case 0x8003 raw 36825-36856 会在空时**自动建向量**并把指针写回池槽）；emulator 的数组模型（T-0082 的 0x2C9/refFromOperand）是"元素从基址槽起连续排"。两者在**元素 0** 上重合（本轮 readStringOperand 就取首元素），但"扩容/自动建数组"这一层不对应。扩展点 = 按 sub_42AEA0 的指针模型重做数组操作数。",
  "ticket": "T-0082",
  "raw": "36825-36888"
}
```

## 5. 建议新增 `analysis/functions.json` 条目（可直接 `report.js --func-add`）

```bash
node .agents/skills/amayui-engine-analysis/scripts/report.js --func-add '{
  "addr":"0x41A6C0","raw_name":"sub_41A6C0","semantic_name":"toFullWidthAscii_41A6C0",
  "op":"","status":"ANALYZED",
  "purpose":"ASCII 数字串 → 双字节全角（原地扩写：n 字符 → 2n 字节）。逐字符写 2 字节：0-9/A-Z/a-z ⇒ {0xA3,c+0x80}、- ⇒ A3AD、+ ⇒ A3AB、# ⇒ A3A3、其余 ⇒ {0x81,0x48}（raw 25574-25576）。本机 exe = 中文版 ⇒ GBK。",
  "sub_behaviors":["strlen → GlobalAlloc 副本(sub_407F60)","逐字符按上表写 a1[2*i]/a1[2*i+1]","a1[2*i]=0 收尾 + GlobalFree"],
  "fields_used":["dword_55C8E0/dword_55CCF0/dword_55D128(1024B 数字缓冲，调用方持有)"],
  "unmodeled":["GlobalAlloc 的失败路径"],
  "evidence":"raw 25539-25593",
  "notes":"★调用点只有 6 处数值转串 + 1 处数字绘制：sub_41B640 raw 26331/26347、sub_42A420 raw 36376/36421/36509/36530、sub_4072F0 raw 12315（0x205 的 x 前进量那一段）。★sub_41B9B0（→ 0x1B2）与专用 int→串 0x1C8（sub_433820 raw 41990-42010）都**不调**它 ⇒ 同一条 0x192 拿 int 得全角、0x1B2 / 0x1C8 得半角。emulator 对应物 = src/vm/operand.ts 的 toFullWidthNumber（守卫 test/operand-string-primitive.test.ts）。"
}'

node .agents/skills/amayui-engine-analysis/scripts/report.js --func-add '{
  "addr":"0x41B9B0","raw_name":"sub_41B9B0","semantic_name":"readStringOperand_41B9B0",
  "op":"0x1B2","status":"ANALYZED",
  "purpose":"读字符串操作数（返回 const char*）—— 三条转串原语里的**第三条**，全库只有 0x1B2（sub_42A9B0 raw 36550-36558）用它。tag 分派与 sub_41B640 同形，但两处不同：① **不做全角化**（全函数体零处调 sub_41A6C0）；② **支持 float 指针族 tag 7/13**（case 7 raw 26441-26445、case 13 raw 26475-26480），前两条原语对 7/13 抛 Command_Type_Exception。数组族：0x8003/0x8009 空容器返回全局 a0=\"0\"（半角）、0x8005/0x800B 走 pointer-in-string 语义。",
  "sub_behaviors":["tag 0/1 立即数 → _itoa_s/%lf（**无** sub_41A6C0）","tag 2 内嵌字面量：逐 dword 取反解出（raw 26405-26418）","tag 3/9 int 池 → _itoa_s(DEC)","tag 4/10 float 池 → %lf","tag 5/11 string 池 SSO","tag 6/12 int 指针 → _itoa_s(DEC(*ptr))","tag 7/13 float 指针 → %lf(*ptr)","tag 8/14 string 指针 SSO","0x8003/0x8009 空 ⇒ a0；0x8005/0x800B ⇒ atoi 解指针取 vec[0]"],
  "fields_used":["_this[30*cur+95781..95794](帧池基址)","_this[95744..95754](全局池)","a0(raw 4399)","byte_51EA3C(raw 4302)"],
  "unmodeled":[],
  "evidence":"raw 26366-26548",
  "notes":"emulator 对应物 = src/vm/operand.ts 的 readStringOperand + stringPrimitiveForOp（按 opcode 选原语）。★与 sub_41B640/sub_42A420 的差就是本条的关键：见 operand.ts 头注的三列对照表。"
}'

node .agents/skills/amayui-engine-analysis/scripts/report.js --func-add '{
  "addr":"0x42A420","raw_name":"sub_42A420","semantic_name":"coerceOperandToString_42A420",
  "op":"0x192/0x193/0x194/0x195/0x1A9/0x2C2","status":"ANALYZED",
  "purpose":"把第 3 个实参指定的操作数**强制转成 std::string**（写入 a2）。tag 分派与 sub_41B640 同形（含全角化 sub_41A6C0 raw 36376/36421/36509/36530），但**多了四个数组 tag**：0x8003/0x8009 int 数组（空 ⇒ 全角 `０` = asc_5205D4 raw 4438）、0x8005/0x800B 字符串数组（空 ⇒ 空串 byte_51EA3C）。tag 7/13 float 指针**没有 case** ⇒ default 抛 Command_Type_Exception（raw 36389-36392）。",
  "sub_behaviors":["tag 0..14 的转串（数值族 over sub_41A6C0）","0x8003/0x8009 ⇒ DEC(vec[0]) 或 `０`","0x8005/0x800B ⇒ atoi(串槽) 当向量指针取 [0] 或空串"],
  "fields_used":["同 sub_41B640"],
  "unmodeled":["0x8005/0x800B 的 pointer-in-string 语义（emulator 无对应值类型）"],
  "evidence":"raw 36318-36544",
  "notes":"emulator 对应物 = src/vm/operand.ts 的 readStringOperand（按 opcode 选原语）；0x8005/0x800B 分支**有意抛错**并登记为缺口（见 tickets/T-0162/changes-c162.md §4 缺口②）。"
}'
```

**对已有条目 `0x41B640` 的建议补丁**（`--func-edit 0x41B640 --set …`）：

- `purpose` 末尾补：`；★每条数值路径返回前都过 sub_41A6C0（raw 26331/26347）做 **ASCII→全角**（本机 exe 中文版 ⇒ GBK 0xA3xx）`
- `notes` 补：`★数组 tag（0x8003 族）在本条里**没有 case** ⇒ default 抛（与 sub_42A420 / sub_41B9B0 的关键差别）；★float 指针族 7/13 同样抛。逐 tag 对照表见 tickets/T-0162/changes-c162.md §3。`
- `unmodeled` 若原为空数组，可不动。

**对已有条目 `0x42D150` 的建议**：语义已正确（`memcpy(dest=op2, src=op1, n=4*op3)`）⇒ 只在 `notes` 补一句"跨类型裸拷贝在 emulator 显式抛（缺口见 T-0162）"。

## 6. 其它该由**别人**接的（不在本票文件白名单内）

1. **`test/menu-string-key.test.ts:60`（T-0158，进行中）**：0xA2/0xA3 的**数值键**现在还是 `String(plan.int(1))`（半角 `-1`）。等 T-0158 把 handler 切到 `readStringOperand`（`sub_41B640` ⇒ 全角）后，该断言必须 retarget 成 `－１`。
   该文件 :75-78 的注释**已经预告了这个全角差**（"数值键是全角化后的串"）⇒ 与本次实现一致。
2. **`handlers/msgwin.ts` 的 `toFullWidth`（raw 2386）** 与本次新增的 `operand.ts` 的 `toFullWidthNumber` 是**同一函数的第 2 份实现**（0x205 用）。建议把 `operand.ts` 的那份 `export` 出去、msgwin 改成 import（口径只有一份）。本票不动 `msgwin.ts`。
3. **`analysis/opcodes.json` 的 `semantics` 列**：`0x192`/`0x193`/`0x194`/`0x195`/`0x1A9`/`0x2C2`/`0x1B2`/`0x2C5`… 都值得补一句"数值操作数经 `sub_41A6C0` 全角化（0x1B2 除外）"。改完要跑 `scripts/build-opcode-table.mjs`。
4. **`docs-new/03-engine/save-data.md`** 的"字符集随发行版 = GBK"是本轮判据之一，本轮未改（只读引用）。
5. **`test/ptr.test.ts:110-113` 的注释**把 `ptr0` 写成 dest、`ptr1` 写成 src（断言本身是自拷贝、对方向不敏感所以仍绿）。方向修正后该注释与体相反 ⇒ 建议 owner 顺手改注释（本票未动该文件，怕撞别人的锚点）。
6. **`ref.ts` 的 `readRef` 对 `kind==='float'` 做 `(raw)|0`**（raw 112）：这是给 `readIntOperand` 用的口径，本身没错，但**float 族不许再用它**。若将来有人给 float 引用加新读点，务必走 `operand.ts` 的 `readFloatRef`（本票已把 operand.ts 内的两条读/写路径改开）。
