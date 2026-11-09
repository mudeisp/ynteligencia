# Órulo Nacional V2 — revisão do workflow e instalação do pacote original

**Pronto para revisão do código; NO-GO para acionamento nacional neste momento.** Os testes locais e a integridade do pacote passaram. A existência e o acesso do perfil PostgreSQL de produção ainda não foram comprovados. Nenhum workflow nacional foi acionado, nenhuma credencial foi revelada e nenhuma configuração remota foi alterada.

## Pacote original instalado

Foi extraído em diretório temporário o mesmo arquivo validado de 8.275.989 bytes, SHA-256 `7b640ea79e06fc304fc0ffe5d53cc77937e9fe1640f4d62f79e7d4cbe9688809`. A comparação usou a branch remota `audit/orulo-national-v2` em `0c3cae0beb315a45adabf584c76c1502e8acfe0e`.

O arquivo original contém 383 arquivos do repositório. Na branch remota faltavam 28 arquivos operacionais; três arquivos de documentação/checksums tinham a versão anterior ao pacote. Todos os 383 arquivos locais correspondem byte a byte ao pacote extraído, inclusive esses três arquivos restaurados. Os 381 checksums internos, `REVIEW-SHA256SUMS`, hashes de manifesto e fila foram conferidos sem recalcular ou substituir os contratos originais.

- Manifesto: `f94cf3139fa2516d55b98c0e242c64193107f0f65be924f36c936dc7952ab070`.
- Fila: `b6726aa08aca9673e4d76d10e405b071682b1c8ed88a8ce93a934392b814f11e`.
- Os 56 arquivos de referência do protocolo permanecem idênticos ao pacote.
- Workflow V4, circuitos anteriores, migrations, catálogo, funções CAS, manifesto, fila e scripts originais não foram modificados.

## Único workflow V2

O arquivo existente `.github/workflows/orulo-national-v2-readonly.yml` foi revisado; nenhum segundo workflow nacional foi criado.

O job sem segredos verifica o pacote original, executa os testes originais e os novos testes de dependências. Node.js 22 e as ações checkout/setup-node/upload-artifact usam referências por SHA; a dependência PGlite usa o lockfile original.

O job nacional continua restrito a `workflow_dispatch`, `main`, proprietário `mudeisp`, ID `323805541`, triggering actor proprietário e primeira tentativa. Exige o job de verificação, igualdade de `github.sha` e `github.workflow_sha`, checkout desse SHA e o ambiente protegido `orulo-lote1`. A política remota observada do ambiente permite somente a branch `main`; ela não foi alterada.

O job protegido referencia os mesmos nomes `ORULO_CLIENT_ID` e `ORULO_CLIENT_SECRET`. Antes de qualquer consulta à Órulo, o workflow verifica as variáveis necessárias e o perfil libpq. Só então chama o runner original, sem alterar argumentos ou implementar outro circuito:

```bash
bash scripts/orulo-national-operational-readonly.sh --service orulo_v2_readonly --output-dir "$RUNNER_TEMP/orulo-national-v2-output"
```

O helper novo `scripts/orulo-national-v2-pg-preflight.py` é exclusivamente uma verificação de dependência do workflow, não um exportador ou mecanismo de recuperação. Ele valida identidade do projeto no host/usuário do perfil, TLS, ausência de aliases de conexão não verificados e uma resposta libpq a uma pequena transação `BEGIN READ ONLY`. Essa consulta verifica permissão de SELECT, colunas necessárias e visibilidade sem RLS ativa. Uma visibilidade limitada por RLS permanece bloqueada como escopo nacional não comprovado; o helper não muda roles, grants, RLS ou políticas.

Erros de conexão são convertidos em códigos fixos: não se imprime o perfil, senha, stdout inesperado ou stderr de libpq. Os arquivos temporários de credencial usam permissões restritas e são removidos em `always()`. O upload foi limitado a resumos diagnósticos; perfis, senhas, respostas da fonte e linhas integrais dos imóveis não são enviados como artefatos públicos.

## Conexão PostgreSQL: evidência disponível e limite

O contrato original do exportador é `psql service=<nome> -X -qAt -v ON_ERROR_STOP=1`, recebendo SQL por stdin. Ele precisa de um perfil libpq e autenticação PostgreSQL, com o mesmo conjunto de dados e sem filtro RLS não comprovado.

