# T-0032 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：路径基准收进 `tools/paths.cjs`（唯一真源）+ 越界前置报错

### 规则（写进代码头注释、启动日志与 `docs-new/04-app/emulator.md` §7）

- **两个 Electron 跑手（`record.cjs`/`shot.cjs`）的路径参数一律按"仓库根"解析**，起跑打印
  `[paths] --scenario = <绝对路径>（命中规则：…）` / `[paths] --out = <绝对路径>（命中规则：仓库根 …）`；
- **越出仓库 ⇒ 前置报错 + `exit(2)`**：一行可读信息（含"基准是仓库根、要写临时区请用 `.tmp/…`"），
  且这行发生在 `require('../dist/electron/main.cjs')` **之前** ⇒ 再也不会出现
  「App threw an error during load」弹窗（旧写法在 `fs.mkdirSync` 处抛 EPERM，异常冒到加载阶段）；
- **老写法仍然可用但会被报告**：`--scenario tools/scenarios/gamestart.json`（在包目录下敲）仓库根候选
  不存在、cwd 候选存在 ⇒ 用 cwd 候选并把 `how=cwd(fallback)` 打进日志（**不做静默双基准**）；
- `--out .tmp/x` ⇒ **仓库** `.tmp/x`（与 `shot.cjs` 固定写仓库 `.tmp/` 一致 ⇒ 票面"产物落在仓库 .tmp/"成立）；
- `shot.cjs` 顺带：参数解析与校验**上移到 `require(main.cjs)` 之前**（原来在之后），并新增 `--name` 校验
  （只是文件名，不许带路径分隔符/`..`；否则产物会写到别处）。

### 改动文件

| 文件 | 改动 |
|---|---|
| `app/amayui-emulator/tools/paths.cjs` | **新增**：`ROOT` / `ToolPathError` / `isInside` / `resolveRepoPath` / `preflight`（唯一真源） |
| `app/amayui-emulator/tools/record.cjs` | 用 `preflight({scenario, out})` 取代原来的两种 `path.resolve`；`OUT`/`SCENARIO_PATH` 来自它 |
| `app/amayui-emulator/tools/shot.cjs` | 参数块上移到 `require(main.cjs)` 之前 + `--name` 校验 + 打印产物目录与基准 |
| `src/tools/scenarioRun.ts` | headless 跑手保留 **cwd** 基准（不搬产物落点），但**打印最终绝对路径** + usage 里写明两种基准的差别 |
| `docs-new/04-app/emulator.md` §7 | 命令示例改成 `.tmp/…`；新增"路径参数基准"小表（两条规则 + 历史事故 + 守卫位置） |

### 守卫 `test/tool-paths.test.ts`（7 条）

① `--out .tmp/x` ⇒ 仓库 `.tmp/x`；② **越界**（`../../.tmp/x`、`../x`、仓库外绝对路径）⇒ 抛
`ToolPathError`（票面实测那条正在其中）；③ `--scenario` 两种写法解析到同一文件且 `how` 分别为
`cwd(fallback)`/`absolute`；③反面 指向不存在文件 ⇒ 可读报错并列出候选；④ **源码棘轮**：两个跑手都
`require('./paths.cjs')` 且 `preflight` 排在 **行首的** `require(main.cjs)` 之前（按行找，避免被文件头
注释里的同一串骗到 —— 第一版就是这么假红的）；④`--name` 校验存在；⑤ `isInside` 边界（前缀相似不是子目录）。

### 判据对照

| 票面判据 | 状态 |
|---|---|
| ① 基准统一且写明 + 打印最终绝对路径 | ✅（两个 Electron 跑手统一为仓库根；`scenario` 打印绝对路径并写明它是 cwd） |
| ② 越界前置报错、退出码 ≠ 0、不再弹窗 | ✅（`exit(2)` + 位置在 `require(main.cjs)` 之前，有源码棘轮钉住） |
| ③ 回归命令正常产出 | ⚠**部分**：路径层已用 7 条守卫 + `node --check` 覆盖；`npm run record`/`shot` 需要 Electron 真窗口 ⇒ 本机 headless 不能跑（见下） |
| ④ 示例路径基准一致 | ✅（`emulator.md` §7 的示例与说明已改；`tools/scenarios/*.json` 只含 spec 内容、无路径） |

### 仍未做（为什么本票**不**标 done 的备选理由）

`npm run record -- --scenario tools/scenarios/gamestart.json --out .tmp/x.jsonl.gz` 与 `npm run shot -- --gamestart`
的**真跑**需要 Electron 窗口（本机 headless 环境跑不了；仓里也没有 CI 可跑 Electron）。路径层已全部可自动化验证，
但"产物确实落到 `.tmp/`"这一步属于 G4/E4 类判据 —— 若要求必须真跑过才结票，请保留 `doing`。
