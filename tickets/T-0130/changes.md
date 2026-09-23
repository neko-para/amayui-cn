# T-0130 · 变更记录

## 第 1 次变更（2026-09-23）：守卫从「文件存在」升级为「**用例存在**」，并把规则抽成唯一实现

### 1. 规格（向后兼容）

```
test/adv-msgwin.test.ts                          ← 旧写法：只查文件存在（仍支持）
test/adv-msgwin.test.ts#0x71 在跳读/自动模式      ← 新写法：再查「这个字面串出现在该文件里」
```

`#` 后写**该文件里真实存在的用例名片段**（取够区分的一段即可）。⇒ 用例被改名/删除/搬走时，台账**当场变红**。
用"字面串"而不是"解析出 test 名再比对"，是为了与既有两套锚点棘轮（`analysis/scripts.json` 的 `layout[].anchor`、
票据的 `evidence[].anchor`）**同构**：少一套解析器、少一类漂移。

### 2. 规则**只有一份**（顺带做掉本票的 item 4）

原先这条规则在 **4 个地方**各写一遍：三个 TS 守卫测试 + 三个 CommonJS 校验器
（`capabilities.js` / `scripts.js` / `tickets.js`）。审计已经抓过一次"两处实现不同步"的事故
（`capabilities.js` 的注释里记着那件事）。

现在：

| 物 | 角色 |
|---|---|
| `scripts/lib/guard-spec.cjs` | **唯一实现**（`splitGuardSpec` / `checkGuard` / `checkGuards`） |
| `scripts/lib/guard-spec.d.cts` | 给 TS 侧的类型声明 |
| `app/amayui-emulator/test/guardAnchor.ts` | 只是**再导出**（TS 侧 import 面保持稳定） |
| 三个 `--validate` 工具 | `require(path.resolve(root, 'scripts', 'lib', 'guard-spec.cjs'))` |

★踩坑记录：三个校验器是 **CommonJS**（`const fs = require('fs')`），所以共享物必须是 `.cjs`
（用 `.mjs` 会 `ERR_AMBIGUOUS_MODULE_SYNTAX`）；另外本文件头注释里一度写了
`.agents/skills/*/scripts/…`，其中 `*/` **提前终止了块注释** ⇒ 解析报
`Unexpected identifier 'capabilities'`（已改成 `<skill>`）。

### 3. 消除"11 条能力共用一个 guard 文件"的失真

`analysis/engine-capabilities.json` 里有 **11 条能力**的 guard 都写成 `test/adv-msgwin.test.ts`
（并把全部 guard 指向 `test/harness.ts` 也全绿）。现在每一条锚到**该文件里不同的用例名**：

| 能力 id | 锚点（用例名片段） |
|---|---|
| `adv-flag-lifecycle` | `0x71 在跳读/自动模式（97050≠0）下保留显示态并置 ADV` |
| `adv-perframe-dispatch` | `ADV 每帧服务：未显示完判定成立时清掉 ADV` |
| `adv-text-reveal-progress` | `0x1CA SetConfig(message:ReadTextSkip)：运行期覆盖门控生效` |
| `msgwin-text-object` | `0x6E show-text / 0x6F end-text-line / 0x196 display-furigana：文本内容按槽记录` |
| `adv-input-pump-perframe` | `0xFA poll-msg-advance 已注册且不抛错` |
| `msgwin-object-table` | `消息窗对象表：0x212 / 0x213 / 0x25D 写同一对象的三个字段组` |
| `msgwin-cancel-key-state` | `set:CancelMesSkipOnClick 下按住 ⇒ 三态机进 stage2` |
| `adv-advance-opcodes` | `★0x72 wait-for-input：结束一页并置等待推进门` |
| `msgwin-text-method-opcodes` | `★重跑 0x72（悬停 ret 回到门指令）不得重启已显完的逐字显现` |
| `msgwin-attr-font-opcodes` | `0x2DE = 字体名 → 字体表下标` |
| `text-reveal-pump-409400` | `★逐字显现速度定律：MessageSpeed = **每字**毫秒` |

（迁移前先 `grep` 核对 11 个锚点都真的在文件里；无一条靠猜。）

### 4. 证伪（两侧都实测过）

把 `adv-flag-lifecycle` 的锚点改成不存在的用例名：

| 侧 | 结果 |
|---|---|
| `node .agents/skills/amayui-engine-analysis/scripts/capabilities.js --validate` | **✗** `adv-flag-lifecycle 的 guard 不存在：…#这个用例根本不存在（反例）（文件里找不到锚点「…」）` |
| `npx tsx --test test/capability-ledger.test.ts` | **✗ 1 fail**（同一条消息） |

还原 ⇒ 两侧都绿。

### 5. 结果

- 四份台账自检全绿：tickets 129 / capabilities 139 / scripts 33 /（+opcode-gaps 由另一套守）
- 三个守卫测试 + `organization` 共 **25 例全绿**；`tsconfig.test.json` 错误数仍为基线 **131**（新增 `.cjs` import 未引入新错）
- 三个技能的 `SKILL.md` 已同步这条规则（engine-analysis / script-analysis / ticket-ledger 三处同源，改一处要三处同步）
