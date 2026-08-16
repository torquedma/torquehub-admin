const { generateDescription } = require('./lib/generate-description.generated');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' })
    };
  }

  let unit, dealer;
  try {
    ({ unit, dealer } = JSON.parse(event.body || '{}'));
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  if (!unit) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing unit data' })
    };
  }

  try {
    const description = await generateDescription(unit, dealer, apiKey);
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    };
  } catch (err) {
    if (err.code === 'INSUFFICIENT_EVIDENCE') {
      // Not a server failure. The request was well-formed; the UNIT lacks the evidence
      // required to generate honestly. 422 = understood but unprocessable.
      console.log('improve-dx refused:', unit && unit.stock, err.message);
      return {
        statusCode: 422,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refused: 'INSUFFICIENT_EVIDENCE', error: err.message })
      };
    }
    console.error('improve-dx error:', err.message);
    const status = err.message.startsWith('Anthropic API') ? 502 : 500;
    return {
      statusCode: status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Unknown error' })
    };
  }
};
