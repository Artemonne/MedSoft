import React from 'react';
import ReactDOM from 'react-dom/client';
import { Alert, Box, CssBaseline, Paper, ThemeProvider, Typography, createTheme } from '@mui/material';
import { App } from './App';
const theme = createTheme({ palette: { primary: { main: '#176b67' }, background: { default: '#f5f7f8' } }, typography: { fontFamily: 'Segoe UI, sans-serif' } });
const content = typeof window.lis === 'undefined'
  ? <Box sx={{ maxWidth: 680, mx: 'auto', p: 4 }}><Paper sx={{ p: 3 }}><Typography variant="h4" gutterBottom>MedSoft LIS</Typography><Alert severity="info">LIS работает как отдельное Electron-приложение. Запустите её командой npm run dev:lis и используйте открывшееся окно приложения.</Alert></Paper></Box>
  : <App />;
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline />{content}</ThemeProvider></React.StrictMode>);
