import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { internalHref, isAllowedHref, type InternalLinkType, type SearchResult } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { EntityPicker } from '../../shared/entity-picker';

function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(v)) return `mailto:${v}`;
  return `https://${v}`;
}

export function ExternalLinkDialog({ editor, open, onOpenChange }: { editor: Editor; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [url, setUrl] = useState('');
  const current = editor.getAttributes('link').href as string | undefined;
  useEffect(() => {
    if (open) setUrl(current && !current.startsWith('mynotes:') ? current : '');
  }, [open, current]);
  const value = normalizeUrl(url);
  const valid = value === '' || isAllowedHref(value);

  const apply = () => {
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!value) chain.unsetLink().run();
    else if (editor.state.selection.empty && !current) {
      editor.chain().focus().insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href: value } }] }).run();
    } else chain.setLink({ href: value }).run();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={current ? 'Editar link' : 'Inserir link'}
      size="sm"
      footer={
        <>
          {current && (
            <Button
              variant="ghost"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                onOpenChange(false);
              }}
            >
              Remover link
            </Button>
          )}
          <Button variant="primary" disabled={!valid} onClick={apply}>
            Aplicar
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) apply();
        }}
      >
        <Field label="Endereço" error={valid ? undefined : 'Use um endereço http(s) ou e-mail.'}>
          {(p) => <Input {...p} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoFocus inputMode="url" />}
        </Field>
      </form>
    </Dialog>
  );
}

export function InternalLinkDialog({
  editor,
  open,
  onOpenChange,
  currentNoteId,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentNoteId: string;
}) {
  const pick = (item: SearchResult) => {
    const href = internalHref(item.type as InternalLinkType, item.id);
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: 'text', text: item.title, marks: [{ type: 'link', attrs: { href } }] },
          { type: 'text', text: ' ' },
        ])
        .run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Link interno" description="Conecte esta nota a outro item do MyNotes.">
      <EntityPicker
        types={['note', 'topic', 'document', 'reading', 'concept']}
        onPick={pick}
        exclude={(i) => i.type === 'note' && i.id === currentNoteId}
      />
    </Dialog>
  );
}
