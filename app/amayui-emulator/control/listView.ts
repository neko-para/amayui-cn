/**
 * 通用「清单」视图：消费一组条目，渲染成一行一条的列表 + 计数 + 「复制全部」。
 *
 * 原先控制窗有 5 个几乎逐字重复的 `render*` 函数（ignored/internal/skipped/gaps/dropped），
 * 且"显示格式"与"复制格式"各写一遍（改一处要改两处）。本类把它收敛成**一份 row 规格**：
 * `rowOf()` 同时给出显示文本、悬浮提示与复制文本，因此两者不可能漂移。
 *
 * 实现细节：`set()` 时把条目**一次性**转成 row 并缓存，显示与复制消费同一份 row 数组
 * （避免复制时重算，也避免 `rowOf` 有副作用时两边不一致）。
 */
import { wireCopyButton } from './clipboard.js';
import type { ListElements } from './dom.js';

/** 一行清单的渲染规格。 */
export interface ListRow {
  /** 显示文本（也是默认的复制文本）。 */
  text: string;
  /** 悬浮提示（如"最近实参"）。 */
  title?: string;
  /** 复制文本；省略时用 `text`。 */
  copy?: string;
}

export interface ListViewOptions<T> {
  elements: ListElements;
  /** 计数后缀，如 `个` / `种`。 */
  unit: string;
  /** 空清单时显示的占位文本。 */
  emptyText: string;
  /** 把条目转成一行。 */
  rowOf(item: T): ListRow;
}

export class ListView<T> {
  #rows: ListRow[] = [];

  constructor(private readonly opt: ListViewOptions<T>) {
    wireCopyButton(opt.elements.copyBtn, () => this.#rows.map((r) => r.copy ?? r.text), '复制全部');
  }

  /** 用最新一轮上报的内容重绘。 */
  set(items: T[] | undefined): void {
    const rows = (items ?? []).map((it) => this.opt.rowOf(it));
    this.#rows = rows;
    const { countEl, box } = this.opt.elements;
    countEl.textContent = `(${rows.length} ${this.opt.unit})`;
    box.textContent = '';
    if (rows.length === 0) {
      box.textContent = this.opt.emptyText;
      return;
    }
    for (const row of rows) {
      const d = document.createElement('div');
      d.textContent = row.text;
      if (row.title) d.title = row.title;
      box.appendChild(d);
    }
  }
}
