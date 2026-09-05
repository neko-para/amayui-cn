# 02-data · 数据提取口径（以 amayui-toolkit metadata 为准）

## 1. 统一来源与 schema

- ✅ **`src/` 是唯一权威数据源**；`app/amayui-toolkit/scripts/extract-metadata.mjs` 读 `src/` → 直接输出到 `app/amayui-toolkit/public/data/metadata.json`（统一 schema + 中文名）。
- 中文名真值来源：`src/` 的 `set-string "日文|中文"`（管道分隔），读取 `|` 后半段。
- `public/` 为衍生物（gitignored）；GitHub Pages 经独立 deploy 分支在 CI 构建生成并提交，主分支不提交衍生物。

## 2. 统一 schema 计数

- ✅ `metadata.json`：`items=923`、`buildings=113`、`recipes=458`（物品 356/建筑 102）、`units=373`（带掉落 214）、`dropEntries=671`、去重掉落物品 254、`maps=145`、`locations=34`、`skills=450`（带描述 449）。
- ✅ `trainings[]`（DRINIT，独立数据域）：`(trainerId, tid)`，字段 `prereq/quantity/race/gender/attribute/level/skillId`；`skillId` 100% 命中 `skills[]`。
- ✅ `units[]` 含 `race/gender/attribute`（枚举见 `app/amayui-toolkit/src/types/metadata.ts` 的 `RACE_NAME/GENDER_NAME/ATTR_NAME`）。
- ✅ `skills[]`（SKINIT + `$1$`..`$5$`）：只导出技能名 + 三行描述（题头/详述/简述，日中双份）；`skillId = 名串地址 − 0x1d4f4`。

## 3. 未汉化与特殊

- ✅ **未汉化项**：`nameZh===name` 物品 40 / 建筑 8 / 单位 6（未汉化或两侧同名），前端按「未汉化」回退展示。
- ✅ 特例：`0xcb 系留员神殿兵` 属性为 null（模板占位）。
- 🟡 单位「副标题」地址在 `src` 多落 `17e` 区间，与旧提取脚本判据（`17f-181`）表面不一致；本工程沿用已验证判据，产出 `title/titleZh` 正确。

## 4. 旧产物作废

- 旧主工程 `scripts/extract-recipes.js`、`extract-unit-drops.js` 及 `metadata/` 下多文件、纯日文、两任务格式的旧 JSON **已被统一 `metadata.json` 取代**；不再作为真值。

## 5. 交叉引用

- 数据表结构见 `./drops.md`/`./skills.md`/`./items-recipes.md`/`./maps-units.md`/`./training-speakers.md`；toolkit 工具见 `../04-app/toolkit.md`。
