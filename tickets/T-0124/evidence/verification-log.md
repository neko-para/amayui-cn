# 独立复核记录（主 agent 亲自做的核对，2026-09-23）

> 为什么单列一份：7 份分组报告是**子代理**写的，它们的"无意义/可疑"结论是本报告全部建议的依据。
> 凡是**要写进结论**的关键判定，主 agent 都亲自复核过一遍；本文件记录**逐条复核结果**（含**两条对子代理结论的订正**）。
> 复核手段只有三种：① 读源码/测试源码本体（不只看报告）；② 实测探针（`node -e` / 单跑测试）；③ 变异注入（见 `mutation-campaign.md`）。
>
> 判定口径（全报告统一）：**价值 = 把被测实现改坏时它会不会红，且红的理由正确。**

---

## A. 复核通过的结论（子代理报告可信）

| # | 结论 | 复核方式 | 结果 |
|---|---|---|---|
| A1 | `test/op-2ed-and-bit-index.test.ts:112-122` 是**同义反复** | 读 `test/harness.ts:33`：`instr()` 的定义就是 `argc: args.length`；该用例 `assert.equal(instr(op,args).argc, args.length)` 两侧同一表达式 | ✅ 成立（唯一能红的条件是改 harness 本身） |
| A2 | `test/operand-plan.test.ts:523-527` 的"分区覆盖等式"**恒真** | 读 `:514-522` 的 `if / else if / else`：每个 `checked` 元素必进且只进一个桶 ⇒ 四桶之和 ≡ `checked.length` | ✅ 成立（断言永不红；`:528`/`:529` 两条棘轮才是真判据） |
| A3 | `test/op-d0-wallclock.test.ts:94-97` 是**同义反复** | 读码：`const { got } = await run(42)` 用的引擎在 `run()` 内部新建；`:93` 起又 `new Engine(...)` 造了**第二个**引擎，从未跑 `0xD0`，只做 `enc`→`dec` 往返 | ✅ 成立 |
| A4 | `test/op-205-blank-extent.test.ts:75` 是**同义反复** | 读码：`assert.equal(advance(ch,30,M1).valueOf(), advance(ch,30,M1))` 两侧同一表达式；且实测 `node -e` 确认 **Node 24 的 `assert.equal(NaN,NaN)` 不抛**（官方对 NaN 特判）⇒ 注释声称的"防 NaN"也做不到 | ✅ 成立（子代理对，主 agent 的第一直觉"NaN 会红"**是错的**） |
| A5 | `test/music-table.test.ts:120` 是**纯字面量运算** | 读码：`assert.equal(0x1000001 & 0xffffff, 1)` 完全不引用被测对象；上一行 `:119` 已独立钉住 `===0x1000001` | ✅ 成立 |
| A6 | `test/missing-texture-skips-item.test.ts:64-85` 是**对 emulator 源码文本的正则棘轮** | 读码：`:68` 认 `#placeholder(it: Item)` 签名、`:72` 查日志文案、`:83` **要求分支注释里含 `raw 122952\|DrawTexture 报错`** | ✅ 成立（诚实标为"棘轮"，但判别力远低于 `presenter.itemSprite(...) === null`） |
| A7 | `test/capability-ledger.test.ts:74-93` 的 guard 检查**只有 `fs.existsSync`** | 读码 | ✅ 成立（无法防"11 条能力共用同一个 guard 文件"） |
| A8 | `tsconfig.json` 把 `test/` 排除在 typecheck 之外 | 读 `tsconfig.json`：`"exclude": ["node_modules","dist","test"]`；`tsconfig.control.json` / `tsconfig.electron.json` 只 `include` `src/**` + `control/**` / `electron/**` | ✅ 成立（`npm run typecheck` 三遍都不覆盖 `test/`） |
| A9 | `parseDebugCommand` 是**零生产调用者的死代码** | `grep -rn parseDebugCommand src/ electron/ tools/ test/`：定义在 `src/vm/debugBreak.ts:514`，**调用者只有 `test/debug-break.test.ts`**；生产走 `session.ts` 的 `compileBreak` | ✅ 成立 |
| A10 | 调试命令表**分裂成 3 份** | `src/vm/debugBreak.ts:514`（被测试、无人调用）、`control/control.ts:266-298`（活、无测试）、`tools/debugsrv.cjs:262-300`（活、无测试） | ✅ 成立 |
| A11 | 面板**用户可见帮助**里写着非法事件名 `global-write` | 读 `control/control.ts:246-247`（`类型：global-write / slot-bind`）；合法值是 `EVENT_KINDS`（`debugBreak.ts:485-490`：`global-int-write` / `global-float-write` / `global-str-write` / `slot-bind`） | ✅ 成立（且缺 float/str 两池；无任何测试覆盖 `control/`） |
| A12 | `control/control.ts:38-43` 的 `opHex()` 用 `padStart(3,'0')` | 读码确认（★主 agent 第一遍在 `src/` 下搜不到而误判为"定位错误"，实际文件在 `app/amayui-emulator/control/control.ts`；**这条订正属于我自己**） | ✅ 成立；覆盖情况见变异 `M16` |
| A13 | 5 处 **`console.warn('[skip]…'); return;` 假绿** | `grep -rn "console.warn('\[skip\]" test/*.test.ts` = **5 处**，分布在 `live2d-moc.test.ts`（`:62/:183/:188`）与 `live2d-deform.test.ts`（`:246/:288`）；对照全仓 `t.skip(` = 31 处 | ✅ 成立。这些用例的回调**不接 `t`**、返回前不调 `t.skip()` ⇒ node:test 记为 **pass**（零断言）。`live2d-moc.test.ts:5` 的注释自称"缺 ⇒ `skip` + 诊断（**不假装通过**）"，**与行为相反** |
| A14 | `engine-config.test.ts:160` 是**错 oracle**（会挡住正确修复） | 子代理给出 raw 依据（`raw 23695` = `= v37 != 0` ⇒ 引擎存 0/1）。主 agent 未逐字复核 raw，但该条**方向上与 `src/engineConfig.ts:243-244` 的 note 自称"布尔化却无 map"一致** | ⚠️ **采信但标注为待逐字核 raw**（不计入"已确证"） |
| A15 | 全量测试的真实规模 | 实跑 `npm test`：`tests 1078 / pass 1066 / fail 0 / skipped 12` | ✅ 成立（覆盖 T-0115 记的 1059/155 文件已增长） |

