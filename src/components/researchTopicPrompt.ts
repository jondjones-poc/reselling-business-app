/**
 * The JSON contract between ChatGPT and Research → Topics.
 * Bump RESEARCH_TOPIC_SCHEMA_VERSION (and the server constant) if the shape changes.
 */
export const RESEARCH_TOPIC_SCHEMA_VERSION = 1;

export const RESEARCH_TOPIC_JSON_SHAPE = `{
  "schemaVersion": 1,
  "topic": "Wetsuits",
  "summary": "One paragraph: is this worth reselling in the UK, and why.",
  "seasonality": "When these sell best and when they are cheapest to buy secondhand.",
  "searchTags": ["rip curl wetsuit", "o'neill psycho tech", "xcel drylock"],
  "brands": [
    {
      "name": "Rip Curl",
      "tier": "premium",
      "resaleLowGbp": 60,
      "resaleHighGbp": 180,
      "buyMaxGbp": 25,
      "modelsToLookFor": ["Flashbomb", "E-Bomb"],
      "notes": "Flashbomb lining is the premium tell; check for a chest zip."
    }
  ],
  "items": [
    {
      "name": "Rip Curl Flashbomb 4/3 Chest Zip",
      "brand": "Rip Curl",
      "whatToLookFor": "Intact seams, flexible neoprene, working zip, no smell.",
      "redFlags": "Perished knees, delaminated seams, faded logo, mould.",
      "howToIdentify": "Internal neck label states model and thickness.",
      "valueLowGbp": 70,
      "valueHighGbp": 160
    }
  ]
}`;

/**
 * Prompt the user copies into ChatGPT. Asks for one fenced JSON block so the
 * answer can be pasted straight into the importer.
 */
export function buildResearchTopicPrompt(topicName: string): string {
  const topic = topicName.trim() || 'the topic';
  return [
    `I run a UK resale business. I buy at car boot sales and sell on eBay and Vinted.`,
    `I want to learn **${topic}** well enough to buy confidently in the field, quickly, from a stranger's table.`,
    ``,
    `Research ${topic} for the **UK secondhand market** and reply with **one JSON code block and nothing else**.`,
    `Use realistic UK secondhand eBay sold prices in GBP — not retail prices.`,
    ``,
    `Rules:`,
    `1. \`tier\` is one of: premium, mid, budget, avoid.`,
    `2. \`buyMaxGbp\` is the most I should pay at a boot sale to still make roughly 3x after fees.`,
    `3. Give 8–15 brands, weighted to what actually turns up secondhand in the UK.`,
    `4. Give 6–12 specific models under \`items\`, favouring ones with the biggest price spread between a good and a bad example.`,
    `5. \`searchTags\` should be 5–10 eBay search phrases that surface these items and little else.`,
    `6. \`redFlags\` and \`howToIdentify\` must be checkable in 30 seconds by hand, without a phone.`,
    `7. Omit a field entirely rather than guessing a number you are unsure about.`,
    ``,
    `Return exactly this shape:`,
    ``,
    '```json',
    RESEARCH_TOPIC_JSON_SHAPE,
    '```'
  ].join('\n');
}

/**
 * Pulls the JSON object out of whatever the user pasted: a bare object, a
 * ```json fenced block, or prose with an object somewhere inside it.
 */
export function extractJsonPayload(raw: string): unknown {
  const text = raw.trim();
  if (!text) throw new Error('Paste the JSON returned by ChatGPT first.');

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter((c): c is string => typeof c === 'string');

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          /* try the next candidate */
        }
      }
    }
  }

  throw new Error('Could not find valid JSON in that text.');
}
