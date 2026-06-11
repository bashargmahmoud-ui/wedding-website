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
    const {
      firstName, lastName, guestName, email, attending,
      welcomeDinner, plusOneName, plusOneAttending, submittedAt
    } = req.body;

    const fullName = (guestName || `${firstName || ''} ${lastName || ''}`).trim();

    if (!fullName || !email || !attending) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Derived headcount: the guest plus their plus-one, counting only attendees.
    const headcount =
      (attending === 'yes' ? 1 : 0) +
      (plusOneName && plusOneAttending === 'yes' ? 1 : 0);

    // ---- Write to Notion ----
    // Columns that always exist in the RSVP responses database.
    const baseProperties = {
      'Guest Name': {
        title: [{ text: { content: fullName } }]
      },
      'Email': {
        email: email
      },
      'Attending': {
        select: { name: attending === 'yes' ? 'Yes' : 'No' }
      },
      'Number of Guests': {
        number: headcount
      },
      'Submitted At': {
        date: { start: submittedAt || new Date().toISOString() }
      }
    };

    // Optional columns. If any don't exist yet, Notion rejects the whole write,
    // so we retry without them (below) to never lose an RSVP. Add these columns
    // to capture the data: "Welcome Dinner" (Select Yes/No),
    // "Plus One Name" (Text), "Plus One Attending" (Select Yes/No).
    const optionalProperties = {
      'Welcome Dinner': {
        select: { name: welcomeDinner === 'yes' ? 'Yes' : 'No' }
      }
    };
    if (plusOneName) {
      optionalProperties['Plus One Name'] = {
        rich_text: [{ text: { content: plusOneName } }]
      };
      optionalProperties['Plus One Attending'] = {
        select: { name: plusOneAttending === 'yes' ? 'Yes' : 'No' }
      };
    }

    const postToNotion = (properties) => fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties
      })
    });

    let notionResponse = await postToNotion({ ...baseProperties, ...optionalProperties });

    if (!notionResponse.ok) {
      const firstErr = await notionResponse.text();
      console.error('Notion error (with optional columns):', firstErr);
      // Fallback: save the core RSVP without the optional columns.
      notionResponse = await postToNotion(baseProperties);
      if (!notionResponse.ok) {
        const err = await notionResponse.text();
        console.error('Notion error (base):', err);
        return res.status(500).json({ error: 'Failed to save to Notion' });
      }
      console.warn('Saved RSVP without optional columns — add "Welcome Dinner", "Plus One Name", and "Plus One Attending" columns to capture them.');
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
