import { Chip } from '@mui/material';
import type { ReactNode } from 'react';
import { useStore } from '../store/useStore';
import type { CardSpec } from '../types/nav';

/** 可点“引用”→ navigate([target])，直接替换整个下半区 */
export function RefChip({ label, target }: { label: ReactNode; target: CardSpec }) {
  const navigate = useStore((s) => s.navigate);
  return (
    <Chip size="small" variant="outlined" color="primary" clickable label={label}
      onClick={() => navigate([target])} />
  );
}
