import {useEffect} from 'react';
import {useTheme} from './theme-picker.jsx';

export function GlassMaterial() {
  const {theme} = useTheme();
  useEffect(() => {
    if (!['liquid','prism'].includes(theme)) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = matchMedia('(any-pointer: fine)');
    let frame = 0;
    let active = null;
    let latest = null;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (active) for (const name of ['--glass-x','--glass-y','--glass-angle']) active.style.removeProperty(name);
      active = null;
    };
    const move = event => {
      if (reduced.matches || !pointer.matches) return;
      const surface = event.target instanceof Element ? event.target.closest('.cw-composer-frame') : null;
      if (!surface) {reset(); return;}
      if (active !== surface) {reset(); active = surface;}
      latest = {x:event.clientX,y:event.clientY};
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!active || !latest) return;
        const bounds = active.getBoundingClientRect();
        const x = Math.max(0,Math.min(100,(latest.x-bounds.left)/bounds.width*100));
        const y = Math.max(0,Math.min(100,(latest.y-bounds.top)/bounds.height*100));
        active.style.setProperty('--glass-x',`${x}%`);
        active.style.setProperty('--glass-y',`${y}%`);
        active.style.setProperty('--glass-angle',`${90+x*1.2}deg`);
      });
    };
    document.addEventListener('pointermove',move,{passive:true});
    document.addEventListener('pointerleave',reset);
    window.addEventListener('blur',reset);
    reduced.addEventListener('change',reset);
    pointer.addEventListener('change',reset);
    return () => {
      reset();
      document.removeEventListener('pointermove',move);
      document.removeEventListener('pointerleave',reset);
      window.removeEventListener('blur',reset);
      reduced.removeEventListener('change',reset);
      pointer.removeEventListener('change',reset);
    };
  },[theme]);
  return null;
}
