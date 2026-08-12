---
name: batch-task-runner
description: 批量执行大量同质化任务。当用户指定批量处理多个结构相同的任务（如逐个翻译/重排 N 个脚本、为每个文件生成 X、逐角色/逐条目分析等），且流程长、需要稳定可续跑时使用：在工程 .tmp 下创建任务专用临时目录，写入记录进度的 PROGRESS 文件与通用 PROMPT 模板，然后顺次用 codex CLI 子进程执行每一个任务，输出与日志独立落文件。
---

# Batch Task Runner（批量任务执行器）

## 概述

适用于「用户明确要求批量执行大量同质化任务」的场景。流程：

1. 在工程 `.tmp/` 下创建任务专用临时目录（`.tmp` 已 gitignore，产物不入库）；
2. 在目录内创建 **PROGRESS 文件**（记录全部任务与状态）与 **PROMPT 模板**（通用提示词）；
3. 按 PROGRESS 顺序，**顺次**用 `codex exec` 子进程执行每一个任务，每个任务的
   输出与日志分别写入独立文件；完成后更新 PROGRESS。

不适用：任务异构或数量很少；用户要求本会话内直接执行（如 amayui-script-translate
约定翻译不借助 codex CLI 子进程时，以该技能为准）；任务需共享会话上下文/交互式确认。

## 步骤

### 1. 确定任务清单

- 任务 = 一组结构相同、可独立完成的单元。为每个任务定唯一 `id`（如脚本名/文件名/编号）。
- 清单来源：用户给出、文件列表（`rg --files` 等）、或一次性脚本生成。
- 生成机器可读清单 `tasks.json`，格式：
  ```json
  {
    "tasks": [
      { "id": "SC0001", "input": "src/SC0001.txt", "output": ".tmp/demo/out/SC0001.md", "note": "可选" }
    ]
  }
  ```
  `input` 为任务输入（子进程读取），`output` 为结果文件路径，可带任意附加字段。

### 2. 创建任务专用临时目录

```
.tmp/<任务名>/
├── PROGRESS.md          # 进度（全部任务 + 状态列，按执行顺序）
├── PROMPT.md            # 通用提示词模板（占位符见下）
├── status.json          # 机器可读状态（批处理脚本维护）
├── outputs/             # 每个任务的输出文件
├── logs/                # 每个任务一次 codex 调用的 stdout/stderr 日志
└── tasks.json           # 任务清单
```

目录名用任务主题（如 `.tmp/character-analysis/`）。`outputs/`、`logs/` 可按需调整。

### 3. 写 PROMPT 模板（PROMPT.md）

模板是**通用提示词**，用占位符标记每个任务不同的部分；固定要求（输出格式、语言、
只写自己的输出文件、不修改其他文件）写死在模板里。示例：

```markdown
你是本工程的批量任务执行器。请处理输入文件：{{input}}
把结果写入：{{output}}
要求：
- 按固定结构输出（见任务说明），全程使用简体中文；
- 只读取输入、写出指定输出文件，不修改任何其他文件、不执行网络操作；
- 你的最终回复即结果文档。
附加字段：{{note}}
```

支持 `{{字段名}}` 占位符（大小写不敏感），从任务对象取值。

### 4. 写 PROGRESS 文件（PROGRESS.md）

列出全部任务（按执行顺序）+ 每项状态（待处理/执行中/完成/失败）+ 输出路径。
批处理脚本（见下）会从 `status.json` 自动生成并随进度刷新；手工执行时每完成一个
任务就更新对应行。PROGRESS 同时是「断点续跑」的依据：重跑时跳过已完成任务。

### 5. 顺次执行（codex CLI 子进程）

优先用本技能自带脚本 `scripts/batch-run.js`：

```bash
node .agents/skills/batch-task-runner/scripts/batch-run.js \
  --tasks .tmp/<任务名>/tasks.json \
  --prompt .tmp/<任务名>/PROMPT.md \
  --dir .tmp/<任务名>
```

脚本行为：

- 按顺序为每个任务执行一次 `codex exec --approve-for-me --ephemeral -o <output> <渲染后的提示词>`；
- 每次调用的 stdout/stderr 追加到 `logs/<id>.log`；
- 状态写入 `status.json`，并刷新 `PROGRESS.md`；
- 失败自动重试 1 次（`--retries`），仍失败则记失败继续，最后汇总；
- 断点续跑：`--only <id>` 单独重跑、`--from <id>` 从某任务开始、`--force` 重跑已完成；
- `--dry-run` 只打印将执行的命令；`--init` 只生成初始 PROGRESS.md。

不依赖脚本时，直接调用的关键点：

- **stdin 必须关闭**：codex exec 检测到 stdin 是管道时会一直等待输入——用
  `spawn` 且 `stdio: ['ignore','pipe','pipe']`；不要用 `execFile` 传自定义 stdio
  （其回调不会触发）；
- 每次调用输出与日志使用**独立文件名**（`<id>.log` / `<id>.out`），不要共用；
- codex CLI 需要网络：父进程命令需提权（require_escalated）；
- 子进程提示词只读输入、只写自己的输出文件，避免污染工程源文件。

### 6. 汇报

完成后报告：任务总数、完成/失败数、产物目录、失败清单（含原因与单独重跑命令）。

## 注意事项

- `.tmp/` 已在工程 `.gitignore`，中间产物不提交；
- 任务量大时按用户要求控制单次输入规模（如每任务最多 N 页、随机采样 N 次）；
- 每次 codex 调用是独立会话：任务间不共享上下文，跨任务依赖需写进输入文件；
- 若用户要求「并行」，用多个会话/进程时仍须各自独立输出文件，避免写冲突。

## 资源

- `scripts/batch-run.js`：通用顺序执行器（tasks.json + PROMPT 模板 → status.json +
  PROGRESS.md + logs/），支持断点续跑与失败重试。
