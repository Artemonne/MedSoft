import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { App } from './App';

const theme = createTheme({ palette: { primary: { main: '#176b87' }, background: { default: '#f4f7f9' } }, shape: { borderRadius: 10 } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
