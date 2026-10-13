import React from 'react';
import './node-feedback.css';

export function ReplyFeedback({title, message, role = 'alert', children}) {
  return <div className="cw-node-feedback" role={role}>
    <svg className="cw-feedback-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9"/><path d="M12 7v6" strokeLinecap="round"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>
    </svg>
    <div className="cw-feedback-content"><p className="cw-feedback-title">{title}</p><p>{message}</p></div>
    {children && <div className="cw-feedback-actions">{children}</div>}
  </div>;
}
