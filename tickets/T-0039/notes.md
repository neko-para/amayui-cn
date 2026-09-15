# T-0039 · 过程文档（notes.md）

## 2026-09-15


## 复现（2026-09，研究 T-0017 时踩到）

在 `src/renderer/drawitem/model.ts` 的文档注释里加一句提到 `MeshObj.blend` 的话，然后：

```
改动前：当前死写 2 个：Item.blend(写9) MeshObj.blend(写9)        ★ 无新增死写
改动后：当前死写 0 个：无
        基线已过期（这些字段现在有消费者了，可从基线移除）：Item.blend MeshObj.blend
```

（两次都带 `已登记的死写（基线）2 个`；`test/no-dead-writes.test.ts` 的第 2 条断言
`Item.blend 应被判为死写` 在改动后会红。）把注释改成不含 `.blend` 的措辞后恢复原状。

### 为什么是"静默"
`Item` 与 `MeshObj` 各有一个名为 `blend` 的字段 ⇒ 一次 `countAccess('blend')` 的读数被两个条目共用；
而"字段是否 dead"只看 `reads === 0`。任何**注释/文档/字符串**里出现 `.blend` 都会把 reads 抬到 ≥1
⇒ 棘轮（新增死写即红）对这两个字段失效；对其它字段同理，且**没有**反向断言替它们兜底。

### 建议实现（供参考）
在 `findDeadWrites()` 里对参与统计的文本先做一次注释剥离（`stripComments(src)`：行注释 `//…$`
与块注释 `/*…*/`），再进 `countAccess`；`stripFunctions` 的顺序无所谓（两者互不影响）。
守卫可以直接测 `countAccess`（若导出）或测 `findDeadWrites` 对一个临时目录的输入。
