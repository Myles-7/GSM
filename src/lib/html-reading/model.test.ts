import { describe, expect, it } from 'vitest';
import { defaultSettings, parseReadingReturn, readingViewId, settingsSchema, snapshotItems, snapshotViews, resolveReadingProfile, resetReadingPresentation, type ReadingSnapshot } from './model';

const position={id:'00000000-0000-4000-8000-000000000001',viewId:'repositories',repoId:1,revision:1};
const base={format:'gsm-reading-changes',accountId:'42',snapshotId:'snapshot',operations:[]};
describe('versioned HTML reading protocol',()=>{
  it('resolves field inheritance independently without changing repository order or shared settings',()=>{
    const settings=settingsSchema.parse({...defaultSettings,preset:'browse',defaultProfile:{detailModes:{cost:'omit'},perChannel:80},discoveryProfile:{detailModes:{features:'collapsed'}},channelProfiles:{trending:{detailModes:{cost:'expanded'},perChannel:130,historyCount:3}}});
    expect(resolveReadingProfile(settings,'repositories')).toMatchObject({perChannel:80,detailModes:{cost:'omit',features:'expanded',quickstart:'collapsed'}});
    expect(resolveReadingProfile(settings,'trending')).toMatchObject({perChannel:130,historyCount:3,detailModes:{cost:'expanded',features:'collapsed'}});
    expect(resolveReadingProfile(settings,'topic').detailModes.cost).toBe('omit');
    expect(settings.repositorySort).toBe(defaultSettings.repositorySort);
  });
  it('resets appearance overrides while preserving independently configured quantities',()=>{
    const settings=settingsSchema.parse({...defaultSettings,defaultProfile:{perChannel:80,cardFields:['summary']},channelProfiles:{trending:{perChannel:150,historyCount:3,detailModes:{features:'omit'}}}});
    const next=resetReadingPresentation(settings,'browse');expect(next.defaultProfile).toEqual({perChannel:80});expect(next.channelProfiles.trending).toEqual({perChannel:150,historyCount:3});expect(next.sendTime).toBe(settings.sendTime);
  });
  it.each([{cardFields:['summary','summary']},{detailModes:{secret:'expanded'}},{historyCount:0},{detailOrder:['features','features']},{perChannel:501}])('rejects invalid profile overrides %j',override=>{
    expect(()=>settingsSchema.parse({...defaultSettings,repositoryProfile:override})).toThrow();
  });
  it('continues parsing old v1 returns and accepts position-only v2 returns',()=>{
    expect(parseReadingReturn(JSON.stringify({...base,version:1}))).toMatchObject({version:1,operations:[]});
    expect(parseReadingReturn(JSON.stringify({...base,version:2,positions:[position],activeView:null}))).toMatchObject({version:2,operations:[],positions:[position]});
  });
  it.each([
    {...base,version:1,positions:[position]},
    {...base,version:2,positions:[{...position,revision:0}],activeView:null},
    {...base,version:2,positions:[{...position,repoId:-1}],activeView:null},
    {...base,version:2,positions:[position],activeView:null,secret:'excluded'},
    {...base,version:2,positions:[],activeView:{id:position.id,viewId:'',revision:1}},
  ])('rejects invalid or unknown return fields',input=>{expect(()=>parseReadingReturn(JSON.stringify(input))).toThrow();});
  it('defaults only newly introduced settings while preserving old choices',()=>{
    const old={...defaultSettings,summaryLines:undefined,fontSize:'20',theme:'dark'};expect(settingsSchema.parse(old)).toMatchObject({summaryLines:6,fontSize:'20',theme:'dark'});
  });
  it('gives each edition a stable independent view and reads normalized items without duplicates',()=>{
    const item={id:1};const s={sections:[{id:'custom:tools',items:[],editions:[{id:'date/one',entries:[{repoId:1},{repoId:2}]}]}],items:{'1':item}} as unknown as ReadingSnapshot;
    expect(snapshotViews(s)).toEqual({[readingViewId('custom:tools','date/one')]:[1,2]});expect(snapshotItems(s)).toEqual([item]);
  });
});
