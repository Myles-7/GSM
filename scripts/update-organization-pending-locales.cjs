const fs = require('node:fs');
const path = require('node:path');
for (const language of fs.readdirSync('src/locales')) {
  const file = path.join('src/locales', language, 'repositories.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chinese = ['zh', 'zh-TW'].includes(language);
  Object.assign(data.organizationSpeed, chinese ? {
    deferPending: '跳过待处理 {{count}} 项，继续整理',
    deferPendingHint: '停止当前未完成请求，只使用已有理解生成草案。被跳过项保持原归属，可在预览中单独补资料；不应用分类。',
    deferred: '已暂缓',
  } : {
    deferPending: 'Defer {{count}} Pending and Continue',
    deferPendingHint: 'Stop unfinished requests and build a draft from completed understanding. Deferred repositories retain their membership and can be verified separately. No classification is applied.',
    deferred: 'Deferred',
  });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
