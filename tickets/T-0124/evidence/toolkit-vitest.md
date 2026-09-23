# amayui-toolkit 测试审计（只读）

审计对象：`app/amayui-toolkit`（React+MUI+Vite+zustand 静态 SPA；`npm test` = `vitest run`）。
测试规模实测：5 文件 / 87 用例（`grep -c "it("`：5+23+47+9+3）。
方法：纯静态读码 + 真语料核对（`public/data/metadata.json` 抽样核对锚点，未跑 `npm test`）。所有反例实验均为**思路**，未执行变异（只读纪律 + CPU 占用约束）。

## 0. 先决事实（影响全部判定）

1. **测试不在任何 gate 里**：`.github/workflows/deploy-pages.yml:37-39` 只跑 `npm run build`（= extract + vite build），**从不跑 `npm test`**。仓库根也没有把它接进任何 verify。
2. **测试依赖未入 git 的衍生物**：`app/amayui-toolkit/.gitignore:2` 忽略 `public/`；`git ls-files` 显示 `public/data/metadata.json` **未被跟踪**（`git check-ignore` 命中）。`search.test.ts:12`、`dataset.test.ts:15`、`useStore.test.ts:15` 三个文件在 `beforeAll` 里 `readFileSync(public/data/metadata.json)`，`package.json` **没有 `pretest` / 没有自动 `build:data`**。⇒ 全新 clone 上 `npm test` 会是 3 个文件 ENOENT 报错（基础设施红），而不是测试信号；只有在本地已生成 metadata.json 后才可跑。数据棘轮的可信度完全取决于「跑测试前是否先 `npm run build:data`」。
3. **无 mock / 无假件**：5 个文件都不用 stub/fake/mock，`ds` 由真语料 `metadata.json` 构建。⇒ 本次审计**没有任何 `scaffold` 类**。
4. **三类「假绿」逐条排查结论：本套件基本没有踩到**（证据：`grep -rn "console\.|it.skip|it.todo|\.rejects|\.resolves|async |await |describe.skip|only"` 在 5 个测试文件里 **0 命中**）：
   - 零断言空跑：无 `console.warn(...); return;`、无 `if (!data) return;`、无 skip。87 个 `it` 体每个至少 1 条 `expect`。
   - 未 await 的异步断言：5 个文件**没有任何 async 测试**；`loadDataset()`（dataset.ts:269）与 `init()`（useStore.ts:46）根本没被测（是覆盖缺口，不是假绿）。
   - 恒真断言（纯字面量运算）：无。但存在**同源重算型**恒真（见 M1/M2），能量等价。
5. 真语料核对（`node` 读 metadata.json）：units=373、maps=145、locations=34、skills=450(449 带描述)、trainings=440/训练者 6、mapUnitEntries=1791 且 **unitRef 未解析数 = 0**、菲亚-伊布拉姆 3 个单位、unit 0x9b = 因夫鲁斯骑士、star[0x136,0xfb,0xdc,0xdd]=[2,0,1,2]、skill 352=零距离流刃枪破/$3$SKINIT.txt。⇒ 测试里的字面锚点**确为真语料真值**，不是自造。

---

## ① 5 文件判定表

| 文件 | 类别 | oracle | 强度 | Verdict | 一句话理由 |
|---|---|---|---|---|---|
| `src/services/rules.test.ts` (49/5) | core | 独立（手写字面；枚举真值来自 types/metadata 的 RACE/GENDER/ATTR 表与游戏设定） | 中 | **keep** | 5 例全在守「谓词→chip 文案 + 轴向排序 + 分类谓词」这一真实映射，改坏任一分支（含 AXIS_ORDER）必红且理由正确；唯一软点是 `isNamePredicate/isUnitFacet` 近于 1 行的平凡函数。 |
| `src/services/search.test.ts` (206/23) | core | 独立（真语料锚点 + 手写字面） | 中 | **keep（2 例 upgrade / 1 例 drop）** | 大多数用例把 `buildResults` 求值结果与真语料锚点（0x136 ★3、菲亚 3 单位、0x9b）对照，有真齿；但排序/去重例是同义反复，idExact 例的标题覆盖了未执行的分支，两个「自动强制单位」例在构造上不可失败。 |
| `src/services/dataset.test.ts` (472/47) | core + ratchet（约 20/47 例只断言 `md.*` 衍生物，不碰 dataset.ts/search.ts 代码） | 独立（真语料字面） | 中弱 | **upgrade（大量 keep-ratchet）** | 真语料锚点值钱（技能全文、训练 TID 交界、地点 seq、hex 地址），但混入 1 条纯同义反复、1 条被更强用例完全覆盖的弱阈值、1 条只证非空、4 处 counts 自洽，且「测试 dataset.ts」的名分与实际断言对象不符。 |
| `src/store/useSearchDraft.test.ts` (76/9) | core | 独立（手写字面谓词） | 中 | **upgrade** | 守的是「草稿规则不变量（类型锁定/同轴替换/连坐清除）」，关切真实、断言方式正确；但 `toExpr` 例自证，且 `star` 轴、`op` 参数、`load` 的 `ensureUnit` 归一化分支、`removePredicate` 的保留分支全无覆盖。 |
| `src/store/useStore.test.ts` (82/3) | core | 独立（真语料 + 手写字面 key） | 中 | **upgrade** | 3 例守「历史去重 + navigate 同步草稿」，是真不变量；但含 1 条恒真断言，且 `goBack/goForward`（useStore.ts:72-88）、`init`、`selectView/selectExpr` **0 覆盖**——而「顶部不失效」的另一半恰在 goBack。 |

