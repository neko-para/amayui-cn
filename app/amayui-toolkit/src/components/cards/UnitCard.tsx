import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { RefChip } from '../RefChip';
import { MessageCard } from './MessageCard';
import { entityTagLabel, idHex } from '../../services/idspace';
import { RACE_NAME, GENDER_NAME, ATTR_NAME } from '../../types/metadata';
import { buildResults, queryFromId, queryFromUnitAttr, queryFromUnitStar, queryFromTraining } from '../../services/search';
import { cardFromResult } from '../../types/search';
import type { UnitAttrKind } from '../../types/search';

export function UnitCard({ id }: { id: number }) {
  const dataset = useStore((s) => s.dataset);
  const navigate = useStore((s) => s.navigate);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const unit = dataset.byUnit.get(id);
  if (!unit) return <MessageCard text={`找不到单位 #${idHex(id)}`} />;
  const maps = dataset.mapsWithUnit.get(id) ?? [];
  const spawnable = maps.filter((a) => a.spawnable);
  const fixed = maps.filter((a) => !a.spawnable);

  // 单位自身情报（EBINIT per-unit struct，v5 + v7 星级）
  const raceName = unit.race != null ? RACE_NAME[unit.race] : null;
  const genderName = unit.gender != null ? GENDER_NAME[unit.gender] : null;
  const attrName = unit.attribute != null ? ATTR_NAME[unit.attribute] : null;
  const star = unit.star != null ? unit.star + 1 : null;   // 0-based → ★N

  // 点击属性 chip → 构造 queryFromUnitAttr（自动 category=unit）→ 求值该属性值的全部单位
  const goAttr = (attr: UnitAttrKind, value: number) => {
    const expr = queryFromUnitAttr(attr, value);
    navigate(expr, buildResults(expr, dataset).map((r) => cardFromResult(r.kind, r.id)));
  };
  // 点击星级 chip → 构造 queryFromUnitStar(op='gte')（≥ 该星）→ 求值 ≥★N 的全部单位
  const goStar = (n: number) => {
    const expr = queryFromUnitStar('gte', n);
    navigate(expr, buildResults(expr, dataset).map((r) => cardFromResult(r.kind, r.id)));
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{unit.nameZh || unit.name}</Typography>
          <Typography variant="body2" color="text.secondary">{unit.name}</Typography>
          <Chip size="small" variant="outlined" label={entityTagLabel('unit', unit.unitId)} />
        </Box>
        <Typography variant="body2" sx={{ mt: 1 }}>{unit.titleZh || unit.title}</Typography>

        {/* 单位自身情报：种族 / 性别 / 属性（EBINIT per-unit struct）；点击 → 该类属性值的全部单位 */}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          {raceName && unit.race != null && (
            <Chip size="small" color="primary" variant="outlined" label={`种族 · ${raceName}`} title="点击查看同种族单位"
              clickable onClick={() => goAttr('race', unit.race!)} />
          )}
          {genderName && unit.gender != null && (
            <Chip size="small" variant="outlined" label={`性别 · ${genderName}`} title="点击查看同性别单位"
              clickable onClick={() => goAttr('gender', unit.gender!)} />
          )}
          {attrName && unit.attribute != null && (
            <Chip size="small" color="secondary" variant="outlined" label={`属性 · ${attrName}`} title="点击查看同属性单位"
              clickable onClick={() => goAttr('attribute', unit.attribute!)} />
          )}
          {star != null && (
            <Chip size="small" color="warning" variant="outlined" label={`★${star}`} title="点击查看 ≥★N 的单位"
              clickable onClick={() => goStar(star)} />
          )}
          {!raceName && !genderName && !attrName && star == null && (
            <Typography variant="body2" color="text.secondary">（该单位暂无种族/性别/属性/星级数据）</Typography>
          )}
        </Stack>

        {/* 训练内容：仅训练者单位展示（trainerId === unit.unitId）。左=需求（textZh，点击 query），右=收益（技能/未解析） */}
        {(() => {
          const trainings = dataset.metadata.trainings
            .filter((t) => t.trainerId === unit.unitId)
            .sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || (a.tid - b.tid));   // 游戏内顺序 = order(6c5595)升序
          if (trainings.length === 0) return null;
          const goTraining = (t: typeof trainings[number]) => {
            const expr = queryFromTraining(t);
            navigate(expr, buildResults(expr, dataset).map((r) => cardFromResult(r.kind, r.id)));
          };
          return (
            <>
              <Divider sx={{ my: 2 }} />
              <Box>
                <Typography variant="subtitle2">训练内容（{trainings.length}）</Typography>
                <Typography variant="caption" color="text.secondary">该训练者消耗满足条件的单位（点击需求可反查对应单位）</Typography>
                <Stack sx={{ mt: 1, spacing: 1.5 }} rowGap={1.5}>
                  {trainings.map((t, i) => {
                    const sk = t.skillId != null ? dataset.bySkill.get(t.skillId) : null;
                    return (
                      <Stack key={t.tid} direction="row" sx={{ alignItems: 'flex-start', gap: 2, pt: 0.75 }}>
                        {/* 左：需求（textZh，点击 query） */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Chip
                            size="small"
                            variant="outlined"
                            color="primary"
                            label={t.textZh}
                            title={t.text || t.textZh}
                            clickable
                            onClick={() => goTraining(t)}
                          />
                        </Box>
                        {/* 右：收益（技能可点击 / 暂未解析） */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          {sk
                            ? <Chip size="small" variant="outlined" color="success" clickable label={`技能 ${sk.nameZh || sk.name}`} title="点击查看技能" onClick={() => navigate(queryFromId('skill', sk.skillId), [cardFromResult('skill', sk.skillId)])} />
                            : <Chip size="small" variant="outlined" label="暂未解析" disabled />}
                        </Box>
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>
            </>
          );
        })()}

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2">掉落物{!unit.hasDrops ? '（无）' : ''}</Typography>
        {unit.drops.length === 0 ? (
          <Typography variant="body2" color="text.secondary">该单位无掉落表。</Typography>
        ) : (
          <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
            {unit.drops.map((d, i) => {
              const it = dataset.byItem.get(d.itemId);
              const rateLabel = d.rate >= 100 ? '100%' : `${d.rate}%`;
              return (
                <RefChip key={i}
                  label={`${it?.nameZh || '#' + idHex(d.itemId)} ${rateLabel}`}
                  target={{ kind: 'item', id: d.itemId }} />
              );
            })}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary">
          掉落率按百分比理解：低于 100 为对应概率，100 为必定掉落（BOSS 专属/保底）。
        </Typography>

        {maps.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
                <Typography variant="subtitle2">出现在地图（{maps.length}）</Typography>
                <Typography variant="caption" color="text.secondary">
                  可重复刷新 {spawnable.length} · 其它 {fixed.length}
                </Typography>
              </Stack>

              {spawnable.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span>可重复刷新</span>
                    <Typography component="span" variant="body2" color="text.secondary">（{spawnable.length}）</Typography>
                  </Typography>
                  <Stack direction="row" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 1 }}>
                    {spawnable.map((a) => (
                      <RefChip key={a.map.mapNo} label={a.map.nameZh || a.map.name}
                        target={{ kind: 'map', mapNo: parseInt(a.map.mapNo, 16) }} />
                    ))}
                  </Stack>
                </Box>
              )}

              {fixed.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <span>其它出现（固定/出击）</span>
                    <Typography component="span" variant="body2" color="text.secondary">（{fixed.length}）</Typography>
                  </Typography>
                  <Stack direction="row" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 1 }}>
                    {fixed.map((a) => (
                      <RefChip key={a.map.mapNo} label={a.map.nameZh || a.map.name}
                        target={{ kind: 'map', mapNo: parseInt(a.map.mapNo, 16) }} />
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
