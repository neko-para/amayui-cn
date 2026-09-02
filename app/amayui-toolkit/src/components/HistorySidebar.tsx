import { Box, List, ListItemButton, ListItemText, Typography, Divider } from '@mui/material';
import { useStore } from '../store/useStore';
import { useSearchDraft } from '../store/useSearchDraft';
import { RuleChips } from './RuleChips';
import { buildResults } from '../services/search';
import { cardFromResult } from '../types/search';
import type { SearchExpression } from '../types/search';

/**
 * 左侧历史记录：每条 = 同一 `RuleChips`（readonly+dense），与顶部搜索区共用同一套规则渲染。
 * 点击 = **回填搜索区草稿** + 展示结果（见 docs/04-功能与界面设计.md §2.3）。
 */
export function HistorySidebar() {
  const entries = useStore((s) => s.historyEntries);
  const dataset = useStore((s) => s.dataset);
  const navigate = useStore((s) => s.navigate);
  const draft = useSearchDraft();

  const replay = (expr: SearchExpression) => {
    if (!dataset) return;
    draft.load(expr);   // 回填顶部草稿（同批规则 chips + 名称文本）
    navigate(expr, buildResults(expr, dataset).map((r) => cardFromResult(r.kind, r.id)));
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="subtitle2" sx={{ px: 2, pt: 2, pb: 1, fontWeight: 600 }}>
        历史记录
      </Typography>
      <Divider />
      {entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          暂无历史
        </Typography>
      ) : (
        <List dense sx={{ overflowY: 'auto', flexGrow: 1, mx: 0.5 }}>
          {entries.map((e) => (
            <ListItemButton
              key={e.key}
              sx={{ borderRadius: 1, px: 1 }}
              title="点击回填规则并展示结果"
              onClick={() => replay(e.expr)}
            >
              <ListItemText primary={<RuleChips expr={e.expr} dense />} sx={{ m: 0 }} />
            </ListItemButton>
          ))}
        </List>
      )}
    </Box>
  );
}
