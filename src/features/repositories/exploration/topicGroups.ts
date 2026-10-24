import type { ExplorationScene } from './types';

// Navigation groups only. Group membership never claims a verified relationship.
const definitions = [
  ['agents', /智能体|agent|编程助手|代码助手|codex|claude|提示词|prompt/i],
  ['engineering', /代码|编程|开发|编译|api|框架|测试|审查|软件|工程|配置|版本|git|sdk|ide/i],
  ['data', /数据|检索|搜索|知识|笔记|数据库|爬虫|采集|rag/i],
  ['creative', /图像|视频|音频|语音|设计|界面|视觉|创作|生成|媒体|图形/i],
  ['automation', /自动化|工作流|部署|运维|监控|容器|服务|浏览器|集成/i],
  ['learning', /学习|教程|指南|文档|资源|收录|研究|论文|教育/i],
] as const;
export const topicGroupId = (label: string): string => definitions.find(([,pattern])=>pattern.test(label))?.[0] ?? 'other';
export function topicGroups(scene: ExplorationScene) {
  const groups = new Map<string, {id:string; repositoryIds:Set<number>; topics:ExplorationScene['topics']}>();
  for(const topic of scene.topics) {
    const id=topicGroupId(topic.label),group=groups.get(id) ?? {id,repositoryIds:new Set<number>(),topics:[]};
    topic.repositoryIds.forEach(value=>group.repositoryIds.add(value));group.topics.push(topic);groups.set(id,group);
  }
  return [...groups.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
