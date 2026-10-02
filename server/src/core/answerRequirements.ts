/** Preserve literal user constraints without spending a separate model request. */
export function answerRequirements(question: string, language: string) {
  const clauses = question.split(/\r?\n|[；;]|(?<=[。！？!?])\s*/u)
    .map(text => text.replace(/^\s*(?:[-*]|\d+[.)、])\s*/, '').trim()).filter(Boolean);
  return {
    originalRequest: question,
    defaultLanguage: language,
    requirements: [...new Set(clauses)].slice(0, 32),
    precedence: 'Explicit format, language, length, exclusions and deliverables in originalRequest override ALL default presentation instructions. A follow-up changes only the requirements it explicitly revises.',
  };
}

export const USER_REQUIREMENTS_FIRST = `Before retrieving or drafting, identify the requested deliverable, language, format, required dimensions and exclusions.
Treat explicit user format/length/language instructions as higher priority than default headings, tables, introductory summaries or verbosity.
Do not add optional research requirements. Answer ordinary questions directly; ask a clarification only if the missing choice would materially change the answer.
When evidence is insufficient, name only the unresolved requested requirement. Distinguish explicit negative evidence from absence of evidence.
For comparisons, address the same requested dimensions for every source; for procedures, give only supported executable steps; for explanations, give reasons and relevant examples.`;
