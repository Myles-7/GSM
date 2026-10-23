// Only named application contracts cross IPC. Schemas and CLI options remain local.
const string = { type: 'string' };
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const citation = object({ sourceId: string, quote: string });
const project = object({ repositoryId: { type: 'integer' }, summary: string,
  topics: array(object({ label: string, citations: array(citation, 6) }), 6),
  entities: array(object({ label: string, aliases: array(string, 12), description: string }), 20),
  relations: array(object({ targetType: { enum: ['entity', 'repository'] }, target: string,
    kind: { enum: ['direct', 'interoperable', 'similar', 'discovery'] }, branch: string, reason: string, citations: array(citation, 8) }), 30) });
const contracts = Object.freeze({
  'repository-summary-v1': object({ summary: string, tags: array(string, 5), platforms: array({ enum: ['mac', 'windows', 'linux', 'ios', 'android', 'docker', 'web', 'cli'] }, 8) }),
  'exploration-profiles-v3': object({ projects: array(project, 5) }),
  'exploration-assignments-v3': object({ assignments: array({ type: 'array', prefixItems: [{ type: 'integer' }, array({ type: 'array', items: string, minItems: 2, maxItems: 2 }, 3)], items: false, minItems: 2, maxItems: 2 }, 5) }),
  'exploration-topics-v1': object({ groups: array(object({ sourceIds: array(string, 40), targetId: string }), 40) }),
});
module.exports = { contracts };
