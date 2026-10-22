export interface ClassificationLeaf {
  key: string;
  zh: string;
  en: string;
  terms: string[];
  refinements?: ClassificationLeaf[];
}
export interface ClassificationDomain extends ClassificationLeaf {
  icon: string;
  children: ClassificationLeaf[];
}
const leaf = (key: string, zh: string, en: string, terms: string[], refinements?: ClassificationLeaf[]): ClassificationLeaf => ({ key, zh, en, terms, refinements });

const agents = [
  leaf('coding', '编程智能体', 'Coding agents', ['coding agent', 'coding assistant', 'code generation', 'software engineering agent', '编程智能体', '编程助手', '编码助手', '代码生成', '代码代理']),
  leaf('browser', '浏览器操作智能体', 'Browser agents', ['browser automation', 'browser agent', 'web browsing', 'computer use', '浏览器自动化', '浏览器操作', '网页操作', '电脑操作']),
  leaf('assistant', '个人助理智能体', 'Personal assistants', ['personal assistant', 'personal agent', '个人助理', '个人助手', '个人智能体', '日程助理']),
  leaf('multi', '多智能体协作', 'Multi-agent collaboration', ['multi agent', 'multiagent', 'agent collaboration', '多智能体', '多代理协作', '智能体协作']),
  leaf('orchestration', '智能体编排框架', 'Agent orchestration', ['agent framework', 'agent orchestration', 'agent runtime', '智能体框架', '智能体编排', '代理框架', '智能体运行时']),
];
const models = [
  leaf('serving', '模型推理服务', 'Inference serving', ['inference server', 'model serving', 'inference service', '推理服务', '推理服务器', '模型服务', 'vllm', 'triton']),
  leaf('local', '本地模型运行', 'Local model runners', ['local llm', 'local model', 'on device inference', '本地大模型', '本地模型', '本地推理', 'ollama', 'llama.cpp']),
  leaf('training', '训练与微调', 'Training & fine-tuning', ['fine tuning', 'finetuning', 'training', '微调', '模型训练', 'lora', 'qlora']),
  leaf('evaluation', '模型评测', 'Model evaluation', ['model evaluation', 'llm evaluation', '模型评测', '模型评估', '评测基准', 'llm benchmark']),
  leaf('management', '模型管理与分发', 'Model management', ['model management', 'model registry', '模型管理', '模型仓库', '模型分发', '模型下载']),
];
const coding = [
  leaf('editor', '编辑器与插件', 'Editors & extensions', ['code editor', 'ide plugin', 'editor extension', 'vscode extension', '代码编辑器', '编辑器插件', 'ide 插件', 'neovim']),
  leaf('search', '代码搜索与导航', 'Code search & navigation', ['code search', 'code navigation', 'code indexing', '代码搜索', '代码检索', '代码导航', '代码索引']),
  leaf('review', '代码审查与重构', 'Review & refactoring', ['code review', 'refactoring', 'pull request review', '代码审查', '代码评审', '代码重构', '重构工具']),
  leaf('debug', '调试与诊断', 'Debugging & diagnostics', ['debugger', 'debugging', 'profiling', '调试器', '调试工具', '性能诊断', '性能分析器']),
  leaf('generation', '代码生成工具', 'Code generators', ['code generator', 'scaffolding', 'boilerplate generator', '代码生成', '脚手架', '样板生成']),
];
const notes = [
  leaf('personal', '个人笔记', 'Personal notes', ['personal notes', 'personal knowledge', '个人笔记', '个人知识管理', '双向链接', 'zettelkasten']),
  leaf('team', '团队知识库', 'Team knowledge bases', ['team wiki', 'team knowledge', '团队知识库', '企业知识库', '团队文档', '协作知识库']),
  leaf('documents', '文档管理', 'Document management', ['document management', 'document organization', '文档管理', '文件归档', '文档归档', '文档检索']),
  leaf('reading', '阅读与收藏', 'Reading & bookmarks', ['read later', 'bookmark', 'rss reader', '稍后阅读', '书签', '阅读器', '收藏管理']),
  leaf('directory', '资料与资源目录', 'Resource directories', ['awesome list', 'resource collection', 'resource directory', '资源列表', '资源合集', '资料目录', '精选列表']),
];
const domain = (key: string, zh: string, en: string, icon: string, terms: string[], children: ClassificationLeaf[]): ClassificationDomain => ({ key, zh, en, icon, terms, children });
export const purposeCatalog: ClassificationDomain[] = [
  domain('ai', 'AI 应用', 'AI applications', '🤖', ['llm', '人工智能', '大模型', '智能体', 'agent', 'rag', '机器学习'], [
    leaf('agent', '智能体与自动化', 'Agents & automation', ['agent', '智能体', 'agentic'], agents),
    leaf('model', '模型调用与运行', 'Model runners & serving', ['llm inference', 'model inference', '模型推理', '大模型调用', '模型运行', 'model serving', 'local llm', 'fine tuning', '模型训练', '模型评测'], models),
    leaf('knowledge', '知识库与问答', 'Knowledge & Q&A', ['rag', 'retrieval augmented', 'knowledge question', '知识问答', '智能问答', '检索增强', '知识库问答']),
    leaf('text', '文本与内容生成', 'Text & content generation', ['text generation', 'ai writing', '文本生成', '智能写作', '大模型翻译', '自动摘要']),
    leaf('image', '图像生成', 'Image generation', ['image generation', 'text to image', 'diffusion', '图像生成', '文生图', '图片生成']),
    leaf('media', '视频与语音生成', 'Video & speech generation', ['video generation', 'text to speech', 'voice cloning', '视频生成', '语音合成', '语音克隆']),
    leaf('chat', '对话与聊天应用', 'Chat applications', ['chatbot', 'chat assistant', 'chat interface', '聊天机器人', '对话助手', '聊天界面']),
  ]),
  domain('developer', '开发与工程', 'Development & engineering', '🛠️', ['developer', '开发工具', 'development', '编程', 'ide'], [
    leaf('code', '代码编辑与编程辅助', 'Coding & editing', ['coding', 'code editor', 'code review', '代码编辑', '编程辅助', '代码搜索', '重构', 'debugging', 'ide'], coding),
    leaf('cli', '命令行与终端', 'CLI & terminals', ['terminal', 'cli tool', 'command line', '命令行', '终端', 'shell utility']),
    leaf('build', '编译与构建', 'Compilation & builds', ['compiler', 'build tool', 'bundler', '编译器', '构建工具', '打包工具']),
    leaf('release', '发布与包管理', 'Releases & packages', ['package manager', 'release automation', 'dependency management', '包管理', '发布管理', '依赖管理']),
    leaf('test', '测试与质量', 'Testing & quality', ['unit test', 'testing framework', 'static analysis', 'lint', '测试框架', '单元测试', '静态分析', '代码质量']),
    leaf('docs', '开发文档与 API 文档', 'Developer documentation', ['api documentation', 'documentation generator', '开发文档', '文档生成', 'api 文档']),
    leaf('sdk', 'SDK 与开发库', 'SDKs & libraries', ['sdk', 'development library', '开发库', '开发套件']),
  ]),
  domain('web', 'Web 产品', 'Web products', '🌐', ['web application', '网站', 'web app'], [
    leaf('frontend', '界面与组件', 'Interfaces & components', ['ui component', 'component library', 'design system', '组件库', '界面组件', '设计系统']),
    leaf('backend', '后端服务', 'Backend services', ['backend service', 'backend framework', '后端服务', '后端框架']),
    leaf('fullstack', '全栈应用', 'Full-stack apps', ['full stack', 'fullstack', '全栈应用', '全栈框架']),
    leaf('browser', '浏览器工具', 'Browser tools', ['browser extension', 'browser tool', '浏览器扩展', '浏览器插件', '网页增强']),
    leaf('api', 'API 产品', 'API products', ['api service', 'api gateway', 'api 服务', 'api 网关']),
    leaf('site', '站点与内容发布', 'Sites & publishing', ['website builder', 'static site', 'cms', '建站', '静态网站', '内容管理系统']),
  ]),
  domain('data', '数据与分析', 'Data & analytics', '📊', ['数据分析', 'analytics', '数据处理'], [
    leaf('collection', '数据采集', 'Data collection', ['crawler', 'scraper', 'web scraping', '爬虫', '数据采集', '网页抓取']),
    leaf('processing', '清洗与格式转换', 'Cleaning & conversion', ['data cleaning', 'data conversion', '数据清洗', '格式转换', '数据转换']),
    leaf('pipeline', '数据管道', 'Data pipelines', ['etl', 'data pipeline', '数据管道', '流处理']),
    leaf('analysis', '数据分析与统计', 'Analysis & statistics', ['data analysis', 'statistics', 'analytics', '数据分析', '统计分析']),
    leaf('visualization', '可视化与仪表盘', 'Visualization & dashboards', ['visualization', 'dashboard', 'chart', '可视化', '仪表盘', '图表']),
    leaf('storage', '数据管理与存储', 'Data management', ['database management', 'data storage', '数据库管理', '数据存储']),
  ]),
  domain('knowledge', '知识与内容', 'Knowledge & content', '📚', ['note taking', 'knowledge base', '知识管理', '笔记', '文档管理', '阅读'], [
    leaf('notes', '笔记与知识管理', 'Notes & knowledge', ['notes', 'note taking', 'knowledge base', '笔记', '知识管理', '知识库'], notes),
    leaf('documents', '文档与阅读', 'Documents & reading', ['document', '文档', '阅读', 'reader', 'bookmark', 'rss'], notes),
    leaf('writing', '写作与出版', 'Writing & publishing', ['writing', 'publishing', 'blogging', '写作', '出版', '博客']),
    leaf('resources', '资料与资源目录', 'Resource directories', ['awesome list', 'resource collection', '资源合集', '资源列表', '精选列表']),
  ]),
  domain('productivity', '效率与自动化', 'Productivity & automation', '⚡', ['productivity', 'workflow automation', '效率工具', '工作流自动化'], [
    leaf('workflow', '工作流自动化', 'Workflow automation', ['workflow automation', 'workflow engine', '工作流自动化', '流程自动化', '工作流引擎']),
    leaf('batch', '批处理工具', 'Batch processing', ['batch processing', 'bulk processing', '批处理', '批量处理']),
    leaf('personal', '个人效率', 'Personal productivity', ['launcher', 'clipboard', 'productivity', '启动器', '剪贴板', '个人效率']),
    leaf('tasks', '任务与日程', 'Tasks & calendars', ['todo', 'task management', 'calendar', '待办', '任务管理', '日程管理']),
  ]),
  domain('media', '设计与媒体', 'Design & media', '🎨', ['image processing', 'media', 'design tool', '媒体', '设计工具'], [
    leaf('image', '图像编辑与处理', 'Image editing', ['image processing', 'image editor', '图像处理', '图片编辑', '照片编辑']),
    leaf('audio', '音频与音乐', 'Audio & music', ['audio processing', 'music player', '音频处理', '音乐播放器', '音频编辑']),
    leaf('video', '视频与动画', 'Video & animation', ['video editing', 'video player', 'animation', '视频编辑', '视频播放器', '动画制作']),
    leaf('design', 'UI/UX 与原型', 'UI/UX & prototypes', ['ui design', 'ux design', 'prototyping', '界面设计', '原型设计']),
    leaf('graphics', '3D 与图形工具', '3D & graphics', ['3d modeling', '3d rendering', '3d 建模', '图形渲染']),
  ]),
  domain('education', '教育与研究', 'Education & research', '🔬', ['education', 'research', 'learning resource', '学习资料', '教育', '研究工具'], [
    leaf('programming', '编程学习与教程', 'Programming tutorials', ['programming tutorial', 'learn programming', '编程学习', '编程教程', '技术教程', 'coding tutorial']),
    leaf('science', '科学计算', 'Scientific computing', ['scientific computing', 'simulation', '科学计算', '数值计算', '仿真']),
    leaf('research', '论文与研究工具', 'Papers & research', ['research tool', 'paper management', '论文管理', '研究工具', '文献检索']),
    leaf('teaching', '课程与教学平台', 'Courses & teaching', ['course', 'teaching', '课程', '教学平台', '课堂']),
    leaf('roadmap', '路线图与面试学习', 'Roadmaps & interview prep', ['learning roadmap', 'interview', '学习路线', '面试', '开发者路线图']),
  ]),
  domain('infrastructure', '基础设施与运维', 'Infrastructure & operations', '☁️', ['devops', 'infrastructure', '运维', '基础设施'], [
    leaf('deployment', '部署与托管', 'Deployment & hosting', ['deployment', 'hosting', '部署管理', '自托管', '托管服务']),
    leaf('monitoring', '监控与可观测性', 'Monitoring & observability', ['monitoring', 'observability', '监控', '可观测性', '日志管理']),
    leaf('network', '网络与代理', 'Networks & proxies', ['proxy', 'vpn', 'dns', 'network tool', '代理服务', '网络工具', '内网穿透']),
    leaf('services', '服务与容器管理', 'Services & containers', ['container management', 'service management', '容器管理', '服务管理']),
  ]),
  domain('security', '安全与隐私', 'Security & privacy', '🛡️', ['security', 'privacy', '安全', '隐私'], [
    leaf('identity', '身份认证', 'Authentication', ['authentication', 'single sign on', '身份认证', '单点登录']),
    leaf('permission', '权限管理', 'Authorization', ['authorization', 'rbac', 'access control', '权限管理', '访问控制']),
    leaf('detection', '安全检测', 'Security scanning', ['vulnerability', 'security scanner', '漏洞', '安全扫描', '渗透测试']),
    leaf('privacy', '隐私与加密', 'Privacy & encryption', ['privacy', 'encryption', '隐私保护', '加密工具', '密码管理']),
  ]),
  domain('business', '商业与协作', 'Business & collaboration', '🤝', ['collaboration', 'business', '协作', '商业'], [
    leaf('team', '团队沟通与协作', 'Team collaboration', ['team collaboration', 'team chat', '团队协作', '团队沟通']),
    leaf('project', '项目管理', 'Project management', ['project management', '项目管理', '项目规划']),
    leaf('customer', '客户与运营', 'Customers & marketing', ['crm', 'customer management', 'marketing', '客户管理', '运营管理', '营销']),
    leaf('finance', '财务与商业分析', 'Finance & business analytics', ['finance', 'business intelligence', '财务', '商业分析']),
  ]),
  domain('game', '游戏与互动', 'Games & interaction', '🎮', ['game', 'gaming', '游戏'], [
    leaf('engine', '游戏引擎与编辑器', 'Game engines', ['game engine', 'level editor', '游戏引擎', '关卡编辑器']),
    leaf('tools', '模组与游戏工具', 'Mods & game tools', ['game mod', 'game tool', '游戏模组', '游戏工具']),
    leaf('project', '游戏项目', 'Games', ['game', 'gaming', '游戏']),
    leaf('interactive', '互动与模拟实验', 'Interactive experiments', ['interactive simulation', '交互实验', '互动模拟']),
  ]),
  domain('open', 'API 与开放资源', 'APIs & open resources', '🔗', ['public api', 'dataset', '公共接口', '数据集', '资源目录'], [
    leaf('api', '公共 API 目录', 'Public API catalogs', ['public api', 'api collection', '公共 api', '公共接口', 'api 目录']),
    leaf('dataset', '数据集与语料', 'Datasets & corpora', ['dataset', 'corpus', '数据集', '语料库']),
    leaf('mcp', 'MCP 与插件目录', 'MCP & plugin catalogs', ['mcp directory', 'mcp catalog', 'plugin directory', 'mcp 目录', 'mcp 资源', '插件目录']),
    leaf('directory', '开放资源目录', 'Open directories', ['open directory', 'resource directory', '开放目录', '资源目录']),
  ]),
];

