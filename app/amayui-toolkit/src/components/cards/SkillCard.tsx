import { Alert, Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import { useStore } from '../../store/useStore';
import { MessageCard } from './MessageCard';
import { entityTagLabel, idHex } from '../../services/idspace';

/** 描述行在游戏内的角色（对应 SKINIT 的三段数组） */
const DESC_ROLE = {
  title: { label: '题头', hint: '【分类：技能名】＋属性' },
  body: { label: '详述', hint: '技能说明面板正文' },
  short: { label: '简述', hint: '列表用单行摘要' },
} as const;

/**
 * 一行游戏文案：中文为主、日文原文对照，并标注它在 SKINIT 里的角色。
 * 文案含全角空格与游戏内排版意图，故用 `pre-wrap` 原样保留缩进。
 */
function DescLine({ role, zh, jp }: { role: keyof typeof DESC_ROLE; zh: string; jp: string }) {
  const { label, hint } = DESC_ROLE[role];
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip size="small" variant="outlined" label={label} sx={{ height: 20, flexShrink: 0 }} />
        <Typography variant="caption" color="text.secondary">{hint}</Typography>
      </Box>
      <Typography variant="body1" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
        {zh}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
        {jp}
      </Typography>
    </Box>
  );
}

/**
 * 技能卡片：展示 SKINIT 的技能名 + 三行描述文案（中文为主、日文对照）。
 *
 * 数据来自 `metadata.json` 的 `skills[]`（skillId = 名串地址 − 0x1d4f4）；
 * 三行文案分别取自三段并列数组，地址模型见 `docs/re/src/05-技能数据.md`。
 * 技能的 `mov` 数值字段（威力/射程/消耗等）尚未提取，故本卡片暂无数值区与跳转引用。
 */
export function SkillCard({ skillId }: { skillId: number }) {
  const dataset = useStore((s) => s.dataset);
  if (!dataset) return <MessageCard text="数据加载中…" />;
  const sk = dataset.bySkill.get(skillId);
  if (!sk) return <MessageCard text={`找不到技能 #${idHex(skillId)}`} />;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h6">{sk.nameZh || sk.name}</Typography>
          <Typography variant="body2" color="text.secondary">{sk.name}</Typography>
          <Chip size="small" variant="outlined" label={entityTagLabel('skill', sk.skillId)} />
          {!sk.hasDesc && <Chip size="small" color="warning" variant="outlined" label="无描述" />}
        </Box>
        <Typography variant="caption" color="text.secondary">
          来源：{sk.source}{sk.nameLine != null && `:${sk.nameLine}`}
        </Typography>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2">描述文案（游戏内三行）</Typography>

        {sk.hasDesc ? (
          <Stack>
            <DescLine role="title" zh={sk.titleZh ?? ''} jp={sk.title ?? ''} />
            <DescLine role="body" zh={sk.bodyZh ?? ''} jp={sk.body ?? ''} />
            <DescLine role="short" zh={sk.shortZh ?? ''} jp={sk.short ?? ''} />
          </Stack>
        ) : (
          <Alert severity="info" sx={{ mt: 1 }}>
            该技能只有名字、无描述文案 —— 属于仅供内部状态使用的技能槽。
          </Alert>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          技能的数值字段（威力 / 射程 / 消耗等 mov 项）尚未提取，语义未定。
        </Typography>
      </CardContent>
    </Card>
  );
}
