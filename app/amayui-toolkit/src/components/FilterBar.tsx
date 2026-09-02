import { useState } from 'react';
import { Box, Chip, FormControl, InputLabel, MenuItem, Popover, Select, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { FilterAlt } from '@mui/icons-material';
import { useStore } from '../store/useStore';
import { useSearchDraft } from '../store/useSearchDraft';
import { RuleChips } from './RuleChips';
import { buildResults } from '../services/search';
import { cardFromResult, CATEGORY_LABEL } from '../types/search';
import type { SearchExpression, SearchPredicate, SearchCategory, StarOp } from '../types/search';
import { isNamePredicate } from '../services/rules';
import { RACE_NAME, GENDER_NAME, ATTR_NAME } from '../types/metadata';

const KINDS: SearchCategory[] = ['item', 'unit', 'building', 'map', 'location', 'skill'];

/**
 * 分面 chip 行（见 docs/04-功能与界面设计.md §2.2）：
 *   常驻可删的「类型 / 单位分面」规则 chips + `＋筛选` 弹窗。
 *   - chips 删除 = 立即提交；
 *   - 弹窗内改分面 = 草稿；**关闭弹窗**才提交（避免边改边污染历史）。
 * 名称规则由上方 SearchBar 的名称框呈现，此处不渲染为 chip。
 */
export function FilterBar() {
  const dataset = useStore((s) => s.dataset);
  const navigate = useStore((s) => s.navigate);
  const draft = useSearchDraft();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingOp, setPendingOp] = useState<StarOp>('gte');   // 星级比较符（在选定星数前先记住）

  // 仅分面谓词（名称由搜索框承担）
  const facetExpr = draft.expr.filter((p) => !isNamePredicate(p));
  const expr = draft.expr;

  const commit = () => {
    const e: SearchExpression = draft.expr;
    if (!dataset || e.length === 0) return;
    navigate(e, buildResults(e, dataset).map((r) => cardFromResult(r.kind, r.id)));
  };

  const markDirty = () => setDirty(true);

  // 当前轴值（分面编辑器回显）
  const category = expr.find((p) => p.type === 'category')?.value ?? '';
  const race = expr.find((x): x is { type: 'unitAttr'; attr: 'race'; value: number } => x.type === 'unitAttr' && x.attr === 'race')?.value;
  const gender = expr.find((x): x is { type: 'unitAttr'; attr: 'gender'; value: number } => x.type === 'unitAttr' && x.attr === 'gender')?.value;
  const attribute = expr.find((x): x is { type: 'unitAttr'; attr: 'attribute'; value: number } => x.type === 'unitAttr' && x.attr === 'attribute')?.value;
  const star = expr.find((p): p is Extract<SearchPredicate, { type: 'unitStar' }> => p.type === 'unitStar');

  const onCategory = (kind: SearchCategory | '') => {
    if (kind === '') {
      const p = expr.find((x) => x.type === 'category');
      if (p) draft.removePredicate(p);
    } else {
      draft.setCategory(kind);
    }
    markDirty();
  };
  const onAxis = (axis: 'race' | 'gender' | 'attribute', value: string | number) => {
    if (value === '') {
      const p = expr.find((x) => x.type === 'unitAttr' && x.attr === axis);
      if (p) draft.removePredicate(p);
    } else {
      draft.setUnitFacet(axis, Number(value));
    }
    markDirty();
  };
  const onStarValue = (value: string | number) => {
    if (value === '') {
      const p = expr.find((x) => x.type === 'unitStar');
      if (p) draft.removePredicate(p);
    } else {
      draft.setUnitFacet('star', Number(value), star?.op ?? pendingOp);
    }
    markDirty();
  };
  const onStarOp = (op: StarOp) => {
    setPendingOp(op);
    if (star?.value != null) draft.setUnitFacet('star', star.value, op);
    markDirty();
  };
  const onRemoveChip = (pred: SearchPredicate) => { draft.removePredicate(pred); commit(); };
  const closePopover = () => { if (dirty) commit(); setAnchor(null); setDirty(false); };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
      <RuleChips expr={facetExpr} deletable onRemove={onRemoveChip} emptyText="未加筛选" />
      <Chip size="small" variant="outlined" color="primary" icon={<FilterAlt fontSize="small" />}
        label="筛选" clickable onClick={(e) => setAnchor(e.currentTarget)} />

      <Popover open={Boolean(anchor)} anchorEl={anchor}
        onClose={closePopover}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}>
        <Box sx={{ p: 2, width: 300 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>筛选</Typography>

          <FormControl fullWidth size="small">
            <InputLabel>类型</InputLabel>
            <Select value={category} label="类型" onChange={(e) => onCategory(e.target.value as SearchCategory | '')}>
              <MenuItem value="">（不限）</MenuItem>
              {KINDS.map((k) => <MenuItem key={k} value={k}>{CATEGORY_LABEL[k]}</MenuItem>)}
            </Select>
          </FormControl>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, mb: 0.5 }}>
            单位分面（选定后自动限定类型 = 单位）
          </Typography>

          <FormControl fullWidth size="small" sx={{ mb: 1 }}>
            <InputLabel>种族</InputLabel>
            <Select value={race ?? ''} label="种族" onChange={(e) => onAxis('race', e.target.value)}>
              <MenuItem value="">（不限）</MenuItem>
              {Object.entries(RACE_NAME).map(([v, n]) => <MenuItem key={v} value={Number(v)}>{n}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" sx={{ mb: 1 }}>
            <InputLabel>性别</InputLabel>
            <Select value={gender ?? ''} label="性别" onChange={(e) => onAxis('gender', e.target.value)}>
              <MenuItem value="">（不限）</MenuItem>
              {Object.entries(GENDER_NAME).map(([v, n]) => <MenuItem key={v} value={Number(v)}>{n}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" sx={{ mb: 1 }}>
            <InputLabel>属性</InputLabel>
            <Select value={attribute ?? ''} label="属性" onChange={(e) => onAxis('attribute', e.target.value)}>
              <MenuItem value="">（不限）</MenuItem>
              {Object.entries(ATTR_NAME).map(([v, n]) => <MenuItem key={v} value={Number(v)}>{n}</MenuItem>)}
            </Select>
          </FormControl>

          <Stack direction="row" spacing={1} alignItems="center">
            <ToggleButtonGroup size="small" exclusive value={star?.op ?? pendingOp} onChange={(_e, op) => op && onStarOp(op as StarOp)}>
              <ToggleButton value="gte">≥</ToggleButton>
              <ToggleButton value="eq">=</ToggleButton>
            </ToggleButtonGroup>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel>星级</InputLabel>
              <Select value={star?.value ?? ''} label="星级" onChange={(e) => onStarValue(e.target.value)}>
                <MenuItem value="">（不限）</MenuItem>
                {[1, 2, 3, 4, 5].map((n) => <MenuItem key={n} value={n}>★{n}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </Box>
      </Popover>
    </Box>
  );
}
