# Texto para iniciar a continuidade no ambiente operacional

Continuar a preparação nacional Órulo V2 a partir do pacote privado anexo, baseado em `audit/orulo-national-v2`, commit `a46a508`. Ler `repository/orulo-national-v2/handoff/README.md`, conferir os checksums externos e `handoff/PACKAGE-SHA256SUMS` e inspecionar o protocolo existente antes de executar qualquer leitura.

Este ambiente está autorizado para descoberta autenticada na Órulo, exportações SQL somente leitura do projeto `wzaegidwtdjuhqchpdpd`, validação de evidências e dry run offline. Usar somente mecanismos e credenciais existentes autorizados; não presumir que os metadados de um segredo fornecem seu valor. Não usar o proxy público com fallback como comprovação da origem.

Executar as etapas independentes seguras do runbook. Classificar ocorrências como BLOCKER, NON_BLOCKER ou UNKNOWN e indicar qual etapa é afetada. Falha localizada não deve impedir outros alvos. Falha compartilhada de autenticação/rate limit bloqueia chamadas dependentes, não a documentação e análise offline. Não pedir confirmações repetidas para as leituras já autorizadas.

Manter um manifesto nacional preliminar e um lote lógico. Não inventar URLs, recuperar por suposição, promover `UNKNOWN` a `PASS`, substituir hashes antigos por baseline novo sem registrar drift ou tratar testes locais como prova de CAS de produção.

Produzir nova evidência autenticada, classificação por candidato, propostas exclusivamente diagnósticas, relatório de simulação e recomendação fundamentada de dimensionamento. O protocolo de autorização, CAS, snapshots e ledger permanece inalterado. Parar antes de migrations remotas, CAS real, escrita no ledger operacional, emissão de autorização, mudança de catálogo, workflow operacional, PR público, merge ou deploy.
