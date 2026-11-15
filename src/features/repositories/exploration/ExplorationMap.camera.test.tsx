import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearExplorationWorkspace } from '../hooks/useExplorationWorkspace';
import { ExplorationMap } from './ExplorationMap';
import { projectScene } from './model';
import { accountFixture, repositoryFixture } from './testFixtures';
import { computeLayerSatellites, layoutExploration, type MapLayout } from './graphLayout';
import { overviewCamera } from './mapGeometry';
describe('map camera persistence boundaries', () => {
  beforeEach(()=>clearExplorationWorkspace());
  it('does not let a queued wheel frame overwrite an explicit overview',async()=>{
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:1000,height:700,x:0,y:0,left:0,top:0,right:1000,bottom:700,toJSON:()=>({})});
    try{
      const repositories=[repositoryFixture(1)],focus={type:'all'} as const,callback=vi.fn();
      render(<ExplorationMap scene={projectScene(accountFixture(repositories),repositories,focus)} focus={focus} repositories={repositories} onFocus={vi.fn()} onSelect={vi.fn()} onBlank={vi.fn()} onAllTopics={vi.fn()} onCameraChange={callback}/>);
      fireEvent.click(screen.getByRole('button',{name:'完整概览'}));const expected=callback.mock.calls.at(-1)![0];
      fireEvent.wheel(screen.getByLabelText('关系画布，方向键平移，Home重置'),{deltaY:-120,clientX:200,clientY:200});
      fireEvent.click(screen.getByRole('button',{name:'完整概览'}));
      await act(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      expect(callback.mock.calls.at(-1)![0]).toEqual(expected);
    }finally{rect.mockRestore();}
  });
  it('draws unselected overview categories on canvas and exposes only the hovered card',()=>{
    const original=window.ResizeObserver;
    class Observer implements ResizeObserver {
      constructor(private callback:ResizeObserverCallback){}
      observe(){this.callback([],this);}
      unobserve(){}
      disconnect(){}
    }
    window.ResizeObserver=Observer;
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:1200,height:700,x:0,y:0,left:0,top:0,right:1200,bottom:700,toJSON:()=>({})});
    try{
      const repositories=[repositoryFixture(1)],scene=projectScene(accountFixture(repositories),repositories,{type:'all'}),onFocus=vi.fn();
      const layout=layoutExploration(scene,{type:'all'},new Map([[1,'project-1']])),node=layout.nodes[1];
      const view=render(<ExplorationMap scene={scene} focus={{type:'all'}} repositories={repositories} initialCamera={{zoom:.1,x:100,y:60}} onFocus={onFocus} onSelect={vi.fn()} onBlank={vi.fn()} onAllTopics={vi.fn()}/>);
      expect(view.container.querySelectorAll('.explore-graph-node')).toHaveLength(0);
      const viewport=screen.getByLabelText('关系画布，方向键平移，Home重置');
      fireEvent(viewport,new MouseEvent('pointermove',{bubbles:true,clientX:node.x*.1+100,clientY:node.y*.1+60}));
      expect(view.container.querySelectorAll('.explore-graph-node')).toHaveLength(1);
      fireEvent.click(view.container.querySelector('.explore-graph-node')!);
      expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({type:'group'}));
    }finally{rect.mockRestore();window.ResizeObserver=original;}
  });
  it('restores each level camera and separates accounts',()=>{
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:1000,height:700,x:0,y:0,left:0,top:0,right:1000,bottom:700,toJSON:()=>({})});
    try{
      const repositories=[repositoryFixture(1)],account=accountFixture(repositories),root={type:'all'} as const,callback=vi.fn();
      const topic=account.index!.profiles['1'].topics[0],child={type:'topic' as const,id:topic.id,label:topic.label};
      const props={repositories,onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn(),onCameraChange:callback,initialCamera:{zoom:1,x:100,y:60},viewKey:'owner42:workspace:v4'};
      const view=render(<ExplorationMap {...props} focus={root} scene={projectScene(account,repositories,root)}/>);
      fireEvent.keyDown(screen.getByLabelText('关系画布，方向键平移，Home重置'),{key:'ArrowRight'});
      const parentCamera=callback.mock.calls.at(-1)![0];
      view.rerender(<ExplorationMap {...props} focus={child} scene={projectScene(account,repositories,child)}/>);
      fireEvent.keyDown(screen.getByLabelText('关系画布，方向键平移，Home重置'),{key:'ArrowDown'});
      view.rerender(<ExplorationMap {...props} focus={root} scene={projectScene(account,repositories,root)}/>);
      expect(callback.mock.calls.at(-1)![0]).toEqual(parentCamera);
      view.rerender(<ExplorationMap {...props} viewKey="owner99:workspace:v4" focus={root} scene={projectScene(account,repositories,root)}/>);
      expect(callback.mock.calls.at(-1)![0]).not.toEqual(parentCamera);
      fireEvent.doubleClick(screen.getByLabelText('关系画布，方向键平移，Home重置'));
      expect(callback.mock.calls.at(-1)![0].zoom).toBeLessThanOrEqual(1.15);
    }finally{rect.mockRestore();}
  });
  it('does not recenter a manually moved camera when floating panels change', () => {
    const repos=[repositoryFixture(1)], focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus), callback=vi.fn();
    const props={scene,focus,repositories:repos,onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn(),onCameraChange:callback,initialCamera:{zoom:.8,x:145,y:72}};
    const view=render(<ExplorationMap {...props}/>);
    fireEvent.keyDown(screen.getByLabelText('关系画布，方向键平移，Home重置'), {key:'ArrowRight'});
    const before=callback.mock.calls.at(-1)![0];
    view.rerender(<ExplorationMap {...props} insets={{left:230,right:350,top:130,bottom:60}}/>);
    expect(callback.mock.calls.at(-1)![0]).toEqual(before);
  });
  it('fits the measured canvas and satellite previews until the camera is manually moved', () => {
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:820,height:700,x:0,y:0,left:0,top:0,right:820,bottom:700,toJSON:()=>({})});
    try {
      const repos=[repositoryFixture(1)], focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus), callback=vi.fn();
      const names=new Map(repos.map(repo=>[repo.id,repo.name]));
      const layout=layoutExploration(scene,focus,names);
      const bounds=computeLayerSatellites(layout,scene,focus,names).map(item=>({...item,width:136,height:32}));
      expect(bounds.length).toBeGreaterThan(0);
      const props={scene,focus,repositories:repos,onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn(),onCameraChange:callback};
      const view=render(<ExplorationMap {...props}/>);
      const insets={left:16,right:16,top:160,bottom:58};
      view.rerender(<ExplorationMap {...props} insets={insets}/>);
      const fitted=callback.mock.calls.at(-1)![0];
      expect(fitted).toEqual(overviewCamera(layout,820,700,insets,bounds));
      for(const item of bounds) {
        expect((item.x-item.width/2)*fitted.zoom+fitted.x).toBeGreaterThanOrEqual(insets.left);
        expect((item.x+item.width/2)*fitted.zoom+fitted.x).toBeLessThanOrEqual(820-insets.right);
        expect((item.y-item.height/2)*fitted.zoom+fitted.y).toBeGreaterThanOrEqual(insets.top);
        expect((item.y+item.height/2)*fitted.zoom+fitted.y).toBeLessThanOrEqual(700-insets.bottom);
      }
      fireEvent.keyDown(screen.getByLabelText('关系画布，方向键平移，Home重置'),{key:'ArrowRight'});
      const moved=callback.mock.calls.at(-1)![0];
      view.rerender(<ExplorationMap {...props} insets={{...insets,top:200}}/>);
      expect(callback.mock.calls.at(-1)![0]).toEqual(moved);
    } finally { rect.mockRestore(); }
  });
  it('refits an untouched overview when the scene arrives after the canvas mounts', () => {
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:820,height:700,x:0,y:0,left:0,top:0,right:820,bottom:700,toJSON:()=>({})});
    try {
      const focus={type:'all'} as const, repos=[repositoryFixture(1)], empty: typeof repos=[], callback=vi.fn();
      const insets={left:16,right:16,top:160,bottom:58};
      const common={focus,insets,onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn(),onCameraChange:callback};
      const view=render(<ExplorationMap {...common} repositories={empty} scene={projectScene(accountFixture(empty),empty,focus)}/>);
      const scene=projectScene(accountFixture(repos),repos,focus), names=new Map(repos.map(repo=>[repo.id,repo.name]));
      const layout=layoutExploration(scene,focus,names);
      const bounds=computeLayerSatellites(layout,scene,focus,names).map(item=>({...item,width:136,height:32}));
      view.rerender(<ExplorationMap {...common} repositories={repos} scene={scene}/>);
      expect(callback.mock.calls.at(-1)![0]).toEqual(overviewCamera(layout,820,700,insets,bounds));
      fireEvent.keyDown(screen.getByLabelText('关系画布，方向键平移，Home重置'),{key:'ArrowRight'});
      const moved=callback.mock.calls.at(-1)![0];
      view.rerender(<ExplorationMap {...common} repositories={empty} scene={projectScene(accountFixture(empty),empty,focus)}/>);
      expect(callback.mock.calls.at(-1)![0]).toEqual(moved);
    } finally { rect.mockRestore(); }
  });
  it('keeps an automatically cached overview eligible for fitting after a StrictMode remount', () => {
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:820,height:700,x:0,y:0,left:0,top:0,right:820,bottom:700,toJSON:()=>({})});
    try {
      const focus={type:'all'} as const, repos=[repositoryFixture(1)], empty: typeof repos=[], callback=vi.fn();
      const insets={left:16,right:16,top:160,bottom:58};
      const common={focus,viewKey:'strict-overview',onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn(),onCameraChange:callback};
      const view=render(<StrictMode><ExplorationMap {...common} repositories={empty} scene={projectScene(accountFixture(empty),empty,focus)}/></StrictMode>);
      const scene=projectScene(accountFixture(repos),repos,focus), names=new Map(repos.map(repo=>[repo.id,repo.name]));
      const layout=layoutExploration(scene,focus,names);
      const bounds=computeLayerSatellites(layout,scene,focus,names).map(item=>({...item,width:136,height:32}));
      view.rerender(<StrictMode><ExplorationMap {...common} repositories={repos} scene={scene} insets={insets}/></StrictMode>);
      expect(callback.mock.calls.at(-1)![0]).toEqual(overviewCamera(layout,820,700,insets,bounds));
    } finally { rect.mockRestore(); }
  });
  it('preserves a panned camera and zoom while the reserved directory changes viewport width', () => {
    let width=1000;
    let notify: (() => void) | undefined;
    const original=window.ResizeObserver;
    class Observer implements ResizeObserver {
      constructor(private callback:ResizeObserverCallback) { notify=()=>this.callback([],this); }
      observe(){notify?.();}
      unobserve(){}
      disconnect(){}
    }
    window.ResizeObserver=Observer;
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({width,height:700,x:0,y:0,left:0,top:0,right:width,bottom:700,toJSON:()=>({})}));
    try {
      const repos=[repositoryFixture(1)], focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus), callback=vi.fn();
      render(<ExplorationMap scene={scene} focus={focus} repositories={repos} initialCamera={{zoom:.8,x:145,y:72}} onFocus={vi.fn()} onSelect={vi.fn()} onBlank={vi.fn()} onAllTopics={vi.fn()} onCameraChange={callback}/>);
      fireEvent.keyDown(screen.getByLabelText('关系画布，方向键平移，Home重置'),{key:'ArrowRight'});
      const before=callback.mock.calls.at(-1)![0];
      width=620; act(()=>notify?.());
      expect(callback.mock.calls.at(-1)![0]).toEqual({...before,x:before.x-190});
      width=1000; act(()=>notify?.());
      expect(callback.mock.calls.at(-1)![0]).toEqual(before);
    } finally { rect.mockRestore(); window.ResizeObserver=original; }
  });
  it('centers and locates a selected project satellite within the visible canvas', () => {
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:820,height:700,x:0,y:0,left:0,top:0,right:820,bottom:700,toJSON:()=>({})});
    try {
      const repos=[repositoryFixture(1)], focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus), callback=vi.fn();
      const names=new Map(repos.map(repo=>[repo.id,repo.name])), layout=layoutExploration(scene,focus,names);
      const satellite=computeLayerSatellites(layout,scene,focus,names)[0];
      expect(satellite).toBeDefined();
      const insets={left:16,right:16,top:160,bottom:58};
      const props={scene,focus,repositories:repos,insets,onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn(),onCameraChange:callback};
      const view=render(<ExplorationMap {...props}/>);
      view.rerender(<ExplorationMap {...props} selectedRepositoryId={satellite.repositoryId}/>);
      const centered=callback.mock.calls.at(-1)![0];
      expect(satellite.x*centered.zoom+centered.x).toBeCloseTo((insets.left+820-insets.right)/2);
      expect(satellite.y*centered.zoom+centered.y).toBeCloseTo((insets.top+700-insets.bottom)/2);
      expect(view.container.querySelector('.explore-satellite-node.is-selected-sat')).toBeInTheDocument();
      fireEvent.keyDown(screen.getByLabelText('关系画布，方向键平移，Home重置'),{key:'ArrowRight'});
      fireEvent.click(screen.getByRole('button',{name:'定位当前选中项'}));
      expect(callback.mock.calls.at(-1)![0]).toEqual(centered);
    } finally { rect.mockRestore(); }
  });
  it('does not apply a late resize shift after centering a newly selected satellite', () => {
    let width=1000;
    let notify: (() => void) | undefined;
    const original=window.ResizeObserver;
    class Observer implements ResizeObserver {
      constructor(private callback:ResizeObserverCallback) { notify=()=>this.callback([],this); }
      observe(){notify?.();}
      unobserve(){}
      disconnect(){}
    }
    window.ResizeObserver=Observer;
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({width,height:700,x:0,y:0,left:0,top:0,right:width,bottom:700,toJSON:()=>({})}));
    try {
      const repos=[repositoryFixture(1)], focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus), callback=vi.fn();
      const names=new Map(repos.map(repo=>[repo.id,repo.name])), layout=layoutExploration(scene,focus,names);
      const satellite=computeLayerSatellites(layout,scene,focus,names)[0], insets={left:16,right:16,top:160,bottom:58};
      const props={scene,focus,repositories:repos,insets,onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn(),onCameraChange:callback};
      const view=render(<ExplorationMap {...props}/>);
      width=620;
      view.rerender(<ExplorationMap {...props} selectedRepositoryId={satellite.repositoryId}/>);
      const centered=callback.mock.calls.at(-1)![0];
      act(()=>notify?.());
      expect(callback.mock.calls.at(-1)![0]).toEqual(centered);
      expect(satellite.x*centered.zoom+centered.x).toBeCloseTo(width/2);
    } finally { rect.mockRestore(); window.ResizeObserver=original; }
  });
  it('explains when a selected project has no node at this level', () => {
    const repos=Array.from({length:4},(_,index)=>repositoryFixture(index+1)), focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus);
    render(<ExplorationMap scene={scene} focus={focus} repositories={repos} selectedRepositoryId={4} onFocus={vi.fn()} onSelect={vi.fn()} onBlank={vi.fn()} onAllTopics={vi.fn()}/>);
    expect(screen.getByRole('button',{name:'定位当前选中项'})).toBeDisabled();
    expect(screen.getByText('当前层未显示该项目，请进入相关方向后定位。')).toBeVisible();
  });
  it('lets a satellite be selected with pointer and keyboard without invoking the blank-canvas action', async () => {
    const user=userEvent.setup();
    const repos=[repositoryFixture(1)], focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus), onSelect=vi.fn(), onBlank=vi.fn();
    render(<ExplorationMap scene={scene} focus={focus} repositories={repos} onFocus={vi.fn()} onSelect={onSelect} onBlank={onBlank} onAllTopics={vi.fn()}/>);
    const satellite=screen.getByRole('button',{name:'查看项目 project-1'});
    await user.click(satellite);
    satellite.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith(1,satellite);
    expect(onBlank).not.toHaveBeenCalled();
  });
  it.each([3,4,5,6,7,8])('keeps %i groups of satellite previews clear of each other and their parent nodes', count => {
    const repos=Array.from({length:count*3},(_,index)=>repositoryFixture(index+1)), focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus);
    const names=new Map(repos.map(repo=>[repo.id,repo.name]));
    const layout: MapLayout={nodes:[{id:'focus',type:'focus',label:'focus',x:500,y:500,width:164,height:100,color:0},
      ...Array.from({length:count},(_,index)=>{const angle=index/count*Math.PI*2-Math.PI/2;return {id:`group-${index}`,type:'topic' as const,label:'group',x:500+Math.cos(angle)*300,y:500+Math.sin(angle)*300,width:192,height:86,color:0,previewIds:[index*3+1,index*3+2,index*3+3]};})],edges:[],regions:[],width:1000,height:1000};
    const satellites=computeLayerSatellites(layout,scene,focus,names);
    expect(satellites).toHaveLength(count*(count<=4?3:2));
    for (const satellite of satellites) {
      const parent=layout.nodes.find(node=>node.id===satellite.parentId)!;
      expect(Math.abs(satellite.x-parent.x)>=(parent.width+136)/2 || Math.abs(satellite.y-parent.y)>=(parent.height+32)/2).toBe(true);
      for (const other of satellites.filter(item=>item.parentId===satellite.parentId && item.id!==satellite.id)) {
        expect(Math.abs(satellite.x-other.x)>=136 || Math.abs(satellite.y-other.y)>=32).toBe(true);
      }
    }
  });
  it('allows a positive overview below ten percent in a short canvas', () => {
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:20,x:0,y:0,left:0,top:0,right:100,bottom:20,toJSON:()=>({})});
    try {
      const repos=[repositoryFixture(1)];const focus={type:'all'} as const;const callback=vi.fn();
      render(<ExplorationMap scene={projectScene(accountFixture(repos),repos,focus)} focus={focus} repositories={repos} onFocus={vi.fn()} onSelect={vi.fn()} onBlank={vi.fn()} onAllTopics={vi.fn()} onCameraChange={callback}/>);
      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls.at(-1)![0].zoom).toBeGreaterThan(0);
    } finally {rect.mockRestore();}
  });
  it('zooms directly with the wheel while keeping the pointer world coordinate fixed',async()=>{
    const repos=[repositoryFixture(1)],focus={type:'all'} as const,callback=vi.fn();
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:1000,height:700,x:10,y:20,left:10,top:20,right:1010,bottom:720,toJSON:()=>({})});
    try{
      render(<ExplorationMap scene={projectScene(accountFixture(repos),repos,focus)} focus={focus} repositories={repos} initialCamera={{zoom:1,x:100,y:60}} onFocus={vi.fn()} onSelect={vi.fn()} onBlank={vi.fn()} onAllTopics={vi.fn()} onCameraChange={callback}/>);
      const before=callback.mock.calls.at(-1)![0];
      const viewport=screen.getByLabelText('关系画布，方向键平移，Home重置');
      fireEvent.wheel(viewport,{deltaY:-80,clientX:410,clientY:320});
      await waitFor(()=>expect(callback.mock.calls.at(-1)![0].zoom).toBeGreaterThan(before.zoom));
      const after=callback.mock.calls.at(-1)![0];
      expect((400-before.x)/before.zoom).toBeCloseTo((400-after.x)/after.zoom);
      expect((300-before.y)/before.zoom).toBeCloseTo((300-after.y)/after.zoom);
      fireEvent.wheel(viewport,{deltaY:0,clientX:410,clientY:320});
      expect(callback.mock.calls.at(-1)![0]).toEqual(after);
    }finally{rect.mockRestore();}
  });

  it('does not dim a new level because the hovered parent no longer exists',()=>{
    const repos=[repositoryFixture(1)],account=accountFixture(repos),root={type:'all'} as const;
    const common={repositories:repos,onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn()};
    const view=render(<ExplorationMap {...common} focus={root} scene={projectScene(account,repos,root)}/>);
    fireEvent.mouseEnter(view.container.querySelector('.node-topic')!);
    const topic=account.index!.profiles['1'].topics[0],next={type:'topic' as const,id:topic.id,label:topic.label};
    view.rerender(<ExplorationMap {...common} focus={next} scene={projectScene(account,repos,next)}/>);
    expect(view.container.querySelectorAll('.is-dimmed')).toHaveLength(0);
  });

});
