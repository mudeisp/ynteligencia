# Órulo Media Recovery V1

Objetivo: auditar e recuperar imagens de plantas da Órulo sem alterar preço, estoque, tipologias, leads, Ads, SEO ou UX.

## Diagnóstico que motivou o trabalho

No snapshot de produção auditado em 02/11/2026, havia 7.035 empreendimentos Órulo ativos. 4.000 possuíam registros de plantas, mas 3.339 desses empreendimentos tinham plantas declaradas e zero imagem de planta armazenada. Dos 26.718 objetos de planta encontrados, 5.080 possuíam `image_url`.

O payload padrão de `/api/v2/buildings/{id}` pode trazer `floor_plans` com ID/descrição/associações sem dimensões de imagem. A recuperação usa o endpoint dedicado `/api/v2/buildings/{id}/floor_plans` solicitando `520x280`, `1024x1024` e `2280x1800`.

## Script

`scripts/orulo-media-recovery.mjs`

Por padrão é somente leitura/dry-run:

```bash
node scripts/orulo-media-recovery.mjs --states=SP,ES --limit=50
```

A saída informa, entre outros campos:

- empreendimentos com plantas declaradas;
- empreendimentos sem imagens antes da consulta ao vivo;
- empreendimentos recuperáveis;
- plantas e imagens armazenadas antes;
- plantas e imagens retornadas pelo endpoint dedicado;
- linhas que mudariam;
- falhas por building ID;
- lista dos empreendimentos recuperáveis.

A escrita exige RPC CAS instalada, lista explícita do Lote 1 (99 IDs, sem 86644) e ledger persistente novo. Consulte [liberação e rollback](orulo-media-cas.md). O comando abaixo é apenas para uma futura execução autorizada:

```bash
node scripts/orulo-media-recovery.mjs --states=SP --building-ids-file=scripts/orulo-media-recovery-lote1.ids.json --ledger=/caminho/persistente/lote1-cas-NOVO.jsonl --write
```

Mesmo no modo de escrita, somente `raw_data.building.floor_plans` é enriquecido e `updated_at` é atualizado. O restante de `raw_data` é preservado. O script não altera campos normalizados de preço, estoque, localização ou tipologia.

## Segurança operacional

1. Rodar primeiro em dry-run com `--limit` pequeno.
2. Conferir `buildingsRecoverable`, `planImagesReturnedLive` e `failures`.
3. Testar manualmente casos-controle, incluindo Mandarim The Legend (`building_id=46939`).
4. Só depois liberar escrita CAS restrita aos 99 IDs autorizados, com ledger persistente e snapshots V2.
5. Revalidar LPs no `www.yincorp.com.br` após a atualização.

## Vídeos e tour virtual

Este V1 não inventa nem busca vídeo em fontes externas. Vídeos e `virtual_tour` continuam sendo medidos no snapshot do payload Órulo para distinguir ausência na fonte de falha de renderização. A recuperação automática deste V1 é restrita a imagens de plantas, porque existe endpoint Órulo específico e já conhecido para elas.