export const technologyCatalog: ClassificationDomain[] = [
  domain('ai', 'LLM 与 Agent', 'LLMs & agents', '🤖', ['llm', 'agent', '智能体', '大模型'], [
    leaf('agent', 'Agent 与编排', 'Agents & orchestration', ['agent', 'agentic', '智能体', 'langgraph', 'autogen', 'crewai'], agents),
    leaf('prompt', 'Prompt 与工作流', 'Prompts & workflows', ['prompt engineering', 'prompt template', '提示词', 'llm workflow', '大模型工作流']),
    leaf('application', 'LLM 应用框架', 'LLM application frameworks', ['langchain', 'llm application', '大模型应用框架', 'semantic kernel']),
  ]),
  domain('ml', '机器学习', 'Machine learning', '🧠', ['machine learning', 'deep learning', '机器学习', '深度学习'], [
    leaf('model', '模型训练与推理', 'Model training & inference', ['pytorch', 'tensorflow', 'model inference', '模型推理', 'fine tuning', '模型训练', 'onnx'], models),
    leaf('vision', '计算机视觉', 'Computer vision', ['computer vision', 'opencv', '计算机视觉', '目标检测']),
    leaf('diffusion', '扩散与生成模型', 'Diffusion models', ['diffusion', 'stable diffusion', '扩散模型', 'diffusers']),
  ]),
  domain('retrieval', '检索与向量', 'Retrieval & vectors', '🔎', ['retrieval', 'rag', 'embedding', '检索增强', '向量'], [
    leaf('rag', 'RAG 与检索增强', 'RAG', ['rag', 'retrieval augmented', '检索增强']),
    leaf('embedding', 'Embedding 与索引', 'Embeddings & indexes', ['embedding', '嵌入模型', '向量索引', 'sentence transformers']),
    leaf('vector', '向量数据库', 'Vector databases', ['vector database', '向量数据库', 'qdrant', 'milvus', 'chroma', 'weaviate']),
    leaf('search', '全文搜索', 'Full-text search', ['elasticsearch', 'opensearch', 'meilisearch', 'full text search', '全文搜索']),
  ]),
  domain('web', 'Web 前端', 'Web frontend', '🌐', ['frontend', '前端', 'web interface'], [
    leaf('react', 'React 与 Next.js', 'React & Next.js', ['react', 'next.js', 'nextjs']),
    leaf('vue', 'Vue 与 Nuxt', 'Vue & Nuxt', ['vue', 'nuxt']),
    leaf('svelte', 'Svelte 与其他框架', 'Svelte & frameworks', ['svelte', 'angular', 'solidjs', 'astro']),
    leaf('ui', 'CSS 与 UI 组件', 'CSS & UI components', ['css', 'tailwind', 'ui component', '组件库']),
    leaf('browser', '浏览器扩展', 'Browser extensions', ['browser extension', 'chrome extension', 'webextension', '浏览器扩展', '浏览器插件']),
    leaf('static', 'SSR 与静态站点', 'SSR & static sites', ['ssr', 'static site', '静态站点', 'hugo', 'jekyll']),
  ]),
  domain('backend', 'Web 后端与 API', 'Web backend & APIs', '⚙️', ['backend', '后端', 'api framework'], [
    leaf('python', 'Python 服务框架', 'Python services', ['fastapi', 'django', 'flask', 'starlette']),
    leaf('node', 'Node.js 服务框架', 'Node.js services', ['express', 'nestjs', 'fastify', 'hono', 'koa']),
    leaf('go', 'Go 与系统服务', 'Go & system services', ['gin', 'echo framework', 'fiber framework', 'axum', 'actix']),
    leaf('api', 'REST 与 GraphQL', 'REST & GraphQL', ['rest api', 'graphql', 'openapi', 'grpc']),
    leaf('realtime', '实时通信', 'Realtime communication', ['websocket', 'socket.io', 'server sent events', 'sse']),
  ]),
  domain('data', '数据库与存储', 'Databases & storage', '🗄️', ['database', '数据库', 'storage', '存储'], [
    leaf('sql', '关系数据库', 'Relational databases', ['postgresql', 'postgres', 'mysql', 'sqlite', 'sql database', '关系数据库']),
    leaf('nosql', 'NoSQL 数据库', 'NoSQL databases', ['mongodb', 'nosql', 'couchdb', 'dynamodb']),
    leaf('cache', '缓存与键值存储', 'Caches & key-value stores', ['redis', 'memcached', 'key value', '键值存储']),
    leaf('files', '文件与对象存储', 'Files & object storage', ['object storage', 'minio', 's3', '对象存储', '文件存储']),
  ]),
  domain('engineering', '数据工程', 'Data engineering', '📊', ['etl', 'data pipeline', '数据工程'], [
    leaf('scraping', '爬虫与采集框架', 'Crawling frameworks', ['scrapy', 'crawler', 'scraping', '爬虫', '数据采集']),
    leaf('pipeline', 'ETL 与数据管道', 'ETL & pipelines', ['etl', 'airflow', 'dagster', '数据管道']),
    leaf('stream', '流处理与消息队列', 'Streams & queues', ['kafka', 'flink', 'rabbitmq', 'stream processing', '流处理']),
    leaf('formats', '数据格式与转换', 'Data formats', ['parquet', 'apache arrow', 'data conversion', '数据转换']),
  ]),
  domain('devtools', '开发工具链', 'Developer tooling', '🧰', ['developer tool', '开发工具', 'toolchain'], [
    leaf('cli', 'CLI 与脚本', 'CLI & scripts', ['cli', 'command line', 'shell script', '命令行', '脚本工具']),
    leaf('quality', '测试与静态检查', 'Testing & static analysis', ['pytest', 'vitest', 'jest', 'playwright', 'eslint', 'static analysis', '测试框架', '静态检查']),
    leaf('build', '编译与构建', 'Compilers & builds', ['compiler', 'cmake', 'webpack', 'vite', 'esbuild', '编译器', '构建工具']),
    leaf('editor', '编辑器与语言服务', 'Editors & language servers', ['language server', 'lsp', 'ide', '代码编辑器', '语言服务', 'vscode']),
    leaf('sdk', 'SDK 与库', 'SDKs & libraries', ['sdk', 'development library', '开发套件']),
  ]),
  domain('cloud', '云与基础设施', 'Cloud & infrastructure', '☁️', ['cloud', 'devops', '云原生', '基础设施'], [
    leaf('docker', 'Docker 与容器', 'Docker & containers', ['docker', 'podman', 'container runtime', '容器运行时']),
    leaf('kubernetes', 'Kubernetes 与编排', 'Kubernetes', ['kubernetes', 'k8s', 'helm']),
    leaf('deployment', '云部署与 IaC', 'Cloud deployment & IaC', ['terraform', 'ansible', 'pulumi', 'cloud deployment', '云部署']),
    leaf('monitoring', '监控与可观测性', 'Observability', ['prometheus', 'grafana', 'opentelemetry', 'observability', '可观测性']),
  ]),
  domain('desktop', '桌面与原生', 'Desktop & native', '🖥️', ['desktop application', 'desktop framework', '桌面应用', '原生应用'], [
    leaf('electron', 'Electron', 'Electron', ['electron']),
    leaf('tauri', 'Tauri', 'Tauri', ['tauri']),
    leaf('qt', 'Qt 与图形界面', 'Qt & GUI frameworks', ['qt', 'pyqt', 'pyside', 'gtk', 'wxwidgets', 'avalonia']),
    leaf('native', '原生系统开发', 'Native systems', ['winui', 'wpf', 'cocoa', 'appkit', 'win32', 'native system', '原生系统开发', '系统编程']),
  ]),
  domain('mobile', '移动开发', 'Mobile development', '📱', ['mobile development', '移动开发', '移动应用'], [
    leaf('android', 'Android 原生', 'Android native', ['android', 'jetpack compose']),
    leaf('ios', 'iOS 原生', 'iOS native', ['ios', 'swiftui', 'uikit']),
    leaf('flutter', 'Flutter', 'Flutter', ['flutter', 'dart']),
    leaf('react-native', 'React Native', 'React Native', ['react native', 'expo']),
  ]),
  domain('protocol', '协议与集成', 'Protocols & integration', '🔗', ['protocol', '协议', 'service integration'], [
    leaf('mcp', 'MCP 与工具调用', 'MCP & tool calling', ['mcp', 'model context protocol', '模型上下文协议']),
    leaf('identity', 'OAuth 与身份协议', 'Identity protocols', ['oauth', 'openid', 'saml', 'jwt']),
    leaf('integration', '服务集成与 Webhook', 'Integrations & webhooks', ['webhook', 'service integration', '第三方服务集成']),
    leaf('network', '网络协议', 'Network protocols', ['http proxy', 'socks', 'dns protocol', '网络协议']),
  ]),
  domain('media', '媒体与图形', 'Media & graphics', '🎨', ['media processing', 'graphics', '媒体处理'], [
    leaf('image', '图像处理', 'Image processing', ['image processing', 'pillow', 'imagemagick', '图像处理']),
    leaf('audio', '音频处理', 'Audio processing', ['audio processing', 'webaudio', '音频处理', 'portaudio']),
    leaf('video', '视频编解码', 'Video processing', ['ffmpeg', 'video codec', '视频编解码', '视频处理']),
    leaf('graphics', '3D 与渲染', '3D & rendering', ['webgl', 'three.js', 'opengl', 'vulkan', 'webgpu', '图形渲染']),
  ]),
  domain('security', '安全技术', 'Security technology', '🛡️', ['security', '安全技术'], [
    leaf('auth', '认证与授权', 'Authentication & authorization', ['authentication', 'authorization', 'rbac', '认证授权']),
    leaf('crypto', '加密与密码学', 'Cryptography', ['cryptography', 'encryption', '密码学', '加密算法']),
    leaf('vulnerability', '漏洞检测', 'Vulnerability detection', ['vulnerability scanner', '漏洞检测', '漏洞扫描']),
    leaf('sandbox', '沙箱与隔离', 'Sandboxing', ['sandbox', 'isolation', '沙箱', '进程隔离']),
  ]),
  domain('runtime', '语言与运行时', 'Languages & runtimes', '💻', [], [
    leaf('python', 'Python', 'Python', ['python']), leaf('js', 'JavaScript / TypeScript', 'JavaScript / TypeScript', ['javascript', 'typescript', 'nodejs', 'node.js']),
    leaf('rust', 'Rust', 'Rust', ['rust']), leaf('go', 'Go', 'Go', ['golang', 'go']), leaf('jvm', 'JVM', 'JVM', ['java', 'kotlin', 'jvm']),
    leaf('dotnet', '.NET', '.NET', ['.net', 'dotnet', 'c#']), leaf('native', 'C / C++', 'C / C++', ['c', 'c++']),
  ]),
];

export function validateClassificationCatalog(catalog: ClassificationDomain[]): void {
  const keys = new Set<string>();
  for (const parent of catalog) {
    if (keys.has(parent.key)) throw new Error(`Duplicate domain: ${parent.key}`);
    keys.add(parent.key);
    const ids = new Set<string>();
    for (const child of parent.children) {
      for (const key of [child.key, ...(child.refinements ?? []).map(item => `${child.key}-${item.key}`)]) {
        if (ids.has(key)) throw new Error(`Duplicate leaf: ${parent.key}/${key}`);
        ids.add(key);
      }
    }
  }
}
validateClassificationCatalog(purposeCatalog);
validateClassificationCatalog(technologyCatalog);
