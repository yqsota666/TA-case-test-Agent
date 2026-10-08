import React, {useEffect, useRef, useState} from 'react';
import './sidebar-resize.css';

const minWidth = () => window.innerWidth <= 680 ? 176 : window.innerWidth <= 900 ? 192 : 220;
const maxWidth = () => Math.max(minWidth(), Math.min(window.innerWidth <= 900 ? 320 : 480, window.innerWidth - (window.innerWidth <= 900 ? 300 : 480)));
const clampWidth = width => Math.round(Math.max(minWidth(), Math.min(maxWidth(), width)));

export function useSidebarResize() {
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [width, setWidth] = useState(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  useEffect(() => {
    const resize = () => {
      setViewportWidth(window.innerWidth);
      if (window.innerWidth <= 480) {drag.current = null; setDragging(false);}
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const cursor = document.body.style.cursor;
    const userSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [dragging]);
  const stop = () => {drag.current = null; setDragging(false);};
  const separator = <div className={`cw-sidebar-resize${dragging ? ' is-dragging' : ''}`}
    role="separator" tabIndex={0} aria-label="调整侧栏宽度" aria-orientation="vertical"
    aria-controls="cw-sidebar" aria-valuemin={minWidth()} aria-valuemax={maxWidth()}
    aria-valuenow={width === null ? (viewportWidth <= 680 ? 176 : viewportWidth <= 900 ? 208 : viewportWidth <= 1000 ? 252 : 272) : clampWidth(width)}
    title="左右拖动调整侧栏宽度，双击恢复默认"
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {id: event.pointerId, x: event.clientX, width: event.currentTarget.parentElement.getBoundingClientRect().width};
      setDragging(true);
    }}
    onPointerMove={event => {
      if (drag.current?.id === event.pointerId) setWidth(clampWidth(drag.current.width + event.clientX - drag.current.x));
    }}
    onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      stop();
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={stop} onLostPointerCapture={stop}
    onDoubleClick={() => setWidth(null)}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = event.currentTarget.parentElement.getBoundingClientRect().width;
      setWidth(clampWidth(event.key === 'Home' ? minWidth() : event.key === 'End' ? maxWidth() : current + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10)));
    }}/>;
  return {style: width === null ? undefined : {'--cw-sidebar-width': `${clampWidth(width)}px`}, separator};
}
