import {createContext, useContext, useEffect, useRef, useState} from 'react';
import {Palette, Check} from './ui-icons.jsx';
import './theme-picker.css';
import './palette-preview.css';

export const themes = [
  ['liquid','蓝色玻璃'], ['neutral','灰白'], ['warm','暖灰'], ['contrast','深灰侧栏'],
];
const valid = value => themes.some(([id]) => id === value);
const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);
function requestedAppearance() {
  const palette = new URLSearchParams(location.search).get('palette');
  return valid(palette) ? palette : 'contrast';
}
function applyAppearance(value) {
  document.documentElement.dataset.theme = 'liquid';
  if (value === 'liquid') delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = value;
}
applyAppearance(requestedAppearance());
export function initialTheme() {
  return 'liquid';
}
export function ThemeProvider({children}) {
  const [appearance, setAppearance] = useState(requestedAppearance);
  const choose = value => {
    if (!valid(value)) return;
    applyAppearance(value);
    setAppearance(value);
    const url = new URL(location.href);
    url.searchParams.set('theme', 'liquid');
    url.searchParams.set('palette', value);
    history.replaceState(history.state, '', url);
  };
  useEffect(() => {
    const restore = () => {const value = requestedAppearance(); applyAppearance(value); setAppearance(value);};
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  return <ThemeContext.Provider value={{theme:'liquid', appearance, choose}}>{children}</ThemeContext.Provider>;
}
export function ThemePicker() {
  const {appearance, choose} = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const selected = useRef(null);
  useEffect(() => {
    if (!open) return;
    selected.current?.focus({preventScroll:true});
    if (selected.current) {
      const panel = selected.current.parentElement;
      panel.scrollTop = Math.max(0, selected.current.offsetTop - panel.clientHeight / 2);
    }
    const outside = event => {if (!root.current?.contains(event.target)) setOpen(false);};
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="cw-appearance" ref={root} onKeyDown={event => {
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({preventScroll:true});}
  }}>
    <button type="button" className="cw-appearance-trigger" ref={trigger} aria-label="选择外观" title="选择外观" aria-expanded={open} onClick={() => setOpen(value => !value)}><Palette size={17}/></button>
    {open && <div className="cw-appearance-panel" role="group" aria-label="外观">
      {themes.map(([id,label]) => <button key={id} type="button" ref={id === appearance ? selected : null} aria-pressed={id === appearance} onClick={() => {choose(id); setOpen(false); trigger.current?.focus({preventScroll:true});}}>
        <span className={`cw-appearance-swatch cw-swatch-${id}`} aria-hidden="true"/><span>{label}</span>{id === appearance && <Check size={14}/>}</button>)}
    </div>}
  </div>;
}
