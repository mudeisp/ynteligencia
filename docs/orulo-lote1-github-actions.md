# Órulo Lote 1: preparação manual protegida no GitHub Actions

## Decisão e infraestrutura

GitHub Actions já está ativo neste repositório público. Environments com revisão e branches selecionadas podem proteger o job manual. O conector usado nesta sessão não permite consultar os endpoints administrativos de Environments/self-hosted runners; essas configurações existentes NÃO foram presumidas presentes. O workflow verifica as regras pela API durante o futuro dispatch e falha se não conseguir verificá-las.

Não foi identificado um armazenamento durável aprovado e configurado para este fluxo. A solução proposta usa **runner hospedado do GitHub + bucket S3 privado/versionado + role AWS via OIDC**. Isso evita manter um runner self-hosted em repositório público e não precisa de chave AWS permanente. Pode reutilizar bucket/role adequados existentes; se não existirem, o proprietário deve provisioná-los. Nenhum serviço, bucket, role, segredo ou Environment foi criado por esta alteração. Há custos normais do S3 e de Actions conforme a conta; não foi contratado serviço automaticamente.

São necessárias três novas entradas no GitHub Environment, com as credenciais existentes fornecidas privadamente pelo proprietário. As variáveis sensitive da Vercel não são herdadas pelo GitHub e não serão extraídas de lá pelo Codex.

**Estado inicial: BLOQUEADO.** Sem a variável ORULO_STORAGE_READY=true, o dispatch falha antes do job com OIDC/segredos. Mesmo após configuração e pré-flight bem-sucedido, este PR NÃO contém passo de escrita/backfill: o resultado informa writeEnabled=false. Não há input de execução, comando arbitrário, SHA ou lista de buildings. Habilitar escrita posteriormente exige autorização e revisão próprias, usando o runner aprovado e o journal durável; não basta alterar uma variável.

## Fluxo preparado

- `.github/workflows/orulo-lote1-manual.yml`: somente workflow_dispatch; nenhum push, PR, cron, webhook ou rota pública executa o fluxo operacional.
- Controle/guards: checkout do SHA do próprio workflow revisado, apenas em refs/heads/main. O código de origem aprovado é outro checkout, fixado em `2fa6ec8b093346e1a2319e4c6833cdfb0c52825e`, sem executar código arbitrário desse checkout no pré-flight.
- Node 22. Actions fixadas por commit; checkout não persiste credenciais.
- Environment `orulo-lote1`: reviewer obrigatório, impedir autoaprovação, não permitir bypass administrativo, única branch main (não tag).
- Grupo de concorrência fixo `orulo-lote1-production`, cancel-in-progress=false. Futuro workflow de escrita deverá usar esse mesmo grupo; nenhuma outra execução operacional deve ocorrer fora dele.
- Reruns (run_attempt>1) são rejeitados. Uma tentativa futura precisa de novo dispatch, novo prefixo e reconciliação de qualquer tentativa incerta.
- Manifesto imutável: 99 IDs, sem 86644; SHA256 canônico `1c8b002b5a3b4b6caf614e3b4e6d84383b8e306ae2773f3d7de48cc7daaa6d03`.
- O job protegido recebe apenas as três variáveis necessárias pelo gestor de secrets do GitHub. Somente booleanos de presença entram no relatório/journal; não se imprime valor, tamanho, ambiente completo ou token.
- O pré-flight testa armazenamento remoto com canário, readback de versão/checksum e evento READ_ONLY_PREFLIGHT. Não autentica no Órulo, não consulta baseline real no Supabase e não chama CAS ou backfill.

## Durabilidade: por que artifacts não bastam

Arquivos temporários e upload-artifact no final não asseguram que INTENT sobreviva a uma interrupção entre a mutação e o upload. A cópia canônica proposta é S3, em objetos STANDARD privados com SSE-S3 AES256, versionamento e gravação condicional If-None-Match: *.

Prefixo fixo:
`orulo-lote1/2fa6ec8b093346e1a2319e4c6833cdfb0c52825e/<run_id>-1/`

