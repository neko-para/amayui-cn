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
