import React,{useState,useRef,useEffect,useId,useCallback,useMemo} from 'react';
import {createPortal} from 'react-dom';
import {IconChevronDown,IconCheck} from './Icons';
import {useTranslation} from '../hooks/useTranslation';
import {selectPosition} from './selectPosition';
import '../styles/select.css';
export interface SelectOption {value:string;label:React.ReactNode;description?:string;icon?:React.ReactNode;group?:string;disabled?:boolean;searchText?:string}
export interface SelectProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>,'value'|'onChange'|'size'> {
 value:string;onChange:(value:string)=>void;options:SelectOption[];placeholder?:string;placement?:'top'|'bottom';align?:'start'|'end';icon?:React.ReactNode;
 dropdownTitle?:string;size?:'sm'|'md';variant?:'field'|'inline';searchable?:boolean;footer?:React.ReactNode;displayValue?:React.ReactNode;popoverClassName?:string;
}
export function Select({value,onChange,options,placeholder,disabled=false,placement='bottom',align='start',icon,className='',style,dropdownTitle,size='md',variant='field',searchable=false,footer,displayValue,popoverClassName='',...buttonProps}:SelectProps){
 const {t}=useTranslation();const [open,setOpen]=useState(false);const [query,setQuery]=useState('');const [active,setActive]=useState(-1);
 const trigger=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLDivElement>(null);const search=useRef<HTMLInputElement>(null);const id=useId();
 const [position,setPosition]=useState<ReturnType<typeof selectPosition>>();const [portal,setPortal]=useState<Element|null>(null);
 const selected=options.find(item=>item.value===value);
 const filtered=useMemo(()=>options.filter(item=>`${item.searchText||''} ${typeof item.label==='string'?item.label:''} ${item.value} ${item.group||''}`.toLowerCase().includes(query.toLowerCase())),[options,query]);
 const close=useCallback((focus=false)=>{setOpen(false);if(focus)trigger.current?.focus({preventScroll:true});},[]);
 const updatePosition=useCallback(()=>{const rect=trigger.current?.getBoundingClientRect();if(rect)setPosition(selectPosition(rect,{width:window.innerWidth,height:window.innerHeight},placement,align));},[placement,align]);
 const show=()=>{if(disabled)return;setQuery('');setActive(options.findIndex(item=>item.value===value&&!item.disabled));setPortal(trigger.current?.closest('.modal-overlay')||document.querySelector('.workbench-app')||document.body);updatePosition();setOpen(true);};
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{
  if(!open)return;
  updatePosition();search.current?.focus({preventScroll:true});
  const outside=(event:PointerEvent)=>{const target=event.target as Node;if(!trigger.current?.contains(target)&&!panel.current?.contains(target))close();};
  const scroll=(event:Event)=>{if(!panel.current?.contains(event.target as Node))updatePosition();};
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',updatePosition);document.addEventListener('scroll',scroll,true);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',updatePosition);document.removeEventListener('scroll',scroll,true);};
 },[open,close,updatePosition]);
 useEffect(()=>{if(open&&active>=0)panel.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[active,open]);
 const choose=(index:number)=>{const item=filtered[index];if(!item||item.disabled)return;onChange(item.value);close(true);};
 const keyDown=(event:React.KeyboardEvent)=>{
  if((event.metaKey||event.ctrlKey)&&!event.altKey&&/^[1-5nkl]$/i.test(event.key)){close();return;}
  if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'){close(true);return;}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();event.stopPropagation();if(!open){show();return;}
   const enabled=filtered.map((item,index)=>item.disabled?-1:index).filter(index=>index>=0);if(!enabled.length)return;
   const current=enabled.indexOf(active);setActive(event.key==='Home'?enabled[0]:event.key==='End'?enabled[enabled.length-1]:current<0?(event.key==='ArrowUp'?enabled[enabled.length-1]:enabled[0]):enabled[(current+(event.key==='ArrowUp'?-1:1)+enabled.length)%enabled.length]);
  }else if((event.key==='Enter'||event.key===' ')&&open){if(event.key===' '&&event.target===search.current)return;event.preventDefault();event.stopPropagation();choose(active>=0?active:filtered.findIndex(item=>!item.disabled));}
 };
 return <div className={`custom-select ${variant==='inline'?'is-inline':''} ${open?'is-open':''} ${className}`} style={style}>
  <button {...buttonProps} ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open?id:undefined} aria-activedescendant={open&&active>=0?`${id}-${active}`:undefined} disabled={disabled}
   className={`custom-select-trigger custom-select-trigger-${size} ${open?'is-open':''}`} onClick={()=>open?close():show()} onKeyDown={keyDown}>
   <span className="custom-select-trigger-content">{(icon||selected?.icon)&&<span className="custom-select-trigger-icon">{icon||selected?.icon}</span>}<span className="custom-select-trigger-label">{displayValue||selected?.label||placeholder||t('ui.selectPlaceholder')}</span></span><IconChevronDown size={14}/>
  </button>
  {open&&portal&&position&&createPortal(<div ref={panel} className={`custom-select-popover ${popoverClassName}`} data-select-popover data-placement={position.placement} style={{position:'fixed',left:position.left,top:position.top,bottom:position.bottom,width:position.width,maxHeight:position.maxHeight}} onKeyDown={keyDown}>
   {dropdownTitle&&<div className="custom-select-dropdown-title">{dropdownTitle}</div>}
   {searchable&&<input ref={search} className="select-search" role="combobox" aria-label={t('ui.searchOptions')} aria-expanded="true" aria-controls={id} aria-activedescendant={active>=0?`${id}-${active}`:undefined} value={query} onChange={event=>{setQuery(event.target.value);setActive(-1);}} placeholder={t('ui.searchOptions')}/>}
   <div id={id} role="listbox" aria-label={buttonProps['aria-label']||dropdownTitle||t('ui.selectPlaceholder')} className="custom-select-options">
    {filtered.map((item,index)=><React.Fragment key={item.value}>{item.group&&(index===0||filtered[index-1].group!==item.group)&&<div role="presentation" className="custom-select-group">{item.group}</div>}
     <div id={`${id}-${index}`} role="option" aria-selected={item.value===value} aria-disabled={item.disabled||undefined} data-option-index={index} data-option-value={item.value} className={`custom-select-option ${item.value===value?'is-selected':''} ${index===active?'is-highlighted':''}`} onPointerMove={()=>!item.disabled&&setActive(index)} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(index)}>
      <span className="custom-select-option-check">{item.value===value&&<IconCheck size={14}/>}</span><span className="custom-select-option-copy"><span className="custom-select-option-label-row">{item.icon}{item.label}</span>{item.description&&<span className="custom-select-option-description">{item.description}</span>}</span>
     </div></React.Fragment>)}
    {!filtered.length&&<div className="custom-select-empty">{t('ui.noOptions')}</div>}
   </div>{footer&&<div className="select-footer" onClick={()=>close()}>{footer}</div>}
  </div>,portal)}
 </div>;
}