### 逐用例要点

**rules.test.ts（5）**
- r1(6-24) 6 谓词→6 条中文文案 `toEqual(['类型: 单位','名称=「鬼」','种族: 鬼','性别: 女','属性: 火炎','星级≥★3'])`。附带守 `AXIS_ORDER` 排序；独立字面，keep。
- r2(26-30) `idExact 0x2a→'id 2a'`、`nameSub 火炎→'名称含 "火炎"'`、`star eq 5→'星级=★5'`。独立字面，keep。
- r3(32-34) `rulesFromExpr([])===[]`。平凡边界，keep（成本≈0）。
- r4(38-42) `isNamePredicate` 3 断言（含反例 category→false）。keep。
- r5(44-48) `isUnitFacet` 3 断言。keep。

**search.test.ts（23）**
- s1(17-28) 菲亚-伊布拉姆：expr 字面相等 + `view.length>1`（真值 3）+ 全为 unit。独立锚点，强。
- s2(30-34) 未汉化实体 `nameZh===name` → nameExact 用 `name`。`find(...)!` 若找不到会 TypeError 红（不会静默绿），可。
- s3(38-44) queryFromId item 1 → `[{kind:'item',id:1}]` + nameZh='青铜导键'。独立锚点，强。
- s4(48-54) 技能「防御」交集 → `length===1` 且 kind=skill（不跨类型）。强。
- s5(56-63) **同义反复 + 重复**：`a=buildResults(expr,ds); b=buildResults(expr,ds); expect(a).toEqual(b)`——纯函数同输入两次，必绿；标题声称的「kind 固定序 → 序号排序、去重」实际一句没测，length===1 又与 s3 重复。→ drop / 重写（见 M2）。
- s6(65-70) idExact 0x9b → 因夫鲁斯骑士。只走 `byId`（addr 是 5 位 hex），**`byAddr` 分支全测试集从未为真**；标题「同时匹配 id 下标与名串地址」名不副实。→ upgrade（M3）。
- s7(74-78) expressionKey 子句顺序无关（category+nameExact 两置换相等）。有齿，keep。
- s8(80-85) label='单位 · 火' 且 `not.toContain('nameExact')`。独立字面，keep。
- s9(89-98) queryFromUnitAttr 输出字面 + 结果全 unit。keep。
- s10(100-110) 「只含 unitAttr 无 category 自动强制 unit」+ 逐行 `u.attribute===6`。后者是把实现的过滤条件重算一遍；前者在构造上不可失败（M4）。→ upgrade。
- s11(112-117) gender=2 → 全女。keep（但同 s10 的重算式断言）。
- s12(119-123) order-independence（unitAttr 版）——与 s7 同一不变量第 2 遍。
- s13(125-128) `'单位 · 种族 · 鬼'`。独立字面，keep。
- s14(132-143) star eq3 逐行重算 + **独立锚点 0x136 必须在结果里**。锚点使该例有价值，强。
- s15(145-150) gte4 逐行重算。中。
- s16(152-157) 「只含 unitStar 自动强制 unit」——同 M4 不可失败。
- s17(159-163) order-independence（unitStar 版）——第 3 遍。
- s18(165-168) `'单位 · 星级 ≥ ★3'` / `'单位 · 星级 = ★2'`。独立字面，keep。
- s19(172-175) queryFromTraining 纯属性字面。守「无 level 不加星子句」，强。
- s20(177-186) level=2→gte 3 字面 + 结果全 unit。前半强，后半同 M4。
- s21(188-191) level=4（★5）→ `eq(5)`（恰好、非以上）。**真业务语义**，强。
- s22(193-198) race/gender→对应 unitAttr。keep。
- s23(200-205) 空条件→`[{category:'unit'}]` 且结果非空。守「训练需求不产生空 query」，强。

