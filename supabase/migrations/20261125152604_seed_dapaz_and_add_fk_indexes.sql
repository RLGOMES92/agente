-- Starter tenant. Replace phone_number_id and team_number through the admin panel/environment before enabling Meta webhook.
insert into public.companies (id, phone_number_id, token_env, team_number, variables, active)
values (
  'dapaz',
  null,
  'WA_TOKEN_DAPAZ',
  '',
  jsonb_build_object(
    'NOME_EMPRESA','DaPaz Confeitaria',
    'OBJETIVO_FINAL','ajudar o cliente a conhecer os produtos e solicitar um orçamento',
    'TOM_DE_VOZ','acolhedor, doce, profissional e objetivo',
    'EMOJIS','Use 🎂 e ✨ com moderação.',
    'REGRAS_ESPECIFICAS','Atendimento com hora marcada. A empresa trabalha com entregas e retirada. Não confirme agenda, disponibilidade ou prazo sem validação da equipe.',
    'DADOS_INSTITUCIONAIS','Confeitaria especializada em bolos e doces personalizados. Atendimento com hora marcada, com opções de entrega e retirada.',
    'CATALOGO_PRECOS','Serviços conhecidos: bolos personalizados, bolos de aniversário, bolos temáticos, doces personalizados e topos de bolo. Preços, tamanhos, sabores disponíveis, condições e prazos ainda precisam ser confirmados pela equipe. Para perguntas sobre esses dados, faça o transbordo.',
    'RESTRICOES','Não invente preços, disponibilidade, sabores, tamanhos, prazos ou condições. Pedidos personalizados e confirmação de agenda dependem da equipe.',
    'LINK_FECHAMENTO','Solicite à equipe o canal/link oficial para finalizar o pedido.',
    'PERGUNTA_QUALIFICACAO','Para qual data você precisa do pedido?',
    'REGRA_DE_FECHAMENTO','Quando o cliente demonstrar intenção de fechar, encaminhe para a equipe confirmar detalhes e disponibilidade.',
    'DESCRICAO_CURTA_NEGOCIO','bolos e doces personalizados'
  ),
  true
)
on conflict (id) do nothing;

create index if not exists idx_users_company on public.users(company_id, active);
create index if not exists idx_audit_company_time on public.audit_logs(company_id, created_at desc);
create index if not exists idx_audit_time on public.audit_logs(created_at desc);
