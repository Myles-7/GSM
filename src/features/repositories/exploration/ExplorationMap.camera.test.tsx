import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExplorationMap } from './ExplorationMap';
import { projectScene } from './model';
import { accountFixture, repositoryFixture } from './testFixtures';
describe('map camera persistence boundaries', () => {
  it('does not recenter a manually moved camera when floating panels change', () => {
    const repos=[repositoryFixture(1)], focus={type:'all'} as const, scene=projectScene(accountFixture(repos),repos,focus), callback=vi.fn();
    const props={scene,focus,repositories:repos,onFocus:vi.fn(),onSelect:vi.fn(),onBlank:vi.fn(),onAllTopics:vi.fn(),onCameraChange:callback,initialCamera:{zoom:.8,x:145,y:72}};
    const view=render(<ExplorationMap {...props}/>);
    fireEvent.keyDown(screen.getByLabelText('关系画布，方向键平移，Home重置'), {key:'ArrowRight'});
    const before=callback.mock.calls.at(-1)![0];
    view.rerender(<ExplorationMap {...props} insets={{left:230,right:350,top:130,bottom:60}}/>);
    expect(callback.mock.calls.at(-1)![0]).toEqual(before);
  });
  it('keeps auto-fit zoom within the persisted camera range in a short canvas', () => {
    const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:20,x:0,y:0,left:0,top:0,right:100,bottom:20,toJSON:()=>({})});
    try {
      const repos=[repositoryFixture(1)];const focus={type:'all'} as const;const callback=vi.fn();
      render(<ExplorationMap scene={projectScene(accountFixture(repos),repos,focus)} focus={focus} repositories={repos} onFocus={vi.fn()} onSelect={vi.fn()} onBlank={vi.fn()} onAllTopics={vi.fn()} onCameraChange={callback}/>);
      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls.at(-1)![0].zoom).toBeGreaterThanOrEqual(.1);
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
