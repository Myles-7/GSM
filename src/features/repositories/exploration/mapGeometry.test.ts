import { describe, expect, it } from 'vitest';
import { accountFixture, repositoryFixture } from './testFixtures';
import { explorationLevel } from './graphLayout';
import { projectScene } from './model';
import { hitOverviewNode, labelPlacement, overviewCamera, zoomCamera } from './mapGeometry';

describe('complete radial overview',()=>{
  for(const count of [100,500,1000])it(`fits all ${count} children and connections without a minimum-scale crop`,()=>{
    const repositories=Array.from({length:count},(_,index)=>repositoryFixture(index+1)),account=accountFixture(repositories);
    const topic=account.index!.profiles['1'].topics[0],focus={type:'topic' as const,id:topic.id,label:topic.label};
    const level=explorationLevel(projectScene(account,repositories,focus),focus,new Map(repositories.map(repo=>[repo.id,repo.name])));
    const insets={left:16,right:370,top:150,bottom:58},camera=overviewCamera(level.layout,1200,700,insets);
    expect(level.children).toHaveLength(count);expect(level.layout.edges).toHaveLength(count);expect(level.projectCount).toBe(count);
    for(const node of level.layout.nodes){
      expect((node.x-node.width/2)*camera.zoom+camera.x).toBeGreaterThanOrEqual(insets.left);
      expect((node.x+node.width/2)*camera.zoom+camera.x).toBeLessThanOrEqual(1200-insets.right);
      expect((node.y-node.height/2)*camera.zoom+camera.y).toBeGreaterThanOrEqual(insets.top);
      expect((node.y+node.height/2)*camera.zoom+camera.y).toBeLessThanOrEqual(700-insets.bottom);
    }
    const last=level.children.at(-1)!;
    expect(hitOverviewNode(level.layout.nodes,camera,last.x*camera.zoom+camera.x,last.y*camera.zoom+camera.y)?.id).toBe(last.id);
    const zoomed=zoomCamera(camera,1.5,500,300,camera.zoom*.8);
    expect((500-camera.x)/camera.zoom).toBeCloseTo((500-zoomed.x)/zoomed.zoom);
  });
  it('avoids overlapping labels rather than hiding nodes',()=>{
    const place=labelPlacement();
    expect(place({x:0,y:0,width:80,height:20})).toBe(true);
    expect(place({x:50,y:5,width:80,height:20})).toBe(false);
    expect(place({x:90,y:0,width:80,height:20})).toBe(true);
  });
});
