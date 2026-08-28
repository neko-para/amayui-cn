import type { ReactNode } from 'react';
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography, Divider } from '@mui/material';
import { Inventory2, Groups, Apartment, Map, MenuBook, ChevronRight } from '@mui/icons-material';
import { useStore } from '../store/useStore';
import type { CardKind } from '../types/nav';

const KIND_ICON: Record<CardKind, ReactNode> = {
  item: <Inventory2 fontSize="small" />,
  unit: <Groups fontSize="small" />,
  building: <Apartment fontSize="small" />,
  map: <Map fontSize="small" />,
  recipe: <MenuBook fontSize="small" />,
  message: <ChevronRight fontSize="small" />,
};

/** 左侧纵向历史记录列表：点击触发新跳转（而非恢复历史）；去重（取最新）。 */
export function HistorySidebar() {
  const entries = useStore((s) => s.historyEntries);
  const navigate = useStore((s) => s.navigate);

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
              title="点击跳转到这一条（生成新历史）"
              onClick={() => navigate(e.view)}
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
