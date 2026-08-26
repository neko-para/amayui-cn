/**
 * 运行时能力探测：前端是否运行在桌面薄壳（WebView2 + Tauri）内。
 * 无壳（纯浏览器/GitHub Pages）时，原生能力降级为 web 替代或隐藏。
 */
export const hasNative =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** 在桌面壳内但缺所选能力时返回 false 的占位（未来按需扩展） */
export const supportsNative = (cap: 'saveDialog' | 'openDataDir'): boolean => {
  void cap;
  return hasNative;
};
