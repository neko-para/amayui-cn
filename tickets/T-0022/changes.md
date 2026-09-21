# T-0022 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：跨包边收口（opcodes.json 包内副本）+ 孤儿文件清理

### 判据 1：`npm run build` 是否触发 TS6059 —— **不触发**（附实证），但跨包**输入**仍要收

- `tsc -p tsconfig.json`（`rootDir: src`）**exit 0、无诊断**；`--listFilesOnly` 当时显示程序里只有
  仓根那份 `scripts/asm/opcodes.json`。
- ★**但产物布局被它破坏**：`dist/opcodes.json` 逸出到 `dist/tsc/` 之外（那是 2026-09-10 的旧产物），
  `dist/tsc/opcodes.js` 里留下的说明符 `'../../../scripts/asm/opcodes.json'` **从 `dist/tsc/` 出发解析不到任何东西**
  ⇒ "今天不炸"≠"没有隐患"，这条按票面建议收掉。

### 修法（按票面判据原话："把 opcodes.json 生成物同步进 `src/generated/`"）

1. `scripts/asm/build-opcodes.js`：**同一次** `JSON.stringify` 写两份 ——
   `scripts/asm/opcodes.json`（**真源**，装配器/全部测试读它）与
   `app/amayui-emulator/src/generated/opcodes.json`（**包内副本**，`src/opcodes.ts` import 它）。
2. `src/opcodes.ts` 的 import 由 `'../../../scripts/asm/opcodes.json'` → `'./generated/opcodes.json'`。
3. **实证**：`npx tsc -p tsconfig.json --listFilesOnly | grep opcodes.json` ⇒ **只剩包内那一份**；
   `npm run build` 后 `dist/` 下**无逸出文件**（删掉旧的 `dist/opcodes.json` 后重建也不再生）。
4. 生成器**幂等性**先验过：跑一次前后 `scripts/asm/opcodes.json` 的 sha256 相同
   （`B11CC847…7D41`），所以本次生成不会偷偷改数据。

### 判据 2：孤儿文件

| 文件 | 结论 |
|---|---|
| 仓根 `age_map_src.mjs` | **早已不存在**（票面条目陈旧） |
| `dist/tmp_scan.js` / `dist/tmp_trace.js.map` / `dist/tmp_scan.js.map` | 三个陈旧 scratch（09-05/09-06）已删；`grep -r "tmp_scan\|tmp_trace"` 零引用 |
| `electron/ipc/files.ts` → `scripts/agf/format.js`（A5） | **保留跨包并登记理由**：`tsconfig.electron.json` 本就为它设 `rootDir: "../.."` + `allowJs`，且它由 esbuild 打包（不是 tsc 输入）⇒ 无需副本 |

### 守卫（新增 `test/opcode-json-sync.test.ts`，2 条）

① 两份**逐字节相同**（生成器写的是同一个字符串 ⇒ 不一致只可能是"改了真源忘了重跑"）；
② 副本内容可用（条数 > 500 + `opcode/argc/name` 形状），防"两份都空也算相同"的假绿。
（`--listFilesOnly` + 无逸出文件是手工实证，见上；自动化那半就是这两条。）

### 验证

- `npm run verify` 全绿（typecheck ×3 + 全量测试 + 死写闸门）；`refactor-plan` §10 的第 8/9 项销账。
