// Vercel Serverless Function: Ask AI → Claude API
// Environment variables needed:
//   ANTHROPIC_API_KEY - Your Anthropic API key

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_PROMPT } from './system-prompt.js';

// Load the source-of-truth knowledge base once per cold start.
// Edit api/knowledge.md to change what the concierge knows.
//
// NOTE: do NOT use import.meta.url here. Vercel transpiles these functions to
// CommonJS, where import.meta is a syntax error that crashes the function.
// At runtime the working directory is the task root (/var/task) and
// knowledge.md is shipped alongside via "includeFiles" in vercel.json, so we
// resolve it from process.cwd() instead.
let KNOWLEDGE_BASE = '';
for (const candidate of [
  join(process.cwd(), 'api', 'knowledge.md'),
  join(process.cwd(), 'knowledge.md'),
]) {
  try {
    KNOWLEDGE_BASE = readFileSync(candidate, 'utf8');
    if (KNOWLEDGE_BASE) break;
  } catch (err) {
    // not at this path — try the next candidate
  }
}
if (!KNOWLEDGE_BASE) {
  console.error('Could not load knowledge.md from any known path');
}

const FULL_SYSTEM_PROMPT = KNOWLEDGE_BASE
  ? `${SYSTEM_PROMPT}\n\n# KNOWLEDGE BASE (your only source of facts)\n\n${KNOWLEDGE_BASE}`
  : SYSTEM_PROMPT;

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Rate limiting: max message length
    if (message.length > 500) {
      return res.status(400).json({ error: 'Message too long. Please keep it under 500 characters.' });
    }

    // Build conversation history (keep last 6 messages for context)
    const recentHistory = history.slice(-6).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const messages = [
      ...recentHistory,
      { role: 'user', content: message }
    ];

    // Call Claude API (using Haiku for speed + low cost)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: FULL_SYSTEM_PROMPT,
        messages: messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(500).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await response.json();
    const reply = data.content[0]?.text || "I'm sorry, I couldn't process that. Please try again!";

    return res.status(200).json({
      reply: reply,
      usage: {
        input_tokens: data.usage?.input_tokens,
        output_tokens: data.usage?.output_tokens
      }
    });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
