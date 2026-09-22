# 突变的证据：I9「沿革不进叙述文档」守卫可被真实违规打红

## 命令

```powershell
$f='docs-new/03-engine/unpacking.md'
Copy-Item $f .tmp/mut-backup-unpacking.md -Force
Add-Content $f "`n> ★2026-09 订正：这行是突变探针。`n"
npx --prefix app/amayui-emulator tsx --test app/amayui-emulator/test/doc-model.test.ts
Copy-Item .tmp/mut-backup-unpacking.md $f -Force   # 还原，:51 计数回到 0
```

## 输出（节选）

```text
✖ ★文档模型：沿革不进叙述文档（A4① —— `03-engine` 机制叙述里不得复述「订正」） (5.3136ms)
ℹ pass 7
ℹ fail 1
  AssertionError [ERR_ASSERTION]: 叙述文档里出现沿革话术（A4①：旧的直接删、订正落 journal；数据层的沿革见 tickets/T-0108）：
    - 03-engine/unpacking.md:51 「订正」
--- 已还原；确认：0 处 订正
```

⇒ 守卫**真的**在查（不是恒真的空断言）：① 命中文件 + 行号 + 词都对；② 还原后回归绿（`doc-model.test.ts` 8/8）。

## 判据边界（写给未来的自己）

- 本守卫只覆盖 `docs-new/03-engine/*.md` 里 `kind=narrative` 的**机制叙述**（A4① 的直接受害者）。
- **不覆盖**数据层：`analysis/opcodes.json` 49 + `engine-capabilities.json` 37 + `opcode-gaps.json` 31 +
  `functions.json` 24 + `fields.json` 4 + `scripts.json` 1 = **146 处**「订正」（A2 说沿革该落各实体的
  `journal[]`、而不是被渲染的 `semantics`/`note`）⇒ 已开 **`tickets/T-0108`** 承接，本票不手改生成物。
