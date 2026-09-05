# 02-data · 训练所 / 单位字段 / 说话人 id / 存档

## 1. DRINIT（训练所）

- ✅ **训练者块 + TID + 「K−TID」字段列模型**（结骑训练词条）；base/追加包合并（`$3$DRINIT` 等，`$1/$2/$4/$5$DRINIT` 为无文本空壳）。
- ✅ 条件/奖励字段：消耗满足条件的单位（训练者单位=四结骑+双傀），字段 `prereq/quantity/race/gender/attribute/level/skillId`（枚举与 units 同构）。
- ✅ 训练所数据导出：`drinit-training-records.csv`；`app/amayui-toolkit` 含 `trainings[]`（`skillId` 100% 命中 `skills[]`）。

## 2. 单位字段（EBINIT）

- ✅ 单位种族：`0x52a0b4 + id`；性别：`0x52a49c + id`；属性：`0x52b054 + id`；星级：`0x5461ec + id`（0-based）。
- ✅ 特例：`0xcb 系留员神殿兵` 属性为 null（模板占位）。

## 3. 说话人 id ↔ EBINIT

- ✅ 说话人 id = 记录序 + 1（`CNINIT` 缺席补名）；`0x132` 重复问题。
- ✅ `CNINIT` 角色名称；`EBINIT` 单位/种族名。

## 4. 存档与内存

- ✅ **存档 ≠ BIN 快照**：`SAVE*.DAT` 是结构化动态状态流，**不持久化静态数据表**；进程内存扫描结论（`app/amayui-inspector` 可读运行中状态）。

## 5. 交叉引用

- 单位/训练所数据用于 toolkit 的 `units[]`/`trainings[]`，见 `./extraction.md`；说话人/单位名翻译真值见 `../01-translation/publish-status.md`（src 为真值）。
