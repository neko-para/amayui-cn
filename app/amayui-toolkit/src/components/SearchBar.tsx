import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { useStore } from '../store/useStore';
import { querySearch, type SearchEntry } from '../services/dataset';
import type { CardSpec } from '../types/nav';

/** 顶部搜索区（Autocomplete，日/中双索引） */
export function SearchBar() {
  const dataset = useStore((s) => s.dataset);
  const navigate = useStore((s) => s.navigate);
  if (!dataset) return <TextField fullWidth disabled label="数据加载中…" />;
  const options = dataset.search;

  return (
    <Autocomplete
      options={options}
      filterOptions={(opts, state) => querySearch(opts, state.inputValue ?? '')}
      getOptionLabel={(o) => o.nameZh || o.name}
      noOptionsText="无匹配"
      onChange={(_e, o) => { if (o) navigate([toCard(o)]); }}
      renderInput={(params) => <TextField {...params} label="搜索 物品 / 单位 / 设施 / 地图 / 地点（日/中）" />}
      renderOption={(props, o) => (
        <Box component="li" {...props} key={`${o.kind}-${o.id}`}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
            <Typography variant="body1">{o.nameZh || o.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {o.name}{o.sub ? ' · ' + o.sub : ''}
            </Typography>
          </Box>
        </Box>
      )}
    />
  );
}

function toCard(e: SearchEntry): CardSpec {
  if (e.kind === 'item') return { kind: 'item', id: e.id };
  if (e.kind === 'unit') return { kind: 'unit', id: e.id };
  if (e.kind === 'map') return { kind: 'map', mapNo: e.id };
  if (e.kind === 'location') return { kind: 'location', locationId: e.id };
  return { kind: 'building', id: e.id };
}