---

## B. 订正子代理结论（★重要：两条）

### B1 ❌ G2 把 `test/call-frame.test.ts:81` 判为"同义反复" —— **不成立**

- G2 的说法：`:81` 是 `e.globals.int.set(7,42)` 之后 `assert.equal(e.globals.int.get(7),42)`，"arrange 即 assert"。
- 实际读码（`:76-81`）：

  ```ts
  e.globals.int.set(7, 42);                                     // :76  arrange
  loadScriptIntoFrame(f0, mkScript([...]), 'B.BIN');            // :79  ★被测动作：重载脚本
  assert.equal(f0.locals.int.size, 0, '载入后局部池应为空…');       // :80
  assert.equal(e.globals.int.get(7), 42, '全局池是跨脚本状态，**不得**被清'); // :81 ★断言在动作之后
  ```

  ⇒ `:81` 断的是"**重载脚本不得清掉全局池**"，arrange 与 assert 之间隔着一个真实动作，**不是** set→get 自证。
- 它真正的弱点不是"无意义"，而是**结构上几乎不可证伪**：`loadScriptIntoFrame(frame, …)` 的签名里拿不到 `Engine`/globals，任何不动签名的改动都无法清全局池。⇒ 归类应为**弱**（`weak`），不是"同义反复"。
- 正确的加强方向（G2 自己也提到了）：把 `:80` 的 `f0.locals.int.size === 0`（**断言内部表示**：稀疏 Map 为空）换成行为断言"重载后读 `local 7 == 0`" —— 后者在"预填 `enc(0)`"这种等价改写下**不该红**，而 `size===0` 会红。

