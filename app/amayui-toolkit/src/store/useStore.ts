import { create } from 'zustand';
import type { Dataset, ViewEntry } from '../services/dataset';
import { loadDataset, describeView } from '../services/dataset';
import type { View } from '../types/nav';

export type ThemeMode = 'light' | 'dark' | 'system';

interface AppState {
  dataset: Dataset | null;
  loading: boolean;
  error: string | null;
  /** 内存历史栈（当前视图 = history[pos]） */
  history: View[];
  pos: number;
  /** 去重后的历史记录（最新在前），用于左侧列表 */
  historyEntries: ViewEntry[];
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  init: () => Promise<void>;
  navigate: (cards: View) => void;
  goBack: () => void;
  goForward: () => void;
}

const INITIAL_VIEW: View = [{ kind: 'message', text: '请在上方搜索 物品 / 单位 / 设施…' }];

export const useStore = create<AppState>((set, get) => ({
  dataset: null,
  loading: false,
  error: null,
  history: [INITIAL_VIEW],
  pos: 0,
  historyEntries: [],
  theme: 'system',

  setTheme: (t) => set({ theme: t }),

  init: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const dataset = await loadDataset();
      set({ dataset, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  navigate: (cards) => {
    const { history, pos, dataset, historyEntries } = get();
    // 1) 栈式：push 到当前位置之后
    const next = [...history.slice(0, pos + 1), cards];
    // 2) 去重历史记录：同一目标(entry.key)只保留最新一条，最新插入到顶部
    const entry = dataset ? describeView(cards, dataset) : null;
    let entries = historyEntries;
    if (entry) {
      entries = [entry, ...historyEntries.filter((e) => e.key !== entry.key)];
    }
    set({ history: next, pos: next.length - 1, historyEntries: entries });
  },

  goBack: () => {
    const { pos } = get();
    if (pos > 0) set({ pos: pos - 1 });
  },

  goForward: () => {
    const { history, pos } = get();
    if (pos < history.length - 1) set({ pos: pos + 1 });
  },
}));

/** 当前视图（下半区内容） */
export const selectView = (s: AppState): View => s.history[s.pos] ?? INITIAL_VIEW;
