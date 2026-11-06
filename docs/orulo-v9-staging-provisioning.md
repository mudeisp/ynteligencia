# V9 — projeto independente e ensaio staging

Estado desta entrega: preparação executável, **sem projeto criado**. CI descartável não é staging. O projeto de destino deve chamar-se `ynteligencia-v9-staging`; a organização escolhida pelo proprietário é `xtqvxxncxirpujvxznly` (`yinteligencia`). Nunca usar `wzaegidwtdjuhqchpdpd` ou `bgggafirdjvxihqselha`.

## Cotação e bloqueio de provisionamento

Em 2026-11-06, o conector autenticado retornou plano `free`, dois projetos ativos e `get_cost(type=project)` com **amount=0, recurrence=monthly** para essa organização. O proprietário autorizou a cotação, **não a criação ou cobrança**. `create_project` e `confirm_cost` não foram chamados.

A [documentação de billing](https://supabase.com/docs/guides/platform/billing-on-supabase) limita o Free a dois projetos ativos, inclusive entre organizações do mesmo proprietário. A cotação de US$ 0/mês não comprova vaga para o terceiro projeto. Não pausar, apagar ou transferir os existentes para contornar a quota. Não alterar o plano da organização, pois o plano/billing é compartilhado por seus projetos.

Se o fornecedor exigir upgrade, obter nova cotação e autorização específica. Referência pública, **não cotação contratual**: [Pro parte de US$ 25/mês e Micro de US$ 10/mês, com US$ 10 de crédito compute por organização](https://supabase.com/pricing). Três projetos Micro em Pro somariam aproximadamente US$ 45/mês para a organização inteira, antes de excedentes, câmbio e impostos. Isso seria uma mudança no faturamento dos projetos existentes e **não está autorizada**. A proposta atual limita-se a um projeto independente sem upgrades/add-ons.

Proposta revisável: nome acima, mesma organização, região sugerida `us-east-2`, menor compute elegível, sem PITR, domínio, IPv4 pago ou log drain. Recursos de banco, Auth, Storage, credenciais e consumidores devem ser novos e independentes; compartilhar apenas organização/billing não prova isolamento. Não criar branch de produção nem restaurar backup de produção.

## Procedimento após autorização e disponibilidade

1. Confirmar custo/quota; obter autorização explícita para provisionar. Se qualquer custo/upgrade for diferente do aprovado, parar. Registrar o ref realmente retornado pelo fornecedor; não preencher ref por estimativa.
2. Guardar evidência de `get_project` (id/name/organization_id/database.host/status) e confirmar projeto novo, sem réplicas/FDW/dblink/publicações/consumidores, webhooks comerciais ou buckets compartilhados. Não copiar environment variables, service keys, OAuth Órulo ou inventário.
3. Preencher uma cópia de `test-support/orulo-v9-staging/target.example.json` somente após essa revisão. O guard exige nome/ref/host/org, evidência do fornecedor e referência à autorização; o template é deliberadamente inexequível. O arquivo é configuração de teste, não um novo ledger ou autorização de recuperação. A evidência local não substitui a consulta autenticada ao fornecedor.
4. Conectar ao **novo** host com CA revisada e `verify-full`. Inspecionar schema vazio, versão, default ACLs, roles e RLS. Aplicar somente `schema.sql` e os três arquivos listados em `bootstrap-manifest.json`, conferindo SHA256 antes. A fixture cria somente `public.properties`, sem dados, sem TRUNCATE e sem alterar roles de sistema Supabase. Os migrations existentes criam o journal e snapshots; não se importam runs/recibos/autorizadores/lotes históricos.
5. Criar senhas distintas e novas para os dois logins; usar `password_encryption=scram-sha-256`, `\password` em terminal seguro e habilitar LOGIN apenas em `orulo_webhook_writer` e `orulo_provenance_reader`. Não habilitar LOGIN nos proprietários de funções. Não conceder memberships entre identidades ou DML direto. O admin também usa credencial exclusiva desse projeto. Não imprimir senhas nem enviar SQL com senha em relatórios.
6. Instalar somente o driver de testes travado: `npm ci --prefix test-support/orulo-v9-staging --ignore-scripts --no-audit --no-fund`. `pg` e transitivos estão fixados no lockfile; nenhum driver ou conexão foi adicionado ao entrypoint de produção.
7. Fornecer ao processo local, por canal seguro, `V9_STAGING_ADMIN_PASSWORD`, `V9_STAGING_WRITER_PASSWORD`, `V9_STAGING_READER_PASSWORD` e `V9_STAGING_CA_FILE`. Não usar DSN: SSL/query params de URLs podem substituir opções de TLS no node-postgres. O runner usa host explícito do manifesto, CA, `rejectUnauthorized=true` e hostname verificado; ignora PGHOST/PGDATABASE ambientes.
8. Executar `node scripts/orulo-v9-staging-validate.mjs /caminho/target-revisado.json`. O runner **não cria projeto, não aplica migrations e não configura logins**. Recusa os refs de produção e dados fora da fixture; só então realiza escritas sintéticas em IDs reservados dessa execução. Não removê-los automaticamente: conservar evidências para revisão.

## O que o ensaio comprova

O teste usa o driver `pg.Pool` real, o adapter transacional e o handler existentes, um endpoint HTTP de entrada em loopback com HMAC efêmero, e uma fonte HTTP sintética local. O transporte de fonte é injetado apenas por código servidor; não há input HTTP/env que altere a fonte do portal. Sem injeção, os wrappers e `withOruloFloorPlans` continuam usando o fetch existente.

Verifica SCRAM observado no protocolo real, assinatura SASL final validada pelo driver, TLS autorizado no cliente e ativo no servidor, senha inválida rejeitada com SQLSTATE 28P01, isolamento dos papéis, concorrência entre conexões, rollback de imóvel/recibo, descarte de sessão quebrada, reconexão e reset de sessão. O wrapper candidato executa ROLLBACK/DISCARD ALL no checkout/devolução e descarta conexão insegura; nunca repete a mutação. O transporte de produção continua desativado.

O gateway HTTP de teste recusa assinatura ausente e building fora da fixture. A fonte fornece uma imagem PNG sintética identificada por plan/building/URL e SHA256, preserva vídeo/tour da fixture e permite injetar resposta de building ou mídia divergente. **Não comprova autenticação real de webhooks Órulo, validade de plantas reais, nem semântica de eventos de produção**. Nenhuma chamada real à Órulo é feita. Um teste com fixtures não é uma autorização para expor o gateway publicamente.

São medidos, em no máximo 100 amostras (padrão 20), p50/p95 HTTP fim a fim, número de novos recibos, variação física da relação e tamanho médio de tuple. O JSON e seu SHA256 não contêm DSN, senha, token, CA privada ou chave HMAC. Resultados em CI sempre dizem `CI_DISPOSABLE_VALIDATED_NOT_STAGING`; em uma base staging comprovada, o resultado positivo continua `STAGING_TESTS_PASSED_PENDING_REVIEW`. A classificação final exige revisão das provas e dos itens ainda ausentes.

## Retenção e capacidade propostas

- Não há purga automática. O append-only e as restrições do journal permanecem ativos. Não desabilitar triggers para manutenção.
- Manter todos os recibos enquanto qualquer run/snapshot que cubra sua janela estiver aberto, incerto, em investigação, com reconciliação pendente ou hold administrativo. Não presumir que ABORTED seja reconciliação suficiente. Não aplicar retenção retroativa aos históricos existentes.
- Depois de reconciliação comprovada, propor mínimo de 90 dias de acesso online, prorrogado por holds. Este prazo é política proposta para aprovação, **não um DELETE agendado**.
- Arquivar somente após revisão separada: exportação canônica com UUID/txid/intervalo de transition IDs, contagem, hashes, run/snapshot references e SHA256 do artifact; verificar readback e restauração integral da cadeia. Usar armazenamento privado, acesso mínimo e chaves independentes. Nenhum bucket ou serviço foi criado nesta etapa.
- A exclusão online só poderia ocorrer após prova de restauração, ausência de referências/holds e mudança administrativa especificamente revisada. Até haver esse procedimento implementado e autorizado, conservar online e bloquear novos testes se faltar capacidade.
- Para dimensionamento, calcular `transições/dia × bytes médios observados × dias × fator de margem >=2`, somar snapshots, índices, TOAST, WAL e margem fixa. Não converter tuple bytes diretamente em cobrança ou capacidade de produção. Medir em staging com payloads sintéticos representativos antes de aprovar escala.
- Alertas propostos em 70% e 85% do orçamento de disco. Em 85%, interromper novas escritas de ensaio, preservar recibos e diagnosticar; nunca apagar prova para o teste continuar. A quota/disco efetivamente contratada deve constar no relatório antes de qualquer projeção.

## Critério de saída

Só considerar `STAGING_VALIDATED` com projeto realmente criado/autorizado/isolado, HEAD conferido, migration executada ali, autenticação/pool/HTTP/mídia sintética/concorrência/rollback bem-sucedidos e medições/retention revisadas. CI não preenche esses campos. Credenciais e validação do remetente/fonte reais, freshness de `updated_at`, retenção operacional e qualquer liberação de `STRICT_GLOBAL_V1` continuam decisões separadas; este preparo não autoriza merge, produção ou recuperação.
