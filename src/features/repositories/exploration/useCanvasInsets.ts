import { useLayoutEffect, useState, type RefObject } from 'react';
import { emptyInsets, type CanvasInsets } from './mapGeometry';

/** Observe actual occluding surfaces; opening a panel never changes graph geometry. */
export function useCanvasInsets(root: RefObject<HTMLElement>, revision: string): CanvasInsets {
  const [insets,setInsets]=useState(emptyInsets);
  useLayoutEffect(()=>{
    const page=root.current;if(!page)return;
    const measure=()=>{
      const viewport=page.querySelector('.explore-map-viewport');if(!viewport)return;
      const rect=viewport.getBoundingClientRect();if(!rect.width||!rect.height)return;
      const dock=page.querySelector('.explore-command-dock')?.getBoundingClientRect();
      if(dock)page.style.setProperty('--explore-command-bottom',`${dock.bottom-page.getBoundingClientRect().top}px`);
      let top=16,right=16;
      for(const selector of ['.explore-command-dock','.explore-navigation','.explore-disambiguation']){
        const element=page.querySelector(selector);if(!element||!element.getClientRects().length)continue;
        top=Math.max(top,element.getBoundingClientRect().bottom-rect.top+12);
      }
      const panel=page.querySelector<HTMLElement>('.explore-results');
      if(panel&&!panel.hidden&&panel.getClientRects().length)right=Math.max(right,rect.right-panel.getBoundingClientRect().left+12);
      const status=page.querySelector<HTMLDetailsElement>('.explore-status-dock');
      if(status?.open)right=Math.max(right,rect.right-status.getBoundingClientRect().left+12);
      const next={left:16,right,top,bottom:58};
      setInsets(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    };
    const observer=new ResizeObserver(measure);
    [page,...page.querySelectorAll('.explore-command-dock,.explore-navigation,.explore-results,.explore-status-dock')].forEach(element=>observer.observe(element));
    page.addEventListener('toggle',measure,true);window.addEventListener('resize',measure);measure();
    return()=>{observer.disconnect();page.removeEventListener('toggle',measure,true);window.removeEventListener('resize',measure);};
  },[root,revision]);
  return insets;
}
