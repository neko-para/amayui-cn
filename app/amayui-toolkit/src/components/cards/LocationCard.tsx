import {
  Box, Card, CardContent, Chip, Divider, Stack, Typography,
} from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';

/**
 * 抽象地点卡片：展示地点名 + 其下所有地图（可点地图跳转）。
 * 反向（地图 → 本地点）在各 MapCard 顶部 RefChip 实现，二者互跳。
 */
export function LocationCard({ locationId }: { locationId: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const loc = dataset.byLocation.get(locationId);
  if (!loc) return <MessageCard text={`找不到地点 #${locationId}`} />;

  const maps = dataset.mapsByLocation.get(locationId) ?? [];

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{loc.nameZh || loc.name}</Typography>
          <Typography variant="body2" color="text.secondary">{loc.name}</Typography>
          <Chip size="small" variant="outlined" label={`地点 #${loc.locationId.toString(16)}`} />
          <Chip size="small" label={`地图 ${maps.length}`} />
        </Box>
        <Typography variant="caption" color="text.secondary">来源：{loc.source}</Typography>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2">该地点的场景 / 地图</Typography>

        {maps.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>该地点暂无已归并的地图。</Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
            {maps.map((app) => (
              <RefChip key={app.map.mapNo} label={app.map.nameZh || app.map.name}
                target={{ kind: 'map', mapNo: parseInt(app.map.mapNo, 16) }} />
            ))}
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          点击地图可跳转到其卡片；各地图卡片顶部会反链回本地点。
        </Typography>
      </CardContent>
    </Card>
  );
}
