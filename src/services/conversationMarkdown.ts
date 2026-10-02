import type { RepositoryChatMessage, ToolEvidence } from '../types/repositoryChat';

/** Keep review/provenance data with exported answers, including interrupted drafts. */
export function conversationMarkdown(messages: RepositoryChatMessage[], evidence: ToolEvidence[]): string {
  const sources = new Map(evidence.map(item => [item.id, item]));
  return messages.map(message => {
    const parts = [`## ${message.role}`, message.content];
    if (message.role === 'assistant') {
      parts.push(`Status: ${message.status}; phase: ${message.answerPhase ?? 'not-recorded'}; review: ${message.quality ?? 'not-recorded'}`);
      if (message.coverage?.length) parts.push('### Requirement Coverage\n\n' + message.coverage.map(item =>
        `- ${item.status}: ${item.requirement}\n\n  ${item.answerExcerpt}`).join('\n\n'));
      if (message.missing?.length) parts.push('### Missing\n\n' + message.missing.map(item => `- ${item}`).join('\n'));
      if (message.claims?.length) parts.push('### Claims\n\n' + message.claims.map(item =>
        `- ${item.text}\n\n  Evidence: ${item.evidenceId}\n\n  ${item.quote}`).join('\n\n'));
      if (message.comparison?.length) parts.push('### Comparison\n\n' + message.comparison.map(item =>
        `- ${item.repository}: ${item.requirement}: ${item.status}${item.quote ? `\n\n  ${item.quote}` : ''}`).join('\n\n'));
      if (message.researchSources?.length) parts.push('### Research Progress\n\n' + message.researchSources.map(item =>
        `- ${item.repository}: ${item.status} (${item.version ?? 'unversioned'})`).join('\n'));
      const cited = message.evidenceIds.flatMap(id => sources.has(id) ? [sources.get(id)!] : []);
      if (cited.length) parts.push('### Sources\n\n' + cited.map(item =>
        `- ${item.id}: ${item.repoFullName}${item.path ? ` / ${item.path}` : ''}`
        + `\n  Version: ${item.refSha ?? item.contentHash ?? 'not-recorded'}; retrieved: ${item.retrievedAt}`
        + (item.source === 'local' ? '' : `\n  ${item.url}`)).join('\n\n'));
    }
    return parts.join('\n\n');
  }).join('\n\n') + '\n';
}
