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

A configuração fica em `companies/<empresa>.json`.

Para a DaPaz:
- `phone_number_id`: Phone Number ID fornecido pela Meta (necessário para WhatsApp real).
- `token_env`: nome da variável de ambiente que contém o token da Meta.
- `team_number`: número da equipe em formato internacional, somente dígitos. Também é possível definir `TEAM_NUMBER_DAPAZ` no ambiente; essa variável tem prioridade e evita gravar o telefone no GitHub. É necessário para receber os avisos de transbordo.
- `variables`: informações usadas para preencher o prompt da empresa.

Para cadastrar outra empresa, copie `companies/_modelo.json` para `companies/nome.json`, altere os dados e crie a variável de token correspondente no ambiente. Nunca coloque tokens diretamente nos arquivos JSON.

## 3. Conectar ao WhatsApp Cloud API

1. Crie/configure um app Business em Meta for Developers e adicione WhatsApp.
2. Configure o número que será usado pelo bot e obtenha o Phone Number ID.
3. Gere um token de usuário do sistema com as permissões necessárias e acesso ao ativo WhatsApp.
4. Preencha no ambiente: `WA_TOKEN_DAPAZ`, `TEAM_NUMBER_DAPAZ`, `APP_SECRET`, `VERIFY_TOKEN` e `ADMIN_TOKEN`. Defina `TEAM_NUMBER_DAPAZ` com o número da equipe em formato internacional, somente dígitos (ex.: DDI + DDD + número). Não coloque telefone real, tokens ou segredos no GitHub.
5. Atualize `phone_number_id` e `team_number` em `companies/dapaz.json`.
6. Publique o servidor em HTTPS e configure o webhook `https://SEU-DOMINIO/webhook`, usando o mesmo `VERIFY_TOKEN`; assine o campo `messages`.

A versão da Graph API é configurável por `WHATSAPP_API_VERSION` e o padrão atual do projeto é `v26.0`.

## 4. Transbordo e reativação

- O modelo sinaliza transferência com `[TRANSBORDO_HUMANO]` e `[RESUMO: ...]`.
- O servidor remove as tags, pausa o bot para aquele cliente e tenta avisar o número configurado em `team_number`.
- A equipe reativa enviando ao número do bot: `#reativar 5511999999999`.
- Também existe `POST /admin/resume`, com JSON `{ "company": "dapaz", "phone": "5511..." }` e header `x-admin-token`.
- Áudio, imagem e outros tipos de arquivo são encaminhados para atendimento humano.

O envio de mensagens de texto pela API da Meta depende da janela de atendimento do WhatsApp; para mensagens fora da janela, será necessário implementar e usar um template aprovado.

## 5. Banco de dados e publicação

O histórico e a deduplicação de webhooks ficam no SQLite. Em hospedagens com disco efêmero, configure um volume persistente e defina `DB_PATH` para um caminho dentro dele. O Dockerfile usa `/data/agente.db`.

Painel administrativo:
- Abra `https://SEU-DOMINIO/painel/` no navegador.
- Informe o `ADMIN_TOKEN`; o token fica somente na sessão atual do navegador.
- O painel consulta `/admin/overview`, atualiza os indicadores automaticamente e permite reativar conversas pausadas. A reativação limpa o histórico da conversa.
- Administradores também podem cadastrar e editar empresas pela seção **Empresas**. O cadastro valida o identificador, os campos obrigatórios e a unicidade do Phone Number ID. As configurações são salvas em `companies/<id>.json` e recarregadas pelo servidor sem reinício.
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
- Em produção, `APP_SECRET` é obrigatório: sem ele, `POST /webhook` responde `503`; com ele, toda requisição precisa apresentar `X-Hub-Signature-256` válida. Fora de produção, a assinatura pode ficar sem configuração apenas para desenvolvimento local.
- `VERIFY_TOKEN` é obrigatório para a verificação inicial do webhook da Meta; `ADMIN_TOKEN` deve ser forte e exclusivo para proteger as rotas administrativas.
- O login limita tentativas por IP e por conta (8 falhas em 15 minutos). O contador é mantido em memória; em múltiplas instâncias, configure também um limitador compartilhado no proxy/Redis.
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

As senhas são derivadas com scrypt e salt aleatório; o banco armazena apenas o hash. O token de sessão é armazenado como hash SHA-256. Tentativas de login por IP e por conta são limitadas temporariamente (8 falhas em 15 minutos), com limpeza periódica do controle em memória. Em múltiplas instâncias, use também um limitador compartilhado no proxy/Redis. A auditoria registra ações administrativas e de autenticação sem armazenar senhas, tokens ou conteúdo de mensagens. Não compartilhe tokens de sessão e use HTTPS em produção.

**Painel:** a tela `/painel/` oferece duas entradas: console administrativo via `ADMIN_TOKEN` e acesso da equipe via e-mail/senha. O acesso da equipe mostra somente os indicadores e conversas da empresa vinculada; o papel `company_admin` também pode cadastrar e desativar operadores/visualizadores da própria empresa.

Para criar o primeiro usuário de plataforma, use o console administrativo autenticado por `ADMIN_TOKEN`:

```bash
curl -X POST "$BASE_URL/admin/users" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@seudominio.com","password":"TROQUE-POR-UMA-SENHA-FORTE","role":"platform_admin","company_id":null}'
```

Depois, entre em `/painel/` pela opção **Acesso da equipe** usando o e-mail e a senha criados. Para vincular administradores e equipes a uma empresa, informe o `company_id` correspondente ao criar o usuário.
