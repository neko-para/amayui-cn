import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';

export function UnitCard({ id }: { id: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const unit = dataset.byUnit.get(id);
  if (!unit) return <MessageCard text={`找不到单位 #${id}`} />;
  const maps = dataset.mapsWithUnit.get(id) ?? [];
  const spawnable = maps.filter((a) => a.spawnable);
  const fixed = maps.filter((a) => !a.spawnable);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{unit.nameZh || unit.name}</Typography>
          <Typography variant="body2" color="text.secondary">{unit.name}</Typography>
          <Chip size="small" variant="outlined" label={`单位 #${unit.unitId}`} />
        </Box>
        <Typography variant="body2" sx={{ mt: 1 }}>{unit.titleZh || unit.title}</Typography>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2">掉落物{!unit.hasDrops ? '（无）' : ''}</Typography>
        {unit.drops.length === 0 ? (
          <Typography variant="body2" color="text.secondary">该单位无掉落表。</Typography>
        ) : (
          <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
            {unit.drops.map((d, i) => {
              const it = dataset.byItem.get(d.itemId);
              return (
                <RefChip key={i}
                  label={`${it?.nameZh || '#' + d.itemId} ${d.rate}%`}
                  target={{ kind: 'item', id: d.itemId }} />
              );
            })}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary">掉落率按百分比理解（100=必定掉落），语义待与游戏内进一步核对。</Typography>

        {maps.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
                <Typography variant="subtitle2">出现在地图（{maps.length}）</Typography>
                <Typography variant="caption" color="text.secondary">
                  可重复刷新 {spawnable.length} · 其它 {fixed.length}
                </Typography>
              </Stack>

              {spawnable.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span>可重复刷新</span>
                    <Typography component="span" variant="body2" color="text.secondary">（{spawnable.length}）</Typography>
                  </Typography>
                  <Stack direction="row" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 1 }}>
                    {spawnable.map((a) => (
                      <RefChip key={a.map.mapNo} label={a.map.nameZh || a.map.name}
                        target={{ kind: 'map', mapNo: parseInt(a.map.mapNo, 16) }} />
                    ))}
                  </Stack>
                </Box>
              )}

              {fixed.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span>其它出现（固定/出击）</span>
                    <Typography component="span" variant="body2" color="text.secondary">（{fixed.length}）</Typography>
                  </Typography>
                  <Stack direction="row" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 1 }}>
                    {fixed.map((a) => (
                      <RefChip key={a.map.mapNo} label={a.map.nameZh || a.map.name}
                        target={{ kind: 'map', mapNo: parseInt(a.map.mapNo, 16) }} />
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
