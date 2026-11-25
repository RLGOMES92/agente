# Agente WhatsApp multiempresa

Atendimento com Claude e WhatsApp Cloud API, com histórico por cliente, fila de mensagens, transferência para humano e pausa/reativação do bot.

## Requisitos

- Node.js 20 ou superior
- Chave da API da Anthropic para usar a IA
- Para WhatsApp: app Meta com WhatsApp Cloud API, Phone Number ID, token de acesso e webhook HTTPS

## 1. Instalação e teste local (sem WhatsApp)

```bash
npm install
cp .env.example .env
```

No arquivo `.env`, preencha pelo menos `ANTHROPIC_API_KEY`. Depois execute:

```bash
npm run check
npm test
npm run chat dapaz
```

No simulador, teste perguntas sobre produtos, preços, personalização e pedidos para falar com uma pessoa. A configuração inicial da DaPaz contém apenas informações já confirmadas; preços, sabores, prazos e agenda são encaminhados à equipe porque ainda precisam ser cadastrados.

### Demonstração sem custo de IA

Para experimentar o fluxo básico sem chave da Anthropic e sem conectar o WhatsApp:

```bash
npm run demo
```

Essa demonstração usa respostas simuladas locais. Ela permite visualizar o acolhimento, a apresentação dos serviços e a pausa após um transbordo, mas **não testa o Claude nem envia mensagens reais**. Para testar respostas geradas por IA, use `npm run chat dapaz` com uma chave válida da Anthropic no arquivo `.env`.

## 2. Configuração da empresa

Na versão da branch `main` (modo local), a configuração fica em `companies/<empresa>.json`. Na branch de migração, as configurações são armazenadas no Supabase.

Para a DaPaz:
- `phone_number_id`: Phone Number ID numérico fornecido pela Meta (8 a 30 dígitos; necessário para WhatsApp real).
- `token_env`: nome da variável de ambiente que contém o token da Meta; deve começar com `WA_TOKEN_`.
- `team_number`: número da equipe em formato internacional, somente dígitos. Também é possível definir `TEAM_NUMBER_DAPAZ` no ambiente; essa variável tem prioridade e evita gravar o telefone no GitHub. É necessário para receber os avisos de transbordo.
- `variables`: informações usadas para preencher o prompt da empresa.

Para a versão local/main, copie o modelo JSON. Na branch de migração, use o painel administrativo para cadastrar/editar tenants, que grava no Supabase. Tokens sempre ficam somente nas variáveis de ambiente.

## 3. Conectar ao WhatsApp Cloud API

1. Crie/configure um app Business em Meta for Developers e adicione WhatsApp.
2. Configure o número que será usado pelo bot e obtenha o Phone Number ID.
3. Gere um token de usuário do sistema com as permissões necessárias e acesso ao ativo WhatsApp.
4. Preencha no ambiente: `WA_TOKEN_DAPAZ`, `TEAM_NUMBER_DAPAZ`, `APP_SECRET`, `VERIFY_TOKEN` e `ADMIN_TOKEN`. Defina `TEAM_NUMBER_DAPAZ` com o número da equipe em formato internacional, somente dígitos (ex.: DDI + DDD + número). Não coloque telefone real, tokens ou segredos no GitHub.
5. Na versão local, atualize `phone_number_id` e `team_number` em `companies/dapaz.json`; na migração, edite a configuração do tenant no painel/Supabase.
6. Publique o servidor em HTTPS e configure o webhook `https://SEU-DOMINIO/webhook`, usando o mesmo `VERIFY_TOKEN`; assine o campo `messages`.

A versão da Graph API é configurável por `WHATSAPP_API_VERSION` e o padrão atual do projeto é `v26.0`.

## 4. Transbordo e reativação

- O modelo sinaliza transferência com `[TRANSBORDO_HUMANO]` e `[RESUMO: ...]`.
- O servidor remove as tags, pausa o bot para aquele cliente e tenta avisar o número configurado em `team_number`.
- A equipe reativa enviando ao número do bot: `#reativar 5511999999999`.
- Também existe `POST /admin/resume`, com JSON `{ "company": "dapaz", "phone": "5511..." }` e header `x-admin-token`.
- Áudio, imagem e outros tipos de arquivo são encaminhados para atendimento humano; o histórico registra o tipo de conteúdo recebido para dar contexto à equipe.

