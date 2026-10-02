const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const additionsDir = path.join(root, 'docs/personal/upgrades');
const languages = fs.readdirSync(path.join(root, 'src/locales'));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const merge = (target, source) => {
  for (const [key,value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      merge(target[key],value);
    } else target[key]=value;
  }
};
const files = new Map();
function dictionary(language, namespace) {
  const file = path.join(root,'src/locales',language,namespace+'.json');
  if (!files.has(file)) files.set(file, read(file));
  return files.get(file);
}
function copyKey(target, source, key) {
  const parts=key.split('.');
  let value=source;
  for (const part of parts) value=value?.[part];
  if (value === undefined) throw new Error(`Source locale key missing: ${key}`);
  let result=target;
  for (const part of parts.slice(0,-1)) result=result[part]??={};
  result[parts[parts.length-1]]=value;
}
for (const name of fs.readdirSync(additionsDir).filter(name=>name.endsWith('-locale-additions.json'))) {
  const delta=read(path.join(additionsDir,name));
  for (const language of languages) {
    if (delta.upstreamKeys) {
      for (const [namespace,keys] of Object.entries(delta.upstreamKeys)) {
        const upstream=JSON.parse(execFileSync('git',['show',`v0.8.5:src/locales/${language}/${namespace}.json`],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}));
        for (const key of keys) copyKey(dictionary(language,namespace),upstream,key);
      }
      for (const [namespace,value] of Object.entries(delta.additions?.[language]??delta.additions?.en??{})) merge(dictionary(language,namespace),value);
    } else if (delta.namespace) merge(dictionary(language,delta.namespace),delta[language]??delta.en);
  }
}
const identityEn = {
  title:'Repository Identity',preview:'Dry Run',resume:'Resume Migration',apply:'Apply Confirmed Mappings',
  paused:'Writes paused. Resume the original account and workspace, or restore all associated storage together.',
  warning:'Matching names do not prove identity. Confirm only after checking that the old name was not reused; ambiguous rows remain unchanged.',
  noCandidates:'No legacy identity candidates.',restore:'Restore Associated Storage',discard:'Discard Unapplied Preview',
};
const identityZh = {
  title:'仓库身份恢复',preview:'生成迁移预览',resume:'继续未完成迁移',apply:'执行已确认映射',
  paused:'写入已暂停。请在原账号与工作区继续迁移，或共同恢复所有关联存储。',
  warning:'同名不能证明身份。请确认旧名称没有被其他仓库复用后再勾选；歧义记录保持不变。',
  noCandidates:'没有待确认的历史身份记录。',restore:'恢复关联存储',discard:'放弃未执行预览',
};
const feedsZh={
  add:'添加外部订阅源',close:'关闭',name:'订阅源名称',url:'公开 HTTPS 地址',kind:'订阅源格式',checking:'正在校验订阅源…',
  remove:'删除 {{name}}',invalid:'请填写名称和公开 HTTPS 订阅源地址。',account:'请先登录再添加订阅源。',
  duplicate:'该源已存在，或已达到每账号 10 个源的上限。',
  errors:{
    'invalid-url':'订阅源必须使用不含凭据的公开 HTTPS 地址。','invalid-format':'订阅源格式或仓库链接无效。',
    'too-many-repositories':'JSON 订阅源最多包含 30 个仓库。','too-large':'订阅源超过 128000 bytes 上限。',
    unreadable:'无法读取订阅源，请检查地址与浏览器 CORS 权限。',http:'订阅源请求失败或发生重定向。',
    'no-repositories':'订阅源中未找到 GitHub 仓库链接。','no-details':'无法从 GitHub 读取源中仓库的详情。',
    timeout:'订阅源请求已超过 15 秒。',
  },
};
for (const language of languages) {
  merge(dictionary(language,'settings'),{identityMigration:language==='zh'?identityZh:identityEn});
  if (language==='zh') merge(dictionary(language,'discovery'),{externalFeeds:feedsZh});
}
for (const [file,value] of files) fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
console.log(`Merged selective locale keys into ${files.size} dictionaries.`);