Estrutura:
- `start.json`: criação exclusiva; impede reaproveitar execução.
- `storage-probe.json`: canário do pré-flight, sem dados comerciais/credenciais.
- `baseline-v2.jsonl`: reservado para baseline real imediatamente anterior a uma futura escrita autorizada; não é criado vazio pelo pré-flight.
- `ledger/000000000001.jsonl`, `ledger/000000000002.jsonl`, ...: cada objeto é uma linha JSONL, com os campos originais do evento no nível principal e `_journal` contendo sequência/hash anterior.
- `readback-v2.jsonl`: reservado para futura reconciliação, não criado neste PR.

`openDurableJournal` só resolve record(event) depois do ACK remoto com VersionId real e checksum SHA256 correspondente. A confirmação do INTENT precisa anteceder qualquer CAS. Falha/timeout/ACK inválido congela o journal; não há retry nem tentativa automática de completar uma operação incerta. Chamadas concorrentes também congelam os dois chamadores. Os arquivos locais usados pela AWS CLI são apenas scratch de transporte, privados e removidos; nunca são a única cópia do ledger.

O JSONL consolidado é uma visualização derivada: para obtê-lo, baixar os shards ordenados pelo número e concatenar as linhas sem remover campos. Os receipts CAS e o formato dos eventos originais são preservados. A origem auditável continua sendo os objetos versionados e a cadeia de hashes, mesmo que o job não finalize.

Não há prova de durabilidade real nesta sessão: os testes usam S3 simulado. O workflow fica bloqueado até o proprietário configurar o armazenamento e executar o pré-flight privado. A declaração ORULO_STORAGE_READY não substitui a verificação real de privacidade/versionamento/encriptação/ACK/readback.

## Configuração pelo proprietário — sem enviar valores ao Codex

### 1. GitHub Environment e controles

Em `https://github.com/mudeisp/ynteligencia/settings/environments`:

1. Criar Environment **orulo-lote1**.
2. Configurar Required reviewers (ao menos uma pessoa/equipe habilitada diferente de quem fará o dispatch).
3. Ativar **Prevent self-review** e desabilitar **Allow administrators to bypass configured protection rules**.
4. Deployment branches and tags: **Selected branches and tags**, adicionar exclusivamente **branch main**, sem tags ou wildcard. A API deve listar exatamente essa política.
5. Restringir acesso de escrita/dispatch no repositório às pessoas autorizadas. Não conceder credenciais de produção a workflows de PR.

O GITHUB_TOKEN automático consulta apenas metadados de proteção, com contents/actions/deployments read. Se a API responder 403/404 ou os campos não comprovarem as regras, o workflow falha. Não contornar esse gate nem fornecer um PAT ao Codex; o administrador deve resolver o acesso/controle suportado pela conta antes de liberar o fluxo.

### 2. Credenciais privadas

Na página do Environment, em **Environment secrets**, usar **Add environment secret** para criar exatamente:

- ORULO_CLIENT_ID
- ORULO_CLIENT_SECRET
- SUPABASE_SECRET_KEY

O proprietário obtém os valores do cofre/origem já autorizado e os insere diretamente na interface privada do GitHub. Não usar issue, comentário, PR, arquivo .env versionado, log, chat, artifact ou comando com o valor literal. Não copiar variáveis Vercel por ferramentas do Codex. Essas são novas entradas de armazenamento no GitHub, não novos tokens dos provedores.

Não criar AWS_ACCESS_KEY_ID ou AWS_SECRET_ACCESS_KEY no GitHub: AWS usa OIDC e credenciais temporárias emitidas somente para o job aprovado.

### 3. Bucket durável privado

Na conta AWS aprovada, criar ou reutilizar um bucket S3 **general purpose**, com:

- Todos os quatro controles **Block Public Access** ativados.
- Versioning **Enabled** e encriptação padrão SSE-S3 **AES256**.
- Object Ownership: Bucket owner enforced; sem ACL pública.
- Sem expiração/lifecycle do prefixo durante a janela de auditoria aprovada; não usar artifacts de Actions como retenção substituta. Restringir administradores de bucket conforme a política da organização.
- Bucket policy que negue transporte sem TLS e gravações PutObject sem `If-None-Match: *` no prefixo aprovado. Não conceder DeleteObject/DeleteObjectVersion à role do job.

Esse bucket armazena evidências do inventário: deve permanecer privado. Escolher a região e retenção antes de ativar o workflow; esta alteração não cria recursos AWS.

