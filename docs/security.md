# Segurança

## Modelo de ameaças (resumo)

O MyNotes guarda conteúdo privado de uma única pessoa. Ameaças consideradas:

| Ameaça | Mitigação |
|---|---|
| Adivinhação de senha pela internet | Limite de 10 falhas por IP a cada 15 min e 20 por conta por hora (HTTP 429 com `Retry-After`); cada tentativa custa um Argon2id de 64 MiB no cliente. |
| Vazamento do banco D1 | O banco guarda `PBKDF2(Argon2id(senha))` com salts distintos: quebrar exige rodar Argon2id por tentativa. Tokens só como SHA-256. |
| Roubo de token por XSS | Token de acesso só em memória e válido por 15 min; a chave de renovação é **não extraível** (o script pode usá-la enquanto a página está aberta, mas não copiá-la). CSP restritiva, sem HTML arbitrário nas notas, links `javascript:` removidos. |
| CSRF | Não há cookies de autenticação: requisições exigem o cabeçalho `Authorization`, que outro site não consegue enviar. |
| Acesso a arquivos por URL | Bucket R2 privado; nomes aleatórios; download autenticado ou link HMAC válido por 5 min e vinculado ao modo (inline/download). |
| Enumeração de usuários | `prelogin` devolve parâmetros falsos determinísticos para usuários inexistentes; mensagens de erro genéricas e tempo de resposta equalizado. |
| Replays | Desafios de renovação são de uso único (registrados após a verificação) e expiram em 60 s; mutações aceitam `Idempotency-Key`. |
| Abuso de recursos | Corpo JSON limitado a 2 MB; cada requisição de upload a 95 MB (arquivos maiores vão em partes com token assinado que amarra conta, documento e chave no R2); paginação com limite, conteúdo de nota a 600 KB. Recomenda-se uma regra de rate limiting da Cloudflare (WAF) para a rota do Worker. |

## Senha

1. O cliente pede `POST /auth/prelogin {username}` e recebe `{alg: argon2id, salt, memoryKiB: 65536, iterations: 2, parallelism: 1}`.
2. O navegador (num *Web Worker*) calcula `chave = Argon2id(NFKC(senha), salt)` — 32 bytes.
3. Envia `verifier = base64url(chave)` em `POST /auth/login`.
4. O servidor calcula `PBKDF2-SHA256(chave, salt_servidor, 1000)` e compara em tempo constante com o valor salvo.

**Por que não Argon2id/PBKDF2 forte no Worker?** O plano gratuito limita cada requisição a 10 ms de CPU, e um hash de senha adequado custa dezenas a centenas de milissegundos. Mover o passo caro (e com uso de memória) para o dispositivo dá mais proteção do que um PBKDF2 enfraquecido no servidor. Como a entrada do PBKDF2 já tem 256 bits de entropia, poucas iterações bastam para que o valor salvo não sirva como credencial. Os parâmetros ficam salvos por usuário, então podem ser aumentados no futuro (o cliente recusa parâmetros abaixo do mínimo de segurança definido em `KDF_BOUNDS`).

Consequência: o `verifier` é equivalente à senha **para o MyNotes** (quem o intercepta entra), mas não revela a senha original, que pode ser reutilizada em outros serviços. Por isso tudo trafega somente por HTTPS.

## Sessões

```
login:   cliente gera par ECDSA P-256 (privada não extraível, guardada no IndexedDB)
         → envia a chave pública com o login → servidor cria a sessão (60 dias) + token de acesso (15 min)
renovar: POST /auth/challenge → {nonce.exp.hmac}     (sem estado, HMAC com AUTH_SECRET)
         cliente assina "mynotes-refresh:<sessão>:<desafio>" com a chave privada
         POST /auth/refresh → servidor verifica HMAC, validade, assinatura e uso único → novo token
```

- Sessões expiram após `SESSION_MAX_DAYS` (60) ou `SESSION_IDLE_DAYS` (14) sem renovação.
- Logout revoga a sessão e apaga os tokens; trocar a senha revoga todas as outras sessões; sessões podem ser revogadas individualmente em *Configurações*.
- O navegador nunca guarda senha, token de acesso ou qualquer segredo reutilizável fora do dispositivo. O que fica no IndexedDB (id da sessão e chave privada não extraível) não pode ser exportado para outro aparelho.

### Por que não cookies?

GitHub Pages (`*.github.io`) e Workers (`*.workers.dev`) são **sites diferentes**: um cookie da API seria de terceiros, bloqueado pelo Safari e cada vez mais restringido pelos demais navegadores — o login no iPhone deixaria de persistir. O modelo acima funciona igual em todos os navegadores e elimina CSRF.

Se você colocar frontend e API sob o **mesmo domínio registrado** (ex.: `notas.seudominio.com` e `api.seudominio.com`), cookies `Secure; HttpOnly; SameSite=Strict` passam a ser uma alternativa viável para o token de renovação. Essa variante não foi implementada.

## Autorização

- Middleware de autenticação com **negação por padrão**: só `health`, `prelogin`, `login`, `challenge`, `refresh`, links assinados de arquivo e a documentação são públicos. Um teste percorre todas as rotas do OpenAPI e exige 401 sem token.
- Toda consulta filtra por `user_id` (ou pelo dono do registro pai). Referências recebidas (ex.: `topicId`) são verificadas antes de gravar.

## Frontend

- **CSP** (meta tag, já que o Pages não permite cabeçalhos): `default-src 'self'`; scripts só do próprio site (+ `wasm-unsafe-eval` para o Argon2id e o pdf.js); `connect-src` restrito à API; sem `object-src`.
- O editor só produz o esquema conhecido (sem HTML bruto); links aceitos: `http(s)`, `mailto` e `mynotes:` — o servidor remove outros protocolos ao salvar.
- `Referrer-Policy: no-referrer`; links externos com `noopener`.
- Ao sair: cache de consultas, rascunhos e chave do dispositivo são apagados.

## API

- Validação de todas as entradas com Zod (mesmos schemas do frontend, em `packages/shared`).
- Respostas de erro padronizadas sem *stack traces*; erros inesperados são registrados só com método, caminho (sem query string), nome e mensagem do erro e um `requestId`.
- Cabeçalhos: `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Arquivos de texto são servidos como `text/plain` com `Content-Security-Policy: sandbox`; formatos sem pré-visualização são sempre `attachment`. O tipo é validado pela assinatura do arquivo (*magic bytes*), não só pela extensão.

## Segredos

| Segredo | Onde fica |
|---|---|
| `AUTH_SECRET` | `wrangler secret put` (produção) e `apps/api/.dev.vars` (local, ignorado pelo git) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Secrets do GitHub Actions (só para o deploy manual) |

Não há outros. `VITE_API_URL` e `BASE_PATH` são **públicos** por natureza.

## Recomendações operacionais

- Ative 2FA na Cloudflare e no GitHub.
- Restrinja o token da Cloudflare às permissões listadas em `docs/deploy.md`.
- Configure uma regra de rate limiting do WAF para `/api/v1/*` (ex.: 300 requisições/min por IP).
- Exporte backups periodicamente e guarde-os cifrados fora da Cloudflare.
