declare module 'i18n-jsautotranslate' {
  const translate: {
    service: { use: (name: string) => void };
    selectLanguageTag: { show: boolean };
    storage: { get: (key: string) => string | null; set: (key: string, value: string) => void };
    request: {
      api: { connectTest: string; init: string };
      translateText: (
        options: { texts: string[]; from: string; to: string },
        success: (result: { result: number; text: string[] }) => void,
        failure: (error: unknown) => void,
      ) => void;
    };
  };
  export default translate;
}
