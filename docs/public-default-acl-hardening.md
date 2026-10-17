# Hardening dos default ACLs de tabelas futuras

## Escopo e causa confirmada

Base: main `970dda4752b7d5bd27999083e3eb4f45bfe390fd`. Esse main já contém o merge do PR #25. Este PR não modifica nem reaplica a migration dele; o novo diff contém apenas migration de defaults, testes, dois scripts read-only e esta documentação.

Segundo o preflight read-only de Production **confirmado pelo solicitante**, os defaults de tabelas no schema public, para os creators postgres e supabase_admin, concedem SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER e MAINTAIN a anon/authenticated/service_role. Essa é a causa confirmada de tabelas futuras voltarem a nascer com privilégios amplos, mesmo que os objetos antigos sejam corrigidos.

Nenhuma consulta SQL foi executada em Production nesta tarefa. O output bruto do preflight não foi anexado; logo, valores exatos de grant options, grantor, PUBLIC e defaults S/f não foram presumidos. O script fornecido audita todos esses campos para conferência manual. O comando histórico ou autor que instalou esses defaults não pode ser determinado só pelo estado atual do catálogo.

## r, S e f são objetos diferentes

| pg_default_acl.defaclobjtype | Abrangência | Decisão deste PR |
|---|---|---|
| r | Tabelas, incluindo views/foreign tables conforme o comando ON TABLES do PostgreSQL | Revogar defaults de acesso das três application roles e PUBLIC, apenas para futuras relações em public e os dois creators |
| S | Sequences: USAGE/SELECT/UPDATE, por exemplo quando nextval é necessário | Preservar integralmente |
| f | Funções/rotinas: EXECUTE; o padrão global nativo pode incluir PUBLIC | Preservar integralmente |

Default ACL não é ACL de objeto existente. O creator relevante é current_role no CREATE; defaults não são herdados de outros creator roles dos quais ele é membro. Portanto postgres e supabase_admin precisam de tratamento próprio.

Não há necessidade comprovada de alterar defaults de sequence/function para resolver o problema de tabelas. As tabelas centrais usam UUIDs e as RPCs críticas possuem grants explícitos no SQL do repositório. Isso não é uma auditoria de todas as dependências internas da plataforma Supabase: preservar S/f evita interferir nelas. Não se afirma que todos os defaults S/f existentes são necessários ou seguros.

As regras de acesso das funções existentes, SECURITY INVOKER e search_path permanecem intactas. Este PR não tenta endurecer futuras funções via defaults de tabelas.

## Política escolhida

| Creator | Schema | Tipo | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|---|---|
| postgres | public | r | nenhum | nenhum | nenhum | nenhum |
| supabase_admin | public | r | nenhum | nenhum | nenhum | nenhum |

Sem SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN automáticos, nem grant options, para essas application roles. O proprietário continua com seus poderes de dono.

O mínimo genérico de service_role em uma tabela ainda desconhecida é **zero**. Cada migration futura deve conceder explicitamente apenas o necessário ao seu objeto. Isso não remove permissões que service_role já possua em tabelas existentes.

A migration usa apenas ALTER DEFAULT PRIVILEGES ... IN SCHEMA public ... REVOKE, além de verificações de catálogo/transaction settings. Não há GRANT, CASCADE, alteração de tabela existente, dados, schema estrutural, índices, constraints, policies, RLS, funções ou ACLs de objetos existentes. MAINTAIN é tratado em PostgreSQL 17+, de modo explícito e separado. As duas identidades de creator são fixas e verificadas; não há varredura de schemas para mutação.

## Defaults globais e herança: não mascarar sucesso

