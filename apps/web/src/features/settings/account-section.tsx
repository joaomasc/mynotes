import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Laptop, LogOut, Smartphone } from 'lucide-react';
import { DEFAULT_KDF, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@mynotes/shared';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Badge, Spinner } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { ApiError, api, errorMessage } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { deriveVerifier, newKdfSalt } from '@/lib/auth/crypto';
import { currentUser, prelogin } from '@/lib/auth/session';
import { relativeTime } from '@/lib/format';
import { qk } from '@/lib/query';

export function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const mismatch = repeat.length > 0 && next !== repeat;
  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;

  const submit = async () => {
    const user = currentUser();
    if (!user) return;
    try {
      setStep('Verificando…');
      const kdf = await prelogin(user.username);
      const currentVerifier = await deriveVerifier(current, kdf);
      setStep('Protegendo a nova senha…');
      const newKdf = { ...DEFAULT_KDF, salt: newKdfSalt() };
      const newVerifier = await deriveVerifier(next, newKdf);
      await api.post('/auth/password', { currentVerifier, newVerifier, newKdf });
      setCurrent('');
      setNext('');
      setRepeat('');
      toast.success('Senha alterada', { description: 'As outras sessões foram encerradas.' });
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === 'forbidden' ? 'Senha atual incorreta.' : errorMessage(err));
    } finally {
      setStep(null);
    }
  };

  return (
    <form
      className="max-w-sm space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch && !tooShort && current && next) void submit();
      }}
    >
      <input type="text" autoComplete="username" value={currentUser()?.username ?? ''} readOnly hidden />
      <Field label="Senha atual">{(p) => <Input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
      <Field label="Nova senha" hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres. Uma frase longa é mais fácil de lembrar e mais segura.`} error={tooShort ? `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` : undefined}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" maxLength={PASSWORD_MAX_LENGTH} value={next} onChange={(e) => setNext(e.target.value)} />}
      </Field>
      <Field label="Repita a nova senha" error={mismatch ? 'As senhas não coincidem.' : undefined}>
        {(p) => <Input {...p} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" loading={!!step} disabled={!current || !next || mismatch || tooShort}>
        {step ?? 'Alterar senha'}
      </Button>
    </form>
  );
}

export function SessionsList() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: qk.sessions, queryFn: endpoints.auth.sessions });
  const revoke = useMutation({
    mutationFn: (id: string) => endpoints.auth.revokeSession(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.sessions }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const revokeOthers = useMutation({
    mutationFn: endpoints.auth.revokeOthers,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.sessions });
      toast.success(`${r.revoked} sessão(ões) encerrada(s)`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (isLoading) return <Spinner />;
  const others = (data ?? []).filter((s) => !s.current).length;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {data?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            {/iOS|Android/.test(s.deviceLabel ?? '') ? <Smartphone className="size-5 text-muted" aria-hidden /> : <Laptop className="size-5 text-muted" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {s.deviceLabel ?? 'Dispositivo'}
                {s.current && <Badge tone="accent">este aparelho</Badge>}
              </p>
              <p className="text-xs text-muted">
                Último uso {relativeTime(s.lastUsedAt)} · desde {relativeTime(s.createdAt)}
              </p>
            </div>
            {!s.current && (
              <Button
                size="sm"
                variant="ghost"
                icon={<LogOut className="size-3.5" />}
                onClick={async () => {
                  if (await confirm({ title: 'Encerrar esta sessão?', description: 'O dispositivo precisará entrar novamente.', confirmLabel: 'Encerrar', danger: true })) revoke.mutate(s.id);
                }}
              >
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others > 0 && (
        <Button variant="outline" size="sm" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
          Encerrar as outras {others} sessões
        </Button>
      )}
    </div>
  );
}
