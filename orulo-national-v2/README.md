# Auditoria nacional Órulo V2 — preparação bloqueada

Auditoria de leitura executada em 09/11/2026. **NO-GO: o critério de conclusão solicitado ainda não foi atingido.** Existe um manifesto nacional verificável do inventário, mas faltam comprovação autenticada na origem, patches elegíveis e simulação completa. Não solicitar autorização de produção com este material.

- Projeto: `wzaegidwtdjuhqchpdpd`; tabela `public.properties`.
- Universo: `source='novos' AND external_id LIKE 'orulo:%'`, incluindo inativos e todos os estados.
- Código inspecionado: `673f6f98898e5486cba08892ea49a0727e7aa718`.
- Um manifesto mestre, um lote lógico, zero operações CAS propostas e zero escritas de produção.
- [Relatório executivo](reports/executive-summary.md), [auditoria do processo](reports/previous-process-audit.md), [recomendação de lotes](reports/batch-recommendation.md), [go/no-go](reports/go-no-go.md).

O manifesto `manifest/national-v2.json` mantém os imóveis, hashes integrais dos registros, IDs e presença de imagens das plantas, referências históricas e associações deduplicadas por empreendimento/planta. Campos desconhecidos são `null`; imagens candidatas e patches não foram inventados. `ALREADY_COMPLETE` significa presença de referência de imagem, não disponibilidade HTTP comprovada.

Os hashes de registro usam **SHA-256 do texto JSONB PostgreSQL da linha inteira, em UTC**. São diferentes dos MD5 usados no protocolo V2 anterior. O fingerprint global ordena `UUID:recordSha256`, separados por LF, sem LF final. A releitura em uma única consulta confirmou o mesmo conjunto e conteúdo dos 17.922 registros. Isto prova consistência naquele instante, não um bloqueio de concorrência futuro. O manifesto não armazena as linhas completas exigidas por um CAS real.

## Verificar e reproduzir localmente

Na raiz do repositório, Python 3.9+:

```sh
python scripts/orulo-national-v2.py verify orulo-national-v2
(cd orulo-national-v2 && sha256sum -c SHA256SUMS)
(cd orulo-national-v2/manifest && sha256sum -c manifest.sha256)
python scripts/orulo-national-v2.test.py
python scripts/orulo-national-v2.py build --input-dir orulo-national-v2/audit/inputs --output-dir /tmp/orulo-national-v2-rebuilt
cmp orulo-national-v2/manifest/national-v2.json /tmp/orulo-national-v2-rebuilt/manifest/national-v2.json
```

O diretório de saída deve ser novo ou vazio. O empacotador é offline, não importa cliente HTTP/banco, não possui modo de escrita e recusa promover candidatos a recuperáveis. Os documentos de entrada necessários à reprodução estão versionados em `audit/inputs/`. Os SQLs em `sql/` são consultas de leitura, não migrations. Para refazer a coleta, paginar `inventory.sql` por UUID e executar `recheck.sql`; qualquer diferença no fingerprint deve bloquear o novo pacote. Não reaproveitar hashes deste levantamento como baseline de escrita.

`SHA256SUMS` sela os artefatos de dados gerados pelo empacotador; `REVIEW-SHA256SUMS` sela também relatórios, SQLs e evidências de teste. Git fornece a referência versionada externa dos hashes; um arquivo de checksum isolado não é assinatura nem armazenamento WORM.

## Limitação de origem

As credenciais Órulo e `MIA_READ_TOKEN` existem na Vercel como Secret/sensitive. A conexão disponível retornou apenas metadados (`decrypted=false`, sem valor); o ambiente não tem essas credenciais configuradas. Nenhuma configuração foi alterada e nenhum segredo foi extraído por workflows.

O endpoint público `/api/development` foi inspecionado e amostrado em três empreendimentos. Ele pode usar fallback do Supabase e ainda declarar `floor_plans_source=orulo_api`. As 18 URLs retornadas tiveram HTTP 206 e assinatura binária válida via curl, mas isso não remove a ambiguidade de procedência. A primeira tentativa com outro agente HTTP recebeu 403; ambas as observações foram preservadas. Prefixos de 4 KiB foram verificados; não são hashes de imagens completas nem validação visual.

Para concluir, configurar acesso autenticado de leitura à Órulo neste ambiente ou fornecer um canal de diagnóstico existente que exponha origem e erros sem fallback silencioso. Configurar valores secretos pelas configurações seguras do ambiente, nunca no chat ou Git. Depois será necessário consultar os 2.667 empreendimentos candidatos, validar cada planta/URL/variante e construir novos patches e evidências, sem liberar escrita.
