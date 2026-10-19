import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NoteSettings } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
import { endpoints } from '@/lib/api/endpoints';
import { READING_WIDTHS, usePref, useReadingWidth, type ReadingWidth } from '@/lib/prefs';
import { TopicSelect } from '../topics/topic-dialogs';
import { formatDate } from '../notes/templates';
import { useSetting, useUpdateSetting } from './use-settings';

/** Daily notes, templates (synced across devices) and how notes are shown (this device). */
export function NotesSection() {
  const { value } = useSetting('notes');
  const update = useUpdateSetting('notes');
  const [draft, setDraft] = useState<NoteSettings>(value);
  const [width, setWidth] = useReadingWidth();
  const [mode, setMode] = usePref<'edit' | 'read'>('mynotes:note-mode', 'edit');
  useEffect(() => setDraft(value), [value]);
  const templates = useQuery({
    queryKey: ['templates', draft.templatesTopicId],
    queryFn: () => endpoints.notes.list({ topicId: draft.templatesTopicId!, sort: 'title', role: 'note', limit: 200 }),
    enabled: !!draft.templatesTopicId,
  });
  const changed = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div className="space-y-8">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ ...draft, dailyFormat: draft.dailyFormat.trim() || 'YYYY-MM-DD' });
        }}
      >
        <Field label="Assunto dos modelos" hint="As notas deste assunto aparecem em “Inserir modelo”. Use {{data}}, {{hora}}, {{titulo}} e {{assunto}} no texto.">
          {(p) => <TopicSelect {...p} value={draft.templatesTopicId} onChange={(templatesTopicId) => setDraft({ ...draft, templatesTopicId })} emptyLabel="Nenhum" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assunto das notas diárias" hint="Onde “Abrir a nota diária” (Alt+Shift+D) cria a nota do dia.">
            {(p) => <TopicSelect {...p} value={draft.dailyTopicId} onChange={(dailyTopicId) => setDraft({ ...draft, dailyTopicId })} emptyLabel="Sem assunto" />}
          </Field>
          <Field label="Título da nota diária" hint={`YYYY, MM e DD viram ano, mês e dia. Hoje: ${formatDate(draft.dailyFormat || 'YYYY-MM-DD')}`}>
            {(p) => <Input {...p} value={draft.dailyFormat} maxLength={60} onChange={(e) => setDraft({ ...draft, dailyFormat: e.target.value })} />}
          </Field>
        </div>
        <Field label="Modelo da nota diária" hint={draft.templatesTopicId ? undefined : 'Escolha antes o assunto dos modelos.'}>
          {(p) => (
            <Select {...p} value={draft.dailyTemplateId ?? ''} disabled={!draft.templatesTopicId} onChange={(e) => setDraft({ ...draft, dailyTemplateId: e.target.value || null })}>
              <option value="">Nenhum (nota vazia)</option>
              {(templates.data?.data ?? []).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title || 'Sem título'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="outline" loading={update.isPending} disabled={!changed}>
          Salvar
        </Button>
      </form>

      <div className="space-y-4 border-t border-border pt-6">
        <p className="text-sm text-muted">Neste aparelho:</p>
        <Segmented<ReadingWidth>
          label="Largura do texto das notas"
          value={width}
          onChange={setWidth}
          options={(Object.keys(READING_WIDTHS) as ReadingWidth[]).map((k) => ({ value: k, label: READING_WIDTHS[k].label }))}
        />
        <Segmented
          label="Notas abrem em"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'edit', label: 'Modo de edição' },
            { value: 'read', label: 'Modo de leitura' },
          ]}
        />
        <p className="text-xs text-subtle">Ctrl+E alterna entre leitura e edição. Ctrl+clique abre um link em nova aba; Ctrl+Alt+clique abre ao lado.</p>
      </div>
    </div>
  );
}
