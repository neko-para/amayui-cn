import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';

export function UnitCard({ id }: { id: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const unit = dataset.byUnit.get(id);
  if (!unit) return <MessageCard text={`找不到单位 #${id}`} />;

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
                  label={`${it?.nameZh || '#' + d.itemId} ×${d.rate}`}
                  target={{ kind: 'item', id: d.itemId }} />
              );
            })}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary">掉落率/权重语义未定，仅供对照。</Typography>
      </CardContent>
    </Card>
  );
}
