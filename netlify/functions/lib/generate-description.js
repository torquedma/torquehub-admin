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

CRITICAL ACCURACY RULE:
Use ONLY information explicitly present in UNIT INFO or RAW DESCRIPTION above.
Do not infer, guess, decode, assume, or add any engine manufacturer, horsepower, torque, body style, drivetrain, mileage, condition, or specification that is not explicitly stated in the source.
If the source does not state it, omit it.
Accuracy over completeness.

OUTPUT FORMAT — return EXACTLY two parts separated by a line containing only "===":
[Year] [Make] [Model] – [Short Buyer Hook]
===
[2-3 sentence Overview: what it is, condition, best use case. Professional, direct, blue-collar tone. No fluff. Only use the word "fleet" if the raw description explicitly mentions it.]

Do NOT write a "Key Details" section, bullet list, contact section, prices, or specs lists. ONLY the headline line, then "===", then the Overview prose.`;
}

async function generateDescription(unit, dealer, apiKey) {
  const detailLines = [];
  if (unit.year)                   detailLines.push('- Year: ' + unit.year);
  if (unit.make)                   detailLines.push('- Make: ' + unit.make);
  if (unit.model)                  detailLines.push('- Model: ' + unit.model);
  if (unit.mileage)                detailLines.push('- Mileage: ' + unit.mileage);
  if (trimSpec(unit.engine))       detailLines.push('- Engine: ' + trimSpec(unit.engine));
  if (trimSpec(unit.transmission)) detailLines.push('- Transmission: ' + trimSpec(unit.transmission));
  if (unit.drivetrain)             detailLines.push('- Drivetrain: ' + unit.drivetrain);
  if (unit.fuel)                   detailLines.push('- Fuel: ' + unit.fuel);
  // vPIC-enriched fields (verified, code-owned) — only when present
  const vp = unit._vpic || {};
  if (vp.gvwrClass)  detailLines.push('- GVWR: ' + vp.gvwrClass);
  if (vp.bodyClass)  detailLines.push('- Body Class: ' + vp.bodyClass);
  if (vp.horsepower) detailLines.push('- Horsepower: ' + vp.horsepower + ' HP');
  if (vp.torque)     detailLines.push('- Torque: ' + vp.torque + ' lb-ft');
  const priceNum = Number(String(unit.price).replace(/[^0-9.]/g, ''));
  if (priceNum > 0)                detailLines.push('- Price: $' + priceNum.toLocaleString());
  if (unit.vin)                    detailLines.push('- VIN: ' + unit.vin);
  if (unit.stock)                  detailLines.push('- Stock #: ' + unit.stock);
  if (detailLines.length === 0 && unit.stock) detailLines.push('- Stock #: ' + unit.stock);

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
  const raw = (data.content?.[0]?.text || '').trim();
  const parts = raw.split(/\n?===\n?/);
  const defaultHeadline = [unit.year, unit.make, unit.model].filter(Boolean).join(' ') || 'Unit Available';
  let headline = '';
  let overview = '';
  if (parts.length >= 2) {
    headline = (parts[0] || '').trim();
    overview = (parts.slice(1).join('\n').trim() || '').replace(/^Overview\s*/i, '').trim();
  } else {
    headline = defaultHeadline;
    overview = raw.replace(/^Overview\s*/i, '').trim();
  }
  if (!headline) headline = defaultHeadline;

  const d = dealer || {};
  let text = headline + '\n\nKey Details\n' + detailLines.join('\n') + '\n\nOverview\n' + overview;
  if (d.name || d.phone || d.location) {
    const contactBits = [d.phone, d.location].filter(Boolean).join(' | ');
    text += '\n\nInterested In This Unit?\nCall ' + (d.name || 'the dealer') + (contactBits ? ': ' + contactBits : '');
  }
  return text;
}

module.exports = { buildPrompt, generateDescription };
