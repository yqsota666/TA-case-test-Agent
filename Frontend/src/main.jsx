import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowApp } from './workflow-app.jsx';
import './base.css';

createRoot(document.getElementById('root')).render(<WorkflowApp />);
