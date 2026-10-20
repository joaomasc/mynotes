import { AI_CONTEXT_TYPES, isUuid, type AiContext, type AiContextType } from '@mynotes/shared';
import { pathTarget } from '../workspace/tab-info';

/**
 * What the assistant should know about the page being viewed: only the item's
 * type and id (the API reads it, after checking ownership). Lists, settings
 * and other pages without an item give no context.
 */
export function aiContextFromPath(path: string): AiContext | null {
  const [pathname = '/', search = ''] = path.split('?', 2);
  if (pathname === '/graph') {
    const [type, id] = (new URLSearchParams(search).get('focus') ?? '').split(':');
    return type && isAiType(type) && isUuid(id) ? { type, id, view: 'graph' } : null;
  }
  if (pathname === '/assistant') {
    const [type, id] = (new URLSearchParams(search).get('about') ?? '').split(':');
    return type && isAiType(type) && isUuid(id) ? { type, id, view: null } : null;
  }
  const target = pathTarget(path);
  const entity = target.entity;
  if (!entity || !isAiType(entity.type)) return null;
  return { type: entity.type, id: entity.id, view: target.fixed === 'map' ? 'map' : null };
}

function isAiType(type: string): type is AiContextType {
  return (AI_CONTEXT_TYPES as readonly string[]).includes(type);
}

export const contextKey = (c: AiContext | null) => (c ? `${c.type}:${c.id}:${c.view ?? ''}` : 'none');
