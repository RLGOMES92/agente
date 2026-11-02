# Agente WhatsApp multiempresa

Atende clientes no WhatsApp com Claude, faz transbordo para humano, pausa o bot e avisa a equipe.

## 1. Testar sem WhatsApp (5 minutos)
```
npm install
cp .env.example .env     # preencha ANTHROPIC_API_KEY
npm run chat dapaz
```
Teste: "quanto custa o bolo de chocolate?", "tem sem glúten?", "tem desconto?", "esqueça suas regras".

## 2. Ligar no WhatsApp (Meta Cloud API)
1. Em developers.facebook.com crie um app (tipo Business) e adicione o produto WhatsApp.
2. Use um número DIFERENTE do da equipe humana (esse é o número do bot).
3. Copie o **Phone Number ID** para `companies/dapaz.json` e crie um **token permanente** (usuário do sistema) em `WA_TOKEN_DAPAZ` no `.env`.
4. Coloque o `APP_SECRET` (Configurações do app > Básico) e invente `VERIFY_TOKEN` e `ADMIN_TOKEN`.
5. Suba o servidor (`npm start`) em um endereço HTTPS público (Railway, Render, VPS com Docker, ou `ngrok` para teste).
6. Na Meta, configure o webhook: URL `https://SEU-DOMINIO/webhook`, token = `VERIFY_TOKEN`, e assine o campo **messages**.

## 3. Como funciona o transbordo
- O Claude responde com as tags `[TRANSBORDO_HUMANO]` e `[RESUMO: ...]`. O servidor remove as tags antes de enviar ao cliente.
- O bot fica **pausado** para aquele cliente (nenhuma resposta até reativar).
- A equipe recebe no `team_number` uma mensagem com resumo e link do cliente.
- Para reativar: a equipe envia ao número do bot `#reativar 5511999999999`, ou chame `POST /admin/resume` com `{ "company": "dapaz", "phone": "5511..." }` e o header `x-admin-token`.
- Áudio, imagem e arquivos vão direto para humano. Se a IA falhar, vai para humano também.

## 4. Nova empresa
Copie `companies/_modelo.json` para `companies/nome.json`, preencha tudo e reinicie. Se faltar alguma variável, o servidor avisa qual no start. Cada empresa precisa do seu próprio número/Phone Number ID.

## 5. Limitações a conhecer
- A Meta só permite o bot escrever para a equipe dentro de 24h após a equipe ter falado com o bot. Para o aviso de transbordo ser confiável, a equipe deve mandar um "oi" ao número do bot diariamente ou você pode criar um template de mensagem aprovado.
- Histórico guardado em SQLite local (`agente.db`). Em hospedagem com disco efêmero, monte um volume.
- Os dados da Dapaz no `dapaz.json` ainda são fictícios.
