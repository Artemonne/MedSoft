import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { App } from './App';
const theme = createTheme({ palette: { primary: { main: '#176b67' }, background: { default: '#f5f7f8' } }, typography: { fontFamily: 'Segoe UI, sans-serif' } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
