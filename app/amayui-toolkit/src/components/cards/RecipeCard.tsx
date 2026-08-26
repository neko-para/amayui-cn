import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';

export function RecipeCard({ productId }: { productId: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const recipe = dataset.recipeByItemProduct.get(productId)
    ?? dataset.recipeByBuildingProduct.get(productId);
  if (!recipe) return <MessageCard text={`找不到配方 #${productId}`} />;

  const productName = recipe.productRef === 'item'
    ? dataset.byItem.get(recipe.productId)?.nameZh
    : dataset.byBuilding.get(recipe.productId)?.nameZh;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6">{productName || recipe.productZh || recipe.product}</Typography>
        <Typography variant="body2" color="text.secondary">
          {recipe.productRef === 'item' ? '物品配方' : '建筑/设施配方'} · source={recipe.source}
        </Typography>
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2">材料</Typography>
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
      </CardContent>
    </Card>
  );
}