Os nomes `ORULO_V2_PG_SERVICE_CONF`, `ORULO_V2_PGPASS` e serviço `orulo_v2_readonly` já estavam no workflow V2 encontrado. **Isso não comprova que os segredos existam ou que a conexão funcione.** A API do GitHub negou, com HTTP 403, a listagem de segredos do ambiente, de segredos do repositório e de variáveis. Não foram tentadas extrações de valores nem alterações de permissões.

A busca nos workflows e scripts anteriores encontrou conexão `psql` em testes sintéticos (`127.0.0.1`, banco `orulo_audit_test`), não uma conexão de produção reaproveitável. O executor histórico chamado de PostgreSQL também usa RPCs via PostgREST em parte de seu transporte; essa interface não implementa o contrato libpq do exportador.

Não foi possível identificar, nas fontes acessíveis, uma conexão PostgreSQL de produção já utilizada e comprovadamente compatível. `SUPABASE_SECRET_KEY` é um token da interface HTTP, não um perfil/senha libpq. Não foi usado, convertido ou aceito como substituto. O teste desse caso deve falhar antes da conexão.

## Evidências locais

Os resultados estão em `docs/orulo-national-v2-workflow-validation/` e no relatório JSON adjacente:

| Verificação | Resultado medido |
|---|---|
| Regressões originais do protocolo | 153 PASS, 0 falhas |
| Coletor/simulador e SQL read-only originais | 16 PASS, 0 falhas |
| Exportador original | 4 PASS |
| Empacotador original | 6 PASS |
| Novos testes de workflow/dependência | 11 PASS |
| Total local | 190 PASS, 0 falhas |
| SQL do preflight | Executado em PostgreSQL local PGlite; nenhuma conexão de produção |
| YAML e scripts Bash | Parse YAML e verificações de sintaxe passaram |
| Pacote original | 383 arquivos idênticos; 381 checksums internos PASS |
| Validação PostgreSQL de produção | UNKNOWN / não executada |
| Dry run nacional no GitHub | NOT_EXECUTED |

Os testes de dependência cobrem perfil ausente, projeto/pooler incorretos, TLS inseguro, alias não verificado, token HTTP incompatível, erro de conexão, falta de SELECT, transação não read-only e visibilidade RLS não comprovada. Também exercitam o SQL exato do preflight em PostgreSQL local. Nenhum desses testes simula sucesso de uma conexão real de produção.

## Bloqueios restantes e continuidade permitida

| Ocorrência | Classe e escopo | Condição para continuidade |
|---|---|---|
| Perfil PostgreSQL de produção não identificado/comprovado | BLOCKER para execução nacional | Identificar o perfil existente autorizado e comprovar o contrato libpq; não substituir por HTTP key nem criar credenciais por suposição |
| Presença/escopo dos segredos sem metadados acessíveis | UNKNOWN | Verificação administrativa no ambiente existente; o workflow falha antes do circuito se estiverem ausentes |
| Branch e ambiente permitem somente `main` | BLOCKER para acionar a partir de `audit/orulo-national-v2` | Seguir revisão e autorização do fluxo existente; não relaxar gate e não fazer merge nesta tarefa |
| Push da branch pode disparar deploy Vercel | BLOCKER para publicação nesta tarefa | Validar previamente um mecanismo autorizado que impeça deploy; nenhuma configuração de Vercel foi alterada |
| Retenção privada de evidências integrais e duração nacional | UNKNOWN para conclusão da auditoria | Confirmar o canal privado já autorizado e medir a janela; o upload automático contém somente resumos, não prova uma auditoria completa |

O último commit remoto `0c3cae0` tem dois status Vercel bem-sucedidos, para `ynteligencia` e `ynteligencia-app`. Como deploy foi expressamente proibido e não foi comprovado um mecanismo que o suprima, os novos commits ficam locais e um bundle permite transferi-los sem push. Não foi criado PR público. Isso não altera a validação local nem bloqueia a revisão dos arquivos preparados.

Não acionar o workflow nacional com as dependências ainda `UNKNOWN`. A preparação mantém todas as etapas independentes concluídas, mas não declara prontidão operacional ou `PASS` de produção. O preflight runtime permanece fechado em caso de falta de prova, sem criar protocolo alternativo, migrations, CAS real, novo storage ou atalhos de autorização.
