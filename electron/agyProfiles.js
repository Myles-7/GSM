const FEATURES = ['repository-summary', 'repository-details', 'organization', 'gist-summary', 'release-summary', 'query-expansion', 'repository-rerank', 'gist-rerank', 'repository-chat', 'workbench', 'discovery', 'plugin', 'other'];
const validModel = value => typeof value === 'string' && (value === '' || /^\w[\w.-]{0,119}$/.test(value));
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
function validOverrides(overrides) {
  return overrides && typeof overrides === 'object' && !Array.isArray(overrides) && Object.entries(overrides).every(([feature, value]) =>
    FEATURES.includes(feature) && value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, field]) =>
      key === 'model' ? validModel(field) : key === 'effort' ? ['low', 'medium', 'high', 'max'].includes(field) :
        key === 'concurrency' ? integer(field, 1, 5) : key === 'timeoutSeconds' ? integer(field, 20, 600) : false));
}
function resolveProfile(prefs, feature) {
  return { model: prefs.model, effort: prefs.effort, timeoutSeconds: prefs.timeoutSeconds,
    concurrency: prefs.concurrency || 5, ...prefs.featureOverrides?.[feature] };
}
module.exports = { FEATURES, validOverrides, resolveProfile };