O envio de mensagens de texto pela API da Meta depende da janela de atendimento do WhatsApp; para mensagens fora da janela, será necessário implementar e usar um template aprovado.

## 5. Banco de dados e publicação

A branch `main` utiliza SQLite local. A branch `feat/supabase-vercel-migration` usa Supabase para histórico, deduplicação, sessões, auditoria e fila persistente, preparada para execução serverless.

Painel administrativo:
- Abra `https://SEU-DOMINIO/painel/` no navegador.
- Informe o `ADMIN_TOKEN`; o token fica somente na sessão atual do navegador.
- O painel consulta `/admin/overview`, atualiza os indicadores automaticamente e permite reativar conversas pausadas. A reativação limpa o histórico da conversa.
- Administradores também podem cadastrar e editar empresas pela seção **Empresas**. O cadastro valida o identificador, os campos obrigatórios e a unicidade do Phone Number ID. Na branch `main`, as configurações são JSON local; na branch de migração, são salvas no Supabase e recarregadas.
- O painel não armazena tokens da Meta: `token_env` guarda apenas o nome da variável de ambiente. Cadastre o valor secreto no ambiente de hospedagem antes de conectar a empresa.

Endpoints:
- `GET /health`: verificação simples de disponibilidade.
- `GET /admin/companies`: lista configurações administrativas sem retornar segredos.
- `POST /admin/companies`: cadastra empresa; recebe `id`, `phone_number_id`, `token_env`, `team_number` e `variables`.
- `PUT /admin/companies/:id`: atualiza os mesmos campos de uma empresa existente.
- `GET /webhook` e `POST /webhook`: verificação e recebimento de eventos da Meta.
- `GET /admin/overview`: visão administrativa autenticada por `x-admin-token`, com totais por empresa e até 100 conversas recentes (sem expor credenciais ou histórico completo).
- `POST /admin/resume`: reativação autenticada de conversa.

## 6. Segurança

- Nunca envie `.env`, tokens, chaves ou segredos para o GitHub.
- O `.gitignore` protege o arquivo `.env` e o banco local.
- Use tokens fortes e exclusivos para `VERIFY_TOKEN` e `ADMIN_TOKEN`.
- `APP_SECRET` é obrigatório em todos os ambientes que recebem webhooks: sem ele, `POST /webhook` responde `503`; com ele, toda requisição precisa apresentar `X-Hub-Signature-256` válida. Configure um segredo de teste separado para desenvolvimento local.
- `VERIFY_TOKEN` é obrigatório para a verificação inicial do webhook da Meta; `ADMIN_TOKEN` deve ser forte e exclusivo para proteger as rotas administrativas.
- O login limita tentativas por IP e por conta com controle persistente no Supabase (8 falhas em 15 minutos). As chaves são hashes SHA-256; um login válido limpa o contador da conta, mas preserva o contador agregado do IP até o fim da janela.
- A configuração da DaPaz é inicial e não contém preços nem dados de agenda; revise e complete a base antes de atendimento real.


## Usuários e isolamento por empresa

A autenticação de usuários é separada do acesso administrativo por `ADMIN_TOKEN`.

