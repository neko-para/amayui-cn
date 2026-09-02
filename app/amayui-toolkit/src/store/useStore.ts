import { create } from 'zustand';
import type { Dataset, ViewEntry } from '../services/dataset';
import { loadDataset, describeView } from '../services/dataset';
import type { View } from '../types/nav';
import type { SearchExpression } from '../types/search';
import { useSearchDraft } from './useSearchDraft';

export type ThemeMode = 'light' | 'dark' | 'system';

/** 一条历史 = 内部 query（表达式）+ 其结果视图。 */
interface HistoryRecord {
  expr: SearchExpression;
  view: View;
}

interface AppState {
  dataset: Dataset | null;
  loading: boolean;
  error: string | null;
  /** 内存历史栈（当前视图 = history[pos].view） */
  history: HistoryRecord[];
  pos: number;
  /** 去重后的历史记录（最新在前），用于左侧列表 */
  historyEntries: ViewEntry[];
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  init: () => Promise<void>;
  navigate: (expr: SearchExpression, view: View) => void;
  goBack: () => void;
  goForward: () => void;
}

const INITIAL_VIEW: View = [{ kind: 'message', text: '请在上方搜索 物品 / 单位 / 设施…' }];

export const useStore = create<AppState>((set, get) => ({
  dataset: null,
  loading: false,
  error: null,
  history: [{ expr: [], view: INITIAL_VIEW }],
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

  navigate: (expr, view) => {
    const { history, pos, dataset, historyEntries } = get();
    // 0) 顶部搜索区同步为当前「激活规则」（卡片/历史等任何路径进入都生效；草稿态仅在编辑时存在）
    useSearchDraft.getState().load(expr);
    // 1) 栈式：push 到当前位置之后
    const next = [...history.slice(0, pos + 1), { expr, view }];
    // 2) 去重历史记录：同一表达式(key)只保留最新一条，最新插入到顶部
    const entry = dataset ? describeView(expr, view, dataset) : null;
    let entries = historyEntries;
    if (entry) {
      entries = [entry, ...historyEntries.filter((e) => e.key !== entry.key)];
    }
    set({ history: next, pos: next.length - 1, historyEntries: entries });
  },

  goBack: () => {
    const { pos, history } = get();
    if (pos > 0) {
      const next = pos - 1;
      set({ pos: next });
      useSearchDraft.getState().load(history[next]?.expr ?? []);
    }
  },

  goForward: () => {
    const { history, pos } = get();
    if (pos < history.length - 1) {
      const next = pos + 1;
      set({ pos: next });
      useSearchDraft.getState().load(history[next]?.expr ?? []);
    }
  },
}));

/** 当前视图（下半区内容） */
export const selectView = (s: AppState): View => s.history[s.pos]?.view ?? INITIAL_VIEW;

/** 当前激活的表达式（供标题/调试图标等；历史回放时用它重新求值） */
export const selectExpr = (s: AppState): SearchExpression => s.history[s.pos]?.expr ?? [];
