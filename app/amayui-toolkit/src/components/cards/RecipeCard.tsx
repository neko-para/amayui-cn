import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';
import { entityTagLabel, idHex } from '../../services/idspace';

export function RecipeCard({ productId }: { productId: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const recipe = dataset.recipeByItemProduct.get(productId)
    ?? dataset.recipeByBuildingProduct.get(productId);
  if (!recipe) return <MessageCard text={`找不到配方 #${idHex(productId)}`} />;

  const productName = recipe.productRef === 'item'
    ? dataset.byItem.get(recipe.productId)?.nameZh
    : dataset.byBuilding.get(recipe.productId)?.nameZh;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{productName || recipe.productZh || recipe.product}</Typography>
          {/* 配方无自己的名串；徽标标的是**产物**的 id 与名串地址（物品/建筑两套 id 空间会重叠，故随 productRef 取） */}
          <Chip size="small" variant="outlined" label={entityTagLabel(recipe.productRef, recipe.productId)} />
        </Box>
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
                  label={`${mat?.nameZh || '#' + idHex(m.itemId)} ×${m.count}`}
                  target={{ kind: 'item', id: m.itemId }} />
              );
            })}
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
