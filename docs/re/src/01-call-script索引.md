# `call-script <index>` 索引与调用图（src）

> 级别：**已确认**（脚本/容器实证 + 工具产物）。

---

## 1. `call-script <index>` = SYS4INI / APPEND 文件索引（已确认）

`call-script <index>` 的参数是 **SYS4INI.BIN 文件位置（base）或 APPENDnn.AAI（`0xnn000000+pos`）**，已实证：

- `call-script 2d` → `CHARMEDIT.BIN`；`3a`→`SETCHARM.BIN`；`46`→`DRAWCHARM.BIN`；`47`→`SETWEATHER.BIN`；
- `call-script 5261/5262/5263/5264/5265/5266/5267/5268/526a` → `INIT2/LOGO/INIT/TITLE/ALLMAP/REIGN/FIELD/NOVEL/DEAL`；
- `call-script 1000174` → APPEND01 pos372 → `$1$SCINIT.BIN`。

**工具**：
- `scripts/alf/unpack_alf.mjs` + `lzss.mjs`：解 `SYS4INI.BIN`（`S4IC450`，LZSS TOC）得其文件表。
- `scripts/annotate-call-script.js`：给 src/*.txt 里**立即数 call-script** 行尾追加 `// 文件名`（动态 `call-script (global X)` 不标；幂等；`--dry-run`）。全工程 469 文件、8069 处标注、0 未解析。

---

## 2. call-script 调用图（脚本级结构）

工具：`scripts/build-callgraph.mjs` → `output/callgraph.html`（架构视图）、`output/callgraph-full.html`、`output/callgraph-*.gv`、`output/callgraph.json`。

- 941 脚本、5602 条 call-script 边、583 个去重目标、469 个发起者；`call-script (global X)` 动态调用 42 处。
- **家族一致性**：
  - `SGXXXX`（125 成员）/ `SPXXXX`（27）/ `SNXXXX`（1）：**一致 ✅**，全部调用同一套 ~12 目标 → 可折叠为占位；
  - `SCXXXX`（178 成员）：**不一致 ❌**（121 种不同调用集），因每个 SC 有各自场景分支，但都收敛到同一批**框架枢纽**。
- **入口根**（不被 call-script 调）：`SYSTEM4`（主调度）、`TITLE→GAMESTART`、`SC*`（经 SYSTEM4 动态分发）、`STAGEREADY/STAGEROUND/STAGECLOSE`（战斗）、`$n$AUTORUN`（追加包）。
- **框架枢纽**（被最广调用）：`MENU/SAVE/CONFIG/INFO/QUIT/HISTORY/CHARMEDIT/DRAWCHARM/SBUNKI/BUNKI/HIDEWIN/SETCHARM/SETWEATHER/SHOWPOP/REPLAYVOICE/ADDDP/COMMITDR/RENDERMAP/LOOK/UNITECH`。

---

## 3. Todo（src 域）

- [ ] `SC` 家族 121 种调用集（若需按场景细分可导出完整清单）。