### 4. OIDC e role de privilégio mínimo

Cadastrar/reutilizar o provedor IAM OIDC **https://token.actions.githubusercontent.com**, audience **sts.amazonaws.com**. Criar role dedicada, sem outras políticas amplas, com trust policy (substituir somente ACCOUNT_ID):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"},
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {"StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:mudeisp/ynteligencia:environment:orulo-lote1"
    }}
  }]
}
```

Política da role (substituir BUCKET; manter o prefixo/SHA):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketVersioning", "s3:GetBucketPublicAccessBlock", "s3:GetEncryptionConfiguration"],
      "Resource": "arn:aws:s3:::BUCKET"
    },
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::BUCKET/orulo-lote1/2fa6ec8b093346e1a2319e4c6833cdfb0c52825e/*",
      "Condition": {"StringEquals": {
        "s3:if-none-match": "*",
        "s3:x-amz-server-side-encryption": "AES256"
      }}
    },
    {
      "Effect": "Allow",
      "Action": "s3:GetObjectVersion",
      "Resource": "arn:aws:s3:::BUCKET/orulo-lote1/2fa6ec8b093346e1a2319e4c6833cdfb0c52825e/*"
    }
  ]
}
```

A role usa a credencial efêmera OIDC do GitHub. Não criar chave AWS permanente. Configurar bucket policy/controles pelo administrador da AWS; não dar ao job permissões de administrar ou apagar o armazenamento. O administrador de auditoria pode ter acesso separado de leitura/listagem para reconciliar shards, sem ampliar o job.

### 5. Variáveis não secretas

No **Environment orulo-lote1**, adicionar como Variables (não Secrets):

| Nome | Valor |
| --- | --- |
| ORULO_AWS_ROLE_ARN | ARN da role dedicada acima |
| ORULO_AWS_ACCOUNT_ID | ID numérico de 12 dígitos da conta proprietária do bucket |
| ORULO_AWS_REGION | Região do bucket, por exemplo us-east-1 |
| ORULO_AUDIT_BUCKET | Nome do bucket privado |

Somente após configurar Environment, role e bucket, definir em **Repository settings → Secrets and variables → Actions → Variables**:
**ORULO_STORAGE_READY=true**. Deixar ausente/false enquanto não houver armazenamento confiável. É uma confirmação de provisionamento, não habilitação de escrita.

### 6. Dispatch futuro, sem backfill

Após revisão e merge feitos pelo proprietário, abrir **Actions → Orulo Lote1 manual read-only preflight → Run workflow → main**. Aprovar o Environment com o reviewer autorizado. O Codex não disparou esse workflow nesta alteração.

O único resultado possível de sucesso é READ_ONLY_PREFLIGHT_PASSED com writeEnabled=false, presença booleana das três variáveis e canário/journal confirmados no S3. Isso NÃO testa autenticação nos provedores nem captura baseline comercial real. Não clicar em Re-run após erro; reconciliar evidência remota e, se apropriado, emitir novo dispatch revisado.

A escrita continua fora deste workflow. Só preparar a etapa operacional em autorização posterior, mantendo checkout fixo, journal remoto como record callback antes de cada RPC, baseline V2 fresco, manifesto imutável e mesmas paradas CAS. Não usar uma etapa que grave ledger local para subir ao final. Não iniciar Lote 2.

## Testes e limites da entrega

- `node scripts/orulo-media-recovery-actions.test.mjs`: 16 testes sem rede/secrets reais.
- `npm test --prefix test-support/orulo-cas`: inclui esses testes e os 43 já existentes no CI isolado.
- Validam aprovação/ref/attempt, infraestrutura ausente, manifesto/SHA, ACK e readback, perda de ACK depois da persistência, não reutilização, concorrência de appends, INTENT remoto antes de CAS simulado e falha de INTENT impedindo CAS.
- Testes unitários não substituem um pré-flight real do bucket/Environment. APIs administrativas de infraestrutura não puderam ser auditadas pelo conector; proprietário ainda precisa provisionar e comprovar esses controles.

Nenhum backfill, flag de escrita operacional, mutação de imóvel, merge, deploy ou serviço AWS foi executado/criado nesta entrega.
