# T-0102 变更记录

## 第 N 次变更（2026-09-22）—— `0x259` 口径纠错：保留槽→imgid、改清标志位

**症状**：ADV 窗口本体被画成 1×1 `Texture.WHITE` 拉成的白/浅灰块（`#E3E3E3`）。

**根因（引擎逐位复核 + 用户现场日志）**：`0x259`(`sub_41A3A0` raw 25357-25374) 在引擎里是
**「按槽设置的标志两位」的整表复位器**（只写记录表的 `+8`/`+12` = `Scene/0x750`/`Scene/0x754`，
正是 `0x258` 的写入点），**imgid 与槽对象都不动**。
emulator 恰好**清反了**：
- `TextureCache.clearSlotRecords()` / `HeadlessScene.clearSlotRecords()` 清了 `#slotImgid`/`slotImgid`
  ⇒ `resolve()` 与 `#healSlot()` **同时断索引** ⇒ 回落 `presenter.#placeholder`；
- 反而**漏清** `Engine.texSlotFlags`（`0x258` 写入后 `0x259` 不复位）。

**改动的文件**
| 文件 | 改动 |
|---|---|
| `src/renderer/pixi/textureCache.ts` | `clearSlotRecords()` 不再清 `#slotImgid`；注释与日志口径改写 |
| `src/renderer/headlessScene.ts` | 同上（保留 `slotImgid`） |
| `src/vm/handlers/gfx-misc.ts` | `op_clear_slot_records` 新增 `c.e.texSlotFlags.clear()`；注释改写为引擎实际语义 |
| `test/clear-slot-records-keeps-bindings.test.ts` | 新增 4 例守卫 |
| `test/slot-save-resume.test.ts` | 既有 0x259 用例改写：断言 `slotImgid` **保留** + `texSlotFlags` 归零 |

**判据**：`npm run verify` 全绿（1037 测试 / 1025 pass / 12 skipped / 0 fail）+ typecheck ×3 + 死写 0。
突变证明两条：还原 `#slotImgid.clear()` ⇒ 判别力用例红；摘掉 `texSlotFlags.clear()` ⇒ 另一条红。

**未做**：E4 真界面复验（需用户跑一次 `--load 78` 那条路）。
