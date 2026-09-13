/**
 * **引擎字段下标的集中命名表**（`Engine.engineValues` 的键 = `_this[K]` 的 K）。
 *
 * 为什么要有这个文件：`engineValues` 的键是**裸数字**，散落在十余个 handler 里时无法 grep 语义
 * （审计 2026-09 实测：58 个不同字面量、92 处内联）。这里只收**跨文件共用、且语义已由源码坐实**的那些；
 * 单文件内部的临时字段仍可留字面量，但**新增共用字段必须先在这里命名**。
 *
 * 每条都写明：语义 / 写入端（opcode 或帧循环）/ 读取端，便于与 `analysis/fields.json` 对照。
 */
/** `message:MessageSpeed`（`Font+1376`）：逐字节拍 ms。写：`0x74`/`0x1B5`/CONFIG；读：`messageSpeedOf`。 */
export const FIELD_MESSAGE_SPEED = 21668;
/** 消息窗「当前窗格/部件」索引（`0x80` 写；CONFIG 用它切部件）。 */
export const FIELD_MSG_DEFAULT_WIN = 21631;
/** 竖排标志（`Font+235108` bit0）：`0x261` 写、排版/绘制读。★注：排版**恒横向**，该位只改绘制期源矩形。 */
export const FIELD_VERTICAL = 80101;
/** 逐字/字格游标（下一拍要贴出的字格下标）：`0x72` 清零、帧循环 `= (k+1) % 模数`。 */
export const FIELD_CHAR_CURSOR = 107704;
/** 逐字/字格循环模数（= `0x73` 的 op9 = `win+92`）：`0x72` 查询时写入。 */
export const FIELD_CHAR_MODULUS = 107705;
/** 每窗「逐行贴出」闸门基址（`+win`）：bit0 = 闸门、bit16 = 已被泵接管（`0x300` 写、`sub_409400` 消费）。 */
export const FIELD_WIN_REVEAL_GATE = 122466;
/** 每窗贴完后的延时清场 ms（`+win`）：`0x300` op3 写。 */
export const FIELD_WIN_REVEAL_DELAY = 122476;
/** 每窗贴完时刻（timeGetTime，`+win`）：泵记、用于延时判定。 */
export const FIELD_WIN_REVEAL_DONE = 122486;
