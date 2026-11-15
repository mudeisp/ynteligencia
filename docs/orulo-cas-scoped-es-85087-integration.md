# Integração CAS Órulo — execução pontual com auditoria (Brettas 85087)

**Status: DESENHO / SEM MIGRATION OU ESCRITA.** O presente arquivo não autoriza alteração de produção, abertura de permissões nem execução de CAS.

## Diagnóstico verificado em produção (2026-11-15)

- `public.properties` tem três tipologias Órulo `orulo:85087:133473`, `orulo:85087:133475`, `orulo:85087:133476`.
- Cada linha inclui seis objetos em `raw_data.building.floor_plans` (IDs `2727331` a `2727336`), com descrições mas **sem URLs de imagens**.
- `orulo_audit.cas_core` é restrito a `state='SP'` e a uma lista explícita de `building_id`: **não utilizar para ES** e **não ampliar a allowlist global para contornar a proteção**.
- `orulo_audit.national_cas` exige `NATIONAL_TARGET`, manifesto selado, baseline, autorização/lease vigente e `INTENT` durável. A execução nacional congelada `1c8ec62a-9c38-41ac-8091-f1ceef98ca91` está na sequência 6240, com 5.684 alvos, nenhum `NATIONAL_MANIFEST_SEALED`, nenhuma `WRITE_AUTHORIZED`, nenhum `CAS_RESULT`; **nenhum alvo tem `buildingId=85087`**.
- PR #125 implementa apenas verificador de selo em modo leitura e permanece não implantável.

## Objetivo

Recuperar **somente campos de imagens dos seis objetos existentes** para as três linhas de Brettas, utilizando URLs originais comprovadas de uma fonte Órulo autorizada. Não adicionar plantas, alterar IDs, ordem, unidades, preços, disponibilidade, datas, estados, fotos de galeria ou regras do portal.

## Contrato da integração pontual

1. **Fonte e prova:** buscar mídia do fornecedor por canal autenticado e autorizado; determinar o URL por ID; confirmar resposta 200, conteúdo de imagem válido, MIME/assinatura, bytes e hash. Não criar URLs por convenção nem copiar de terceiros. Capturar evidência imutável por ID.
2. **Plano fechado:** exibir ao operador o `buildingId`, exatos três UUIDs e seis IDs, imagem anterior/seguinte, hash do registro completo, URLs e provas. Congelar o plano; proibir modificações fora das chaves permitidas de imagem.
3. **Gate de escrita:** operação separada, assinada pelo proprietário, escopo `buildingId=85087` + UUIDs exatos, expiração curta, vínculo a digest do plano e SHA revisado. Nenhuma autorização por query string, navegador ou payload declarativo do cliente.
4. **Baseline durável:** registrar antes da gravação hashes completos dos três registros e das colunas relevantes; conferir que não há execução concorrente e que o registro segue elegível.
5. **INTENT pré-commit:** inserir intent no ledger privado e **confirmar transação antes** de efetuar o CAS; uma operação por UUID. Recusar retry cego se houver queda de conexão.
6. **CAS transacional:** função nova pontual, `SECURITY DEFINER` com `require_service()`, `lock_run()`, `SELECT ... FOR UPDATE`, comparação exata de `to_jsonb(public.properties)` com o esperado e verificação da allowlist específica. Alterar apenas `raw_data.building.floor_plans[*]` nas chaves de imagens autorizadas. Criar `CAS_RESULT` atômico com o update. Qualquer divergência: rollback completo.
7. **Readback e reconciliação:** ler cada linha após o commit, conferir SHA, IDs, ordem, campos preservados e imagens retornando bytes válidos; registrar prova em ledger. Em conflito ou incerteza: interromper, leitura e reconciliação; nunca forçar.
8. **Portal:** a página já renderiza imagens que vierem em `floor_plans`; verificar no preview e produção somente após readback. Não alterar tracking ou modelos de dados.

## Isolamento do nacional

- Não reutilizar UUID nacional, targets ou lease da execução 43003536521.
- Não chamar `national_cas` com IDs que não estão no manifesto congelado.
- Não alterar `national_control`, `national_seal`, PR #125, nem a lógica global de escrita enquanto sua reconciliação estiver bloqueada.
- Implementar função nova isolada ou **nova execução pontual** após revisão técnica e aprovação explícita de migration, gate, plano e gravação. Analisar conflitos entre esse write e futuras reconciliações nacionais antes de autorizar.
- Não alterar política RLS nem conceder EXECUTE a `anon`, `authenticated` ou cliente web.

## Critérios de aceitação obrigatórios

- PostgreSQL isolado: sucesso em 3 linhas e seis IDs; execução repetida, desordem ou alteração não permitida falham.
- Testes negativos: troca de preço/estoque, diferença de hash, URL inválida/redirect, MIME inválido, IDs extras, outra UF, outros imóveis, autorização vencida, concorrência e queda após INTENT/CAS.
- Ledger: uma única cadeia de eventos consistente e comprovadamente recuperável após falha.
- Preview do portal: as seis plantas reais são exibidas com identificação correta.
- Rollback da **nova** migration testado sem afetar histórico ou funções nacionais.
- Revisão de segurança, plano de reversão e autorização separada antes de produção.

## Situação atual

**Bloqueado na aquisição de seis mídias verificadas da Órulo e na ausência de executor CAS pontual autorizado para ES.** Nenhuma gravação foi efetuada. A implementação deve ocorrer em PR separado de código/migration, antes de aprovação de execução.
