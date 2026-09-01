import { Alert, Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';
import { entityTagLabel, idHex } from '../../services/idspace';

export function ItemCard({ id }: { id: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const item = dataset.byItem.get(id);
  if (!item) return <MessageCard text={`找不到物品 #${idHex(id)}`} />;

  const recipe = dataset.recipeByItemProduct.get(id);
  const asMaterial = dataset.recipesUsingItem.get(id) ?? [];
  const asMaterialItems = asMaterial.filter((r) => r.productRef === 'item');
  const asMaterialBuildings = asMaterial.filter((r) => r.productRef === 'building');
  const droppedBy = dataset.unitsDropItem.get(id) ?? [];

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{item.nameZh || item.name}</Typography>
          <Typography variant="body2" color="text.secondary">{item.name}</Typography>
          <Chip size="small" label={item.craftable ? '可合成' : '不可合成'}
            color={item.craftable ? 'success' : 'default'} />
          <Chip size="small" variant="outlined" label={entityTagLabel('item', item.id)} />
        </Box>

        {recipe && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2">配方（作为产物）</Typography>
            <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
              {recipe.materials.map((m, i) => {
                const mat = dataset.byItem.get(m.itemId);
                return (
                  <RefChip key={i}
                    label={`${mat?.nameZh || '#' + idHex(m.itemId)} ×${m.count}`}
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

              {asMaterialItems.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">物品配方（{asMaterialItems.length}）</Typography>
                  <Stack direction="row" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 1 }}>
                    {asMaterialItems.map((r, i) => (
                      <RefChip key={i} label={dataset.byItem.get(r.productId)?.nameZh || `#${idHex(r.productId)}`}
                        target={{ kind: 'item', id: r.productId }} />
                    ))}
                  </Stack>
                </Box>
              )}

              {asMaterialBuildings.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">建筑配方（{asMaterialBuildings.length}）</Typography>
                  <Stack direction="row" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 1 }}>
                    {asMaterialBuildings.map((r, i) => (
                      <RefChip key={i} label={dataset.byBuilding.get(r.productId)?.nameZh || `#${idHex(r.productId)}`}
                        target={{ kind: 'building', id: r.productId }} />
                    ))}
                  </Stack>
                </Box>
              )}
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
