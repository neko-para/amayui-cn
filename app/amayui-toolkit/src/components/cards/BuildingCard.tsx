import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';

export function BuildingCard({ id }: { id: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const building = dataset.byBuilding.get(id);
  if (!building) return <MessageCard text={`找不到设施 #${id}`} />;

  const recipe = dataset.recipeByBuildingProduct.get(id);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{building.nameZh || building.name}</Typography>
          <Typography variant="body2" color="text.secondary">{building.name}</Typography>
          <Chip size="small" variant="outlined" label={`设施 #${building.id}`} />
        </Box>

        {recipe && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2">建设配方（材料）</Typography>
            <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
              {recipe.materials.map((m, i) => {
                const mat = dataset.byItem.get(m.itemId);
                return (
                  <RefChip key={i}
                    label={`${mat?.nameZh || '#' + m.itemId} ×${m.count}`}
                    target={{ kind: 'item', id: m.itemId }} />
                );
              })}
            </Stack>
          </Box>
        )}

        {!recipe && (
          <Typography variant="body2" color="text.secondary">该设施无建设配方记录。</Typography>
        )}
      </CardContent>
    </Card>
  );
}
