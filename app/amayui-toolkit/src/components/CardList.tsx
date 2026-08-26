import { Stack } from '@mui/material';
import type { CardSpec, View } from '../types/nav';
import { ItemCard } from './cards/ItemCard';
import { UnitCard } from './cards/UnitCard';
import { BuildingCard } from './cards/BuildingCard';
import { RecipeCard } from './cards/RecipeCard';
import { MessageCard } from './cards/MessageCard';

/** 把 CardSpec 映射到对应卡片组件 */
export function CardRenderer({ spec }: { spec: CardSpec }) {
  switch (spec.kind) {
    case 'item': return <ItemCard id={spec.id} />;
    case 'unit': return <UnitCard id={spec.id} />;
    case 'building': return <BuildingCard id={spec.id} />;
    case 'recipe': return <RecipeCard productId={spec.productId} />;
    case 'message': return <MessageCard text={spec.text} />;
  }
}

/** 通用渲染容器：下半区渲染一个有序卡片列表 */
export function CardList({ cards }: { cards: View }) {
  return (
    <Stack spacing={2}>
      {cards.map((c, i) => <CardRenderer key={i} spec={c} />)}
    </Stack>
  );
}
