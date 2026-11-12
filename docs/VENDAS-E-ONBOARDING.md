# Oferta comercial e onboarding do Agente WhatsApp

## O que o produto entrega

- Atendimento automatizado pelo WhatsApp com IA Claude.
- Respostas baseadas nas informações e regras cadastradas para cada empresa.
- Histórico e fila por conversa.
- Encaminhamento para equipe humana e pausa do bot por conversa.
- Painel de operação, indicadores e conversas recentes.
- Login de equipe com papéis e isolamento por empresa.
- Registro de auditoria e controle de usuários.
- Configuração separada por empresa e número WhatsApp.

## Planos sugeridos para estruturar a oferta

Os nomes abaixo são uma estrutura comercial inicial. Preço, limites e SLA devem ser definidos antes de divulgar.

### Essencial
- Um número WhatsApp conectado.
- Configuração inicial de uma empresa.
- Base de perguntas, serviços e regras.
- Atendimento com IA e transbordo humano.
- Painel e acompanhamento básico.

### Profissional
- Tudo do Essencial.
- Mais usuários da equipe.
- Ajustes de fluxos e qualificação.
- Revisão periódica da base de conhecimento.
- Relatório operacional periódico.

### Empresarial
- Configuração e operação multiunidade conforme escopo.
- Fluxos específicos e integrações adicionais mediante projeto.
- Papéis e permissões por equipe.
- Acompanhamento e suporte acordados em contrato.

## Processo de implantação de cada cliente

1. Reunião de diagnóstico: volume, horários, dúvidas frequentes, serviços, exceções e quando transferir para humano.
2. Coleta de dados: nome, descrição, catálogo, preços autorizados, políticas, endereço, horários, links e contatos.
3. Acesso Meta: cliente adiciona/configura o número e concede os ativos/permissões necessários; credenciais são inseridas diretamente no ambiente seguro.
4. Configuração: criar JSON da empresa, Phone Number ID, variável de token e número da equipe.
5. Testes com o cliente: perguntas frequentes, respostas proibidas, orçamento, reclamação, pedido de humano e indisponibilidade.
6. Aprovação por escrito dos textos, regras e mensagens.
7. Ativação controlada e acompanhamento inicial.
8. Revisão após o período inicial e registro de melhorias.

## O que precisa constar na proposta/contrato

- Escopo, canais e número(s) atendidos.
- Limites de uso, volume, usuários e mensagens, se aplicável.
- Valor de implantação, mensalidade e custos de terceiros (Meta/Anthropic/hospedagem).
- Responsabilidades do cliente por conteúdo, preços, políticas e acessos.
- Horários e prazo de atendimento humano.
- Disponibilidade, suporte, manutenção e condições de cancelamento.
- Tratamento de dados, retenção, segurança, suboperadores e atendimento à LGPD.
- Regras para uso de templates aprovados e mensagens fora da janela da Meta.
- Limites da IA: não prometer precisão absoluta; casos sensíveis ou incertos devem ir para a equipe.

## Checklist antes de fechar a primeira venda

- [ ] Demo em ambiente de teste, sem dados reais de outros clientes.
- [ ] Vídeo curto mostrando pergunta, resposta e transbordo.
- [ ] Proposta com escopo e preço definidos.
- [ ] Contrato e aviso de privacidade revisados.
- [ ] Política de suporte e canal de contato definidos.
- [ ] Processo para revogar tokens e remover dados no encerramento.
- [ ] Cliente aprovou as respostas e regras antes da ativação.

## Piloto DaPaz

A configuração atual da DaPaz é apenas uma base inicial: não contém Phone Number ID, token WhatsApp, número da equipe, preços completos nem agenda. Ela orienta a IA a não inventar essas informações e encaminhar dúvidas à equipe. Preencher e testar esses dados antes de usar como demonstração real.

## Mensagem inicial de prospecção

Olá! Tudo bem? Trabalho com implantação de agentes de IA no WhatsApp para empresas. A solução pode responder dúvidas frequentes, apresentar produtos/serviços e encaminhar atendimentos que precisam de uma pessoa, mantendo a equipe no controle. Posso te mostrar uma demonstração rápida aplicada ao seu tipo de negócio?
