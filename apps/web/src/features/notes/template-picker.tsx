import { useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { LayoutTemplate } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Spinner } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { activeEditor } from '@/lib/active-editor';
import { useSetting } from '../settings/use-settings';
import { activeTabElement } from '../workspace/store';
import { useTopics } from '../topics/use-topics';
import { fillTemplate, templateBlocks } from './templates';

let open = false;
/** The editor the template goes into, chosen when the list opens. */
let target: ReturnType<typeof activeEditor.get> = null;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};

/** Opens the template list; the chosen template is inserted at the cursor of the active note. */
export function openTemplatePicker(): void {
  target = activeEditor.get(activeTabElement());
  if (!target) {
    toast.info('Abra uma nota e clique no texto onde o modelo deve entrar.');
    return;
  }
  setOpen(true);
}

export function TemplatePicker() {
  const isOpen = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
  );
  const { value } = useSetting('notes');
  const { tree } = useTopics();
  const [busy, setBusy] = useState<string | null>(null);
  const topicId = value.templatesTopicId;
  const list = useQuery({
    queryKey: ['templates', topicId],
    queryFn: () => endpoints.notes.list({ topicId: topicId!, sort: 'title', role: 'note', limit: 200 }),
    enabled: isOpen && !!topicId,
  });

  const insert = async (id: string) => {
    if (!target || target.editor.isDestroyed) return setOpen(false);
    setBusy(id);
    try {
      const template = await endpoints.notes.get(id);
      const doc = fillTemplate(template.content, {
        title: target.title(),
        topic: (target.topicId && tree.byId.get(target.topicId)?.title) || '',
      });
      target.editor.chain().focus().insertContent(templateBlocks(doc)).run();
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen} title="Inserir modelo" description="O conteúdo do modelo entra no cursor; {{data}}, {{hora}}, {{titulo}} e {{assunto}} são preenchidos.">
      {!topicId ? (
        <EmptyState
          icon={<LayoutTemplate />}
          title="Nenhum assunto de modelos escolhido"
          description="Crie um assunto (por exemplo, “Modelos”), escreva notas nele e escolha-o em Configurações › Notas."
          action={
            <Link to="/settings#notas" onClick={() => setOpen(false)} className="text-sm font-medium text-accent hover:underline">
              Abrir configurações
            </Link>
          }
        />
      ) : list.isLoading ? (
        <Spinner className="mx-auto my-6" />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<LayoutTemplate />} title="Ainda não há modelos" description={`Crie notas em “${tree.byId.get(topicId)?.title ?? 'assunto de modelos'}” para usá-las como modelos.`} />
      ) : (
        <ul className="space-y-1">
          {list.data.data.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void insert(n.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-60"
              >
                <LayoutTemplate className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{n.title || 'Sem título'}</span>
                  {n.excerpt && <span className="block truncate text-xs text-muted">{n.excerpt}</span>}
                </span>
                {busy === n.id && <Spinner className="size-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
