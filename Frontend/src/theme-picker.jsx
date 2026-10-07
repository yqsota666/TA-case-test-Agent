import {createContext, useContext, useEffect, useRef, useState} from 'react';
import {Palette, Check} from 'lucide-react';
import './theme-picker.css';

export const themes = [
  ['liquid','液态玻璃'], ['prism','棱镜玻璃'], ['opal','欧泊玻璃'], ['glacier','冰晶玻璃'],
  ['aurora','光谱玻璃'], ['porcelain','瓷白'], ['folio','书页'], ['jade','青玉'],
  ['copper','暖铜'], ['obsidian','黑曜石'],
  ['graphite','石墨黑'], ['abyss','深海蓝'],
];
const preferenceKey = 'case-agent-appearance';
const valid = value => themes.some(([id]) => id === value);
const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);
export function initialTheme() {
  const requested = new URLSearchParams(location.search).get('theme');
  if (valid(requested)) return requested;
  return 'liquid';
}
export function ThemeProvider({initial, children}) {
  const [theme, setTheme] = useState(initial);
  const choose = value => {
    if (!valid(value)) return;
    document.documentElement.dataset.theme = value;
    setTheme(value);
    try {localStorage.setItem(preferenceKey, value);} catch {}
    const url = new URL(location.href);
    url.searchParams.set('theme', value);
    history.replaceState(history.state, '', url);
  };
  useEffect(() => {
    const restore = () => {const value = initialTheme(); document.documentElement.dataset.theme = value; setTheme(value);};
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  return <ThemeContext.Provider value={{theme, choose}}>{children}</ThemeContext.Provider>;
}
export function ThemePicker() {
  const {theme, choose} = useTheme();
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
      {themes.map(([id,label]) => <button key={id} type="button" ref={id === theme ? selected : null} aria-pressed={id === theme} onClick={() => {choose(id); setOpen(false); trigger.current?.focus({preventScroll:true});}}>
        <span className={`cw-appearance-swatch cw-swatch-${id}`} aria-hidden="true"/><span>{label}</span>{id === theme && <Check size={14}/>}</button>)}
    </div>}
  </div>;
}
