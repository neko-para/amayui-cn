/**
 * 控制窗的 DOM 句柄表。
 *
 * 为什么要集中：原先 25 处 `el<T>('...')` 散在逻辑里、且**不做存在性检查**——
 * `control/index.html` 的 id 一旦改名，运行时拿到的就是 `null`，报错点离原因很远。
 * 现在所有 id 集中在这里，并且缺失就立即抛出带 id 的明确错误。
 */

/** 取元素；不存在（id 与 control/index.html 不一致）时立即报错。 */
export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`控制窗缺少元素 #${id}：control/index.html 与 control/dom.ts 的 id 不一致`);
  return node as T;
}

/** 控制窗用到的全部元素（import 后即可用，缺失会在模块加载期就报错）。 */
export const ui = {
  bin: el<HTMLSpanElement>('bin'),
  error: el<HTMLDivElement>('error'),
  perf: el<HTMLSpanElement>('perf'),

  btnRestart: el<HTMLButtonElement>('btnRestart'),
  btnForceClose: el<HTMLButtonElement>('btnForceClose'),
  btnTraceAll: el<HTMLButtonElement>('btnTraceAll'),

  traceFilter: el<HTMLInputElement>('traceFilter'),
  btnTraceApply: el<HTMLButtonElement>('btnTraceApply'),

  unknownBlock: el<HTMLDivElement>('unknownBlock'),
  unknownInfo: el<HTMLDivElement>('unknownInfo'),
  unknownHint: el<HTMLDivElement>('unknownHint'),
  btnSkipUnknown: el<HTMLButtonElement>('btnSkipUnknown'),
};

/** 一个"清单"区块的元素三元组（标题计数 + 内容盒 + 复制按钮）。 */
export interface ListElements {
  countEl: HTMLSpanElement;
  box: HTMLDivElement;
  copyBtn: HTMLButtonElement;
}

export const lists = {
  ignored: {
    countEl: el<HTMLSpanElement>('ignoredCount'),
    box: el<HTMLDivElement>('ignored'),
    copyBtn: el<HTMLButtonElement>('btnCopyIgnored'),
  },
  internal: {
    countEl: el<HTMLSpanElement>('internalCount'),
    box: el<HTMLDivElement>('internal'),
    copyBtn: el<HTMLButtonElement>('btnCopyInternal'),
  },
  skipped: {
    countEl: el<HTMLSpanElement>('skippedCount'),
    box: el<HTMLDivElement>('skipped'),
    copyBtn: el<HTMLButtonElement>('btnCopySkipped'),
  },
  gaps: {
    countEl: el<HTMLSpanElement>('gapsCount'),
    box: el<HTMLDivElement>('gaps'),
    copyBtn: el<HTMLButtonElement>('btnCopyGaps'),
  },
  dropped: {
    countEl: el<HTMLSpanElement>('droppedCount'),
    box: el<HTMLDivElement>('dropped'),
    copyBtn: el<HTMLButtonElement>('btnCopyDropped'),
  },
} satisfies Record<string, ListElements>;
