# V2 — preflight de privilégios por catálogos, sem mudanças de produção

Base inspecionada: `d489c1e1723493c729819031882b7a6339b2a914`, branch local `audit/orulo-national-v2`.

**Código atualizado e testes locais aprovados. Conexão PostgreSQL real, preflight operacional e dry run nacional: NOT_EXECUTED.** Não houve push, alteração da main, V4, ambiente protegido, Vercel ou Supabase.

## Verificações acrescentadas

Somente `scripts/orulo-national-v2-pg-preflight.py` e seus testes receberam alterações de implementação. Os 383 arquivos do pacote original, o manifesto, a fila, os hashes e os workflows foram preservados.

O código rejeita identidades reservadas/privilegiadas do perfil antes de conectar. Após a conexão, consulta catálogos PostgreSQL em `BEGIN READ ONLY`, com `search_path` local fixado em `pg_catalog`:

- Confere usuário efetivo e usuário da sessão, impedindo que uma sessão administrativa se apresente apenas com `SET ROLE` como leitor.
- Examina roles associadas, inclusive associações `NOINHERIT`, pois elas não provam ausência de possibilidade de assumir outra role. A análise é conservadora: associação excessiva ou não comprovadamente segura bloqueia o preflight.
- Verifica `SUPERUSER`, `BYPASSRLS`, criação de roles/bancos, replicação e associações administrativas conhecidas.
- Usa as funções de privilégio efetivo do PostgreSQL para verificar `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` e grants por coluna nas relações persistentes, incluindo catálogos físicos e schemas de aplicação.
- Verifica mutação de sequences, ownership, capacidade de criar objetos e executar funções `SECURITY DEFINER` não revisadas. Não presume que uma função privilegiada seja inofensiva.
- Audita `ALTER SYSTEM` e capacidade de configurar parâmetros reservados a administradores. A view nativa `pg_settings`, que permite ajustes da própria sessão por padrão, não é confundida com uma tabela persistente de produção; os parâmetros administrativos são tratados separadamente. Objetos temporários da sessão não são classificados como dados persistentes de produção.
- Inspeciona `pg_policy` e `pg_get_expr` sem executar DDL. RLS ativa só é aceita com evidência explícita de política SELECT/ALL permissiva integral e ausência de restrição aplicável não comprovada. Políticas condicionais que o verificador não consegue provar ficam bloqueadas; ele não as modifica, remove, amplia ou contorna.

Todas as provas obrigatórias devem ser booleanos `true`; prova ausente ou ambígua não vira PASS. Os erros e artefatos de falha guardam somente códigos fixos e checks booleanos/UNKNOWN, sem nomes de usuário, perfis, senhas ou stderr de libpq.

**Não há CREATE POLICY, ALTER POLICY, GRANT, REVOKE ou mudança de RLS no SQL executável do preflight.** Esses comandos aparecem exclusivamente na construção de fixtures PGlite locais, em memória, sem endpoint PostgreSQL remoto. Os testes não dependem de `PGHOST`, de secrets reais ou de acesso ao Supabase.

## Cobertura e consistência

Só depois de todas as verificações de role e acesso passarem, outra transação READ ONLY calcula contagem e fingerprint agregado de `public.properties`, usando o mesmo filtro e SHA-256 JSONB/UTC do pacote. O resultado deve coincidir com o manifesto congelado. Drift, cobertura incompleta ou hash divergente bloqueiam antes da descoberta Órulo; o manifesto não é atualizado por suposição.

Essa leitura agregada não exporta linhas no log e não executa recuperação de imagens. A manutenção temporária dos arquivos privados libpq continua no contrato original do workflow, com permissões restritas e limpeza; seus conteúdos não são enviados a logs ou artefatos.

## Testes executados

| Grupo | PASS | Falhas finais |
|---|---:|---:|
| Protocolo original | 153 | 0 |
| Transferência/simulador e SQL originais | 16 | 0 |
| Exportador original | 4 | 0 |
| Manifesto original | 6 | 0 |
| Preflight, workflow e privilégios | 19 | 0 |
| Total local | **198** | **0** |

Os testes reais de SQL usam PGlite isolado. Comprovam casos de leitor com política integral, política restritiva, escrita por coluna via role NOINHERIT, BYPASSRLS direto e associado, SUPERUSER, mutação de sequence, parâmetro administrativo e schema de aplicação cujo nome começa por `pg` sem ser um schema de sistema. A leitura agregada foi comparada ao fingerprint calculado independentemente sobre dois registros sintéticos.

Uma entrada GRANT em catálogo não é automaticamente privilégio efetivo: o teste observa que o PostgreSQL mascara escrita direta em certos catálogos sem contexto administrativo. O verificador usa as funções efetivas do servidor e verifica capacidades administrativas separadamente, sem tentar escrita para provar isso.

Comandos locais reproduzíveis:

```bash
python3 scripts/orulo-national-v2-workflow.test.py
npm test --prefix test-support/orulo-cas
node --test scripts/orulo-national-transfer.test.mjs scripts/orulo-national-readonly-sql.test.mjs
python3 scripts/orulo-national-export-readonly.test.py
python3 scripts/orulo-national-v2.test.py
sha256sum -c orulo-national-v2/handoff/PACKAGE-SHA256SUMS
```

## Bloqueio real e avaliação de executor isolado

As inspeções GitHub foram somente GET:

1. O workflow V2 `.github/workflows/orulo-national-v2-readonly.yml` retornou **404** na API de workflows e não consta do catálogo Actions. Sua definição não está na main atual.
2. O ambiente `orulo-lote1` continua permitindo somente a branch **main**. O próprio V2 também conserva seus gates de proprietário, main, SHA e primeira tentativa. Nenhuma condição foi relaxada.
3. A branch remota continua em `0c3cae0`; a main observada está em `673f6f9`. As revisões preparadas permanecem locais.
4. A exclusão de deployment para a branch de auditoria não foi comprovada. Portanto não houve push que pudesse ativar as integrações Vercel existentes.

Um runner diferente, inclusive self-hosted, não remove a exigência de uma execução GitHub autorizada pela política do environment. Outro repositório não herda os secrets deste environment; copiá-los exigiria acesso a valores que não foi solicitado nem tentado. Não foi criado um executor que mascarasse a branch, identidade ou origem dos secrets.

Os workflows antigos não foram usados como ponte. O V4 com `batch_id` não é V2. O antigo `storage-preflight` de Lote1 abre um journal e grava eventos/snapshots em `orulo_audit`; por isso também não é substituto permitido para esta execução sem escritas. A verificação de cinco empreendimentos não valida a conexão libpq nem o inventário V2.

## Secrets e estado operacional

O cadastro de `ORULO_V2_PG_SERVICE_CONF` e `ORULO_V2_PGPASS` é considerado confirmado pelo usuário. A consulta de **metadados** retornou HTTP 403: isso não comprova ausência, invalidez ou falta de cadastro. Não foram lidos seus conteúdos nem solicitado novo cadastro.

Como não houve execução elegível do V2 com esse environment, formato em runtime, conectividade, autenticação, privilégios reais e cobertura real do usuário dedicado permanecem **UNKNOWN / NOT_EXECUTED**. Nenhum PASS local é apresentado como prova de produção.

O bloqueio é a ausência de um caminho de execução V2 registrado, elegível para o environment e isolado da Vercel sob as restrições atuais. A entrega termina no código local e nos testes, sem push e sem alterações de produção, conforme a orientação do usuário.
