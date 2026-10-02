export interface InertRssHtml {
  text: string;
  links: string[];
}

/**
 * A template has an inert document: unlike a detached div or HTML DOMParser,
 * parsing images/iframes/styles here cannot initiate resource requests.
 * Return strings only; callers must never insert the parsed nodes into the UI.
 */
export function extractInertRssHtml(html: string): InertRssHtml {
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;
  for (const element of fragment.querySelectorAll('script,style,iframe,object,embed,template')) element.remove();
  const links = Array.from(fragment.querySelectorAll('a[href]'), anchor => anchor.getAttribute('href') ?? '');
  return { text: fragment.textContent ?? '', links };
}
