import { useEffect, useMemo, useState } from 'react';
import {
  Alert, AppBar, Box, CssBaseline, IconButton, LinearProgress, Toolbar, Typography,
  ThemeProvider, createTheme, useMediaQuery,
} from '@mui/material';
import { ArrowBack, ArrowForward, Brightness4, Brightness7 } from '@mui/icons-material';
import { useStore, selectView } from './store/useStore';
import { SearchBar } from './components/SearchBar';
import { CardList } from './components/CardList';

export default function App() {
  const init = useStore((s) => s.init);
  const dataset = useStore((s) => s.dataset);
  const error = useStore((s) => s.error);
  const view = useStore(selectView);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const goBack = useStore((s) => s.goBack);
  const goForward = useStore((s) => s.goForward);
  const pos = useStore((s) => s.pos);
  const historyLen = useStore((s) => s.history.length);

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  const muiTheme = useMemo(() => createTheme({ palette: { mode } }), [mode]);

  useEffect(() => { void init(); }, [init]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static">
          <Toolbar>
            <IconButton color="inherit" onClick={goBack} disabled={pos <= 0}><ArrowBack /></IconButton>
            <IconButton color="inherit" onClick={goForward} disabled={pos >= historyLen - 1}><ArrowForward /></IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1, pl: 1 }}>Amayui Toolkit</Typography>
            {dataset && (
              <Typography variant="caption" sx={{ mr: 2 }}>
                物品 {dataset.metadata.counts.items} · 配方 {dataset.metadata.counts.recipes} · 单位 {dataset.metadata.counts.units} · 地图 {dataset.metadata.counts.maps}
              </Typography>
            )}
            <IconButton color="inherit" onClick={() => setTheme(mode === 'dark' ? 'light' : 'dark')} title="切换主题">
              {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
            </IconButton>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{
          flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
          p: { xs: 2, md: 3 }, maxWidth: 920, width: '100%', mx: 'auto',
        }}>
          {/* 上半：搜索区 */}
          <SearchBar />

          {error && <Alert severity="error">数据载入失败：{error}</Alert>}
          {!dataset && !error && <LinearProgress />}

          {/* 下半：通用卡片容器（数据区） */}
          {dataset && (
            <Box sx={{ flexGrow: 1 }}>
              <CardList cards={view} />
            </Box>
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