- `POST /admin/users`: cria um usuário usando o header `x-admin-token`. Campos: `email`, `password` (mínimo 12 caracteres), `role` e `company_id`.
- Papéis disponíveis: `platform_admin`, `company_admin`, `operator` e `viewer`.
- Usuários de empresa precisam ter um `company_id` existente. `platform_admin` não recebe vínculo de empresa.
- `GET /admin/users`: lista usuários sem hashes ou salts de senha.
- `POST /admin/users/:id/disable`: desativa o usuário e revoga suas sessões.
- `POST /auth/login`: recebe e-mail e senha e retorna token de sessão com validade de 12 horas.
- `GET /auth/me`: valida a sessão pelo header `Authorization: Bearer <token>`.
- `POST /auth/logout`: encerra a sessão apresentada.
- `POST /auth/change-password`: altera a senha com validação da senha atual e encerra as demais sessões do usuário.
- `GET /admin/audit`: consulta o registro global de eventos, protegido por `ADMIN_TOKEN`.
- `GET /tenant/audit`: consulta eventos da própria empresa (somente `company_admin`).
- `GET /tenant/overview`: retorna indicadores e conversas somente da empresa vinculada ao usuário autenticado.
- `GET /tenant/users`: lista os usuários vinculados à empresa (somente `company_admin`).
- `POST /tenant/users`: cria usuários `operator` ou `viewer` na própria empresa (somente `company_admin`).
- `POST /tenant/users/:id/disable`: desativa operador/visualizador da própria empresa e revoga suas sessões; não permite desativar a própria conta nem administradores.

As senhas são derivadas com scrypt e salt aleatório; o banco armazena apenas o hash. O token de sessão é armazenado como hash SHA-256. Tentativas de login por IP e por conta são limitadas de forma persistente no Supabase (8 falhas em 15 minutos), funcionando entre instâncias serverless. As chaves de limitação são hashes SHA-256, e o contador da conta é removido após autenticação válida; o contador do IP permanece até expirar para não permitir que uma conta válida zere o limite compartilhado por outros usuários. A tabela e as RPCs de controle são restritas à `service_role`. A auditoria registra ações administrativas e de autenticação sem armazenar senhas, tokens ou conteúdo de mensagens. Não compartilhe tokens de sessão e use HTTPS em produção.

**Painel:** a tela `/painel/` oferece duas entradas: console administrativo via `ADMIN_TOKEN` e acesso da equipe via e-mail/senha. O acesso da equipe mostra somente os indicadores e conversas da empresa vinculada; o papel `company_admin` também pode cadastrar e desativar operadores/visualizadores da própria empresa.

Para criar o primeiro usuário de plataforma, use o console administrativo autenticado por `ADMIN_TOKEN`:

```bash
curl -X POST "$BASE_URL/admin/users" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@seudominio.com","password":"TROQUE-POR-UMA-SENHA-FORTE","role":"platform_admin","company_id":null}'
```

Depois, entre em `/painel/` pela opção **Acesso da equipe** usando o e-mail e a senha criados. Para vincular administradores e equipes a uma empresa, informe o `company_id` correspondente ao criar o usuário.


## Deploy serverless (branch de migração)

A versão desta branch troca a persistência SQLite por Supabase e adapta o Express para Vercel. **Não promover a produção até testar a integração e configurar os segredos.**

### Variáveis privadas obrigatórias na Vercel
- `SUPABASE_URL`: URL do projeto `agente-whatsapp`.
- `SUPABASE_SECRET_KEY`: chave secret do Supabase (ou `SUPABASE_SERVICE_ROLE_KEY` legado). Nunca usar no frontend.
- `ANTHROPIC_API_KEY`: chave de API para a IA.
- `APP_SECRET`: segredo Meta usado para validar assinatura dos webhooks.
- `VERIFY_TOKEN`: token escolhido para validação do webhook Meta.
- `ADMIN_TOKEN`: token forte para console administrativo.
- `CRON_SECRET`: token forte que protege o endpoint worker `/worker`.
- `WA_TOKEN_DAPAZ`: token WhatsApp Cloud API da empresa DaPaz.
- `TEAM_NUMBER_DAPAZ`: telefone da equipe com DDI, somente dígitos.
- `WHATSAPP_API_VERSION`: opcional; padrão atual do código `v26.0`.

Defina essas variáveis nos ambientes Production, Preview e Development conforme aplicável. Não coloque valores secretos no GitHub, no README, nem no chat.

### Configuração Meta
Webhook URL: `https://SEU-DOMINIO/webhook`
Verify token: valor de `VERIFY_TOKEN`
Eventos: `messages`
Assinatura de payload: habilitar e fornecer `APP_SECRET`.

### Worker persistente
O webhook persiste cada evento antes de retornar HTTP 200 e tenta iniciar o processamento em background. Jobs podem ser recuperados pelo endpoint `/worker` autenticado com `Authorization: Bearer CRON_SECRET`. Configure um scheduler externo para chamar esse endpoint periodicamente para recuperar jobs pendentes; não dependa apenas do processamento em background.