**dataset.test.ts（47，按 describe 归组）**
- 地图索引 d1(20-25) byMapNum 54→日/中名（独立字面，强）；d2(27-35) `units.length===21` + row/col/level 范围（真值锚点，中）；d3(37-46) **只证 `mapsWithUnit` 非空**（弱，M7）；d4(48-57) spawnFlag=1 单位在 mapsWithUnit 里 `spawnable===true`（守 OR 聚合，中）。
- 候选 d5(61-66) 中/日名筛选；d6(68-72) sub='地图'。keep。
- 一致性 d7(76-81) `resolved > total*0.7`（弱且已被 d18 完全覆盖，M6）；d8(83-86) 与 d1 重复（同 map54 nameZh）；d9(88-91) counts vs 数组（ratchet，中弱）；d10(93-100) mapNo 唯一 + 干风之山唯一（ratchet，keep-ratchet）。
- 地点 d11(104-110) `maps` 长度 6（真值，强）；d12(112-120) 龙笛峡谷-格雷贝尔关联（强）；d13(122-126) map→location 反查（强）；d14(128-131) 地点候选；d15(133-138) 干风候选去重；d16(140-149) hex 完整匹配/前后缀不命中（**4 条反例，强**）；d17(151-160) seq 顺序 `[1..6]`（强）。
- 单位 d18(163-175) 追加包存在 + **全部 1791 槽 unitRef 可解析** + 0x5 姬斯尼尔（**全测试集最强的一致性断言**）；d19(177-184) race/gender 无 null、attribute 仅 [0xcb]、名字=系留员神殿兵（真值，强）；d20(186-199) 天使/鬼/创造锚点（真值，强）；d21(201-208) 值域；d22(210-217) star 4 锚点（强）；d23(219-224) star 值域 + 仅 0xcb null（强）。
- 训练 d24(228-233) 440/6 + counts（含真值 440，强）；d25(235-243) 训练者集合 `[0x32,0x33,0x34,0x35,0x37,0x38]` + `trainerNameZh===units.nameZh` 交叉一致（强）；d26(245-253) TID 1..0x50、0x36 处 source 交界（强，守提取管道）；d27(255-265) 冷却/鬼字段解码（文本驱动 find，中强）；d28(267-273) 技能交叉反查**只断言 `some`**，而 docs/README.md:40 宣称「skillId 100% 命中 skills[]」——断言弱于文档不变量（→ 应升级为 every 或补 100% 计数）；d29(275-292) 奖励三选一 + 无「无奖励」配方（强不变量）。
- 技能 d30(296-301) 450/449 + counts（强）；d31(303-315) #1 防御 日/中三行全文逐字（**强真值锚点**）；d32(317-326) skillId 唯一 + 范围 + 必有名；d33(328-343) hasDesc 三分 + 无描述集合恰为 `[40]`=進行不可（强）；d34(345-351) $3$SKINIT 352 零距离流刃枪破（强）；d35(353-359) 中/日名候选 + sub 简述字面；d36(361-366) skill 名串地址 1d4f5 完整匹配/前缀不命中（强）；d37(368-376) describeView key/label/kind。
- idspace d38(380-386) 5 个地址字面（强，外部真值）；d39(388-392) 徽标格式字面（强）；**d40(394-399) 纯同义反复**（M1）；d41(401-414) 6 个 id 空间「地址→候选回查」（真端到端，强）；d42(416-421) item/building 同 id 地址可区分（守 id 空间不变量，强）。
- describeView d43(425-432) item key/label/kind；d44(434-441) map key；d45(443-451) 同名组 label 含 `×`（弱，`×N` 恒被拼接）；d46(453-456) 空 view / message→null（真边界）；d47(458-471) 同表达式 key 相同、不同表达式 key 不同（a===b 半自证，c 提供齿，弱中）。