Defaults de schema somam-se aos defaults globais. Um REVOKE IN SCHEMA public **não remove** um privilégio concedido globalmente. [Referência PostgreSQL](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

Como o escopo é somente public:
- Defaults globais de tabelas inseguros fazem a migration abortar; ela não os altera nem afeta outros schemas.
- Application role superuser, herança de creator ownership ou acesso por um grantee intermediário também causam aborto.
- O operador deve revisar esse caso antes de qualquer aplicação. Corrigir defaults globais exige decisão separada de escopo; não compensar com novos grants.
- A migration é uma transação com lock_timeout de 5s e statement_timeout de 30s. Um erro no segundo creator desfaz também o primeiro.
- Creator/application role ou schema ausente causa erro, não skip silencioso.
- O operador precisa de autoridade para ALTER DEFAULT PRIVILEGES de ambos os creators. Não criar SECURITY DEFINER nem conceder memberships para contornar falta de autoridade.

Outros creators, outros schemas e defaults globais seguros são preservados. Os testes cobrem essa fronteira.

## Arquivos

- `supabase/migrations/20261017113121_public_table_default_acl_hardening.sql`: migration incremental/idempotente, criada com Supabase CLI 2.81.3 via migration new.
- `public-default-acl-hardening.test.js`: testes em PostgreSQL local real.
- `scripts/public-default-acl-preflight.sql`: catálogo r/S/f com creator, schema, grantee, privilege_type, is_grantable e grantor; global/built-in table defaults; autoridade do operador e memberships.
- `scripts/public-default-acl-verify.sql`: oito combinações de creator/grantee; considera defaults globais + public e herança de propriedade/acesso.
- `docs/public-default-acl-hardening.md`: diagnóstico, política e aplicação.

Uma linha ausente no pg_default_acl não significa “nenhum privilégio”: podem valer defaults nativos. O script de verificação considera esse fallback. Todos os oito resultados precisam ser PASS; FAIL ou MISSING_PREREQUISITE bloqueia aplicação. O script é read-only e não cria tabela em Production.

## Testes e resultados

PostgreSQL 17.11 genuíno, em 127.0.0.1:55432; Node 24.19.0. Nenhuma instalação/dependência/lockfile do projeto foi alterada.

```powershell
$env:DEFAULT_ACL_TEST_PSQL = 'C:\path\to\psql.exe'
$env:DEFAULT_ACL_TEST_PORT = '55432'
node --test public-default-acl-hardening.test.js
```

```sh
DEFAULT_ACL_TEST_PSQL=/path/to/psql DEFAULT_ACL_TEST_PORT=55432 node --test public-default-acl-hardening.test.js
```

O harness usa postgres local, recusa host remoto, ignora variáveis PG herdadas exceto PGPASSWORD, cria banco descartável e usa fixtures sintéticas. As roles de teste podem permanecer no cluster local; não usar cluster compartilhado. Nenhuma tabela é criada ou truncada em Production.

12/12 testes passam:
1. Reproduzem os oito privilégios excessivos e grant options nos dois creators antes da migration.
2. CREATE TABLE efetivamente executado como postgres; as oito permissões ausentes para cada application role.
3. CREATE TABLE efetivamente executado como supabase_admin; mesmas garantias.
4. Ausência de PUBLIC confirmada por ACL e por uma role sem privilégios. SELECT e TRUNCATE de clientes realmente falham, mesmo sem RLS nas tabelas novas.
5. service_role recebe zero por default; um GRANT explícito futuro de SELECT/INSERT funciona sem trazer TRUNCATE.
6. ACLs, dados, schemas, colunas, RLS, policies, índices, constraints e definições/configs/ACLs das funções existentes são preservados. As funções reais do SQL atual são instaladas no fixture; a migration do #25 não é executada.
7. Defaults S/f, outro schema e outro creator são preservados; sequence futura mantém USAGE preexistente.
8. Reaplicação idempotente; CREATE TABLE depois dela continua seguro nos dois creators.
9. Scripts preflight/verify executados; relatório passa nas oito combinações após a migration.
10. Defaults globais inseguros, PUBLIC global, herança de ownership e grantee intermediário abortam sem alteração parcial.

Suíte existente sem os casos que dependem de PostgreSQL: 203/206. As mesmas três falhas reproduzem no main limpo: “a YNTELIGENCIA reutiliza visitor e sessão e aceita property_id na URL”; “o formulário reutiliza /api/lead, sessão e visitante existentes”; “telemetria de lead não leva PII e o fluxo para se a API não confirma”. Não foram corrigidas neste PR.

Não se afirma execução da suíte PostgreSQL completa. Os testes deste PR usam banco real para validar defaults e preservação dos objetos; não simulam todos os componentes gerenciados da plataforma Supabase.

## Ordem recomendada de aplicação: #26, depois #25

Ordem para uma janela controlada de Production, **após review e autorização separados**:
1. Pausar migrations/CREATE TABLE concorrentes. Registrar os SHAs aprovados e o projeto correto.
2. Administrador autorizado executa os dois preflights read-only e captura os ACLs/default ACLs originais. Confirmar escopo public e creators postgres/supabase_admin.
3. Reproduzir ACLs em staging isolado. Aplicar o arquivo deste PR (#26), reaplicar e exigir oito PASS no script de verificação. Criar tabelas sintéticas como ambos os creators **somente em staging** e conferir privilégios efetivos.
4. Na janela autorizada, aplicar somente a migration #26 e executar sua verificação read-only: fecha a origem da recorrência para novas tabelas.
5. Aplicar a migration de objetos existentes do #25 separadamente: limpa o passivo que #26 intencionalmente não toca. Executar os scripts de grants/preflight do #25 e validar o runtime.
6. Retomar criação de objetos apenas depois de ambos os resultados e smoke tests aprovados.

As migrations não dependem uma da outra. Se #25 **já foi aplicado no banco**, aplicar #26 e verificar os objetos atuais; reaplicar #25 só se a verificação indicar necessidade. Merge de #25 no GitHub não comprova aplicação ao banco.

A ordem de timestamps dos arquivos coloca #25 antes de #26. Por isso **não usar supabase db push genérico** para impor a ordem recomendada desta janela. Aplicar arquivos revisados individualmente pelo procedimento de migrations da equipe e registrar a aplicação apropriadamente, sem duplicar execução nem fingir histórico reconciliado. Este PR não executa repair/DDL em Production.

Exemplo exato para **staging isolado**, com connection string já validada pelo operador:

```sh
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f scripts/public-default-acl-preflight.sql
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f supabase/migrations/20261017113121_public_table_default_acl_hardening.sql
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f supabase/migrations/20261017113121_public_table_default_acl_hardening.sql
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f scripts/public-default-acl-verify.sql
# Somente depois, se ainda necessário e aprovado, migration #25 e seus verificadores.
```

Nada foi aplicado em Production, mergeado ou deployado por esta tarefa.

## Riscos residuais

- Tabelas existentes continuam com seus ACLs atuais até o #25 ser aplicado; isso é intencional.
- Defaults globais inseguros impedem esta migration, pois não podem ser neutralizados apenas em public.
- Outros creator roles/schemas, GRANTs explícitos futuros, event triggers ou automações externas podem reintroduzir acesso.
- Novas migrations que dependam de DML implícito de service_role precisarão de GRANTs explícitos por tabela. O runtime existente não perde permissões, mas instalações novas de SQL antigo devem ser revisadas/testadas; não reaplicar scripts legados automaticamente.
- Defaults de sequences/functions, inclusive possível EXECUTE de PUBLIC em funções futuras, são preservados e não ficam seguros por causa desta mudança de tipo r.
- Falta de autoridade sobre supabase_admin causa erro atômico; resolver com operador autorizado, sem ampliar memberships.
- Não criar tabelas de prova em Production para validar este PR. A verificação read-only usa catálogos; o CREATE fica em staging/local.
- Não há rollback amplo com GRANT ALL. Se necessário, restaurar somente os defaults capturados e aprovados, em tarefa separada.
