# Riscos, bloqueios e continuidade

As classificações têm escopo. `BLOCKER` impede a operação dependente, `NON_BLOCKER` permite continuar e `UNKNOWN` exige evidência adicional antes de promover o alvo. Nenhuma delas, isoladamente, autoriza escrita.

| Ocorrência | Classe / escopo | Continuidade segura |
|---|---|---|
| Credenciais ausentes no Work | NON_BLOCKER / preparação; BLOCKER se ausentes na origem operacional | Código, fila, testes e documentação completos; usar credenciais já autorizadas no ambiente operacional |
| Rejeição anterior de PR público | NON_BLOCKER / transferência privada | Não criar PR, não repetir publicação; entregar arquivo privado e commit local |
| Fallback do endpoint público com rótulo `orulo_api` | BLOCKER / prova da origem pelo proxy | Não corrigir o endpoint neste escopo; consultar OAuth/API oficial diretamente |
| REST público expõe só parte do inventário | BLOCKER / cobertura via REST | Usar SQL READ ONLY e fingerprint; descoberta oficial da Órulo continua independente |
| 5 registros sem estrutura de plantas; 42 ocorrências com URLs inconsistentes; duplicatas em arrays | NON_BLOCKER / demais alvos; BLOCKER para correção automática desses registros | Preservar evidências anteriores e exclusões; não reparar dados periféricos |
| Hash atual difere do preliminar | BLOCKER / proposta daquele imóvel | Excluir alvo e registrar drift; processar imóveis independentes |
| API 401/403/429, OAuth falho, CDN 429 | BLOCKER / serviço compartilhado | Encerrar consultas dependentes; respeitar Retry-After; continuar exportação e análise offline |
| 404 ou erro de um empreendimento | BLOCKER / alvo | Preservar status/evidência e continuar outros empreendimentos |
| Evidência parcial/interrompida | UNKNOWN / empreendimento ou armazenamento | Quarentena do empreendimento; se o armazenamento/índice estiver incerto, nova janela privada; não sobrescrever |
| Memória, espaço, rate limit e duração nacional | UNKNOWN / dimensionamento | Medir no ambiente operacional; não fabricar estimativas ou segmentos |
| Duplicidade de conteúdo e correspondência visual | UNKNOWN / imagem | Não equiparar prefixos ou IDs a validação visual; manter pendências |
| Comparação exata CAS/locks/triggers/rollback em produção | UNKNOWN / execução real | Modelos locais não substituem o protocolo original |
| Lote nacional fora do catálogo autorizado | BLOCKER / futura escrita; NON_BLOCKER / leitura | Manter um lote lógico diagnóstico; nenhuma migration ou liberação de catálogo neste trabalho |

O arquivo `issues.json` vincula cada ocorrência a evidências e à ação permitida. Os números do inventário são observações históricas do commit de base, não uma nova auditoria em produção. A preparação foi concluída sem tentar resolver credenciais, endpoint público, permissões, catálogo ou deploy no Work.

Manter um único manifesto mestre e lote lógico. A fila pode ser consultada em janelas retomáveis sem criar lotes administrativos. A decisão sobre segmentos físicos de uma futura execução depende de limites/latências reais, tamanho dos patches, contenção e validade dos snapshots/autorização já existentes. Checkpoints deste coletor são apenas arquivos privados; não são eventos do ledger `orulo_audit`.
