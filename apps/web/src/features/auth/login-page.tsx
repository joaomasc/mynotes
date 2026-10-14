import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { ApiError, NetworkError } from '@/lib/api/client';
import { login, useAuth } from '@/lib/auth/session';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(username, password, setStep);
      setPassword('');
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      void navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'rate_limited') {
        setError('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Usuário ou senha inválidos.');
      } else if (err instanceof NetworkError) {
        setError('Não foi possível conectar ao servidor. Verifique sua conexão.');
      } else {
        setError('Não foi possível entrar agora. Tente novamente.');
      }
    } finally {
      setStep(null);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="mb-4 size-12 rounded-xl shadow-card" />
          <h1 className="text-2xl font-semibold tracking-tight">MyNotes</h1>
          <p className="mt-1 text-sm text-muted">Seu espaço de conhecimento e estudos</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-card" noValidate>
          <Field label="Usuário">
            {(p) => (
              <Input
                {...p}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                autoFocus
              />
            )}
          </Field>
          <Field label="Senha">
            {(p) => (
              <Input
                {...p}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            loading={!!step}
            disabled={!username.trim() || !password}
          >
            {step ?? 'Entrar'}
          </Button>
        </form>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-subtle">
          <LockKeyhole className="size-3.5" aria-hidden />A senha é protegida neste aparelho antes de ser enviada.
        </p>
      </div>
    </div>
  );
}
