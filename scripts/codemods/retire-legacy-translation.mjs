import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const labels = {
  en: ['Translate page to Chinese', 'Show original page', 'Translating page; click to restore original', 'Some text could not be translated. Retry'],
  zh: ['整页翻译为中文', '显示全页原文', '正在翻译全页，点击可恢复原文', '部分内容翻译失败，点击重试'],
  'zh-TW': ['整頁翻譯為簡體中文', '顯示全頁原文', '正在翻譯全頁，點擊可恢復原文', '部分內容翻譯失敗，點擊重試'],
  ja: ['ページを中国語に翻訳', 'ページの原文を表示', '翻訳中。クリックで原文に戻す', '一部の翻訳に失敗しました。再試行'],
  ko: ['페이지를 중국어로 번역', '페이지 원문 보기', '번역 중. 클릭하여 원문 복원', '일부 번역 실패. 다시 시도'],
  fr: ['Traduire la page en chinois', 'Afficher la page originale', 'Traduction en cours ; cliquer pour restaurer', 'Traduction partielle. Réessayer'],
  de: ['Seite ins Chinesische übersetzen', 'Originalseite anzeigen', 'Übersetzung läuft; klicken zum Wiederherstellen', 'Teilweise fehlgeschlagen. Erneut versuchen'],
  es: ['Traducir página al chino', 'Mostrar página original', 'Traduciendo; pulsa para restaurar el original', 'Traducción parcial. Reintentar'],
  ru: ['Перевести страницу на китайский', 'Показать оригинал страницы', 'Перевод; нажмите для возврата к оригиналу', 'Часть текста не переведена. Повторить'],
  'pt-BR': ['Traduzir página para chinês', 'Mostrar página original', 'Traduzindo; clique para restaurar o original', 'Tradução parcial. Tentar novamente'],
};
const readmeKeys = ['close-translation', 'translated', 'original', 'translated-2', 'bilingual', 'retry-translation', 'translate-document', 'translating', 'translate-to-chinese', 'translate-to-english'];
const settingsKeys = ['translation-engine', 'engine-used-for-readme-document-translation', 'microsoft-translate-free', 'google-translate-free', 'ai-translation-uses-the-active-ai-configuration', 'ai-translation-usually-has-higher-quality-but-is', 'auto-translate-repo-descriptions', 'when-enabled-card-repository-description', 'free-google-endpoint-no-configuration-needed-may', 'free-microsoft-edge-endpoint-no-configuration-ne'];
for (const language of readdirSync(new URL('src/locales/', root))) {
  const path = new URL(`src/locales/${language}/app.json`, root);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  delete json.bilingualMarkdownRenderer;
  for (const key of readmeKeys) delete json.readmeModal[key];
  for (const key of settingsKeys) delete json.aIConfigPanel[key];
  const [enable, original, translating, retry] = labels[language];
  json.pageTranslation = { enable, original, translating, retry };
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}
const fixturePath = new URL('src/services/__fixtures__/ai-prompts.snapshot.json', root);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
for (const prompts of Object.values(fixture.aiService)) delete prompts.translateTexts;
writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Updated translation locales and prompt fixtures in ${fileURLToPath(root)}`);
