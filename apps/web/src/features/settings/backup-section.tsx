import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, TriangleAlert, Upload } from 'lucide-react';
import type { ImportMode } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/feedback';
import { Checkbox } from '@/components/ui/form';
import { errorMessage } from '@/lib/api/client';
import { downloadBlob, exportBackup, importBackup, readBackup, type ParsedBackup } from '@/lib/backup';
import { cn } from '@/lib/cn';
import { todayIso } from '@/lib/format';

export function BackupSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [includeFiles, setIncludeFiles] = useState(true);
  const [busy, setBusy] = useState<{ message: string; fraction?: number | undefined } | null>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [report, setReport] = useState<string[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    try {
      const blob = await exportBackup(includeFiles, (message, fraction) => setBusy({ message, fraction }));
      downloadBlob(blob, `mynotes-backup-${todayIso()}.zip`);
      toast.success('Backup gerado');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const pick = async (file: File) => {
    setReport(null);
    setBusy({ message: 'Lendo e validando o arquivo…' });
    try {
      setParsed(await readBackup(file));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Arquivo inválido');
      setParsed(null);
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    let confirmWord: string | undefined;
    if (mode === 'replace') {
      const ok = await confirm({
        title: 'Substituir todos os dados?',
        description: 'Tudo o que não estiver no backup será apagado definitivamente, inclusive arquivos. Recomenda-se exportar um backup atual antes.',
        confirmLabel: 'Substituir',
        danger: true,
        typeToConfirm: 'SUBSTITUIR',
      });
      if (!ok) return;
      confirmWord = 'SUBSTITUIR';
    }
    try {
      const outcome = await importBackup(parsed, mode, confirmWord, (message, fraction) => setBusy({ message, fraction }));
      void qc.invalidateQueries();
      const lines = [
        `Itens processados: ${Object.entries(outcome.result.counts)
          .map(([t, n]) => `${t} ${n}`)
          .join(', ')}`,
        `Arquivos enviados: ${outcome.filesUploaded}`,
      ];
      if (outcome.filesMissing) lines.push(`${outcome.filesMissing} documento(s) ficaram sem arquivo (o backup não os continha). Envie-os pela página do documento.`);
      lines.push(...outcome.fileErrors.map((e) => `Falha: ${e}`));
      setReport(lines);
      setParsed(null);
      toast.success('Importação concluída');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const total = parsed ? Object.values(parsed.tables).reduce((n, rows) => n + rows.length, 0) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="font-medium">Exportar</h3>
        <p className="text-sm text-muted">
          Gera um arquivo ZIP com todos os assuntos, notas (com histórico), relações, leituras, planos, sessões, mapas, configurações e
          metadados dos documentos — em JSON documentado (veja docs/backup.md).
        </p>
        <Checkbox checked={includeFiles} onChange={setIncludeFiles} label="Incluir os arquivos da biblioteca (PDFs e outros)" />
        <Button variant="primary" icon={<Download className="size-4" />} disabled={!!busy} onClick={() => void doExport()}>
          Exportar backup
        </Button>
      </div>

      <div className="space-y-3 border-t border-border pt-6">
        <h3 className="font-medium">Importar</h3>
        <p className="text-sm text-muted">O arquivo é validado neste aparelho antes de qualquer alteração. A aplicação no servidor é atômica: ou tudo é importado, ou nada muda.</p>
        <Button variant="outline" icon={<Upload className="size-4" />} disabled={!!busy} onClick={() => input.current?.click()}>
          Escolher arquivo .zip
        </Button>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.[0]) void pick(e.target.files[0]);
            e.target.value = '';
          }}
        />
        {parsed && (
          <div className="space-y-4 rounded-xl border border-border p-4">
            <p className="text-sm">
              Backup de <strong>{new Date(parsed.manifest.createdAt).toLocaleString('pt-BR')}</strong> · {total} registros · {parsed.files.size} arquivo(s)
            </p>
            {parsed.problems.length > 0 && (
              <div role="alert" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
                <p className="flex items-center gap-1.5 font-medium">
                  <TriangleAlert className="size-4" aria-hidden /> Problemas encontrados
                </p>
                <ul className="mt-1 list-disc pl-5 text-text">
                  {parsed.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="mt-1 text-text">Registros inválidos serão ignorados; referências quebradas fazem a importação ser recusada sem alterar nada.</p>
              </div>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[13px] font-medium">Como tratar dados existentes</legend>
              {(
                [
                  ['merge', 'Mesclar (recomendado)', 'Adiciona o que falta e atualiza itens apenas quando a cópia do backup é mais recente. Reimportar o mesmo arquivo não duplica nada.'],
                  ['replace', 'Substituir tudo', 'O estado final fica idêntico ao backup. Itens que não estão no arquivo são apagados.'],
                ] as const
              ).map(([value, label, desc]) => (
                <label key={value} className={cn('flex cursor-pointer gap-3 rounded-lg border p-3', mode === value ? (value === 'replace' ? 'border-danger bg-danger-soft' : 'border-accent bg-accent-soft') : 'border-border')}>
                  <input type="radio" name="import-mode" checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-[var(--accent)]" />
                  <span className="text-sm">
                    <span className="font-medium">{label}</span>
                    <span className="block text-muted">{desc}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex gap-2">
              <Button variant={mode === 'replace' ? 'danger' : 'primary'} disabled={!!busy} onClick={() => void doImport()}>
                Importar
              </Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => setParsed(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        {report && (
          <div className="rounded-xl border border-success/40 bg-success-soft p-4 text-sm">
            <p className="font-medium text-success">Importação concluída</p>
            <ul className="mt-1 space-y-0.5">
              {report.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {busy && (
        <div role="status" className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
          <p>{busy.message}</p>
          {busy.fraction !== undefined && <Progress value={busy.fraction * 100} label={busy.message} />}
        </div>
      )}
    </div>
  );
}
