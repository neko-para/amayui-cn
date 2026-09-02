import { type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Autocomplete, Box, Chip, IconButton, TextField, Typography } from '@mui/material';
import { Close } from '@mui/icons-material';
import { useStore } from '../store/useStore';
import { useSearchDraft } from '../store/useSearchDraft';
import { filterCandidates, type SearchEntry } from '../services/dataset';
import { buildResults } from '../services/search';
import { cardFromResult, CATEGORY_LABEL } from '../types/search';
import type { SearchExpression } from '../types/search';
import type { EntityTag } from '../types/nav';

/** 类型标签（搜索结果左侧 tag；与右侧统一「名称中文」对应） */
const KIND_TAG: Record<EntityTag, string> = CATEGORY_LABEL;

/**
 * 顶部搜索框 = 「名称」规则槽（见 docs/04-功能与界面设计.md §2.2）：
 *   - 键入 = `nameSub` 草稿（不写历史）；
 *   - 点候选 = `nameExact` 同名成组（并把该候选类型写成「类型」chip），提交；
 *   - 回车 = 提交当前名称草稿（`nameSub`）。
 * 分面（类型/种族/…）由下方的 FilterBar（RuleChips + ＋筛选）呈现。
 */
export function SearchBar() {
  const dataset = useStore((s) => s.dataset);
  const navigate = useStore((s) => s.navigate);
  const draft = useSearchDraft();

  if (!dataset) return <TextField fullWidth disabled label="数据加载中…" />;
  const options = dataset.search;

  const commit = (expr: SearchExpression) => {
    if (!dataset || expr.length === 0) return;
    navigate(expr, buildResults(expr, dataset).map((r) => cardFromResult(r.kind, r.id)));
  };

  // 点候选 → nameExact 同名成组 + 类型 = 该候选类型
  const onCandidate = (entry: SearchEntry) => {
    const name = entry.nameZh || entry.name;
    const expr: SearchExpression = [{ type: 'category', value: entry.kind }, { type: 'nameExact', value: name }];
    draft.load(expr);
    commit(expr);
  };

  // 回车 → 提交当前名称草稿（nameSub）
  const onEnter = () => commit(draft.toExpr());

  return (
    <Autocomplete
      freeSolo
      options={options}
      value={null}
      inputValue={draft.nameInput}
      onInputChange={(_e, v) => draft.setNameInput(v)}
      filterOptions={(opts, state) => filterCandidates(opts, state.inputValue ?? '')}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.nameZh || o.name)}
      noOptionsText="无匹配"
      clearOnBlur={false}
      onChange={(_e, value, reason) => {
        if (reason === 'selectOption' && value && typeof value === 'object') onCandidate(value as SearchEntry);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="搜索 名称…（回车确认）"
          inputProps={{
            ...params.inputProps,
            onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') { e.preventDefault(); onEnter(); return; }
              params.inputProps.onKeyDown?.(e);
            },
          }}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {draft.nameInput !== '' && (
                  <IconButton size="small" onClick={() => draft.setNameInput('')} aria-label="清除名称">
                    <Close fontSize="small" />
                  </IconButton>
                )}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      renderOption={(props, o) => (
        <Box component="li" {...props} key={`${o.kind}-${o.id}`}>
          <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1, py: 0.5 }}>
            <Chip size="small" variant="outlined" label={KIND_TAG[o.kind]}
              sx={{ flexShrink: 0, minWidth: 40, justifyContent: 'center' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body1" noWrap>{o.nameZh || o.name}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>{o.name}</Typography>
            </Box>
          </Box>
        </Box>
      )}
    />
  );
}
