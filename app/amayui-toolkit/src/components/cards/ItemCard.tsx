import { Alert, Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';
import type { CardSpec } from '../../types/nav';

export function ItemCard({ id }: { id: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const item = dataset.byItem.get(id);
  if (!item) return <MessageCard text={`找不到物品 #${id}`} />;

  const recipe = dataset.recipeByItemProduct.get(id);
  const asMaterial = dataset.recipesUsingItem.get(id) ?? [];
  const droppedBy = dataset.unitsDropItem.get(id) ?? [];

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{item.nameZh || item.name}</Typography>
          <Typography variant="body2" color="text.secondary">{item.name}</Typography>
          <Chip size="small" label={item.craftable ? '可合成' : '不可合成'}
            color={item.craftable ? 'success' : 'default'} />
          <Chip size="small" variant="outlined" label={`物品 #${item.id}`} />
        </Box>

        {recipe && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2">配方（作为产物）</Typography>
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
            {recipe.metadata.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                · 元数据 {recipe.metadata.length} 条（语义未定）
              </Typography>
            )}
          </Box>
        )}

        {asMaterial.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Typography variant="subtitle2">作为材料（{asMaterial.length}）</Typography>
              <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                {asMaterial.map((r, i) => {
                  const name = r.productRef === 'item'
                    ? dataset.byItem.get(r.productId)?.nameZh
                    : dataset.byBuilding.get(r.productId)?.nameZh;
                  const target: CardSpec = r.productRef === 'item'
                    ? { kind: 'item', id: r.productId }
                    : { kind: 'building', id: r.productId };
                  return (
                    <RefChip key={i}
                      label={`${name || '#' + r.productId}（${r.type === 1 ? '物品' : '建筑'}配方）`}
                      target={target} />
                  );
                })}
              </Stack>
            </Box>
          </>
        )}

        {droppedBy.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Typography variant="subtitle2">掉落来源（{droppedBy.length}）</Typography>
              <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                {droppedBy.map((u) => (
                  <RefChip key={u.unitId} label={u.nameZh || u.name}
                    target={{ kind: 'unit', id: u.unitId }} />
                ))}
              </Stack>
            </Box>
          </>
        )}

        {!recipe && asMaterial.length === 0 && droppedBy.length === 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>无关联配方 / 掉落记录。</Alert>
        )}
      </CardContent>
    </Card>
  );
}
