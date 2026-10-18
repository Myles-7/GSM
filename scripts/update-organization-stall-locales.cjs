const fs = require('node:fs');
const path = require('node:path');
for (const language of fs.readdirSync('src/locales')) {
  const file = path.join('src/locales', language, 'repositories.json');
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chinese = ['zh', 'zh-TW'].includes(language);
  data.organizationUx.problems.timeout = chinese
    ? '模型请求超时，已完成结果已保留。继续时只补未完成阶段；若仍超时，可在上方高级参数调整整理请求超时或测试连接。'
    : 'The model request timed out. Completed results are retained; resume only unfinished stages. If it repeats, adjust the organization timeout in advanced settings or test the connection.';
  data.organizationUx.paused = chinese ? '整理已暂停，已完成结果已保留' : 'Organization paused; completed results retained';
  data.organizationSpeed.summaryProgress = chinese ? '资料汇总第 {{level}} 层：{{done}} / {{total}} 批已保存' : 'Inventory summary level {{level}}: {{done}} / {{total}} batches saved';
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
