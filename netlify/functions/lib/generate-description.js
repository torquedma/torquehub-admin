function trimSpec(val) {
  if (!val) return val;
  return val.split(/\s*[—–]\s*|\s+-\s+/)[0].trim();
}

function buildPrompt(unit, dealer) {
  const d = dealer || {};
  const price = unit.price ? '$' + Number(unit.price).toLocaleString() : 'Call for Price';

  // Build UNIT INFO from non-empty fields only — sparse units get no blank labels
  const lines = [];
  lines.push('Year: ' + (unit.year || 'Unknown'));
  if (unit.make)  lines.push('Make: ' + unit.make);
  if (unit.model) lines.push('Model: ' + unit.model);
  lines.push('Price: ' + price);
  if (unit.mileage)                    lines.push('Mileage: ' + unit.mileage);
  if (trimSpec(unit.engine))           lines.push('Engine: ' + trimSpec(unit.engine));
  if (trimSpec(unit.transmission))     lines.push('Transmission: ' + trimSpec(unit.transmission));
  if (unit.drivetrain)                 lines.push('Drivetrain: ' + unit.drivetrain);
  if (unit.fuel)                       lines.push('Fuel: ' + unit.fuel);
  if (unit.vin)                        lines.push('VIN: ' + unit.vin);
  if (unit.stock)                      lines.push('Stock #: ' + unit.stock);

  return `You are writing inventory descriptions for Torque Hub, a commercial equipment marketplace.

Rewrite the following raw dealer description into the Torque Hub standard format:

UNIT INFO:
${lines.join('\n')}

RAW DESCRIPTION:
${unit.raw_description || unit.description || ''}

OUTPUT FORMAT (use exactly this structure, and END after the Overview section — do not write a contact or "Interested" section):
[Year] [Make] [Model] – [Short Buyer Hook]

Key Details
- Use only the fields present in UNIT INFO above.
- Do not include blank, unknown, or unavailable fields.
- Do not invent specifications.

Overview
[2-3 sentences: what it is, condition, best use case. Professional, direct, blue-collar tone. No fluff. Only use the word "fleet" if the raw description explicitly mentions fleet use or fleet maintenance. Do not assume or add it.]`;
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
      max_tokens: 1536,
      messages: [{ role: 'user', content: buildPrompt(unit, dealer) }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const d = dealer || {};
  let text = (data.content?.[0]?.text || '').trim();
  text = text.replace(/\n*\s*Interested In This Unit\?[\s\S]*$/i, '').trim();
  if (d.name || d.phone || d.location) {
    const contactBits = [d.phone, d.location].filter(Boolean).join(' | ');
    text += '\n\nInterested In This Unit?\nCall ' + (d.name || 'the dealer') + (contactBits ? ': ' + contactBits : '');
  }
  return text;
}

module.exports = { buildPrompt, generateDescription };