**useSearchDraft.test.ts（9）**
- p1(11-14) 初始空。p2(16-24) 名称增/删。p3(26-29) setCategory(unit) 不自动加分面。p4(31-35) setUnitFacet 自动锁 unit。p5(37-45) 同轴替换 + 异轴并存（用 `filter(...).toEqual([单个])` 精确守替换）。p6(47-52) setCategory(item) 清分面。p7(54-59) 删「类型=unit」chip → 连坐清空。p8(61-66) load 回填 + 名称框同步。p9(68-75) toExpr（弱，M9）。
- 缺口：`setUnitFacet('star', N, op)`（useSearchDraft.ts:43-52 的 star 分支与 `op` 参数）0 覆盖；p8 用的是已含 category 的良构表达式，**`load`/`setNameInput` 里的 `ensureUnit` 归一化分支（unitAttr 无 category → 补 category）无任何红测**；`removePredicate` 保留类型时的分支（useSearchDraft.ts:29 的 false 侧）未测。

**useStore.test.ts（3）**
- u1(31-48) 三次 navigate → entries=2、最新在顶、两条 key 字面精确。守去重，强。
- u2(50-66) 点历史→新 history 而非改 pos：`length===before+1`、`pos===length-1` 有齿；`toBeGreaterThanOrEqual(posBefore)` 恒真（M5）。
- u3(68-81) navigate(queryFromId) 同步草稿且 nameInput 空；navigate(queryFromEntry) 同步 nameZh。守跨 store 不变量，强。
- 缺口：**`goBack`/`goForward` / `init` / `selectView` / `selectExpr` / 栈截断（navigate 后再 navigate 覆盖 forward 分支）全 0 覆盖**。

---

## ②「无意义 / 可疑」清单（`文件:行号` + 反例实验思路）

**M1. 同义反复（整例空心）** — `src/services/dataset.test.ts:394-399`
```ts
for (const e of ds.search) expect(e.addr).toBe(addrHex(e.kind, e.id));
```
`dataset.ts:124-138` 构造时写的就是 `addr: addrHex(<同 kind 字面>, <同 id>)`，期望值与被测值同函数同参数。
反例：把 `idspace.ts:15` 的 `ID_BASE.item` 从 `0x18e40` 改成 `0x10000` → 这条仍绿（两侧同变），但游戏真实地址已错。⇒ 注释所称「本次改动的核心不变量」是自证；真正守住它的是 d38 的字面 `'18e41'` 与 d41 的地址回查。建议 **drop**（或改为断言若干字面地址）。

**M2. 同义反复（排序/去重从未被断言）** — `src/services/search.test.ts:56-63`
```ts
const a = buildResults(expr, ds); const b = buildResults(expr, ds);
expect(a).toEqual(b);   // 纯函数同输入两次
expect(a.length).toBe(1);
```
反例：把 `search.ts:123` 的 `out.sort(...)` 删掉 → a、b 同样未排序、仍 `toEqual` 绿（排序不变量在标题里，断言里不存在）；`length===1` 已在 s3 断过。
建议 **drop** 或改为真正跨 kind 排序：`buildResults([{category x3}...])` 断言 item<unit<skill 且同 kind 按 id 升序，并造一个 (kind,id) 重复源验证去重。

**M3. 标题声称的分支不可达（假覆盖）** — `src/services/search.test.ts:65-70`
`idExact value: 0x9b`，而 `search.ts:152` 的 `byAddr` 要 `ent.addr === value.toString(16)`；addr 是 `0x17ab6+id` 的 5 位 hex（0x9b→`17b51`），永不等于 `'9b'`。
反例：把 `search.ts:152` 改成 `const byAddr = false;`（或删该行）→ 87 例全绿。且全测试集所有 `queryFromId` 传的都是**实体 id**（列表见 grep：item1/item2/unit/ map0x54/skill1），`byAddr` 分支在任何用例中都不为真。
建议 **upgrade**：补一条 `value: 0x17b51` 的 idExact 断言（应命中 unit 0x9b），否则该分支是「无测试的死代码」。

