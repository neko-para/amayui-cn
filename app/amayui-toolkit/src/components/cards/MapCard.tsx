import {
  Box, Card, CardContent, Chip, Divider, Table, TableBody, TableCell, TableHead,
  TableRow, Typography, Tooltip,
} from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';
import { entityTagLabel, idHex } from '../../services/idspace';

/** 阵营/刷怪的简短说明（与 docs/地图内单位.md 对应） */
const FACTION_LABEL: Record<number, string> = {
  2: '敌方',
  3: '中立友方',
  4: '中立敌方',
};

export function MapCard({ mapNo }: { mapNo: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const map = dataset.byMapNum.get(mapNo);
  if (!map) return <MessageCard text={`找不到地图 #${idHex(mapNo)}`} />;

  const units = map.units;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{map.nameZh || map.name}</Typography>
          <Typography variant="body2" color="text.secondary">{map.name}</Typography>
          <Chip size="small" variant="outlined" label={entityTagLabel('map', parseInt(map.mapNo, 16))} />
          <Chip size="small" label={`单位槽 ${units.length}`} />
          {map.locationId != null && (
            <RefChip label={`← ${dataset.byLocation.get(map.locationId)?.nameZh || '地点'}`}
              target={{ kind: 'location', locationId: map.locationId }} />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary">来源：{map.source}</Typography>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2">地图内单位（数据表格）</Typography>

        {units.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>该地图无单位槽。</Typography>
        ) : (
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>单位</TableCell>
                <TableCell align="center">坐标(列,行)</TableCell>
                <TableCell align="center">等级范围</TableCell>
                <TableCell align="center">阵营</TableCell>
                <TableCell align="center">刷怪</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {units.map((mu, i) => {
                const unit = dataset.byUnit.get(mu.unitRef);
                const name = unit ? (unit.nameZh || unit.name) : `#${mu.unitRef.toString(16)}`;
                const coord = mu.col != null && mu.row != null ? `(${mu.col}, ${mu.row})` : '—';
                const lvl = mu.levelMin != null
                  ? (mu.levelMax != null ? `${mu.levelMin}–${mu.levelMax}` : `${mu.levelMin}`)
                  : '—';
                const faction = mu.faction != null ? FACTION_LABEL[mu.faction] ?? `${mu.faction}` : '—';
                const spawn = mu.spawnFlag === 1 ? '可刷' : mu.spawnFlag === 2 ? '出击' : '固定';
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <RefChip label={name} target={{ kind: 'unit', id: mu.unitRef }} />
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="以地图左上角为原点，1-based（列,行）">
                        <span>{coord}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="center">{lvl}</TableCell>
                    <TableCell align="center">{faction}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" variant="outlined" label={spawn}
                        color={spawn === '可刷' ? 'success' : spawn === '出击' ? 'warning' : 'default'} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          阵营/刷怪/坐标 语义依据 docs/地图内单位.md；点击单位可跳转到其卡片。
        </Typography>
      </CardContent>
    </Card>
  );
}
