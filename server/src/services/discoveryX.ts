import { SyncError } from './syncV2.js';
const X_GRAPHQL_FEATURES = JSON.stringify({
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_metadata_extensions_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
});


export async function fetchXTimeline(handle:string,cursor:string,transport:(url:string)=>Promise<string>) {
 const html=await transport('https://x.com/home');
 const main=html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[A-Za-z0-9_-]+\.js/)?.[0];
 if(!main)throw new SyncError('X_PROTOCOL_CHANGED',502);
 const script=await transport(main);const ids:Record<string,string>={};
 for(const operation of ['UserByScreenName','UserTweets']){
  const id=script.match(new RegExp(`queryId:"([A-Za-z0-9_-]+)",operationName:"${operation}"`))?.[1] || script.match(new RegExp(`operationName:"${operation}"[^{}]*?queryId:"([A-Za-z0-9_-]+)"`))?.[1];
  if(!id)throw new SyncError('X_PROTOCOL_CHANGED',502);ids[operation]=id;
 }
 const parse=(body:string)=>{let value;try{value=JSON.parse(body);}catch{throw new SyncError('X_INVALID_RESPONSE',502);}if(value.errors?.length){const code=value.errors[0]?.code;throw new SyncError([32,239,89,326].includes(code)?'X_CREDENTIAL_EXPIRED':'X_UPSTREAM_FAILED',502);}return value;};
 const user=parse(await transport(`https://x.com/i/api/graphql/${ids.UserByScreenName}/UserByScreenName?variables=${encodeURIComponent(JSON.stringify({screen_name:handle,withGrokTranslatedBio:false}))}`));
 const userId=user.data?.user?.result?.rest_id;if(typeof userId!=='string'||!/^\d+$/.test(userId))throw new SyncError('X_USER_UNAVAILABLE',404);
 const variables={userId,count:20,...(cursor?{cursor}:{}),includePromotedContent:false,withQuickPromoteEligibilityTweetFields:false,withVoice:false};
 const timeline=parse(await transport(`https://x.com/i/api/graphql/${ids.UserTweets}/UserTweets?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(X_GRAPHQL_FEATURES)}`));
 const userResult=timeline.data?.user?.result;if(!userResult||userResult.__typename==='UserUnavailable')throw new SyncError('X_USER_UNAVAILABLE',404);
 const instructions=(userResult.timeline_v2??userResult.timeline)?.timeline?.instructions;
 if(!Array.isArray(instructions))throw new SyncError('X_PROTOCOL_CHANGED',502);
 const items:Array<{id:string;text:string;url:string;createdAt:string;repositories:string[]}>=[];let nextCursor:string|null=null;
 for(const instruction of instructions)for(const entry of instruction.entries??[]){
  if(String(entry.entryId).startsWith('cursor-bottom')){nextCursor=typeof entry.content?.value==='string'?entry.content.value:null;continue;}
  const result=entry.content?.itemContent?.tweet_results?.result;const tweet=result?.tweet??result;const legacy=tweet?.legacy;
  if(!/^\d+$/.test(tweet?.rest_id??'')||typeof legacy?.full_text!=='string')continue;
  const links=[legacy.full_text,...(legacy.entities?.urls??[]).map((u:{expanded_url?:string})=>u.expanded_url??'')].join(' ');
  const repositories=[...new Set([...links.matchAll(/https:\/\/github\.com\/([A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+)/g)].map(m=>m[1].replace(/[.,]+$/,'').toLowerCase()))];
  const date=Date.parse(legacy.created_at??'');items.push({id:tweet.rest_id,text:legacy.full_text,url:`https://x.com/${handle}/status/${tweet.rest_id}`,createdAt:new Date(Number.isFinite(date)?date:0).toISOString(),repositories});
 }
 return {items,nextCursor,exhausted:nextCursor===null};
}
