import {AccountGate} from './account-gate.jsx';
import React from 'react';
import {ThemeProvider, initialTheme} from './theme-picker.jsx';
import {GlassMaterial} from './glass-material.jsx';
import { createRoot } from 'react-dom/client';
import { CaseWorkbench } from './case-workbench.jsx';
import './base.css';
import './defense-themes.css';
import './message-body.css';
import './spectral-components.css';

const initial = initialTheme();
document.documentElement.dataset.theme = initial;

createRoot(document.getElementById('root')).render(<ThemeProvider initial={initial}><GlassMaterial /><AccountGate><CaseWorkbench /></AccountGate></ThemeProvider>);
