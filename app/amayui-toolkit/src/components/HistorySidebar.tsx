import type { ReactNode } from 'react';
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography, Divider } from '@mui/material';
import { Inventory2, Groups, Apartment, Map, Place, MenuBook, AutoAwesome, ChevronRight } from '@mui/icons-material';
import { useStore } from '../store/useStore';
import { buildResults } from '../services/search';
import { cardFromResult } from '../types/search';
import type { SearchExpression } from '../types/search';
import type { CardKind } from '../types/nav';

const KIND_ICON: Record<CardKind, ReactNode> = {
  item: <Inventory2 fontSize="small" />,
  unit: <Groups fontSize="small" />,
  building: <Apartment fontSize="small" />,
  map: <Map fontSize="small" />,
  location: <Place fontSize="small" />,
  recipe: <MenuBook fontSize="small" />,
  skill: <AutoAwesome fontSize="small" />,
  message: <ChevronRight fontSize="small" />,
};

/** 左侧纵向历史记录列表：点击回放该表达式的全部结果（重新求值 → navigate）；去重（取最新）。 */
export function HistorySidebar() {
  const entries = useStore((s) => s.historyEntries);
  const dataset = useStore((s) => s.dataset);
  const navigate = useStore((s) => s.navigate);

  const replay = (expr: SearchExpression) => {
    if (!dataset) return;
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
              title="点击回放此表达式（重新求值）"
              onClick={() => replay(e.expr)}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>{KIND_ICON[e.kind]}</ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>
                    {e.label}
                  </Typography>
                }
                sx={{ m: 0 }}
              />
              <ChevronRight fontSize="small" color="disabled" />
            </ListItemButton>
          ))}
        </List>
      )}
    </Box>
  );
}
