import { useLocation } from 'react-router';
import { usePathTitle } from '../workspace/tab-info';
import { AssistantChat } from './assistant-chat';
import { aiContextFromPath } from './context';

const ENTITY_PATH: Record<string, string> = {
  note: '/notes/',
  topic: '/topics/',
  reading: '/readings/',
  document: '/library/',
  concept: '/concepts/',
  mindmap: '/maps/',
};

/**
 * The assistant as a page (phone layout, or a workspace tab). `?about=note:<id>`
 * starts it with an item as context; the right panel gives the open tab instead.
 */
export function Component() {
  const { pathname, search } = useLocation();
  const context = aiContextFromPath(`${pathname}${search}`);
  const { title } = usePathTitle(context ? `${ENTITY_PATH[context.type]}${context.id}` : '/');
  return (
    <div className="mx-auto flex h-[calc(100dvh-3.25rem-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-3xl flex-col lg:h-(--view-h)">
      <h1 className="sr-only">Assistente de IA</h1>
      <AssistantChat context={context} contextTitle={context && title !== '…' ? title : undefined} className="h-full border-x border-border bg-surface" />
    </div>
  );
}
