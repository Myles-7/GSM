import { fireEvent, render, screen } from '@testing-library/react';
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
});
