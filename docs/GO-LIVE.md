# Checklist de publicação e entrada em operação

Este projeto é um servidor Node.js multiempresa para atendimento pelo WhatsApp Cloud API com Claude. Não publique como site estático nem em hospedagem com disco efêmero: o histórico e a deduplicação usam SQLite.

## Bloqueios obrigatórios antes do primeiro cliente

- [ ] Hospedagem Node.js 20+ com Docker ou suporte a Node, HTTPS e volume persistente.
- [ ] Volume persistente montado em `/data`; manter `DB_PATH=/data/agente.db`.
- [ ] Configurar todas as variáveis secretas no painel da hospedagem (nunca no Git).
- [ ] Definir `NODE_ENV=production`, `PORT`, `ANTHROPIC_API_KEY`, `MODEL`, `VERIFY_TOKEN`, `APP_SECRET` e `ADMIN_TOKEN`.
- [ ] Para cada empresa, configurar `phone_number_id`, variável de token indicada por `token_env` e telefone da equipe.
- [ ] Validar `GET /health` por HTTPS.
- [ ] Configurar na Meta o webhook `https://DOMINIO/webhook`, com o mesmo `VERIFY_TOKEN`, assinatura de `messages` e segredo do app em `APP_SECRET`.
- [ ] Executar `npm run check` e `npm test` em Node.js 20+ antes da publicação.
- [ ] Criar o primeiro usuário `platform_admin` com `POST /admin/users` usando `ADMIN_TOKEN`.
- [ ] Testar login, isolamento entre empresas, mensagem real recebida, resposta do Claude, deduplicação e transbordo humano.
- [ ] Reiniciar a aplicação e confirmar que histórico e sessões persistem no volume.
- [ ] Configurar backup automatizado do arquivo SQLite e testar restauração.

## Variáveis de ambiente

Consulte `.env.example` como referência. Valores reais devem ser criados diretamente na hospedagem:

- `ANTHROPIC_API_KEY`: chave da Anthropic.
- `MODEL`: identificador de modelo Claude habilitado na conta.
- `PORT`: porta HTTP atribuída pela hospedagem.
- `DB_PATH=/data/agente.db`: caminho no volume persistente.
- `NODE_ENV=production`: ativa exigência de assinatura do webhook.
- `WHATSAPP_API_VERSION`: versão da Graph API suportada pelo app.
- `VERIFY_TOKEN`: segredo aleatório usado na validação inicial do webhook.
- `APP_SECRET`: App Secret do app Meta; necessário para validar cada POST.
- `ADMIN_TOKEN`: segredo forte e exclusivo para rotas administrativas.
- Por empresa: token de acesso WhatsApp e número da equipe. O nome da variável de token deve coincidir com `token_env` do JSON.

## Teste de aceitação

1. `GET /health` retorna `ok: true`.
2. Enviar mensagem do WhatsApp de teste para o número conectado.
3. Confirmar resposta gerada pela IA, sem inventar preço, agenda ou prazo.
4. Pedir atendimento humano e confirmar pausa da conversa e notificação para a equipe.
5. Enviar outra mensagem enquanto pausado e confirmar que o bot não responde.
6. Reativar com `#reativar DDI+DDD+NUMERO` a partir do telefone da equipe.
7. Reenviar o mesmo webhook e confirmar que a mensagem não é processada duas vezes.
8. Criar duas empresas de teste e confirmar que usuários de uma não veem conversas da outra.
9. Reiniciar o serviço e confirmar que os dados continuam disponíveis.

## Observações de arquitetura

- O SQLite exige armazenamento persistente e recomenda-se uma única instância de escrita. Não escalar horizontalmente com SQLite local.
- Para alta disponibilidade ou múltiplas instâncias, planejar migração para PostgreSQL e fila compartilhada.
- A limitação de tentativas de login está em memória; em múltiplas instâncias, adicionar rate limit compartilhado no proxy/Redis.
- O envio proativo fora da janela de atendimento do WhatsApp exige template aprovado pela Meta.
- O painel atual é administrativo/interno, não é uma página pública de cadastro ou cobrança de clientes.
