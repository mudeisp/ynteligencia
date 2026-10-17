# Default ACL hardening operacional no Supabase — cenário B

## Investigação read-only e causa exata

Main de base: `d8f0ffc716f0a49f5e6ad0f833aa448c2de28f37`, com #25 e #26 já mergeados. Esta correção não aplica migrations nem altera dados em Production.

Uma transação BEGIN READ ONLY consultou somente catálogos e identidade no projeto `wzaegidwtdjuhqchpdpd`, em 2026-10-17T11:47:23.357517+00:00 (08:47 BRT em 17/10/2026). Nenhum SET ROLE, ALTER DEFAULT PRIVILEGES, alteração de role/ACL ou função de escrita foi executado em Production.

Identidade observada na conexão do conector:
- current_user = session_user = current_role = **postgres**; current_setting('role') = none.
- PostgreSQL 17.6 (170006).
- pg_has_role(current_user,'supabase_admin','USAGE') = **false**.
- pg_has_role(current_user,'supabase_admin','SET') = **false**.
- pg_has_role(current_user,'supabase_admin','MEMBER') = **false**.
- Para o próprio postgres: USAGE/SET/MEMBER = true.

Esta é a identidade efetivamente observada. Não recebemos log histórico de identidade da tentativa manual anterior; o erro informado é coerente com essa conexão postgres. O operador deve executar o preflight na mesma conexão que aplicará a migration, sem assumir que uma ferramenta diferente use a mesma identidade.

| Role | rolsuper | rolinherit | rolcreaterole | rolcreatedb | rolbypassrls |
|---|---|---|---|---|---|
| authenticated | false | true | false | false | false |
| anon | false | true | false | false | false |
| service_role | false | true | false | false | true |
| supabase_admin | true | true | true | true | true |
| postgres | false | true | true | true | true |

Memberships diretas de postgres: supabase_privileged_role, authenticator, service_role, authenticated, anon, pg_create_subscription, pg_read_all_data, pg_signal_backend e pg_monitor. As rotas herdadas incluem authenticator → application roles e pg_monitor → roles de monitoramento. **Nenhuma rota alcança supabase_admin.** Supabase_admin é superuser interno; ser membro de supabase_privileged_role não equivale a ser supabase_admin.

Os default ACLs r/S/f observados no schema public pertencem ao creator indicado por defaclrole:
- Creator postgres: grantor postgres.
- Creator supabase_admin: grantor supabase_admin.
- Para r, as três application roles recebem os oito privilégios, todos com is_grantable=false.
- Os defaults de supabase_admin também concedem esses privilégios a postgres como grantee. Isso não transfere a propriedade do default ACL nem autoridade para alterá-lo.
- Não há default ACL global explícito desses creators no snapshot; aplica-se o fallback nativo. PUBLIC não aparece como grantee nos ACLs de schema observados.
- S/f também têm grants para application roles; são preservados por esta correção.

**Cenário B confirmado para postgres.** A checagem nativa de ALTER DEFAULT PRIVILEGES exige autoridade sobre o creator alvo. Postgres gerenciado não é superuser e não possui os privilégios de supabase_admin. Daí o erro `permission denied to change default privileges` (SQLSTATE 42501), independentemente de CREATEROLE, CREATEDB ou BYPASSRLS. Não há suporte para inferir essa autoridade a partir desses atributos.

