# 02-data · 地图 / 单位摆放 / 特殊点位

## 1. MPINIT（地图地板）

- ✅ 地图 id 联合：`(b228=地点id, b229=序号)`；大小参数 `0x5cd85`=列数 / `0x5cd86`=行数。
- ✅ 地板数据：`copy-local-array` 每块 `2×行` 条、每条 `2×列` 元素；起点 `0x5bd46`、步长 `0x41`；填值基础集 `{0,1,2}` + 可选地形码。

## 2. STINIT（单位摆放 / 战斗目标）

- ✅ `eq … b222 <mapNo>`：关卡 id；`0x121e2 + mapNo` = 关名；单位槽寄存器区间。
- ✅ STINIT2（场景 loc/seq）：场景字段（loc、seq）。

## 3. 特殊点位（采集/挖掘/刷怪旋涡）

- ✅ 记录坐标/类型；`stinit-special-points.csv` 等导出（`app/amayui-toolkit` 亦含 maps/locations）。

## 4. 交叉引用

- 地图/单位作为数据源用于 toolkit 的 `metadata.json`（maps=145、locations=34），见 `./extraction.md`；地图数据工具 `scripts/`。
