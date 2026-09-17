# T-0059 · 过程文档（changes.md）

## 2026-09-17

## 第 1 次变更（2026-09）——真槽续跑落地

### 新增
- app/amayui-emulator/src/vm/engineSlot.ts：容器解码（反置乱 + LZSS + 两个内层 CRC）+ body 解析（帧镜像/池块/图像清单）+ resolveSlotResumeIp / resolveSlotRetStack；另带 scrambleSlotPayload / lzssLiterals 两个**测试用**编码侧（合成槽）。
- app/amayui-emulator/test/engineSlotFixtures.ts：合成脚本二进制 + 合成槽 body/容器夹具（解析层与 VM 层共用，避免两边布局漂移）。
- app/amayui-emulator/test/engine-slot.test.ts（6 条）/ test/slot-load-resume.test.ts（3 条）。

### 改动
- src/script/bin.ts：ScriptBinary 新增 ipTables（三张表**内容**；表位置与表项都相对 headerLen，越界项丢弃）。
- src/vm/engine.ts：新增 Engine.saveResume（读档续跑记录；0xAE 消费后清）。
- src/vm/handlers/save-slot.ts：真槽走 restoreEngineSlot（还原 int/float/string 池 + 记录 id 记已使用 + 面板/文本复位 + 装记录 0 的脚本 + 置读档门 + saveResume），返回 transferredTo = 0；解不出时退回原 transferToRootAfterLoad。
- src/vm/handlers/frame.ts：0xAE 真实现（两条落点分支 + 步长语义 + 走栈装载下一帧 + 收尾）；SAVE_VERSION_BRANCH 简化为版本判定（savedCur/savedRet 改由 saveResume 提供）。
- src/vm/handlers/control.ts：exit-script 的整体复位同时清 saveResume 与读档门（否则『新开一局』的第一个 i0ae 会走到上一局的帧栈）。
- src/vm/saveSlot.ts：SLOT_GAPS 重写（format=3 已解析并可续跑；format 1/2、图像未应用、跳回调 三条如实登记）。
- test/op-a2-a3.test.ts：0xAE 那条守卫改用 saveResume（旧实现拿 engineValues 当帧镜像替身，那两格从没人写过），并补『门开着但无记录 ⇒ 清门』。

### 判据（全绿）
- test/engine-slot.test.ts：合成槽往返 / CRC 负例 / 落点换算 / 返回栈换算 / **47 个真槽逐帧落点自洽（E4）**。
- test/slot-load-resume.test.ts：合成槽的完整两步走栈 + 门关着不动状态 + **真 SAVE00 装载后帧 0 = SYSTEM4.BIN 且第一步走栈装上存档帧脚本（E3）**。
- npm run verify：typecheck ×3 / 628 测试（627 pass 0 fail 1 skip）/ 死写检查 0。

### 文档与台账
- docs-new/03-engine/save-data.md：新增 §7.2（容器/body 布局 + 续跑链路 + 落点语义 + 偏离），§7 的 SLOT_GAPS 列表与 §7.1 的 emulator 实现段同步。
- docs-new/03-engine/opcode-table.md：0xAE 行补两条分支步长语义与『i0ae 339 处』订正。
- analysis/functions.json：新增 0x40F750（restoreFrameFromSaveRecord_40F750）；0x410160/0x40CD10/0x40ED40/0x4192F0 补充 a4=3 布局/表口径/语料订正。
- analysis/fields.json：新增 save_image_base（0x93AA8）、save_frame_record_base（0x98DB0）、frame_ip_table_A（0x5D8C8）。
- analysis/engine-capabilities.json：save-slot-chain 条目 emulator 段追加 T-0059 段并把证据提到 E4；已重生成 engine-capabilities.md 并通过 --validate。
- 删除了 12 个临时探针（src/tools/_slot*.ts / _callbackscan / _tablepos / _pool* / _retdbg）。

## 2026-09-17

## 第 2 次变更（2026-09）——端到端 E4：读档后帧循环继续跑

`test/slot-load-resume.test.ts` 的第 3 条守卫追加了一段**真端到端**：真 SAVE00.DAT 装载后**不手工调 0xAE**，
直接 `runFrameLoop` 跑真实帧循环 —— 帧 0（SYSTEM4）自己跑到 `label_00000b00` 的 i0ae 开始走栈，
直到 `cur == savedCur` 收尾。

实测（本机）：
- 轨迹 `REIGN.BIN → SETADVFLAG.BIN`（= 存档帧的脚本 + 它自己 call-script 的下一支），**没有回标题**
  （SYSTEM4 那两条 `call-script 5264 TITLE` 没被执行 ⇒ 证明控制真的交给了存档帧，而不是继续启动链）；
- 路径上**被跳过的未实现 opcode = 0 个**（以 `t.diagnostic` 记录，不判失败：别的槽可能踩到场景机制缺口）；
- `until` 用「读档门 1 → 0」当判据 ⇒ 单条守卫 0.5 s（此前不加 until 跑 600 帧要 227 s，现在走完即停）。

## 2026-09-17

## 第 3 次变更（2026-09）——★修一个静默错：int 池写回内存必须 ENC

第一次实现把槽里解出的 **int 池明文**直接塞进 `Engine.globals.int`，而 emulator 的读侧一律
`readIntOperand → dec(key, ...)`（`src/vm/operand.ts`）⇒ 续跑后**每一个全局量都读成垃圾**，且**不报任何错**。

引擎正是为此在 `0x1A1` 里把池整体 ENC 一遍（`sub_42DDE0` raw 38433-38438：
`pool[i] = ROL(key ^ ROR(pool[i],7), 21)`，`key = _this[97059]`）。修法：装载时 `e.globals.int.set(i, enc(e.key, v))`
（`src/vm/handlers/save-slot.ts` 的 `restoreEngineSlot`），`float`/`string` 池不动（引擎没有这层）。

判据（守卫 `test/slot-load-resume.test.ts`）：`dec(e.key, globals.int.get(1)) === 3` 且
`globals.int.get(1) !== 3`（内存里必须是 ENC 态）。★E4 旁证：漏了它时端到端轨迹止于
`REIGN.BIN → SETADVFLAG.BIN`；补上后走到 `REIGN.BIN → SETADVFLAG.BIN → SETGARDEN.BIN`
（全局量正确 ⇒ 脚本的分支才走得下去）。
