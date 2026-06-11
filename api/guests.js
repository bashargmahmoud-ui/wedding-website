// Vercel Serverless Function: Guest-list lookup for invite-only RSVP
// Environment variables:
//   NOTION_API_KEY        - Notion integration token (same one used by rsvp.js)
//   GUESTLIST_DATABASE_ID - the guest-list table's database id
//
// Guest-list table columns (names matter for "Plus One Name"; the title can be
// named anything — we auto-detect it):
//   <title>          - the full invited name, e.g. "Caline Khoury"
//   "Plus One Name"  - text; the plus-one's full name, blank if none
//
// The list is queried server-side only and never sent to the browser in bulk —
// a guest must type their exact (normalized) name to get their own record back.

// Normalize for forgiving comparison: strip accents, lowercase, drop punctuation,
// collapse whitespace.
function normalize(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleText(props) {
  for (const key of Object.keys(props || {})) {
    const p = props[key];
    if (p && p.type === 'title') return (p.title || []).map(t => t.plain_text).join('');
  }
  return '';
}

function richText(prop) {
  if (!prop) return '';
  if (prop.type === 'rich_text') return (prop.rich_text || []).map(t => t.plain_text).join('');
  if (prop.type === 'title') return (prop.title || []).map(t => t.plain_text).join('');
  return '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dbId = process.env.GUESTLIST_DATABASE_ID;
  // Not configured yet → tell the front-end to fall back to the open form so
  // RSVP keeps working until the guest list is set up.
  if (!dbId || !process.env.NOTION_API_KEY) {
    return res.status(200).json({ configured: false });
  }

  try {
    const { firstName = '', lastName = '' } = req.body || {};
    const target = normalize(`${firstName} ${lastName}`);
    if (!target) return res.status(400).json({ error: 'Name is required' });

    // Scan the guest list (paginated), comparing the normalized title to the
    // typed name. Capped to keep it bounded for any realistic guest list.
    let cursor = undefined;
    let match = null;
    for (let page = 0; page < 12 && !match; page++) {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify(body)
      });

      if (!r.ok) {
        console.error('Notion guest-list query error:', await r.text());
        return res.status(200).json({ configured: true, found: false });
      }

      const data = await r.json();
      for (const pg of (data.results || [])) {
        const name = titleText(pg.properties || {});
        if (normalize(name) === target) {
          const plusOne = richText((pg.properties || {})['Plus One Name']).trim();
          match = {
            name: name.trim(),
            firstName: name.trim().split(/\s+/)[0] || firstName,
            plusOneName: plusOne || null
          };
          break;
        }
      }

      if (!data.has_more) break;
      cursor = data.next_cursor;
    }

    if (!match) return res.status(200).json({ configured: true, found: false });
    return res.status(200).json({ configured: true, found: true, ...match });

  } catch (error) {
    console.error('Guest lookup error:', error);
    return res.status(500).json({ error: 'Lookup failed' });
  }
}
