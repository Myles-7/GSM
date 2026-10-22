import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExplorationMap } from './ExplorationMap';
import { projectScene } from './model';
import { accountFixture, repositoryFixture } from './testFixtures';
describe('map camera persistence boundaries', () => {
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
