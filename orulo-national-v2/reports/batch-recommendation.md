# Recomendação de lote

Manter **um manifesto nacional e um lote lógico** `orulo-national-v2`. Não há evidência que justifique dezenas de lotes administrativos. O manifesto tem 7.284 imóveis candidatos, 2.667 empreendimentos candidatos e 17.011 pares empreendimento/planta sem imagem. O teto de ocorrências de recuperação é 56.754, não a quantidade comprovadamente recuperável.

Não é possível recomendar honestamente uma única operação transacional nacional, um número final de segmentos físicos ou uma duração operacional. Não há patches validados, medição de throughput autenticado/CAS nem limite de API comprovado. O arquivo do manifesto tem cerca de 17,3 MB; esse volume inclui evidências e relações de inventário e não mede o payload de atualização. A consulta agregada final confirmou estabilidade dos hashes, não um lock nacional.

O executor anterior já usa operações por UUID com comparação integral, lock curto e recibo atômico no ledger. Uma futura execução deve conservar essas transações curtas, agrupadas sob um único identificador lógico, com checkpoints duráveis por operação. Consultas Órulo/CDN devem ocorrer antes de abrir a transação. IDs de planta, quantidade, ordem e todos os campos sem relação com imagem devem ser preservados.

Depois de validar a origem, medir requisições por empreendimento, imagens/URLs distintas, bytes por operação, latência p50/p95, rate limits/Retry-After, duração de baseline e contenção. O catálogo atual tem baseline com validade de cinco minutos e autorização com prazo curto; um percurso nacional pode excedê-los. O número de segmentos deve ser calculado a partir desses limites e de um ensaio local representativo, conservando o manifesto mestre e autorizando especificamente cada janela futura. Não alterar esses limites para acomodar este inventário.

Timeout/ACK perdido permanece ambíguo: reconciliar INTENT/CAS_RESULT e o estado atual, sem retry automático ou reaproveitamento de autorização. Rollback futuro exige comparar o pós-estado autorizado e restaurar somente mídia anterior; mudança de terceiro deve bloquear restauração. Nenhum desses procedimentos foi executado em produção.
