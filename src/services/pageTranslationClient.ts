let clientPromise: Promise<typeof import('i18n-jsautotranslate')['default']> | undefined;

async function requestBatch(texts: string[]): Promise<string[]> {
  clientPromise ??= import('i18n-jsautotranslate').then(({ default: client }) => {
    client.selectLanguageTag.show = false;
    client.service.use('client.edge');
    client.request.api.connectTest = '';
    client.request.api.init = '';
    // Keep page text out of persistent storage and avoid the library's hash-only cache.
    // The page controller supplies a bounded, exact-text session cache instead.
    client.storage.get = () => null;
    client.storage.set = () => {};
    return client;
  }).catch((error) => {
    clientPromise = undefined;
    throw error;
  });
  const client = await clientPromise;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Translation timed out')), 20000);
    const fail = () => {
      clearTimeout(timeout);
      reject(new Error('Translation unavailable'));
    };
    try {
      client.request.translateText(
        { texts, from: 'english', to: 'chinese_simplified' },
        (result) => {
          clearTimeout(timeout);
          if (result?.result !== 1 || !Array.isArray(result.text) || result.text.length !== texts.length ||
            !result.text.every((text) => typeof text === 'string' && text.length > 0)) {
            fail();
            return;
          }
          resolve(result.text);
        },
        fail,
      );
    } catch {
      fail();
    }
  });
}

export async function translatePageTexts(texts: string[]): Promise<string[]> {
  // Preserve node boundaries while splitting long paragraphs below the API limit.
  const groups = texts.map((text) => {
    const parts: string[] = [];
    let remaining = text;
    while (remaining.length > 3000) {
      const space = remaining.lastIndexOf(' ', 3000);
      let end = space > 1500 ? space + 1 : 3000;
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
      parts.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
    if (remaining) parts.push(remaining);
    return parts;
  });
  const unique = [...new Set(groups.flat())];
  const results = new Map<string, string>();
  while (unique.length) {
    const batch: string[] = [];
    let chars = 0;
    while (unique.length && batch.length < 40 && chars + unique[0].length <= 6000) {
      const text = unique.shift()!;
      batch.push(text);
      chars += text.length;
    }
    const translated = await requestBatch(batch);
    batch.forEach((text, index) => {
      const leading = text.match(/^\s*/)?.[0] ?? '';
      const trailing = text.match(/\s*$/)?.[0] ?? '';
      results.set(text, leading + translated[index].trim() + trailing);
    });
  }
  return groups.map((parts) => parts.map((part) => results.get(part)!).join(''));
}
