// Isolated, offline synthetic acceptance data. Never imported by the product.
import { useAppStore } from '../../src/store/useAppStore';
import { AI_CLASSIFICATION_VERSION, buildAIClassification, classificationReport } from '../../src/services/classificationEngine';
import type { Repository } from '../../src/types';

export function configureClassificationAudit() {
  const cases = [
    ['coding-agent', '编程智能体：协助开发者完成代码生成、调试与软件工程任务。', 'coding agent for software engineering', ['TypeScript', 'MCP']],
    ['browser-agent', '浏览器智能体：根据指令操作网页，完成浏览器自动化。', 'browser agent for browser automation', ['Python', 'Playwright']],
    ['team-agents', '多智能体协作：规划任务并协调多个智能体执行。', 'multi-agent collaboration', ['Python', 'LangGraph']],
    ['local-model', '本地模型运行：在设备上使用大语言模型。', 'local llm inference', ['Ollama', 'Python']],
    ['model-service', '模型推理服务：管理请求并提供推理接口。', 'model serving inference server', ['vLLM', 'Docker']],
    ['notes', '个人笔记和知识管理，整理双向链接。', 'personal notes and personal knowledge base', ['Electron', 'React']],
    ['wiki', '团队知识库：让团队共享和维护知识。', 'team wiki and team knowledge base', ['Next.js', 'PostgreSQL']],
    ['reading', '阅读与收藏：保存书签与稍后阅读列表。', 'document reader with bookmarks and read later', ['Tauri', 'Rust']],
    ['api', '公共 API 目录：查找开放公共接口。', 'public api collection', ['Web']],
    ['data-lab', '数据分析与可视化仪表盘。', 'data analysis and visualization dashboard', ['Python', 'Pandas']],
    ['web-ui', '界面组件库与设计系统。', 'ui component library and design system', ['React', 'CSS']],
    ['pipeline', '数据管道和定时 ETL。', 'etl data pipeline', ['Airflow', 'Python']],
    ['secure', '安全扫描与漏洞检测。', 'vulnerability security scanner', ['Go']],
    ['game', '游戏引擎及关卡编辑器。', 'game engine and level editor', ['Rust']],
    ['unresolved', '一个尚缺少详细说明的项目。', '', []],
  ] as const;
  const repositories: Repository[] = Array.from({ length: 368 }, (_, index) => {
    const sample = cases[index % cases.length];
    return { id: index + 1, name: `${sample[0]}-${index + 1}`, full_name: `synthetic/${sample[0]}-${index + 1}`, description: sample[1], ai_summary: sample[2],
      ai_platforms: [...sample[3]], ai_tags: sample[0].includes('agent') ? ['Agent', '自动化'] : [], topics: [], language: sample[3].includes('Python' as never) ? 'Python' : 'TypeScript',
      html_url: `https://example.test/synthetic/${sample[0]}`, owner: { login: 'synthetic', avatar_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="10" fill="%23687351"/><text x="20" y="27" fill="white" text-anchor="middle" font-size="22">S</text></svg>' },
      stargazers_count: 1000 - index, forks_count: 5, forks: 5, created_at: '2026-01-01', updated_at: '2026-10-01', pushed_at: '2026-10-01', analyzed_at: '2026-10-19',
    };
  });
  useAppStore.setState({ repositories, searchResults: repositories, language: 'zh', theme: 'light', currentView: 'repositories', activeClassificationScheme: 'purpose', repositoryViewMode: 'list' });
  const generated = buildAIClassification(repositories, 'zh');
  useAppStore.getState().replaceAIClassification(generated);
  useAppStore.getState().setClassificationGeneration({ algorithmVersion: AI_CLASSIFICATION_VERSION, syncPending: false });
  const params = new URLSearchParams(location.search);
  const count = Number(params.get('classification') || 368);
  if (count === 1000) {
    const large = Array.from({ length: 1000 }, (_, i) => ({ ...repositories[i % repositories.length], id: i + 1 }));
    useAppStore.setState({ repositories: large, searchResults: large });
    const start = performance.now(); useAppStore.getState().replaceAIClassification(buildAIClassification(large, 'zh'));
    console.info('[classification-audit] 1000-project build+commit ms', Math.round(performance.now() - start));
    useAppStore.getState().setClassificationGeneration({ algorithmVersion: AI_CLASSIFICATION_VERSION });
  }
  const state = useAppStore.getState();
  console.info('[classification-audit] SYNTHETIC classification report', JSON.stringify(classificationReport(state.repositories, 'purpose', state.classificationSchemes!.purpose!)));
}