**M4. 不可失败的「自动强制单位」例** — `src/services/search.test.ts:100-110`、`152-157`（s20:183-186 同型）
断言 `view.every(r => r.kind==='unit')`，但在 `collectByKind`（search.ts:83-91）里只有 unit 分支会给 `unitAttr`；其余 kind 的 `ent.unitAttr` 为 undefined ⇒ `matchesAll` 的 `v=null !== p.value`（158-159）/ `star===null → false`（164-165）本就把非单位全部挡掉。
反例：把 `normalizeExpression`（search.ts:128-133）改成 `return expr;`（等于删掉「自动强制 unit」）→ 上述用例**全绿**，因为 kinds 扩到 ALL_KINDS 后非单位仍无一命中。⇒ 关切是真的（不变量在），但断言方式自证；`normalizeExpression` 成了不可观测逻辑。
建议 **upgrade**：向 `buildDataset` 注入一个非 unit 但带 `unitAttr` 的假 `Searchable`（或直接对 `normalizeExpression` 做可观测断言，例如导出它在 `buildResults` 里的 kinds 选择），使该分支一改就红。

**M5. 恒真断言** — `src/store/useStore.test.ts:65`
`expect(st.pos).toBeGreaterThanOrEqual(posBefore)`：`navigate`（useStore.ts:62/69）总是 `pos = next.length-1`，而 `next` 由 `history.slice(0, pos+1)` 扩张，pos 单调不减。
反例：无法构造失败输入。前半 `length===before+1`、`pos===length-1`（63-64）已完整覆盖。建议 **drop 该行**。

**M6. 弱阈值 + 与更强用例重复 + 标题已失真** — `src/services/dataset.test.ts:76-81`
`expect(resolved).toBeGreaterThan(total*0.7)`；实测 `unitRef` 未解析数 = **0/1791**，而 d18（163-175）已断言「每个槽都 `byUnit.has` 为 true」。标题「少数特殊值除外」已不成立。
反例：把 10% 的 `unitRef` 改错 → `>0.7` 仍绿，d18 红。⇒ 冗余且更弱。建议 **drop**（并入 d18）。

**M7. 只证非空的整例** — `src/services/dataset.test.ts:37-46`
遍历 `mapsWithUnit` 取 map 最多的单位，只断言 `best!==null` 与 `bestCount>0`。
反例：让每个单位只映射到 1 张错误地图 → 仍绿。建议 **upgrade** 为具体锚点（例：断言某 unitId 的地图名列表字面），或 **drop**。

**M8（弱，非无意义）** — `src/services/dataset.test.ts:458-471`：`a.key===b.key` 为同一构造的两次，半自证；但 `a.key!==c.key` 提供了齿（若 `expressionKey` 恒返回 `''` 则红）。可保留，建议把 a/b 换成**不同子句顺序**的两个表达式以顺带守规范化。

**M9（弱，重复）** — `src/store/useSearchDraft.test.ts:68-75`：`toExpr(){return get().expr}` 是纯透传，三条 `toContainEqual` 与 p2/p4 对同一状态的断言重复。
反例：`toExpr: () => []` 会红（有最低齿）。建议 **merge** 进 p2/p4，或改为断言「toExpr 返回归一化后的引用/不与 state 共享可变数组」等 p2/p4 不覆盖的性质。

**M10（弱，重复 pattern）** — counts 自洽四处：`dataset.test.ts:88-91`、`105`、`229-230`、`296-298`。它们只能抓「counts 字段与数组不同步」的提取器 bug，抓不到「两者一起错」。作为 ratchet 保留，但属同一不变量的 4 次复制。

**M11（弱）** — `dataset.test.ts:443-451`：`expect(e.label).toContain('×')`，而 `describeViewLabel`（dataset.ts:231）恒拼接 ` ×N`；除非整段被重写否则不会红。建议改为断言 `×3` 全串。

**M12（同源重算，但被锚点救回）** — `search.test.ts:141`/`149`/`108`/`116`：`ds.byUnit.get(r.id)!.star!+1===3` 之类是把 `matchesAll` 的过滤算式重算一遍（class #3）。s14 有独立锚点 `0x136`，故整例仍强；s15/s11 无锚点，属「实现自证」，建议各补 1 个真值锚点。

---

## ③ 重复覆盖 / 空心化观察

**重复覆盖**
1. `expressionKey` 顺序无关被写 3 遍：`search.test.ts:74-78`（cat+name）、`119-123`（unitAttr）、`159-163`（unitStar）——同一 helper 同一不变量，可合并为表驱动 1 例；3 例都没测 `search.ts:206` 的**第二键 `keyOf(a).localeCompare`**（同 order 内排序）与空表达式 `''` 分支。
2. map54 名称断言 2 遍：`dataset.test.ts:20-25` 与 `83-86`。
3. hex 候选完整匹配 2 遍：`dataset.test.ts:140-149`（item/unit）与 `361-366`（skill）。
4. counts vs 数组 4 遍（M10）。
5. `queryFromId('item',1)` 的 arrange 在 `search.test.ts:38-44` 与 `dataset.test.ts:425-432` 各建一次（断言对象不同，属可接受的轻度重叠）。
6. describeView 的「key 字面 + label contains + kind」骨架在 `dataset.test.ts:368-376 / 425-432 / 434-441` 三连复制。
7. 弱阈值 vs 强全集：`dataset.test.ts:76-81` ↔ `163-175`。

