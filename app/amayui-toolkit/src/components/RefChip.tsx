import { Chip } from '@mui/material';
import type { ReactNode } from 'react';
import { useStore } from '../store/useStore';
import { buildResults, queryFromId } from '../services/search';
import { cardFromResult } from '../types/search';
import type { SearchExpression } from '../types/search';
import type { CardSpec } from '../types/nav';

/** 卡片 spec → 内部 query（category + idExact）。求值 = 该单个实体的一张卡。 */
function specToExpr(spec: CardSpec): SearchExpression {
  switch (spec.kind) {
    case 'item': return queryFromId('item', spec.id);
    case 'unit': return queryFromId('unit', spec.id);
    case 'building': return queryFromId('building', spec.id);
    case 'map': return queryFromId('map', spec.mapNo);
    case 'location': return queryFromId('location', spec.locationId);
    case 'skill': return queryFromId('skill', spec.skillId);
    default: return [];
  }
}

/** 可点“引用”→ 构造内部 query（category + idExact），求值该实体视图替换下半区 */
export function RefChip({ label, target }: { label: ReactNode; target: CardSpec }) {
  const navigate = useStore((s) => s.navigate);
  const dataset = useStore((s) => s.dataset);
  const onClick = () => {
    if (!dataset) return;
    const expr = specToExpr(target);
    navigate(expr, buildResults(expr, dataset).map((r) => cardFromResult(r.kind, r.id)));
  };
  return (
    <Chip size="small" variant="outlined" color="primary" clickable label={label} onClick={onClick} />
  );
}
