import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown, Folder, Plus} from 'lucide-react';
import './project-picker.css';

export function ProjectPicker({projects, value, onChange}) {
  const options = [{id:'', name:'新建项目'}, ...projects];
  const selectedIndex = Math.max(0, options.findIndex(option => option.id === value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);
  const [position, setPosition] = useState(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const optionRefs = useRef([]);
  const id = useId();
  const close = () => {setOpen(false); trigger.current?.focus({preventScroll:true});};
  const show = () => {setActive(selectedIndex); setOpen(true);};

  useLayoutEffect(() => {
    if (!open) return;
    let frame;
    const measure = () => {
      const rect = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const below = top + height - rect.bottom - 20;
      const above = rect.top - top - 20;
      const upward = above >= Math.min(320, 46 + options.length * 44) || above > below;
      const menuWidth = Math.min(Math.max(rect.width, 260), width - 24);
      setPosition({
        left:Math.max(left + 12, Math.min(rect.left, left + width - menuWidth - 12)),
        top:upward ? rect.top - 8 : rect.bottom + 8,
        width:menuWidth,
        maxHeight:Math.max(44, Math.min(320, upward ? above : below)),
        transform:upward ? 'translateY(-100%)' : undefined,
      });
    };
    const schedule = () => {cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);};
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open || !position) return;
    const option = optionRefs.current[Math.min(active, options.length - 1)];
    option?.focus({preventScroll:true});
    if (option && panel.current) {
      const menu = panel.current;
      if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
      if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight)
        menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
  }, [open, active, options.length, Boolean(position)]);

  useEffect(() => {
    if (!open) return;
    const outside = event => {
      if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const navigate = event => {
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close();}
    else if (event.key === 'Tab') close();
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
  };

  return <>
    <button type="button" ref={trigger} className="cw-project-picker" aria-label={`所属项目：${options[selectedIndex].name}`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : show()} onKeyDown={event => {
        if (['ArrowDown','ArrowUp'].includes(event.key)) {event.preventDefault(); show();}
      }}>
      <Folder size={15} aria-hidden="true"/><span>{options[selectedIndex].name}</span><ChevronDown size={13} aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={panel} id={id} className="cw-project-menu" role="listbox" aria-label="所属项目"
      style={position || {visibility:'hidden'}} onKeyDown={navigate}>
      <div className="cw-project-menu-label" role="presentation">所属项目</div>
      {options.map((option, index) => <button key={option.id} type="button" role="option"
        ref={element => {optionRefs.current[index] = element;}} tabIndex={index === active ? 0 : -1}
        aria-selected={option.id === value} title={option.name} className={index === 0 ? 'cw-project-create' : undefined}
        onClick={() => {onChange(option.id); close();}}>
        {index === 0 ? <Plus size={15} aria-hidden="true"/> : <Folder size={15} aria-hidden="true"/>}
        <span>{option.name}</span>{option.id === value && <Check size={14} className="cw-project-check" aria-hidden="true"/>}
      </button>)}
    </div>, document.body)}
  </>;
}
