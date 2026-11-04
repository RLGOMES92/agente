const GRAPH_VERSION = process.env.WHATSAPP_API_VERSION || 'v26.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export async function sendText(company, to, body) {
  const token = process.env[company.token_env];
  if (!token) throw new Error(`Token ausente: defina ${company.token_env} no .env`);
  if (!company.phone_number_id) throw new Error(`Phone Number ID ausente para a empresa ${company.id}`);

  const res = await fetch(`${GRAPH}/${company.phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body }
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = payload.error?.message || JSON.stringify(payload);
    throw new Error(`WhatsApp API (${res.status}): ${detail}`);
  }
  return payload;
}
