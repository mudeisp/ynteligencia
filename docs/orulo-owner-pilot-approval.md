# Aprovação do piloto pelo proprietário, sem endpoint novo

O método mais simples continua sendo o **SQL Editor autenticado do Supabase**.
Uma interface adicional exigiria um backend administrativo com identidade de
administrador do banco. Não é necessário criá-lo: não há endpoint público, token,
credencial nova ou concessão a anon/authenticated/service_role neste PR.

## Reconciliação realizada

GitHub run 41832262256 terminou completed/failure na main, tentativa 1, commit
628b9ae4d3255871b0c5412cd815c66bf850428a. Run UUID
26556e29-7a3b-450e-9169-3f894f231077 tinha exatamente START, CLIENT_READBACK/PILOT_PLAN
com 18 UUIDs do 43126, e CLIENT_STOP com confirmedRows=0. Não havia autorização,
INTENT, CAS_RESULT, baseline ou readback. A cadeia SHA-256/canonical foi conferida.

O procedimento específico `supabase/orulo_reconcile_41832262256.sql`, testado em
banco sintético, foi executado administrativamente sob autorização do proprietário:
somente ABORTED (sequência 4) foi acrescentado. Os três eventos anteriores ficaram
iguais. Novo head:
`bb299e56a2c6af82c560dbd0dae9920e3234e0302eb8f930664cd551f2864a57`.
Repetir o procedimento é rejeitado. Não reutilizar Run ID nem UUID antigos.

Após a reconciliação, não há run aberto, INTENT pendente ou CAS dessa execução.
Os 18 UUIDs atuais continuam iguais aos do plano anterior. Isso é evidência de
escopo, não uma autorização para o próximo plano.

## Próxima execução (somente pelo proprietário; não disparada nesta tarefa)

1. Revisar/integrar explicitamente este PR, caso deseje o comando preenchido e os
   contadores apresentados automaticamente. Atualizar ORULO_PILOT_APPROVED_SHA
   para o commit integrado e revisado. Nenhuma variável foi alterada nesta tarefa.
   O gate continua exigindo main, mudeisp/323805541, tentativa 1, Environment
   orulo-lote1 sem bypass administrativo e política exclusiva de branch main.
   O gate dessa proteção passou na execução anterior; ele revalida a configuração
   antes de qualquer acesso a credenciais em uma tentativa futura.
2. **Antes** de disparar, abrir e autenticar o
   [SQL Editor do projeto](https://supabase.com/dashboard/project/wzaegidwtdjuhqchpdpd/sql/new)
   como proprietário/administrador. Deixar a aba pronta, sem executar comandos.
3. Abrir o [workflow piloto](https://github.com/mudeisp/ynteligencia/actions/workflows/orulo-pilot-manual.yml),
   escolher **Run workflow**, branch **main**, e iniciar uma execução NOVA.
   Não usar Re-run jobs. Só o building 43126 permanece no código/autorizações.
4. Entrar no job **pilot**, abrir a etapa **Plan one building, await private admin
   authorization, then fresh baseline and audited CAS** e acompanhar os **logs ao vivo**.
   O bloco “confirmação administrativa pendente” apresenta Run ID/UUID, commit,
   building, UUIDs, quantidade de imagens candidatas (ocorrências nos registros),
   URLs distintas e hash do plano. Revise tudo antes de prosseguir.
   Não aguarde o Step Summary: o GitHub pode publicá-lo apenas depois do término
   da etapa, quando a janela já teria acabado. Ele serve como recibo posterior.
5. Confirmar que o run ainda está em andamento e aguardando autorização. Copiar
   somente o bloco SQL já preenchido dos logs para o SQL Editor. **Clicar Run no
   SQL Editor é a confirmação explícita do proprietário.** Nenhuma formatação,
   resumo ou consulta de status emite WRITE_AUTHORIZED automaticamente.
6. O bloco bloqueia o run e exige que o head ainda seja aquele PILOT_PLAN, do
   building 43126, criado há no máximo dez minutos; só então chama a função
   privada existente `orulo_audit.authorize_pilot` com UUID/head/Run ID/commit
   exatos. Planos fechados, substituídos, antigos ou já autorizados são rejeitados.
   A função mantém o escopo/UUIDs, permissões e validade de 30 minutos. O executor
   só continua após verificar a autorização e capturar baseline fresco.

Se a janela terminar, não tentar autorizar o plano antigo. Esperar o encerramento,
reconciliar o ledger e preparar um novo run sob nova autorização do proprietário.
Em caso de commit ambíguo da própria autorização, ler o ledger antes de qualquer
repetição. Não usar o conector para contornar uma rejeição de autorização.

Não existe agora um novo plano ativo: esta tarefa foi explicitamente proibida de
disparar outro workflow. Portanto, não há novos identificadores para preencher um
comando real neste momento. Eles serão apresentados automaticamente nos logs da
próxima execução autorizada, sem inventar ou reutilizar identificadores antigos.

## Testes e limites

O teste sem autorização verifica: zero CAS, hash completo dos imóveis inalterado,
START/PLAN/STOP duráveis, reconciliação ABORTED preservando todos os eventos,
e rejeição de reconciliação repetida. Os testes do comando verificam que gerar ou
exibir SQL não autoriza, que a execução administrativa explícita usa a função
existente e que head antigo/identificador inválido/reutilização são rejeitados.
CAS, RLS, ACL, tempos de espera/validade, manifesto e escopo não foram alterados.

Nenhum workflow novo, WRITE_AUTHORIZED, imóvel/imagem, credencial, backfill ou
liberação dos outros 98 empreendimentos foi executado nesta tarefa. Não houve
merge automático. A única escrita de produção foi o evento ABORTED autorizado.
