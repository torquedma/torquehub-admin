function buildPrompt(unit, dealer) {
  const d = dealer || {};
  const price = unit.price ? '$' + Number(unit.price).toLocaleString() : 'Call for Price';

  return `You are writing inventory descriptions for Torque Hub, a commercial equipment marketplace.

Rewrite the following raw dealer description into the Torque Hub standard format:

UNIT INFO:
Year: ${unit.year || 'Unknown'}
Make: ${unit.make || ''}
Model: ${unit.model || ''}
Price: ${price}
Mileage: ${unit.mileage || ''}
Engine: ${unit.engine || ''}
Transmission: ${unit.transmission || ''}
Drivetrain: ${unit.drivetrain || ''}
Fuel: ${unit.fuel || ''}
VIN: ${unit.vin || ''}
Stock #: ${unit.stock || ''}
Dealer: ${d.name || ''}
Location: ${d.location || ''}
Phone: ${d.phone || ''}

RAW DESCRIPTION:
${unit.raw_description || unit.description || ''}

OUTPUT FORMAT (use exactly this structure):
[Year] [Make] [Model] – [Short Buyer Hook]

Key Details
- [Only include fields that have data]
- Engine: ...
- Transmission: ...
- Mileage: ...
- Fuel: ...
- VIN: ... (if available)

Overview
[2-3 sentences: what it is, condition, best use case. Professional, direct, blue-collar tone. No fluff. Only use the word "fleet" if the raw description explicitly mentions fleet use or fleet maintenance. Do not assume or add it.]

Interested In This Unit?
Call ${d.name || 'the dealer'}: ${d.phone || ''} | ${d.location || ''}`;
}

async function generateDescription(unit, dealer, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(unit, dealer) }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

module.exports = { buildPrompt, generateDescription };
