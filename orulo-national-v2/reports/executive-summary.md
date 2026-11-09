# Resultado executivo — 09/11/2026

Este relatório preserva os resultados do levantamento de base `a46a508`. A preparação posterior do pacote privado de continuidade está concluída e documentada em `../handoff/README.md`; as pendências abaixo pertencem à etapa operacional separada.

**NO-GO. Dry run completo: UNKNOWN. Pronto para solicitar autorização: NO.** A auditoria nacional e a verificação dos hashes foram concluídas; a validação autenticada de origem e a simulação de recuperação permanecem pendentes. O trabalho não atende ainda ao critério final solicitado.

| Indicador | Resultado |
|---|---:|
| Imóveis auditados | 17.922 |
| Empreendimentos auditados | 8.373 |
| Ocorrências de plantas | 108.708 |
| Plantas sem imagem | 56.754 ocorrências; 17.011 pares empreendimento/planta distintos |
| Imagens comprovadamente recuperáveis | 0 comprovadas para elegibilidade; total real UNKNOWN |
| Imóveis elegíveis | 0 liberados; 7.284 candidatos bloqueados |
| Empreendimentos elegíveis | 0 liberados; 2.667 candidatos bloqueados |
| Imagens duplicadas | 72 entradas repetidas em arrays de 36 ocorrências de plantas |
| URLs compartilhadas entre plantas distintas | 0 por igualdade exata de URL; duplicidade visual/por conteúdo UNKNOWN |
| URLs inconsistentes | 294 referências fora do padrão do executor, em 42 ocorrências de plantas |
| Erros de origem | UNKNOWN: zero consultas autenticadas diretas; 3 respostas de proxy ambíguas |
| Operações CAS propostas | 0 |
| Número recomendado de lotes | 1 lote lógico; segmentos físicos ainda indeterminados |
| Tempo estimado | UNKNOWN: faltam limites e latências de origem/CAS; não houve ensaio operacional |
| Resultado do dry run completo | UNKNOWN |
| Pronto para solicitar autorização? | NO |

Classificação dos imóveis: 5.758 têm referências de imagem em todas as plantas; 7.284 não têm imagens em nenhuma das plantas declaradas; 0 parcialmente preenchidos; 4.875 têm array vazio; 5 têm estrutura de plantas ausente. Esses cinco são excluídos para revisão. Presença de URL não significa URL disponível, imagem correta ou imóvel resolvido em execução anterior.

Os 7.253 imóveis e 2.662 empreendimentos fora dos **alvos UUID de lotes anteriores**, entre os candidatos, confirmam o baseline preliminar. Outros 31 imóveis candidatos pertencem a alvos históricos e continuam sem imagens; não foram excluídos como resolvidos. A cobertura mais ampla por IDs de empreendimentos dos manifestos diagnósticos V4 é outra métrica: há 5.575 imóveis e 4.396 empreendimentos do universo fora dela. As definições estão preservadas em `audit/baseline.json` e `audit/previous-batches.json`.

Há 17.011 candidatos deduplicados: 14 `AMBIGUOUS` nas amostras dos empreendimentos 1740 e 55630, e 16.997 `REQUIRES_REVIEW` sem consulta autenticada. A amostra 81900 já tem imagens no inventário. Não há `SOURCE_NOT_FOUND` comprovado; ausência de consulta não foi classificada como ausência na origem.

A verificação do ledger abrangeu 23 execuções e 7.732 eventos: zero hashes inválidos, zero quebras de cadeia, zero divergências evento/canônico e zero intenções sem resultado CAS. Os triggers de proteção de UPDATE/DELETE/TRUNCATE de `runs` e `entries` estão habilitados. Isso não equivale a certificar todas as comparações de snapshots e recibos de cada execução histórica.

O inventário foi conferido por uma consulta agregada após a coleta: fingerprint `ae6084ff766fb45b8cbd5e6c12d9225db37d3908a1cade8043d79b3341649c42`, observado às 04:39:41 de Brasília (07:39:41 UTC). A consulta pública REST tinha apenas 15.635 registros visíveis; por isso a coleta nacional foi feita via SQL somente leitura.

Validação local: 153 testes existentes passaram, incluindo SQL real em PGlite para autorização, CAS, conflitos, idempotência, preservação, rollback e ledger. Os seis novos testes do empacotador passaram. Dois builds a partir das mesmas entradas produziram artefatos idênticos. Esses testes são locais; não validam patches nacionais inexistentes nem autorizam produção. Consulte `dry-run/local-validation.json`.

Nenhum imóvel foi alterado, nenhum CAS real foi chamado, nenhuma migration remota foi aplicada e nenhum lote foi liberado por este trabalho. Merge e deploy de produção não foram executados.
