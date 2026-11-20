import { isContentEditableHost, isSavableField } from './sensitive';

/** The field that should be saved for an event target, including open shadow trees. */
export function findEditable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null;
  let node: Element | null = target instanceof Element ? target : target.parentElement;
  while (node) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return isSavableField(node) ? node : null;
    }
    if (isContentEditableHost(node)) {
      return node instanceof HTMLElement && isSavableField(node) ? node : null;
    }
    if (node.parentElement) {
      node = node.parentElement;
      continue;
    }
    const root = node.getRootNode();
    if (root instanceof ShadowRoot) {
      node = root.host;
      continue;
    }
    break;
  }
  return null;
}
