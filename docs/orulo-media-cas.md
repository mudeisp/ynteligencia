# CAS de imagens Órulo — liberação controlada do Lote 1

Esta alteração prepara o código; não instala a RPC, não executa o Lote 1 e não autoriza Lote 2.

## Garantia e escopo

A RPC public.orulo_media_cas(uuid,jsonb,jsonb) faz SELECT ... FOR UPDATE por PK UUID, compara a linha inteira com o estado esperado e atualiza apenas raw_data.building.floor_plans e updated_at. Uma atualização concorrente de preço, estoque, fotos, vídeos, tour, tipologias ou qualquer outro campo resulta em CONFLICT. updated_at não é a única prova de estado.

A comparação converte o JSON esperado para os tipos da tabela, mantendo precisão dos timestamps no PostgreSQL. Chaves ausentes/adicionais resultam em conflito. O bloqueio fica somente durante a RPC; chamadas ao Órulo ocorrem antes da transação.

O servidor fixa os 99 IDs de scripts/orulo-media-recovery-lote1.ids.json (Lote 1 original menos 86644). A RPC não aceita uma allowlist fornecida pelo cliente. Também exige source=novos, state=SP e active=true. O cliente exige lista explícita e valida o escopo antes de qualquer chamada remota de execução em modo de escrita. --building-id permanece disponível para diagnósticos, mas não libera escrita.

Somente image_url, images, url e dimensões 520x280/1024x1024/2280x1800 de plantas já existentes podem mudar. A quantidade, a ordem, os IDs e as descrições/tipologias das plantas são preservados. Não são importados desenhos novos. Alterações indevidas por triggers também provocam rollback da RPC.

Retornos:
- UPDATED: uma linha alterada e comprovante transacional retornado.
- CONFLICT: estado mudou; nenhuma atualização.
- NOT_FOUND: PK não existe.
- UNCHANGED: sem mudança necessária ou repetição exata já satisfeita, sem atualizar updated_at.

## Segurança

SECURITY INVOKER, search_path vazio, timezone UTC e lock_timeout de 5 segundos.
EXECUTE é revogado de PUBLIC, anon e authenticated, e concedido somente a service_role. A função também confere current_user. Nenhuma permissão nova sobre a tabela é concedida; as permissões existentes e RLS continuam valendo.

A revisão de catálogo em produção foi somente leitura: service_role já possui SELECT/UPDATE. O trigger de preço mínimo é restrito a UPDATE OF price,active e não é disparado pelo UPDATE desta RPC. O trigger existente de raw_data atualiza o índice derivado do portal; ele continua com seu comportamento normal. Nenhum trigger foi alterado.

## Testes reproduzíveis, sem Supabase real

Node 20+ e PostgreSQL embutido PGlite 0.5.15, fixado com lockfile:
```sh
npm ci --prefix test-support/orulo-cas
npm test --prefix test-support/orulo-cas
```

Os testes executam o SQL real em um banco isolado com dados sintéticos e roles de teste. Incluem sucesso, estado concorrente sem atualizar timestamp, timestamp concorrente, segunda operação com estado antigo, ausência, repetição, timeout antes/depois de commit, readback divergente/falho, ledger sem espaço, privilégios, escopo, metadados de plantas e rollback de trigger indevido. São testes determinísticos de alteração entre leitura e CAS, não um teste de carga com sessões de produção.

Os testes antigos de escrita por PATCH foram substituídos pelos testes CAS. Os testes antigos de diagnóstico continuam.

## Passos objetivos para liberar o Lote 1

1. Revisar e aprovar este PR e o manifesto de 99 IDs; não reutilizar o runner operacional antigo de 100 IDs.
2. Aplicar supabase/orulo_media_cas.sql por um canal SQL autorizado. A instalação cria apenas a função e seus grants; não atualiza imóveis. Não foi aplicada por esta alteração.
3. Conferir sem mutação:
```sql
select has_function_privilege('service_role','public.orulo_media_cas(uuid,jsonb,jsonb)','EXECUTE'),
       has_function_privilege('anon','public.orulo_media_cas(uuid,jsonb,jsonb)','EXECUTE'),
       has_function_privilege('authenticated','public.orulo_media_cas(uuid,jsonb,jsonb)','EXECUTE');
-- Esperado: true, false, false.
```
4. Manter o mecanismo V2: snapshot por PK imediatamente antes da futura escrita e outro depois, mesmo conjunto de campos e hashes canônicos UTC. Atualizar a referência não atribui autoria a mudanças.
5. Após autorização específica de execução, usar a revisão revisada e credenciais já configuradas em ambiente protegido. Na raiz do repositório, o comando FUTURO é:
```sh
node scripts/orulo-media-recovery.mjs --states=SP --building-ids-file=scripts/orulo-media-recovery-lote1.ids.json --ledger=/caminho/persistente/lote1-cas-TIMESTAMP.jsonl --write
```
O diretório deve existir e ser persistente; o arquivo deve ser novo. Não usar armazenamento descartável de um build para a futura escrita. Nenhum comando desse tipo foi executado nesta implementação.
6. Comparar snapshots V2 por chave e reconciliar o ledger por registro. Somente eventos RESULT com status UPDATED, readback bem-sucedido e receipt podem gerar comprovantes para o V2: usar event.receipt, cujo id, expectedBeforeContentHash, expectedAfterContentHash, verified e allowedChangedPaths seguem o comparador V2.
7. Mudanças externas ou divergências de conteúdo não cobertas por comprovante exato permanecem concorrentes/não atribuídas e exigem investigação. Não iniciar Lote 2.

## Ledger, timeout e readback

O ledger JSONL é aberto de forma exclusiva. Cada INTENT é escrito integralmente e sincronizado em disco antes da RPC, com operationId, PK, building ID, estado esperado e plantas propostas. RESULT contém resposta, readback e, em UPDATED, o comprovante com hashes V2 e caminhos autorizados.

Timeout, falha HTTP ou resposta inválida acionam readback, nunca uma nova RPC automática. Estado desejado observado é registrado como UNCHANGED com EXPECTED_STATE_OBSERVED_ACTOR_UNPROVEN; não cria comprovante de autoria. Estado original ainda visível continua AMBIGUOUS, pois a transação pode estar em andamento. Estado diferente vira CONFLICT.

Qualquer resposta ambígua encerra a execução após esse readback, inclusive se o resultado esperado foi observado. Readback pós-commit divergente ou falha de ledger também encerra. Antes de uma futura tentativa, reconciliar a PK com banco/ledger manualmente e emitir nova autorização e novo arquivo; nunca repetir automaticamente a operação.

rowsWritten conta somente UPDATED confirmado. Não usar esse contador sozinho para interpretar uma execução interrompida ou ambígua.

## Rollback

Antes de executar qualquer lote: aplicar supabase/orulo_media_cas_rollback.sql para revogar execução e remover a RPC. Não modifica imóveis. Interromper os processos clientes primeiro.

Reverter o PR não deve reativar escrita pelo PATCH antigo; manter scripts antigos somente em leitura.

Se houver uma execução futura: o rollback da função não desfaz dados. Uma reversão de imagens deve partir do ledger, por PK, verificando o estado esperado pós-operação com CAS e restaurando somente a mídia anterior, nunca raw_data inteiro. Se o registro já mudou, classificar conflito e não restaurar automaticamente.

