import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';

/** Route-level error boundary. Never shows stack traces. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // A new deploy may remove old lazy chunks: a reload fixes it.
  const staleChunk = error instanceof Error && /dynamically imported module|Importing a module script failed/i.test(error.message);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold">{notFound ? 'Página não encontrada' : 'Algo deu errado'}</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        {notFound
          ? 'O endereço não existe ou o item foi removido.'
          : staleChunk
            ? 'Uma nova versão do MyNotes foi publicada. Recarregue a página para continuar.'
            : 'Ocorreu um erro inesperado nesta tela. Seus dados salvos não foram afetados.'}
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Recarregar
        </Button>
        <Link to="/" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg">
          Ir para o início
        </Link>
      </div>
    </div>
  );
}