### B2 ⚠️ G4 把 `test/overlay.test.ts:121` 判为"**永不红**" —— **过强，实测会红（但红的方式不对）**

- G4 的说法：`assert.rejects(store.write('x.txt','y'), /拒绝写/)` **未 await**，实测"本该失败时仍 `pass 1 fail 0`"。
- 主 agent 的实测（变异注入 + 单跑该文件）：

  ```
  # 注入：删掉 src/arch/overlay.ts:146 的 same-dir 拒绝
  $ npx tsx --test test/overlay.test.ts
  ℹ Error: Test "overlay 与 base 指同一目录 ⇒ 拒绝写（防止把真数据当 overlay）" at test/overlay.test.ts:1:3542
            generated asynchronous activity after the test ended. This activity created the error
            "AssertionError [ERR_ASSERTION]: The input did not match the regular expression /拒绝写/"
  ✖ test/overlay.test.ts (793.71ms)
  ℹ tests 14 / pass 12 / fail 1
  ```

  ⇒ 在这个文件里（13 个用例、后面还有真异步用例把事件循环撑住）**回归会被抓到**，但**报告形态是"测试结束后产生了异步活动"**、失败挂在**文件**上，而不是那一条断言上。
- 结论订正：**不是"零覆盖/永不红"，而是"脆弱的误归因"**（若该断言是文件里唯一/最后的用例、或运行器提前退出，就可能变成真空）。修法仍然只是加 `await`（1 行），但**不要把这条当成"假绿"的代表**。
- ★这条订正的意义：**"未 await"与"假绿"中间隔着运行器行为**（Node 的 `unhandledRejection` 默认会炸）。凡是拿"未 await"当"永远绿"论证的，必须**实跑**才能下结论。

---

## C. 复核未做/不足以定论的（诚实标注）

| # | 结论 | 状态 |
|---|---|---|
| C1 | G5 关于 `engine-config.test.ts:160` 与 raw `23695` 的**逐字**对照 | 未逐字核 raw；采信子代理（它给了行号与表达式），但**修复前请自行复核 raw 23691/23695** |
| C2 | G5 关于 `analysis/fields.json` 两条 offset（`frame_tick_lock`/`frame_count`）与 raw 矛盾 | 未核；该条若成立，是**数据层 bug**，与本票的测试审计是两件事 —— 建议单独开票 |
| C3 | 各组"L2D / 音频 / 渲染"里需要真资产才能判的条目（例如"删 `pixiBackend.ts:1468` 是否全绿"） | 只做了静态判读，未逐个变异（成本）；**变异campaign 只抽了 12 处**（见 `mutation-campaign.md`） |
| C4 | 各组给出的"去重后省多少用例/多少秒" | 均为**估算**，未实施；实施时必须给改前/改后实测（沿用 `T-0115` 的纪律） |

---

## D. 复核方法本身的两条教训（写给以后）

1. **子代理的"反例实验"多数是静态推演，不是执行**。本次 7 份报告里只有极少数真的跑过探针（G4 跑过一次 node:test 探针、G6 实测过单跑耗时、G5 实测过定向批跑）。凡结论要进决策（"删这条断言不损失检出"），**必须实跑或变异**——本次 12 处变异就抓到了一条过强结论（B2）。
2. **"未 await / 空断言 / 静默 return"是三类不同病**，要分开判：
   - **空断言**（`console.warn; return`）⇒ node:test 记 **pass**，**真·假绿**（A13）；
   - **未 await** ⇒ 取决于运行器与后续用例，**可能红但归因错**（B2）；
   - **恒真断言**（两侧同一表达式）⇒ **永不红**（A1/A3/A4/A5）。
   ⇒ 清理时优先级应是 **空断言 > 恒真断言 > 未 await**（前者是"谎报绿灯"，后者只是"报错难看"）。