Referências: [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html), [pg_has_role/identidade](https://www.postgresql.org/docs/17/functions-info.html), [roles Supabase](https://supabase.com/docs/guides/database/postgres/roles). O código nativo em [aclchk.c](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/catalog/aclchk.c) verifica has_privs_of_role para o alvo antes de aplicar o default ACL.

O teste anterior do #26 executava a migration como postgres superuser local, condição diferente de Production. Isso permitiu o teste de ambos os creators e deixou de cobrir a restrição operacional real. O novo teste corrige essa lacuna com conexões distintas e um postgres local NÃO superuser.

## Correção e limites de responsabilidade

A migration automática agora controla somente o creator **postgres** em public, tipo **r**:
- Zero privilégios automáticos para PUBLIC/anon/authenticated/service_role.
- REVOKE explícito de SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; MAINTAIN em PG17+.
- Falta de autoridade sobre postgres, grants globais inseguros, acesso herdado por aplicação ou pré-requisito ausente continuam gerando erro e rollback integral.
- **Nenhuma tentativa automática de alterar defaults de supabase_admin**, mesmo sob um operador privilegiado.
- Nenhum SET ROLE, GRANT de role, mudança de hierarchy, SECURITY DEFINER ou elevação de privilégio.

Supabase_admin é uma **dependência administrativa externa**, não skip silencioso:
- A migration emite WARNING `supabase_admin_not_manageable` quando a identidade não tem USAGE dessa role.
- Sob identidade com autoridade, emite `supabase_admin_external_action_required`; o automático continua limitado a postgres.
- A pós-validação lê ambos os creators e mantém o resultado global **PARTIAL_PLATFORM_ACTION_REQUIRED** enquanto houver defaults inseguros da plataforma.
- A existência de um requisito externo não desfaz o hardening válido de postgres. Isso é separação explícita de escopos, não aplicação parcial provocada por erro na transação.
- Só reporta **COMPLETE** se os catálogos provarem que os dois creators estão seguros para todas as quatro identidades verificadas.

O comando histórico do #26 tentou tratar duas autoridades distintas numa única transação. A tentativa descrita abortou integralmente; nenhum REVOKE de postgres permaneceu. O teste local reproduz exatamente essa falha e comprova o rollback.

## Verificação: não confundir commit com hardening completo

`scripts/public-default-acl-verify.sql` retorna uma linha por creator/grantee:

| Campo | Significado |
|---|---|
| migration_identity | current_user da conexão de verificação |
| responsibility | project para postgres; platform_external para supabase_admin |
| operator_can_manage_creator | USAGE efetivo, não promessa de troca de role |
| acl_status | PASS / FAIL / MISSING_PREREQUISITE por creator/grantee |
| status | project_hardened, postgres_hardening_failed, supabase_admin_not_manageable, supabase_admin_external_action_required ou platform_hardening_verified |
| overall_status | PROJECT_HARDENING_FAILED, PARTIAL_PLATFORM_ACTION_REQUIRED ou COMPLETE |

PUBLIC pode estar seguro e application roles inseguras no mesmo creator; por isso é necessário ler overall_status de todas as linhas. Um status individual platform_hardening_verified não certifica todo o projeto.

O script considera defaults globais + schema e herança de ownership/acesso. Código de saída 0 de psql indica execução da consulta, **não COMPLETE**. Automação deve interpretar overall_status; não tratar WARNING ou commit da migration como fechamento do requisito externo.

A nova consulta foi executada também em Production, exclusivamente read-only: retornou postgres_hardening_failed para as três application roles de postgres, supabase_admin_not_manageable para as três de supabase_admin, e overall_status=PROJECT_HARDENING_FAILED. PUBLIC não possui grant inseguro nos dois creators. Isso confirma que o hardening de postgres ainda não está aplicado; PARTIAL_PLATFORM_ACTION_REQUIRED é o resultado esperado somente depois da etapa corrigida, enquanto a plataforma continuar pendente.

O preflight inclui current_user/session_user/current_role, atributos das cinco roles, USAGE/SET/MEMBER, memberships e caminhos herdados, owner/creator/grantor do ACL e grant options. Consulta SET somente em PG16+, sem executar troca de role.

## O que permanece intacto

- ACLs, dados, RLS, policies, schemas, colunas, índices, constraints e funções existentes.
- SECURITY INVOKER, search_path e ACLs das funções críticas.
- Default ACLs de sequences (S) e functions/rotinas (f).
- Outros schemas/creators e todos os default ACLs pertencentes a supabase_admin.
- Privilégios/memberships/atributos das roles.

r significa tabelas, incluindo relações abrangidas por ON TABLES; S significa sequences; f significa funções/rotinas. Alterar um tipo não resolve os outros. Não há necessidade demonstrada de mexer em S/f para esta correção.

Não existe GRANT compensatório na migration. Tabelas novas criadas por postgres precisarão de grants de DML explícitos conforme o consumidor. Tabelas criadas por supabase_admin podem continuar nascendo com acesso amplo: o risco fica pendente, visível, até ação externa autorizada.

## Migration pendente e histórico

Arquivo corrigido: `supabase/migrations/20261017113121_public_table_default_acl_hardening.sql`.

O arquivo do #26 é editado porque a tentativa de Production falhou e abortou; não há aplicação bem-sucedida a preservar nesse banco, conforme o contexto informado. Não se cria uma migration posterior que fique bloqueada pela migration pendente anterior.

Antes da tentativa futura, conferir o histórico real da ferramenta:
- Se #26 está pendente/não aplicado: usar o arquivo corrigido deste PR após review.
- Se outro ambiente já registrou aplicação do #26 original: o runner não reexecutará o arquivo só porque mudou. Validar catálogos e tratar aquele ambiente pelo procedimento de reconciliação revisado da equipe. Não alterar checksum/histórico ou marcar aplicado sem evidência.
- Não usar migration repair/GRANT amplo para mascarar erro; esta tarefa não executa reparo de histórico.
- Não usar db push genérico: ordem de arquivos e estados existentes precisam ser verificados pelo operador.

Não houve alteração da migration do #25, backfill, scoring, Buyer Profile, AGENTE, Push, Ads UX ou lead flow.

## Testes locais sob autoridade equivalente

PostgreSQL 17.11 real, cluster **isolado** em 127.0.0.1:55433:
- Bootstrap local_fixture_admin inicializa fixtures; postgres é LOGIN NOSUPERUSER INHERIT CREATEROLE CREATEDB BYPASSRLS.
- Supabase_admin é uma role SUPERUSER somente nesse cluster sintético.
- Nenhuma membership é concedida para obter autoridade. Não há SET ROLE nos testes: cada conexão usa -U com a identidade apropriada.
- Essas fixtures não são alterações de roles da plataforma Supabase. Não apontar para cluster compartilhado ou Production.

Preparação de um cluster descartável novo, fora do repositório (binários PostgreSQL disponíveis no PATH):

```sh
initdb -D /path/to/isolated-fixture-data -U local_fixture_admin -A trust --no-locale -E UTF8
pg_ctl -D /path/to/isolated-fixture-data -o "-h 127.0.0.1 -p 55433" -l /path/to/fixture.log start
DEFAULT_ACL_TEST_PSQL=/path/to/psql DEFAULT_ACL_TEST_PORT=55433 DEFAULT_ACL_BOOTSTRAP_USER=local_fixture_admin node --test public-default-acl-hardening.test.js
```

PowerShell: definir DEFAULT_ACL_TEST_PSQL/DEFAULT_ACL_TEST_PORT/DEFAULT_ACL_BOOTSTRAP_USER em $env e executar o mesmo node --test. O harness recusa host remoto, ignora settings PG herdados, cria/remove banco descartável e só cria roles se ausentes. Se postgres já for superuser, falha e pede cluster dedicado; não altera a role existente.

**13/13 testes passaram**, cobrindo:
1. Cenário B real por conexão não superuser: current/session/role postgres; USAGE/SET false para admin.
2. Reproduzir permission denied no desenho original e demonstrar rollback de todos os defaults.
3. Migration corrigida conclui postgres, emite supabase_admin_not_manageable e preserva plataforma.
4. Tabela futura de postgres sem privilégios de application roles/PUBLIC.
5. Tabela futura de admin continua insegura e o relatório marca parcial, sem fingir COMPLETE.
6. Idempotência e tabelas novas seguras após reaplicação.
7. Preservação de objetos, dados, S/f, outros schemas, roles e memberships.
8. Fail-closed para grants globais inseguros de postgres; erro de identidade sem autoridade sobre postgres.
9. Globals inseguros de admin são reportados sem mutação e sem bloquear o escopo controlável.
10. Nenhum comando automático de grant/role switching/escalada; mesmo um operador autorizado não aciona mutação automática de admin.
11. COMPLETE somente após ação **sintética local** representar uma etapa externa e o catálogo provar os dois creators seguros.

A etapa sintética externa do último teste conecta diretamente como o creator admin local. Ela não pertence à migration e não foi executada em Production.

Suíte existente sem casos PostgreSQL: **203/206**, com as mesmas três falhas reproduzidas no main limpo (d8f0ffc716f0a49f5e6ad0f833aa448c2de28f37):
- a YNTELIGENCIA reutiliza visitor e sessão e aceita property_id na URL;
- o formulário reutiliza /api/lead, sessão e visitante existentes;
- telemetria de lead não leva PII e o fluxo para se a API não confirma.

Sem regressão nova nessa suíte; não se afirma execução da suíte PostgreSQL completa. As RPCs reais são instaladas no fixture e suas definições/ACLs preservadas; não há alteração funcional delas neste PR.

## Sequência operacional recomendada para Production

**Nada abaixo foi aplicado por esta tarefa.**
1. Revisar/mergear o PR em processo separado e aprovar janela. Confirmar identidade na conexão real de migration executando apenas o preflight; capturar ACLs/histórico. Suspender CREATE TABLE/migrations concorrentes.
2. Ensaiar em staging isolado sob postgres não superuser sem autoridade de supabase_admin. Reproduzir o erro antigo e conferir que o arquivo corrigido não o causa.
3. Após aprovação específica, aplicar o arquivo #26 corrigido por este PR. Esperar warning da dependência externa. Executar pós-validação: postgres deve ser project_hardened; com o estado observado, overall_status deve ser PARTIAL_PLATFORM_ACTION_REQUIRED.
4. Aplicar #25, ainda não aplicado segundo o solicitante, em etapa separada autorizada. Validar os grants das tabelas existentes e fazer smoke tests do runtime. O #25 não corrige defaults externos e não transforma o relatório global em COMPLETE.
5. Abrir requisito administrativo com Supabase/operador de plataforma que já detenha autoridade legítima sobre supabase_admin. Solicitar política equivalente de tabelas futuras public e preservar S/f/objetos existentes. Não conceder membership ao projeto, não usar SECURITY DEFINER e não alterar roles internas como workaround.
6. Receber evidência da ação externa; executar novamente somente preflight/pós-validação. Declarar COMPLETE apenas quando ambos os creators estiverem comprovadamente seguros.
7. Enquanto o item externo não estiver resolvido, manter o hardening global como parcial e revisar explicitamente ACLs de qualquer tabela criada por roles de plataforma. Não prometer que uma pausa da equipe impede criação interna da plataforma.

Exemplo para **staging isolado**, não para execução automática:

```sh
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f scripts/public-default-acl-preflight.sql
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f supabase/migrations/20261017113121_public_table_default_acl_hardening.sql
psql -X -v ON_ERROR_STOP=1 -d "$STAGING_DATABASE_URL" -f scripts/public-default-acl-verify.sql
```

## Riscos residuais

O projeto não controla defaults de supabase_admin; #25 ainda precisa de aplicação separada; outros creators/schemas, grants explícitos, defaults S/f e automações da plataforma continuam fora deste hardening. Grants globais inseguros de postgres bloqueiam a migration em vez de alterar outros schemas. O acesso a tabelas atuais não é reduzido por este PR. Nunca reintroduzir GRANT ALL como rollback.

O cenário A não foi observado: USAGE/SET/MEMBER são false para supabase_admin. Não há procedimento de assumir essa role neste PR. Se a plataforma oferecer outra identidade legítima no futuro, isso deve ser validado separadamente; não é autorização para elevar o postgres do projeto.
