/**
 * SKILL.md Parser
 *
 * Parses SKILL.md content with YAML frontmatter and markdown body.
 * Extracts structured metadata for storage and a one-line summary
 * for lightweight agent discovery by the Lean orchestrator.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface SkillFrontmatter {
  name?: string;
  version?: string;
  description?: string;
  webhook_url?: string;
  [key: string]: any;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
  summary: string; // One-line summary for lightweight discovery
  version: string | null;
  sections: {
    whenToTrigger?: string;
    whatINeed?: string;
    whatIDo?: string;
    dontTrigger?: string;
  };
}

// ============================================================================
// FRONTMATTER PARSING
// ============================================================================

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Supports the standard --- delimiters.
 * Uses a lightweight parser (no external dependency) for simple key: value pairs.
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const trimmed = content.trim();

  // Check for frontmatter delimiters
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }

  // Find the closing delimiter
  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const frontmatterRaw = trimmed.substring(3, endIndex).trim();
  const body = trimmed.substring(endIndex + 3).trim();

  // Parse simple YAML key: value pairs
  const frontmatter: SkillFrontmatter = {};
  for (const line of frontmatterRaw.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

// ============================================================================
// SECTION EXTRACTION
// ============================================================================

/**
 * Extract named sections from the markdown body.
 * Looks for ## headings matching known patterns.
 */
function extractSections(body: string): ParsedSkill['sections'] {
  const sections: ParsedSkill['sections'] = {};

  const sectionPatterns: Array<{
    key: keyof ParsedSkill['sections'];
    patterns: RegExp[];
  }> = [
    {
      key: 'whenToTrigger',
      patterns: [/^##\s+when\s+to\s+trigger/i, /^##\s+trigger\s+conditions/i, /^##\s+triggers/i],
    },
    {
      key: 'whatINeed',
      patterns: [/^##\s+what\s+i\s+need/i, /^##\s+requirements/i, /^##\s+inputs/i],
    },
    {
      key: 'whatIDo',
      patterns: [/^##\s+what\s+i\s+do/i, /^##\s+behavior/i, /^##\s+actions/i],
    },
    {
      key: 'dontTrigger',
      patterns: [
        /^##\s+don'?t\s+trigger/i,
        /^##\s+do\s+not\s+trigger/i,
        /^##\s+exclusions/i,
        /^##\s+when\s+not\s+to/i,
      ],
    },
  ];

  const lines = body.split('\n');
  let currentKey: keyof ParsedSkill['sections'] | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    // Check if this line is a heading that matches a known section
    let matchedKey: keyof ParsedSkill['sections'] | null = null;
    for (const { key, patterns } of sectionPatterns) {
      if (patterns.some((p) => p.test(line))) {
        matchedKey = key;
        break;
      }
    }

    if (matchedKey) {
      // Save previous section
      if (currentKey && currentContent.length > 0) {
        sections[currentKey] = currentContent.join('\n').trim();
      }
      currentKey = matchedKey;
      currentContent = [];
    } else if (currentKey) {
      // If we hit another ## heading that's not a known section, close current section
      if (/^##\s/.test(line)) {
        sections[currentKey] = currentContent.join('\n').trim();
        currentKey = null;
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }
  }

  // Save last section
  if (currentKey && currentContent.length > 0) {
    sections[currentKey] = currentContent.join('\n').trim();
  }

  return sections;
}

// ============================================================================
// SUMMARY GENERATION
// ============================================================================

/**
 * Generate a one-line summary from the SKILL.md content.
 * Priority: frontmatter description > first # heading > first paragraph.
 */
function generateSummary(frontmatter: SkillFrontmatter, body: string): string {
  // 1. Use frontmatter description if available
  if (frontmatter.description) {
    return truncate(frontmatter.description, 500);
  }

  const lines = body.split('\n').filter((l) => l.trim().length > 0);

  // 2. Use first paragraph after the # heading
  let foundHeading = false;
  for (const line of lines) {
    if (/^#\s/.test(line)) {
      foundHeading = true;
      continue;
    }
    if (foundHeading && !line.startsWith('#')) {
      return truncate(line.trim(), 500);
    }
  }

  // 3. Use first non-heading line
  for (const line of lines) {
    if (!line.startsWith('#')) {
      return truncate(line.trim(), 500);
    }
  }

  // 4. Use the frontmatter name as last resort
  if (frontmatter.name) {
    return frontmatter.name;
  }

  return '';
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// ============================================================================
// MAIN PARSER
// ============================================================================

/**
 * Parse a SKILL.md file into structured data.
 *
 * @param content - Raw SKILL.md content
 * @returns ParsedSkill with frontmatter, body, summary, version, and sections
 */
export function parseSkillMd(content: string): ParsedSkill {
  const { frontmatter, body } = parseFrontmatter(content);
  const sections = extractSections(body);
  const summary = generateSummary(frontmatter, body);
  const version = (frontmatter.version as string) || null;

  return {
    frontmatter,
    body,
    summary,
    version,
    sections,
  };
}
