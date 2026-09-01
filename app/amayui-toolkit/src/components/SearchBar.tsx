import { useState } from 'react';
import { Autocomplete, Box, Chip, TextField, Typography } from '@mui/material';
import { useStore } from '../store/useStore';
import { querySearch, type SearchEntry } from '../services/dataset';
import type { CardSpec, View } from '../types/nav';
import type { EntityTag } from '../types/nav';

/** 类型标签（搜索结果左侧 tag；与右侧统一「名称日文」对应） */
const KIND_TAG: Record<EntityTag, string> = {
  item: '物品',
  unit: '单位',
  building: '设施',
  map: '地图',
  location: '地点',
};

/** 顶部搜索区（Autocomplete，日/中双索引；同名同类型合并，选中下放全部命中卡片） */
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
      filterOptions={(opts, state) => querySearch(opts, state.inputValue ?? '')}
      getOptionLabel={(o) => o.nameZh || o.name}
      noOptionsText="无匹配"
      clearOnBlur={false}   // 保留已输入内容，点击展开时继续用输入文字搜索
      onChange={(_e, o) => { if (o) { setInputValue(''); navigate(toView(o)); } }}
      renderInput={(params) => <TextField {...params} label="搜索 物品 / 单位 / 设施 / 地图 / 地点（日/中）" />}
      renderOption={(props, o) => {
        const merged = o.count > 1;
        return (
          <Box component="li" {...props} key={`${o.kind}-${o.ids.join('-')}`}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1, py: 0.5 }}>
              <Chip size="small" variant="outlined" label={KIND_TAG[o.kind]}
                sx={{ flexShrink: 0, minWidth: 40, justifyContent: 'center' }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Typography variant="body1" noWrap>{o.nameZh || o.name}</Typography>
                  {merged && <Chip size="small" color="info" variant="outlined" label={`×${o.count}`} sx={{ height: 18 }} />}
                </Box>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {o.name}{merged && `（${o.count} 个同名${KIND_TAG[o.kind]}）`}
                </Typography>
              </Box>
            </Box>
          </Box>
        );
      }}
    />
  );
}

/** 由合并后的搜索项生成目标 View（下放全部命中的卡片，保序） */
function toView(e: SearchEntry): View {
  return e.ids.map((id) => cardFor(e.kind, id));
}

function cardFor(kind: EntityTag, id: number): CardSpec {
  switch (kind) {
    case 'item': return { kind: 'item', id };
    case 'unit': return { kind: 'unit', id };
    case 'building': return { kind: 'building', id };
    case 'map': return { kind: 'map', mapNo: id };
    case 'location': return { kind: 'location', locationId: id };
  }
}
