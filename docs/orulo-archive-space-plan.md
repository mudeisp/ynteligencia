# Evidências e plano de recuperação física

## Medições de produção (somente leitura)

| Medida | Bytes | Interpretação |
|---|---:|---|
| Banco completo | 547228819 | Aproximadamente 547,2 MB decimais / 521,9 MiB |
| orulo_audit.entries | 209739776 | Relação total incluindo índices/TOAST |
| orulo_audit.snapshot_records | 130252800 | Relação total incluindo índices/TOAST |
| orulo_audit.snapshot_sets | 5906432 | Relação total incluindo índices/TOAST |
| orulo_audit.runs | 81920 | Relação total incluindo índices/TOAST |
| Schema de auditoria (soma física) | 345980928 | Footprint observado; não é espaço autorizado para remoção |
| Soma pg_column_size de entries + snapshot_records | 278565848 | Estimativa de tamanho de datums; não equivale a bytes de disco liberáveis |
| Espaço comprovadamente recuperável nesta entrega | 0 | Nenhum run elegível ou removido |

Para chegar abaixo de 400 MB decimais seria preciso reduzir pelo menos 147228819 bytes, sem considerar crescimento concorrente. A unidade de cobrança/limite e a medição do painel precisam ser reconciliadas com pg_database_size antes de prometer adequação ao plano. A dimensão do schema mostra oportunidade de estudo, não demonstra economia atingível com o protocolo vigente.

## Condições impeditivas

23 execuções encerradas, sendo 4 FINISHED e 19 ABORTED; nenhuma aprovada para remoção. 7732 eventos, 348344 snapshot_records. Nenhuma exportação durável real, nenhum restore individual real, nenhuma revisão completa de dependências/aprovações. Duas execuções abortadas são pré-requisitos ativos codificados em função. Triggers append-only impedem descarte de todas as quatro tabelas. Não foi enviado DELETE/TRUNCATE/VACUUM/ALTER/GRANT ou qualquer manutenção à produção.

## Plano físico — somente preparação

1. Concluir arquivo externo privado, readback independente, restauração individual e revisão do fechamento das dependências. Revalidar os próprios hashes das funções que consultam runs; não substituir acesso on-line por suposição de que o dump basta.
2. Definir posteriormente, com autorização específica e revisão do protocolo, como uma retenção legítima seria implementada sem desabilitar a cadeia de auditoria. Esta versão não oferece bypass dos triggers. Sem essa decisão, parar.
3. Separar remoção lógica e devolução física ao filesystem: DELETE deixa versões mortas; VACUUM normal pode reutilizar páginas internamente, mas em geral não devolve todo o arquivo ao sistema. Índices e TOAST têm custos próprios. Não prometer queda de pg_database_size nem do faturamento pela soma dos registros.
4. Uma reescrita (VACUUM FULL/CLUSTER ou reconstrução equivalente) pode precisar de espaço temporário próximo do tamanho da relação/índices reescritos, além de WAL e margem de crescimento. Sob limite de disco, não iniciar sem comprovar capacidade livre e recuperação. Um aumento temporário de capacidade pode ser necessário; não autorizado nesta tarefa.
5. Planejar janela de indisponibilidade para locks exclusivos, orçamento de IO, monitoramento, cancelamento seguro, backups verificáveis e plano de retorno. Métodos alternativos de reescrita on-line exigem estudo de suporte, locks, privilégios, espaço temporário e impacto em réplica/PITR; não estão aprovados.
6. Após eventual operação futura autorizada, medir novamente pg_database_size, pg_total_relation_size, dead tuples e tamanho no painel. Registrar valor antes/depois e intervalo. Nenhuma economia será declarada sem essa medição.

## Testes e bloqueios

A suíte nova usa PostgreSQL 17.6 local isolado e verifica corrupção, arquivo incompleto, hash/cadeia divergente, run ativo, snapshots ausentes, dependência CAS, retomada, origem modificada, concorrência, restauração alterada e tentativa de exclusão sem aprovação. O teste de restauração sintética não aprova descarte de runs reais. O workflow novo executa somente essa validação local.

BLOCKED: armazenamento durável e seu readback reais; restauração dos 23 runs; revisão de referências dinâmicas, aprovações e recuperação pendente; mecanismo de retenção compatível com append-only; autorização posterior de descarte/manutenção; capacidade e janela para devolução física. NON_BLOCKER resolvido: cache npm padrão sem permissão; utilizado cache temporário sem alterar dependências.

Resultado local final: **177 testes aprovados** (24 novos de arquivamento/restauração, 153 do protocolo CAS original), zero falhas. A interface S3 foi testada com storage simulado, inclusive bytes remotos corrompidos; nenhuma persistência externa real é reivindicada.
