import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Monitor, Moon, Sun, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Segmented } from '@/components/ui/form';
import { Card, Page, PageHeader } from '@/components/ui/layout';
import { useAuth } from '@/lib/auth/session';
import { API_BASE, APP_VERSION } from '@/lib/config';
import { readThemePreference, type ThemePreference } from '@/theme-boot';
import { PasswordForm, SessionsList } from './account-section';
import { BackupSection } from './backup-section';
import { HotkeysSection } from './hotkeys-section';
import { NotesSection } from './notes-section';
import { setLocalTheme, useSetting, useUpdateSetting } from './use-settings';

function Block({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card as="section" className="p-5 sm:p-6">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function Appearance() {
  const { value } = useSetting('ui');
  const update = useUpdateSetting('ui');
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference());
  useEffect(() => setTheme(value.theme), [value.theme]);
  return (
    <Segmented
      label="Tema"
      value={theme}
      onChange={(t) => {
        setTheme(t);
        setLocalTheme(t);
        update.mutate({ ...value, theme: t });
      }}
      options={[
        { value: 'system', label: <><Monitor className="size-4" /> Sistema</> },
        { value: 'light', label: <><Sun className="size-4" /> Claro</> },
        { value: 'dark', label: <><Moon className="size-4" /> Escuro</> },
      ]}
    />
  );
}

function StudyGoal() {
  const { value } = useSetting('study_goals');
  const update = useUpdateSetting('study_goals');
  const [hours, setHours] = useState('');
  useEffect(() => setHours(value.weeklyMinutes ? String(value.weeklyMinutes / 60) : ''), [value.weeklyMinutes]);
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const h = Number.parseFloat(hours.replace(',', '.')) || 0;
        update.mutate({ weeklyMinutes: Math.round(Math.max(0, Math.min(100, h)) * 60) });
      }}
    >
      <Field label="Horas de estudo por semana" hint="Mostrada no painel inicial. Deixe vazio para não usar meta.">
        {(p) => <Input {...p} type="number" min={0} max={100} step={0.5} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} className="w-32" />}
      </Field>
      <Button type="submit" variant="outline" loading={update.isPending} className="mb-[1.375rem]">
        Salvar
      </Button>
    </form>
  );
}

export function Component() {
  const { user } = useAuth();
  const { hash } = useLocation();
  // Links like /settings#atalhos open at that section.
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
    return () => clearTimeout(t);
  }, [hash]);
  return (
    <Page width="narrow">
      <PageHeader title="Configurações" />
      <nav aria-label="Seções" className="-mx-1 mb-6 flex gap-1 overflow-x-auto text-sm">
        {[
          ['aparencia', 'Aparência'],
          ['notas', 'Notas'],
          ['atalhos', 'Atalhos'],
          ['estudos', 'Estudos'],
          ['conta', 'Conta e segurança'],
          ['backup', 'Backup'],
          ['sobre', 'Sobre'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
            {label}
          </a>
        ))}
      </nav>
      <div className="space-y-6">
        <Block id="aparencia" title="Aparência" description="O tema escolhido vale para todos os seus dispositivos.">
          <Appearance />
        </Block>
        <Block id="notas" title="Notas" description="Nota diária e modelos valem para todos os seus dispositivos; largura e modo de abertura, só para este.">
          <NotesSection />
        </Block>
        <Block id="atalhos" title="Atalhos de teclado" description="Clique no teclado de um comando e pressione a nova combinação. A paleta de comandos (Ctrl+P) mostra todos.">
          <HotkeysSection />
        </Block>
        <Block
          id="estudos"
          title="Estudos"
          description="Sessões, cronômetro e tempo por assunto continuam guardados. Cada assunto mostra o seu tempo de estudo."
        >
          <StudyGoal />
          <Link to="/study" className="mt-4 inline-flex text-sm font-medium text-accent hover:underline">
            Abrir o histórico de estudos
          </Link>
        </Block>
        <Block id="conta" title="Conta e segurança" description={`Usuário: ${user?.username ?? ''}`}>
          <div className="space-y-8">
            <div>
              <h3 className="mb-3 font-medium">Alterar senha</h3>
              <PasswordForm />
            </div>
            <div>
              <h3 className="mb-1 font-medium">Sessões ativas</h3>
              <p className="mb-3 text-sm text-muted">Cada navegador conectado tem uma chave própria. Encerre sessões de aparelhos que você não usa mais.</p>
              <SessionsList />
            </div>
          </div>
        </Block>
        <Block id="backup" title="Backup e recuperação">
          <BackupSection />
        </Block>
        <Card className="flex items-center justify-between gap-3 p-5">
          <div>
            <h2 className="font-semibold">Lixeira</h2>
            <p className="text-sm text-muted">Assuntos, notas e documentos excluídos podem ser restaurados.</p>
          </div>
          <Link to="/trash" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">
            <Trash className="size-4" /> Abrir lixeira
          </Link>
        </Card>
        <Block id="sobre" title="Sobre">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Versão</dt>
              <dd>{APP_VERSION}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Servidor</dt>
              <dd className="truncate">{new URL(API_BASE).host}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Documentação da API</dt>
              <dd>
                <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Abrir
                </a>
              </dd>
            </div>
          </dl>
        </Block>
      </div>
    </Page>
  );
}
