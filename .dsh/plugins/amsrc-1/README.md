# amsrc-1 · 天結文案定位（源码备份）

动态 Cordis 插件（在 DSH 会话进程内定义、运行，**进程重启即消失**）。本目录保存其精确源码，
供 DSH 重启后按下方「恢复步骤」重新创建。**本文件不是可加载的模块**——动态插件只能通过
`cordis_define` + `cordis_run` 重建。

## 保存时的运行状态

- pluginId：`amsrc-1`；packageId：`pkg-2`（current）；pluginRunId：`run-2`
- 仅 Host 半（无 Client 半 → 激活无需审批）
- 注册的模型可见工具：`amayui_locate_text`

## 工具行为（amayui_locate_text）

- **只匹配 `// 输入原文：…` 注释行**——reflow 正文（show-text 拆分）与 `/* 原文存档 */` 不计入，
  同一句不会命中多份；
- 自动忽略 `<br>` 与空白/换行差异：游戏内跨行文字可直接原样粘贴；
- 返回取证信息：文件、脚本名（可直接作 `reflow-apply` / `assemble` 参数）、行号、页块行号范围、
  说话人（`// FROM:`）、日文原句（存档内 show-text 引号内容）、正文行、前后各 N 个页块的
  说话人+译文上下文（与 `scripts/adv-context.js --raw` 同口径）；
- 参数：`text`（必填）、`neighbors`（默认 2，范围 0–10）、`limit`（默认 20）；
- 与 `amayui-script-update` 技能协同：第一步「定位与取证」由本工具直接完成，无需再运行
  `scripts/adv-context.js`。

## 恢复步骤（DSH 重启后）

1. 读取 `host.js` 全文，逐字作为 `cordis_define` 的 `code.host`（含开头注释，不要改动转义）。
2. `cordis_define` 参数：
   - `plugin`：`{ "kind": "new", "idPrefix": "amsrc" }`
   - `name`：`天結文案定位`
   - `purpose`：`在 src/*.txt 中定位游戏译文片段（只匹配 // 输入原文： 注释行），返回文件、行号、说话人、日文原句与页块上下文，供评估流程直接取证使用。`
   - `code.host`：`host.js` 内容；`code.client` 省略。
   - 新插件 id 会重新分配（如 `amsrc-2`），以返回值为准。
3. `cordis_run`（mode `run`）激活返回的 `pluginId` / `packageId`。
4. 验证：`cordis_inspect_query`（platform `host` / provider `Tool` / method `listTools`）应出现
   `amayui_locate_text`。
5. 使用：在聊天中直接粘贴游戏内文案并说明要评估/定位即可；代理调用工具后按
   `amayui-script-update` 流程继续（评估 → 字母序号候选 → 确认 → 改页块 → reflow → assemble → CHANGELOG）。

## 变更历史

- `pkg-2`（当前）：修正 `extractOriginal`——多行 `/* 原文存档 */` 只提取各 show-text 引号内日文并按行拼接。
- `pkg-1`：初版。
