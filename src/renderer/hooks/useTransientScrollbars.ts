import {useEffect} from 'react';

/** Track actual scrolling once for all workbench panels, menus and dialogs. */
export function useTransientScrollbars() {
  useEffect(()=>{
    const timers=new Map<HTMLElement,ReturnType<typeof setTimeout>>();
    let dragging:HTMLElement|null=null;
    const hideLater=(element:HTMLElement)=>{
      clearTimeout(timers.get(element));
      timers.set(element,setTimeout(()=>{
        if(dragging===element){hideLater(element);return;}
        element.removeAttribute('data-scroll-active');timers.delete(element);
      },900));
    };
    const onScroll=(event:Event)=>{
      const element=event.target;
      if(!(element instanceof HTMLElement)||!element.closest('.workbench-app'))return;
      const style=getComputedStyle(element);
      const vertical=element.scrollHeight>element.clientHeight+1&&/auto|scroll/.test(style.overflowY);
      const horizontal=element.scrollWidth>element.clientWidth+1&&/auto|scroll/.test(style.overflowX);
      if(!vertical&&!horizontal)return;
      element.setAttribute('data-scroll-active','true');hideLater(element);
    };
    const onPointerDown=(event:PointerEvent)=>{
      if(!(event.target instanceof HTMLElement))return;
      const element=event.target.closest<HTMLElement>('[data-scroll-active]');
      if(!element)return;
      const rect=element.getBoundingClientRect();
      if(event.clientX>=rect.left+element.clientWidth||event.clientY>=rect.top+element.clientHeight)dragging=element;
    };
    const onPointerUp=()=>{const element=dragging;dragging=null;if(element)hideLater(element);};
    document.addEventListener('scroll',onScroll,true);
    document.addEventListener('pointerdown',onPointerDown,true);
    document.addEventListener('pointerup',onPointerUp,true);
    document.addEventListener('pointercancel',onPointerUp,true);
    window.addEventListener('blur',onPointerUp);
    return()=>{
      document.removeEventListener('scroll',onScroll,true);
      document.removeEventListener('pointerdown',onPointerDown,true);
      document.removeEventListener('pointerup',onPointerUp,true);
      document.removeEventListener('pointercancel',onPointerUp,true);
      window.removeEventListener('blur',onPointerUp);
      for(const [element,timer] of timers){clearTimeout(timer);element.removeAttribute('data-scroll-active');}
    };
  },[]);
}
