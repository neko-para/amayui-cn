# T-0043 · 过程文档（notes.md）

## 2026-09-16

### 2026-09-16 · 现场清理（用户确认）

为取证临时用 `node scripts/translate.js assemble CONFIG1|CONFIG|CONFIG2` 写出的三个松散 BIN
（`install/CONFIG.BIN` / `CONFIG1.BIN` / `CONFIG2.BIN`，经 `install -> raw` 符号链接即 `raw/` 下同名文件）
**已按用户确认删除** —— 用户确认 `raw/` 原本不带这三个 BIN，因此没有覆盖任何日文数据（assemble 的第二步
`install/DATA1/` 当时就 ENOENT，也没留下目录）。

⇒ 本机 `test/config1-chain.test.ts` 的两条样例文案断言**又回到红**（读到 ALF 里的原版日文），
这正是本票要解决的状态；T-0042 的实测结论（行标签 (233,231,230) 暖）与 BIN 语言无关，两张截图都在。

## 2026-09-16

### 2026-09-16 · ③ 已解决（结论比跳过更强：这一步本来就是错的）

用户确认：**从来没有把文件安装到

## 从 ticket.json 的 `notes` 字段迁入（2026-09 文档模型）

同族历史：T-0034（engine-config.test.ts 直接读真游戏 base 的 SYS4REG.INI ⇒ 玩家一改设置就红）—— 都是'守卫依赖环境/产物'。本票是它在另外两处的同类。③的现场：`node scripts/translate.js assemble CONFIG1` 写出 install/CONFIG1.BIN 后在 install/DATA1 上 ENOENT；补跑 CONFIG/CONFIG2 同样。跑完这三条后 test/config1-chain.test.ts 10/10 绿（2026-09-16 实测）。

★2026-09-16 收尾：①②③ 都已解决（①平台化路径断言 ②产物缺失显式 skip/诊断 ③删掉"往 install/DATA1 装"的错误操作并从 res/images 补 AGF 的真源口径），本机 npm test 0 红。
