import React from 'react';
import {Archive,ArrowLeftRight,ClipboardCheck,FileText,Table2} from '../ui-icons.jsx';
import {cn} from './element-utils.js';
import './artifact-card.css';

const icons={plan:FileText,data:Table2,files:ArrowLeftRight,result:ClipboardCheck,project:Archive};
export function ArtifactCard({title,meta,action='查看方案',kind='plan',variant='secondary',generating=false,disabled=false,className,...props}) {
  const Icon=icons[kind]??FileText;
  return <button {...props} type="button" data-slot="artifact-card" data-variant={variant} className={cn('cw-artifact',className)} disabled={disabled||generating} aria-busy={generating||undefined}>
    <span className="cw-artifact-icon" aria-hidden="true"><Icon size={20}/></span>
    <span className="cw-artifact-copy"><span className="cw-artifact-title">{title}</span>{(generating||meta)&&<span className="cw-artifact-meta">{generating?'整理中…':meta}</span>}</span>
    <span className="cw-artifact-action">{generating?'请稍候':action}</span>
  </button>;
}
