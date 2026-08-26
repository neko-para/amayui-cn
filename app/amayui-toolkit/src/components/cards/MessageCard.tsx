import { Card, CardContent, Typography } from '@mui/material';

/** 纯文本卡片（空态 / 错误 / 来源未知提示） */
export function MessageCard({ text }: { text: string }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography color="text.secondary">{text}</Typography>
      </CardContent>
    </Card>
  );
}
