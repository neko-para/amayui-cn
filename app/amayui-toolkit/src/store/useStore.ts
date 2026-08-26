import { create } from 'zustand';
import type { Dataset } from '../services/dataset';
import { loadDataset } from '../services/dataset';
import type { View } from '../types/nav';

export type ThemeMode = 'light' | 'dark' | 'system';

interface AppState {
  dataset: Dataset | null;
  loading: boolean;
  error: string | null;
  /** 内存历史栈（当前视图 = history[pos]） */
  history: View[];
  pos: number;
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
    const { history, pos } = get();
    const next = [...history.slice(0, pos + 1), cards];
    set({ history: next, pos: next.length - 1 });
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
