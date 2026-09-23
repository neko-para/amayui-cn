# T-0131 · 变更记录

## 第 1 次变更（2026-09-23）：toolkit 的 88 个 vitest 用例接进闸门 + 消衍生物依赖 + 修 4 处无判别力断言

### 1. 接进闸门（原来 87 例不在任何闸门里）

`.github/workflows/deploy-pages.yml` 原来只 `npm run build`（生成 metadata + vite build），**从不 `npm test`**。
现在在 install 与 build 之间加了一步 `npm test`（并写明：它覆盖的是**数据查询 SPA**，与
`app/amayui-emulator` 的 `npm run verify`（VM/渲染/台账）是两个独立闸门；根级没有统一 verify ——
这一条如实记在票里，没有假装"已并入 verify"）。

### 2. 消"未入 git 的衍生物"依赖（全新 clone 不再 ENOENT）

`app/amayui-toolkit/.gitignore:2` 忽略 `public/`，`git ls-files app/amayui-toolkit/public` = **0**
（`metadata.json` 是 `build:data` 生成的），而没有任何 `pretest` ⇒ 全新 clone 上 `search`/`dataset`/`useStore`
三个文件的 `beforeAll` 会 ENOENT。

**修**：`package.json` 加 `"pretest": "npm run build:data"`。
**证伪/验证**：`rm public/data/metadata.json && npm test` ⇒ `pretest` 自动重建（1.9 MB）、
`Test Files 5 passed / Tests 88 passed`。

### 3. 无判别力断言（每条都做了反例实验）

| # | 位置 | 原形态 | 处置 | 反例实验（实测结果） |
|---|---|---|---|---|
| 1 | `src/services/dataset.test.ts:394-399` | `expect(e.addr).toBe(addrHex(e.kind, e.id))` —— 而 `dataset.ts:124-138` 构造时就写的同一表达式 ⇒ **同源重算、恒真** | 换成**两层判据**：① **字面 golden**（`item 1 → 18e41`、`skill 1 → 1d4f5`、`skill 0x28 → 1d51c`、`unit 0x9b → 17b51`）；② **经搜索内核的地址往返**（覆盖 `byAddr`） | 把 `ID_BASE.unit` 改成 `0x10000` ⇒ 本用例**红**（★第一版只做往返，改基址时两侧同变、**不红** —— 这个弱点是被这次反例实验抓出来的，才补上 golden） |
| 2 | `src/store/useStore.test.ts:65` | `expect(st.pos).toBeGreaterThanOrEqual(posBefore)` —— navigate 后 pos 单调不减，构造不出失败输入；且上一行已**精确**钉住 `pos === history.length - 1` | 删除（留注释说明） | 无法构造失败输入 |
| 3 | `src/services/search.test.ts:56-63` | 同一纯函数调两次 `toEqual`（恒真），而标题声称的"跨 kind 排序 + 去重"一句没测 | 重写为**真跨 kind**：先在 `ds.search` 里找一个**在 ≥2 个 id 空间都存在**的 id（各实体 id = 名串地址 − 各自基址，基址互不相干 ⇒ 天然重叠），再断：kind 按 `CATEGORY_ORDER` 非降、同 kind 内 id 升序、`(kind,id)` 唯一、谓词写两遍结果不翻倍 | 删掉 `search.ts:123` 的 `sort` ⇒ 红（原版仍绿） |
| 4 | `src/services/search.test.ts:65-70` | `idExact` 只传 `0x9b`（= unitId）⇒ 只走 `byId`，**`byAddr` 分支全测试集永不命中** | 补按**地址值** `0x17b51` 的查询（此时 id 下标 ≠ 地址值 ⇒ 只有 `byAddr` 能命中），并断 `addr === '17b51'` / `id === 0x9b` | 把 `search.ts:152` 的 `byAddr` 改成 `false` ⇒ 本用例**红**（原版 87 例全绿） |

### 4. 双实现一致断言（防静默漂移）

`rules.ts:68` 与 `search.ts:263` 各有一份手写 `UNIT_ATTR_LABEL`，取值名表（15 种族 / 3 性别 / 7 属性）
也各存一份 ⇒ 两边各有自己的测试，**漂移会静默绿**。
新增 `src/services/rules.test.ts` 的一条：25 个取值逐个断言
`expressionLabel(expr) === rulesFromExpr(expr).label.replace(': ', ' · ')`（分隔符不同、词必须一致）。
**证伪**：把 `rules.ts` 的 `race: '种族'` 改成 `'种族X'` ⇒ 本用例**红**。

### 5. 结果

| 口径 | 前 | 后 |
|---|---|---|
| 用例 | 87 | **88**（+1 双实现一致；4 处改写不增减例数） |
| `npm test`（`cd app/amayui-toolkit`） | 87 passed —— 但**不在任何闸门里** | **88 passed**，且 CI 会跑 |
| `npx tsc --noEmit`（toolkit） | — | exit 0 |

★三条反例实验全部实测过（byAddr 关掉 / 改 `ID_BASE` / 改 rules 标签），每条都让**对应的新用例**红，
而它们对应的**旧写法**在那三种改动下都不红（其中 ① 的第二层是这次实验补出来的）。

### 仍未做（如实登记）

- **`dataset.test.ts` 约 20/47 例只断言 `md.*`**（JSON 衍生物），完全不经过 `buildDataset`/`buildResults`
  ⇒ 它是**提取管道的数据契约棘轮**，不是 `dataset.ts` 的单测。票里建议拆成 `metadata.contract.test.ts`。
- **`useStore` 的 `goBack`/`goForward`/`init`/`selectView`/`selectExpr` 仍 0 覆盖**（"顶部不失效"的另一半在 `goBack`）。
- `search.ts` 的 `normalizeExpression`（自动强制 unit）目前**不可被失败**：非单位实体的 `unitAttr` 恒为
  `undefined`，注入不进去 ⇒ 需要构造带 `unitAttr` 的非单位 `Searchable` 才能真守。