**空心化 / 与 gate 脱节**
- **87 例不在 CI gate**：`deploy-pages.yml` 只 `npm run build`，从不 `npm test`（无 `pretest`、无根 verify 引用）。⇒ 整套测试当前只能靠人工记得跑。
- **测试对象名不副实**：`dataset.test.ts` 47 例里约 20 例（d8/d9/d10/d19/d20/d21/d22/d23/d24/d25/d26/d27/d28/d29/d30/d31/d32/d33/d34）只用 `md.*`（JSON 衍生物），完全不经过 `buildDataset`/`buildResults`。它们是**提取管道的数据契约棘轮**，不是 `dataset.ts` 的单测；名字叫 dataset.test 会让人误以为 dataset.ts 被覆盖。
- **棘轮跑在可能过期的衍生物上**：`public/` gitignore + 无 `pretest`，若 src 变了而 metadata.json 没重生成，测试要么读旧数据绿、要么因数据变更红——两种都不是代码信号。
- **标签映射双实现、双自证**：`UNIT_ATTR_LABEL` + 种族/性别/属性名表在 `rules.ts:32-36,68-72` 与 `search.ts:261-274` 各存一份；`rules.test.ts:16-23` 只验前者、`search.test.ts:125-128` 只验后者。没有任何用例断言**两者对同一谓词渲染一致**——两处漂移会静默通过（一个改了自己那份 + 自己那份测试）。
- **文档不变量 > 测试不变量**：`docs/README.md:40` 称训练 `skillId` **100% 命中 skills[]**，测试 `dataset.test.ts:267-273` 只断 `some`。文档比测试严。
- 覆盖空洞（非空心，但同一批）：`useStore.goBack/goForward/init/selectView/selectExpr`、`useSearchDraft` 的 star 轴与 `ensureUnit` 归一化分支、`dataset.loadDataset`、`search.matchesAll` 的 `byAddr` 分支。

---

## ④ 最该改的 3 件事

1. **修掉 3 条「绿得没有信息量」的断言，让关键分支可失败**：删除 `dataset.test.ts:394-399` 的同义反复（M1）与 `useStore.test.ts:65` 恒真行（M5）；把 `search.test.ts:56-63` 从「同输入两次相等」改为真跨 kind 排序+去重断言（M2）；把 `search.test.ts:65-70` 的 idExact 换成地址值 `0x17b51` 以真正打到 `search.ts:152` 的 `byAddr`（M3，当前该分支删掉全绿）。
2. **让「自动强制 unit」可观测，否则删掉 `normalizeExpression`**：给 `buildResults` 注入一个非 unit 却带 `unitAttr` 的 Searchable（M4），或用可观测方式断言 kinds 选择；同理把 `dataset.test.ts:76-81` 删掉并入 `163-175`（M6），把 `37-46` 换成具体锚点（M7），把 `267-273` 的 `some` 升到文档宣称的 100% 命中。
3. **把测试接进 gate 并补上真空白**：(a) `package.json` 加 `pretest: node scripts/extract-metadata.mjs`（或在 `test/` 放一份 fixture），使全新 clone 的 `npm test` 不因 `public/` 未生成而 ENOENT；(b) 在 `deploy-pages.yml` 的 `npm run build` 前加 `npm test`（或接进仓库 verify）；(c) 把 20 个 `md.*` 用例拆成 `metadata.contract.test.ts`（数据棘轮）并给 `useStore.goBack/goForward`、`useSearchDraft` 的 star 轴/`ensureUnit` 分支补红测。

---

### 附：本次未做的验证（残余不确定性）
- 未执行任何变异/反例（M1/M2/M5 是逐字节可判定的同义反复，结论确定；M3/M4/M6/M7 是可达性论证，置信度高但未跑）。
- 未运行 `npm test`（CPU 约束 + 只读），因此「87 例当前是否全绿」未经运行确认；所有真值锚点用 `node` 直读 `public/data/metadata.json` 核对过。
