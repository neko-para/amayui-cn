import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { rulesFromExpr } from '../services/rules';
import type { SearchExpression, SearchPredicate } from '../types/search';

interface RuleChipsProps {
  /** 要渲染的表达式（顶部传「分面」expr；历史传完整 expr）。 */
  expr: SearchExpression;
  /** 是否可删（顶部 interactive）；删除时回调该谓词。 */
  deletable?: boolean;
  onRemove?: (pred: SearchPredicate) => void;
  /** 紧凑只读模式（历史侧栏）：小号 chip + 最多 N 枚后折叠为 …(N)。 */
  dense?: boolean;
  /** 无规则时的占位文案（可选）。 */
  emptyText?: string;
}

/** 密集模式最多显示多少枚 chip，其余折叠成 `…(N)`。 */
const DENSE_CAP = 4;

/**
 * 把谓词渲染成「规则」chips。顶部搜索区（interactive）与右侧历史侧栏（readonly+dense）共用，
 * 文案统一来自 `rulesFromExpr`。见 docs/04-功能与界面设计.md §2.1 / §2.3。
 */
export function RuleChips({ expr, deletable, onRemove, dense, emptyText }: RuleChipsProps) {
  const rules = rulesFromExpr(expr);
  if (rules.length === 0) {
    if (emptyText) return (
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: dense ? 12 : 13 }}>
        {emptyText}
      </Typography>
    );
    return null;
  }

  const shown = dense ? rules.slice(0, DENSE_CAP) : rules;
  const rest = dense ? rules.slice(DENSE_CAP) : [];
  const fullTooltip = rules.map((r) => r.label).join(' · ');

  const chips = (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', minWidth: 0 }}>
      {shown.map((r) => (
        <Chip key={r.key} size={dense ? 'small' : 'small'} variant="outlined" color="primary"
          label={r.label}
          title={r.label}
          onDelete={deletable ? () => onRemove?.(r.pred) : undefined}
          sx={{ maxWidth: '100%' }}
        />
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.map((r) => r.label).join(' · ')}>
          <Chip size="small" variant="outlined" label={`…(${rest.length})`} />
        </Tooltip>
      )}
    </Box>
  );

  // 历史侧栏：整行工具提示 = 完整规则（无障碍/兜底）。
  return dense ? <Tooltip title={fullTooltip}>{chips}</Tooltip> : chips;
}
