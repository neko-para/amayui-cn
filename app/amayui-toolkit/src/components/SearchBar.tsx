import { useState } from 'react';
import { Autocomplete, Box, Chip, TextField, Typography } from '@mui/material';
import { useStore } from '../store/useStore';
import { filterCandidates, type SearchEntry } from '../services/dataset';
import { buildResults, queryFromEntry } from '../services/search';
import { cardFromResult, CATEGORY_LABEL } from '../types/search';
import type { EntityTag } from '../types/nav';

/** 类型标签（搜索结果左侧 tag；与右侧统一「名称日文」对应） */
const KIND_TAG: Record<EntityTag, string> = CATEGORY_LABEL;

/**
 * 顶部搜索区（Autocomplete）。
 * 输入仅用于**筛选候选**（名称/hex 子串）；点选候选时构造内部 query =
 * `{category: kind, nameExact: nameZh}`，求值得到该类型下**同名实体的全部卡片**作为当前视图。
 */
export function SearchBar() {
  const dataset = useStore((s) => s.dataset);
  const navigate = useStore((s) => s.navigate);
  const [inputValue, setInputValue] = useState('');
  if (!dataset) return <TextField fullWidth disabled label="数据加载中…" />;
  const options = dataset.search;

  return (
    <Autocomplete
      options={options}
      value={null}   // 受控：永不持有「已选」值，避免 re-open 时 inputValueIsSelectedValue 触发 '' 传入 filterOptions
      inputValue={inputValue}
      onInputChange={(_e, v) => setInputValue(v)}
      filterOptions={(opts, state) => filterCandidates(opts, state.inputValue ?? '')}
      getOptionLabel={(o) => o.nameZh || o.name}
      noOptionsText="无匹配"
      clearOnBlur={false}   // 保留已输入内容，点击展开时继续用输入文字搜索
      onChange={(_e, o) => {
        if (o && dataset) {
          setInputValue('');
          // 构造内部 query：category + nameExact → 该类型下同名实体的全部结果。
          const expr = queryFromEntry(o);
          navigate(expr, buildResults(expr, dataset).map((r) => cardFromResult(r.kind, r.id)));
        }
      }}
      renderInput={(params) => <TextField {...params} label="搜索 物品 / 单位 / 设施 / 地图 / 地点 / 技能（日/中）" />}
      renderOption={(props, o) => (
        <Box component="li" {...props} key={`${o.kind}-${o.id}`}>
          <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1, py: 0.5 }}>
            <Chip size="small" variant="outlined" label={KIND_TAG[o.kind]}
              sx={{ flexShrink: 0, minWidth: 40, justifyContent: 'center' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="body1" noWrap>{o.nameZh || o.name}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" noWrap>{o.name}</Typography>
            </Box>
          </Box>
        </Box>
      )}
    />
  );
}