### Migrações
As migrações do Supabase são versionadas em `supabase/migrations`. Tabelas do aplicativo têm RLS habilitado e não concedem acesso às roles `anon` e `authenticated`; o backend usa somente a chave secreta.


### Outbox durável de mensagens enviadas
O backend grava respostas ao cliente e alertas de transbordo em `message_outbox` antes de tentar enviar. A outbox tem chave idempotente, claim atômico, lease recuperável, backoff exponencial (até 8 tentativas) e registro do ID retornado pela Meta. O worker `/worker` processa tanto mensagens inbound como outbound; configure scheduler a cada 1–5 minutos. O worker agora reserva um job por vez imediatamente antes de processá-lo, evitando que mensagens no fim de um lote percam o lease enquanto aguardam chamadas anteriores.

**Aplicação:** migração `20261126000100_add_durable_message_outbox.sql` adicionada ao repositório e aplicada ao projeto Supabase dedicado. Não é necessário reaplicar manualmente.

**Limite importante:** envio é *at-least-once*. Se a Meta aceitar a mensagem e a conexão falhar antes de recebermos a confirmação, um retry pode entregar duplicado. A chave idempotente impede duplicar o registro interno, mas a API WhatsApp não oferece deduplicação de entrega garantida por essa chave. A resposta gerada para cada mensagem recebida é persistida em `inbound_responses` antes de gravar o histórico e enfileirar o envio. Uma RPC transacional grava as duas mensagens do histórico uma única vez; retries retomam o texto e a decisão de transbordo já salvos, sem chamar a IA novamente. Os registros são removidos após 30 dias. A guarda de inbound também evita gerar novamente a resposta quando ela já está persistida na outbox. A intenção de transbordo também é persistida em `message_handoffs` antes da pausa; se houver falha parcial entre o alerta da equipe, a pausa e a confirmação ao cliente, o retry retoma o mesmo transbordo e envia uma confirmação de contingência sem chamar a IA novamente. Marcadores antigos são removidos após 30 dias.

### Validação antes de ativar atendimento
- [ ] Executar `npm run check` e `npm test` localmente (Node 20+).
- [ ] Testar webhook GET de verificação, assinatura inválida (401) e ausência de `APP_SECRET` (503).
- [ ] Enviar mensagem de texto e verificar persistência de histórico e resposta.
- [ ] Testar falha temporária Supabase/Meta e recuperação pelo worker.
- [ ] Testar transbordo, equipe sem telefone, pausa e comando `#reativar`.
- [ ] Confirmar isolamento entre tenants e autenticação administrativa.
- [ ] Configurar scheduler para chamar `/worker` a cada 1–5 minutos, com `Authorization: Bearer CRON_SECRET`; não expor esse segredo em URL/logs.
- [ ] Fazer deploy de Preview e validar antes de produção.


### Segurança das reservas da fila
Cada reserva inbound/outbound recebe um `lease_token` UUID novo. Concluir ou devolver um job à fila exige o mesmo token e o estado `processing`; se outro worker recuperar uma reserva expirada, o worker antigo não consegue alterar o estado da nova reserva. Isso protege as atualizações do banco contra workers obsoletos, mas não elimina a possibilidade de entrega duplicada se a Meta aceitar um envio e a confirmação se perder.

### Testes do adaptador Supabase
`npm test` inclui testes com `fetch` simulado para verificar que histórico, exclusão, visão geral e usuários são sempre filtrados pelo `company_id`, além das condições de propriedade das reservas da fila. `npm run check` também verifica a sintaxe desse arquivo de teste.

Tentativas de login com e-mail ausente/malformado ou senha acima do limite também consomem o contador agregado por IP; entradas inválidas não podem contornar o rate limit enviando requisições repetidas com formato incorreto.

O backend aceita a chave nova `sb_secret_...` e a chave legada `service_role`. A chave nova é enviada somente no header `apikey` (não é JWT); o header Bearer é mantido apenas para a chave legada JWT.
