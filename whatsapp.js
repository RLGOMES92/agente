const GRAPH = 'https://graph.facebook.com/v21.0';

export async function sendText(company, to, body) {
  const token = process.env[company.token_env];
  if (!token) throw new Error(`Token ausente: defina ${company.token_env} no .env`);
  const res = await fetch(`${GRAPH}/${company.phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
  if (!res.ok) console.error('Erro WhatsApp', res.status, await res.text());
}
