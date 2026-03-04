// Vercel Serverless Function: RSVP → Notion + Google Sheets
// Environment variables needed:
//   NOTION_API_KEY     - Your Notion integration token
//   NOTION_DATABASE_ID - b5b576c523364e418ce1fc0188e7b3b5

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { firstName, lastName, email, attending, guestCount, submittedAt } = req.body;

    if (!firstName || !lastName || !email || !attending) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ---- Write to Notion ----
    const notionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          'Guest Name': {
            title: [{ text: { content: `${firstName} ${lastName}` } }]
          },
          'Email': {
            email: email
          },
          'Attending': {
            select: { name: attending === 'yes' ? 'Yes' : 'No' }
          },
          'Number of Guests': {
            number: attending === 'yes' ? parseInt(guestCount) || 1 : 0
          },
          'Submitted At': {
            date: { start: submittedAt || new Date().toISOString() }
          }
        }
      })
    });

    if (!notionResponse.ok) {
      const err = await notionResponse.text();
      console.error('Notion error:', err);
      return res.status(500).json({ error: 'Failed to save to Notion' });
    }

    // ---- Write to Google Sheets (optional) ----
    // If you want Google Sheets too, uncomment and add:
    //   GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_KEY env vars
    //
    // const { google } = require('googleapis');
    // const auth = new google.auth.GoogleAuth({
    //   credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    //   scopes: ['https://www.googleapis.com/auth/spreadsheets']
    // });
    // const sheets = google.sheets({ version: 'v4', auth });
    // await sheets.spreadsheets.values.append({
    //   spreadsheetId: process.env.GOOGLE_SHEET_ID,
    //   range: 'Sheet1!A:F',
    //   valueInputOption: 'USER_ENTERED',
    //   requestBody: {
    //     values: [[firstName, lastName, email, attending, guestCount, submittedAt]]
    //   }
    // });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('RSVP error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
