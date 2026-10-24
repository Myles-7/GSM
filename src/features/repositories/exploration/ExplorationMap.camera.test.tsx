import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearExplorationWorkspace } from '../hooks/useExplorationWorkspace';
import { ExplorationMap } from './ExplorationMap';
import { projectScene } from './model';
import { accountFixture, repositoryFixture } from './testFixtures';
import { layoutExploration } from './graphLayout';
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
