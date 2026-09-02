import { useEffect, useMemo, useState } from 'react';
import {
  Alert, AppBar, Box, CssBaseline, Drawer, IconButton, LinearProgress, Toolbar, Typography,
  ThemeProvider, createTheme, useMediaQuery,
} from '@mui/material';
import { ArrowBack, ArrowForward, Brightness4, Brightness7, Menu } from '@mui/icons-material';
import { useStore, selectView } from './store/useStore';
import { SearchBar } from './components/SearchBar';
import { FilterBar } from './components/FilterBar';
import { CardList } from './components/CardList';
import { HistorySidebar } from './components/HistorySidebar';

const SIDEBAR_W = 272;

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
  const isDesktop = useMediaQuery('(min-width: 900px)');   // 与侧栏 `md` 断点一致
  const [navOpen, setNavOpen] = useState(false);
  const mode = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  const muiTheme = useMemo(() => createTheme({
    palette: { mode },
    components: {
      // 细滚动条：降低因滚动条占宽导致的内容与搜索框的左右错位
      MuiCssBaseline: {
        styleOverrides: {
          body: { scrollbarWidth: 'thin' },
          '*::-webkit-scrollbar': { width: 6, height: 6 },
          '*::-webkit-scrollbar-thumb': { borderRadius: 3, backgroundColor: 'rgba(128,128,128,.4)' },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
        },
      },
      // 卡片：加边框 + 阴影强化边缘；边框颜色与搜索框(OutlinedInput)非激活态一致
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: '1px solid',
            borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.23)' : 'rgba(0,0,0,0.23)',
            boxShadow: '0 1px 2px rgba(16,24,40,.06), 0 4px 10px rgba(16,24,40,.08)',
          }),
        },
      },
    },
  }), [mode]);

  useEffect(() => { void init(); }, [init]);

  const sidebar = <HistorySidebar />;

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <AppBar position="static">
          <Toolbar>
            {/* 移动端：菜单按钮 → 左侧抽屉（历史记录） */}
            {!isDesktop && (
              <IconButton color="inherit" edge="start" onClick={() => setNavOpen(true)} sx={{ mr: 1 }} aria-label="打开菜单">
                <Menu />
              </IconButton>
            )}
            <IconButton color="inherit" onClick={goBack} disabled={pos <= 0}><ArrowBack /></IconButton>
            <IconButton color="inherit" onClick={goForward} disabled={pos >= historyLen - 1}><ArrowForward /></IconButton>
            <Typography variant="h6" sx={{ flexGrow: 1, pl: 1 }}>Amayui Toolkit</Typography>
            {dataset && (
              <Typography variant="caption" sx={{ mr: 2 }}>
                物品 {dataset.metadata.counts.items} · 配方 {dataset.metadata.counts.recipes} · 单位 {dataset.metadata.counts.units} · 地图 {dataset.metadata.counts.maps} · 地点 {dataset.metadata.counts.locations} · 技能 {dataset.metadata.counts.skills}
              </Typography>
            )}
            <IconButton color="inherit" onClick={() => setTheme(mode === 'dark' ? 'light' : 'dark')} title="切换主题">
              {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
            </IconButton>
          </Toolbar>
        </AppBar>

        <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* 桌面：固定左侧历史记录 */}
          <Box component="nav" sx={{
            width: SIDEBAR_W, flexShrink: 0, borderRight: 1, borderColor: 'divider',
            display: { xs: 'none', md: 'block' },
          }}>{sidebar}</Box>

          {/* 中央：搜索框 = 顶部固定头（透明背景，阴影可见、无内容在其后）；滚动区在其下方裁剪内容，二者用 scrollbar-gutter 保持居中一致 */}
          <Box component="main" sx={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* 固定搜索头：不滚动、不压缩、不预留滚动条槽(不滚动)，正常居中 */}
            <Box sx={{
              flexShrink: 0, alignSelf: 'center',
              width: '100%', maxWidth: 920,
              px: { xs: 2, md: 3 }, pt: { xs: 2, md: 3 }, pb: 1,
            }}>
              <SearchBar />
              <Box sx={{ mt: 0.5 }}><FilterBar /></Box>
            </Box>

            {/* 滚动区：内容被裁剪（不溢出到搜索头之上），两侧对称预留滚动条槽(防止单侧滚动条把内容往左挤) */}
            <Box sx={{ flexGrow: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', scrollbarGutter: 'stable both-edges' }}>
              <Box sx={{ maxWidth: 920, width: '100%', mx: 'auto', px: { xs: 2, md: 3 }, pb: { xs: 2, md: 3 } }}>
                {error && <Alert severity="error">数据载入失败：{error}</Alert>}
                {!dataset && !error && <LinearProgress />}

                {dataset && <CardList cards={view} />}
              </Box>
            </Box>
          </Box>
        </Box>

        {/* 移动端：左侧抽屉（历史记录） */}
        <Drawer anchor="left" open={!isDesktop && navOpen} onClose={() => setNavOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_W } }}>
          <Box sx={{ width: SIDEBAR_W }}>{sidebar}</Box>
        </Drawer>
      </Box>
    </ThemeProvider>
  );
}
