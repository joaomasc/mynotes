import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ChevronDown, History, MessageSquarePlus, RotateCcw, SendHorizontal, Sparkles, Trash, TriangleAlert, X } from 'lucide-react';
import {
  AI_MESSAGE_MAX,
  ENTITY_LABELS,
  markdownToDoc,
  uuidv7,
  type AiAction,
  type AiContext,
  type AiConversation,
  type AiMessage,
} from '@mynotes/shared';
import { Button, IconButton } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Badge, EmptyState, Spinner } from '@/components/ui/feedback';
import { Menu, type MenuEntry } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { cn } from '@/lib/cn';
import { EntityIcon } from '@/lib/entities';
import { usePref } from '@/lib/prefs';
import { qk } from '@/lib/query';
import { ActionCard } from './action-card';
import { RichText, sourcePath } from './rich-text';
import { mergeDecision, mergeTurn, refreshAfterActions, useAiConversation, useAiConversations, useAiStatus } from './use-assistant';

/** Shared by the right panel and the /assistant page: the same conversation continues in both. */
export const CONVERSATION_PREF = 'mynotes:ai-conversation';

interface Pending {
  messageId: string;
  text: string;
  context: AiContext | null;
  conversationId: string | null;
  error: unknown;
}

const usd = (v: number) => `US$ ${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;

export function AssistantChat({
  context,
  contextTitle,
  className,
}: {
  /** Item the user is looking at (sent as type + id only). */
  context: AiContext | null;
  contextTitle?: string | undefined;
  className?: string;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const status = useAiStatus();
  const [conversationId, setConversationId] = usePref<string | null>(CONVERSATION_PREF, null);
  const conversation = useAiConversation(conversationId);
  const conversations = useAiConversations();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [withContext, setWithContext] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A different page brings its own context back.
  const contextId = context ? `${context.type}:${context.id}` : '';
  useEffect(() => setWithContext(true), [contextId]);

  // A conversation deleted elsewhere (or not found) starts a new one.
  useEffect(() => {
    if (conversation.error instanceof ApiError && conversation.error.status === 404) setConversationId(null);
  }, [conversation.error, setConversationId]);

  const send = useMutation({
    mutationFn: (p: Pending) =>
      endpoints.ai.chat({ conversationId: p.conversationId, messageId: p.messageId, message: p.text, context: p.context }),
    onSuccess: (res) => {
      qc.setQueryData<AiConversation>(qk.aiConversation(res.conversation.id), (old) => mergeTurn(old, res));
      setConversationId(res.conversation.id);
      setPending(null);
      void qc.invalidateQueries({ queryKey: qk.aiConversations });
      void qc.invalidateQueries({ queryKey: qk.aiStatus });
      refreshAfterActions(qc, res.actions);
    },
    onError: (err, p) => setPending({ ...p, error: err }),
  });

  const decide = useMutation({
    mutationFn: ({ action, accept }: { action: AiAction; accept: boolean }) =>
      accept ? endpoints.ai.confirm(action.id) : endpoints.ai.reject(action.id),
    onMutate: ({ action }) => setDeciding(action.id),
    onSettled: () => setDeciding(null),
    onSuccess: (d) => {
      if (conversationId) qc.setQueryData<AiConversation>(qk.aiConversation(conversationId), (old) => mergeDecision(old, d));
      refreshAfterActions(qc, [d.action]);
      if (d.action.status === 'executed') toast.success('Feito: ' + d.action.title);
      else if (d.action.status === 'failed') toast.error(d.action.error ?? 'A ação falhou');
    },
    onError: (err) => {
      // Already decided or expired elsewhere: show its real state.
      const current = err instanceof ApiError ? (err.details as { action?: AiAction } | undefined)?.action : undefined;
      if (current && conversationId) qc.setQueryData<AiConversation>(qk.aiConversation(conversationId), (old) => mergeDecision(old, { action: current, event: null }));
      toast.error(errorMessage(err));
    },
  });

  const messages = useMemo(() => conversation.data?.messages ?? [], [conversation.data]);
  const actions = useMemo(() => new Map((conversation.data?.actions ?? []).map((a) => [a.id, a])), [conversation.data]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending]);

  const submit = (text = draft) => {
    const message = text.trim();
    if (!message || send.isPending) return;
    const p: Pending = {
      messageId: uuidv7(),
      text: message,
      context: withContext ? context : null,
      conversationId,
      error: null,
    };
    setPending(p);
    setDraft('');
    send.mutate(p);
  };

  const retry = () => {
    if (!pending) return;
    const p = { ...pending, error: null };
    setPending(p);
    send.mutate(p);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // Grows with the text, up to ~8 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const startNew = () => {
    setConversationId(null);
    setPending(null);
    inputRef.current?.focus();
  };

  const removeConversation = async () => {
    if (!conversationId) return;
    const ok = await confirm({
      title: 'Apagar esta conversa?',
      description: 'As mensagens somem. O que o assistente já criou ou alterou no MyNotes continua.',
      confirmLabel: 'Apagar conversa',
      danger: true,
    });
    if (!ok) return;
    try {
      await endpoints.ai.removeConversation(conversationId);
      qc.removeQueries({ queryKey: qk.aiConversation(conversationId) });
      void qc.invalidateQueries({ queryKey: qk.aiConversations });
      startNew();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const ready = status.data ? status.data.enabled && status.data.configured : true;
  const historyItems: MenuEntry[] = conversations.isLoading
    ? [{ label: 'Carregando…', onSelect: () => undefined, disabled: true }]
    : (conversations.data ?? []).length === 0
      ? [{ label: 'Nenhuma conversa ainda', onSelect: () => undefined, disabled: true }]
      : (conversations.data ?? []).map((c) => ({ label: c.title, onSelect: () => (setPending(null), setConversationId(c.id)) }));

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={conversation.data?.title}>
          {conversation.data?.title ?? 'Nova conversa'}
        </p>
        <Menu
          label="Conversas anteriores"
          trigger={
            <IconButton label="Conversas anteriores" size="sm" className="size-7">
              <History className="size-4" />
            </IconButton>
          }
          items={historyItems}
        />
        <IconButton label="Nova conversa" size="sm" className="size-7" onClick={startNew}>
          <MessageSquarePlus className="size-4" />
        </IconButton>
        {conversationId && (
          <IconButton label="Apagar conversa" size="sm" className="size-7" onClick={() => void removeConversation()}>
            <Trash className="size-4" />
          </IconButton>
        )}
      </div>

      <div ref={logRef} role="log" aria-live="polite" aria-label="Conversa com o assistente" className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {!ready ? (
          <EmptyState
            icon={<Sparkles />}
            title={status.data?.enabled === false ? 'Assistente desativado' : 'Assistente não configurado'}
            description={
              status.data?.enabled === false
                ? 'A IA foi desativada no servidor (AI_ENABLED=false).'
                : 'Falta a chave da OpenAI no servidor (OPENAI_API_KEY). Veja “Assistente de IA” no README.'
            }
          />
        ) : messages.length === 0 && !pending ? (
          conversation.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <Welcome onPick={(t) => submit(t)} hasContext={!!context} />
          )
        ) : (
          messages.map((m) => (
            <MessageView key={m.id} message={m} actions={actions} deciding={deciding} onDecide={(action, accept) => decide.mutate({ action, accept })} />
          ))
        )}

        {pending && (
          <>
            <UserBubble text={pending.text} />
            {pending.error ? (
              <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-2.5 text-sm">
                <p className="flex items-start gap-1.5 text-danger">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{errorMessage(pending.error)}</span>
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" icon={<RotateCcw className="size-4" />} onClick={retry} loading={send.isPending}>
                    Tentar novamente
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => (setDraft(pending.text), setPending(null))}>
                    Editar
                  </Button>
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted" role="status">
                <Spinner className="size-4" label="Aguardando o assistente" /> Consultando suas notas…
              </p>
            )}
          </>
        )}
      </div>

      <form
        className="shrink-0 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {context && withContext && (
          <p className="mb-1.5 flex items-center gap-1 text-xs text-muted">
            <EntityIcon type={context.type} className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              Contexto: {ENTITY_LABELS[context.type]}{contextTitle ? ` “${contextTitle}”` : ''}
              {context.view === 'map' ? ' (mapa mental)' : context.view === 'graph' ? ' (grafo)' : ''}
            </span>
            <button type="button" onClick={() => setWithContext(false)} className="ml-auto rounded p-0.5 hover:bg-surface-2 hover:text-text" aria-label="Não usar o item aberto como contexto">
              <X className="size-3.5" />
            </button>
          </p>
        )}
        <div className="flex items-end gap-1.5">
          <label htmlFor="ai-input" className="sr-only">
            Mensagem para o assistente
          </label>
          <textarea
            id="ai-input"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, AI_MESSAGE_MAX))}
            onKeyDown={onKey}
            rows={1}
            disabled={!ready}
            placeholder={ready ? 'Pergunte ou peça algo… (Enter envia, Shift+Enter quebra linha)' : 'Assistente indisponível'}
            className="scrollbar-thin max-h-[200px] min-h-9 flex-1 resize-none rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
          />
          <IconButton
            type="submit"
            label="Enviar"
            variant="secondary"
            disabled={!ready || !draft.trim() || send.isPending}
            className="bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-surface-2 disabled:text-muted"
          >
            {send.isPending ? <Spinner className="size-4 text-current" label="Enviando" /> : <SendHorizontal className="size-4" />}
          </IconButton>
        </div>
        <p className="mt-1 flex justify-between gap-2 text-[11px] text-subtle">
          <span className="truncate">
            {status.data
              ? `${status.data.model} · hoje ${usd(status.data.spentTodayUsd)}${status.data.dailyBudgetUsd !== null ? ` de ${usd(status.data.dailyBudgetUsd)}` : ''}`
              : ' '}
          </span>
          {draft.length > AI_MESSAGE_MAX * 0.8 && (
            <span>
              {draft.length}/{AI_MESSAGE_MAX}
            </span>
          )}
        </p>
      </form>
    </div>
  );
}

function Welcome({ onPick, hasContext }: { onPick: (text: string) => void; hasContext: boolean }) {
  const ideas = hasContext
    ? ['Resuma este item', 'Com o que isto está conectado?', 'Sugira relações para este item']
    : ['Quais notas falam sobre industrialização brasileira?', 'Onde anotei a teoria do valor de Ricardo?', 'Mostre meus assuntos e subassuntos'];
  return (
    <div className="space-y-3 py-4 text-center">
      <Sparkles className="mx-auto size-7 text-accent" aria-hidden />
      <p className="text-sm text-muted">
        Pergunte sobre suas notas, livros e assuntos, ou peça para criar e organizar. Antes de mudar várias coisas, o assistente mostra uma prévia para você confirmar.
      </p>
      <ul className="space-y-1.5">
        {ideas.map((t) => (
          <li key={t}>
            <button type="button" onClick={() => onPick(t)} className="w-full rounded-lg border border-border px-2.5 py-1.5 text-left text-sm hover:bg-surface-2">
              {t}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-soft px-3 py-2 text-sm break-words whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function MessageView({
  message,
  actions,
  deciding,
  onDecide,
}: {
  message: AiMessage;
  actions: Map<string, AiAction>;
  deciding: string | null;
  onDecide: (action: AiAction, accept: boolean) => void;
}) {
  const doc = useMemo(() => (message.role === 'assistant' ? markdownToDoc(message.content) : null), [message]);
  if (message.role === 'user') return <UserBubble text={message.content} />;
  if (message.role === 'event') {
    return <p className="rounded-md bg-surface-2 px-2 py-1 text-center text-xs text-muted">{message.content}</p>;
  }
  const reads = message.tools.filter((t) => t.kind === 'read');
  const own = message.actionIds.map((id) => actions.get(id)).filter((a): a is AiAction => !!a);
  return (
    <article aria-label="Resposta do assistente" className="space-y-2">
      <RichText doc={doc!} sources={message.sources} />
      {message.status !== 'ok' && <Badge tone="warning">{message.status === 'incomplete' ? 'Resposta incompleta' : 'Resposta interrompida'}</Badge>}
      {message.tools.length > 0 ? (
        <details className="group text-xs text-muted">
          <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-text">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
            {reads.length > 0 ? `Consultou o MyNotes (${reads.length})` : 'Não consultou suas notas'}
            {message.tools.length > reads.length && ` · ${message.tools.length - reads.length} alteração(ões)`}
          </summary>
          <ul className="mt-1 space-y-0.5 pl-5">
            {message.tools.map((t, i) => (
              <li key={i} className={cn(!t.ok && 'text-danger')}>
                {t.label}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="text-xs text-subtle">Sem consulta às suas notas: resposta com conhecimento geral.</p>
      )}
      {own.map((a) => (
        <ActionCard key={a.id} action={a} busy={deciding === a.id} onDecide={(accept) => onDecide(a, accept)} />
      ))}
      {message.sources.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Fontes</p>
          <ul className="flex flex-wrap gap-1">
            {message.sources.map((s) => (
              <li key={`${s.type}:${s.id}:${s.page ?? ''}`}>
                <Link to={sourcePath(s)} className="inline-flex max-w-56 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs hover:bg-surface-2">
                  <EntityIcon type={s.type} className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {s.title || 'Sem título'}
                    {s.page ? `, p. ${s.page}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
