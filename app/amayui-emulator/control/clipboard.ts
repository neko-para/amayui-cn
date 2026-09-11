/**
 * 剪贴板工具：复制文本 + 「复制全部」按钮的行为。
 *
 * 为什么需要回退路径：Electron 渲染进程在非安全上下文/权限受限时 `navigator.clipboard` 会拒绝，
 * 此时用临时 textarea + `execCommand('copy')` 兜底。
 */

/** 复制文本到剪贴板；失败时回退到临时 textarea + execCommand。返回是否成功。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 把按钮接成「复制全部」：点后短暂显示结果再恢复原标签。
 * `lines()` 每次点击时求值 —— 清单每 0.5s 重刷，不能闭包捕获旧内容。
 */
export function wireCopyButton(btn: HTMLButtonElement, lines: () => string[], label: string): void {
  let timer = 0;
  btn.addEventListener('click', () => {
    const items = lines();
    const done = (msg: string): void => {
      btn.textContent = msg;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        btn.textContent = label;
      }, 1500);
    };
    if (items.length === 0) {
      done('（空）');
      return;
    }
    void copyText(items.join('\n')).then((ok) => done(ok ? `已复制 ${items.length} 条` : '复制失败'));
  });
}
