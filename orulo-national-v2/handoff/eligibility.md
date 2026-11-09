# Elegibilidade e exclusões

Há três decisões distintas: referência armazenada, recuperabilidade diagnóstica e autorização de produção. Este pacote prepara e mede as duas primeiras. Não emite a terceira e não modifica seus critérios existentes.

| Status | Evidência mínima | Consequência |
|---|---|---|
| `RECOVERABLE` | ID de planta exato na resposta autenticada e completa da Órulo; URLs reais retornadas; todos os campos de mídia válidos; host/caminho aceitos pelo `verifyBatchImage` original; HTTP 200/206, MIME compatível e assinatura; evidências/hash íntegros | Pode participar da simulação local, continuando sem autorização |
| `ALREADY_COMPLETE` | Referências de imagem já presentes nas plantas atuais | Excluir de novos patches; presença não comprova disponibilidade ou correção visual |
| `SOURCE_NOT_FOUND` | Resposta oficial 404 ou resposta completa sem a planta/imagem procurada | Bloquear somente a recuperação do alvo; continuar os demais |
| `SOURCE_ERROR` | Falha HTTP, OAuth, rede, JSON, IDs ou resposta incompleta | Registrar erro e escopo; bloqueio local ou compartilhado conforme causa |
| `AMBIGUOUS` | URL exata compartilhada entre plantas distintas, procedência incerta ou evidência interrompida | `UNKNOWN` sobre recuperabilidade; não emitir patch |
| `REQUIRES_REVIEW` | Campo inválido, URL recusada, hash alterado, falta de cobertura, planta inválida ou divergência de escopo | Bloquear o alvo; continuar etapas independentes |

Na simulação, exigir snapshot integral do universo filtrado, hashes das linhas canônicas PostgreSQL e fingerprint agregado conferido. A linha atual deve preservar o hash preliminar; mudança de terceiros causa exclusão para revisão. Imóvel agora completo não recebe patch mesmo que o hash tenha mudado. Imóvel inativo ou empreendimento incompatível é bloqueado para revisão. A análise nacional de outros estados permanece diagnóstica; o escopo SP e os catálogos do executor original não foram ampliados.

O patch é calculado por `batchPatches` e aplicado em memória por `imageOnlyPlans`, ambas as funções existentes. Só são propostos campos de imagem em plantas já declaradas. A quantidade, ordem, IDs, associações e descrições permanecem iguais. Plantas com imagens atuais não são substituídas. Não adicionar plantas, alterar fotos/vídeos/tour/estoque/preço ou reparar imagens antigas inválidas automaticamente.

As verificações locais cobrem preservação, segunda aplicação sem novo patch, detecção modelada de mudança concorrente e restauração modelada de apenas mídia. O hash do modelo JavaScript não é hash CAS PostgreSQL e não pode ser enviado ao executor. A simulação não prova locks, efeitos de triggers, precisão numérica PostgreSQL, recibos transacionais ou rollback real; isso permanece no protocolo original.

As evidências CDN armazenam prefixo de até 4 KiB, seu SHA-256, MIME, status, assinatura e URL; o corpo integral da resposta da API tem hash separado. Hash de prefixo não é hash da imagem completa. Duplicidade por conteúdo/visão, correspondência visual e disponibilidade no instante de futura escrita permanecem pendentes. Nenhuma URL é construída a partir de ID ou nome de arquivo.

Se qualquer planta sem imagem de um imóvel não estiver validada, o imóvel inteiro fica fora da proposta local. Falha de um alvo não torna os outros elegíveis por suposição; cada um mantém suas próprias provas. Uma classificação `RECOVERABLE` local nunca autoriza CAS, contorna catálogo, dispensa snapshots ou substitui a confirmação administrativa específica do protocolo.
