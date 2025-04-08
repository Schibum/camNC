export type ToolInfo = {
  tool: number;
  diameter: number;
  taper?: number;
  name: string;
  isFlat: boolean;
};

/** Try to guess tool information from fusion360 gcode */
export function parseToolInfo(gcode: string): ToolInfo[] {
  const lines = gcode.split(/\r?\n/);
  // Find the index of the "Tools Table:" line (case-insensitive)
  const toolsTableIndex = lines.findIndex(line => /tools table:/i.test(line));
  if (toolsTableIndex === -1) {
    return [];
  }
  // Limit to 10 lines below the "Tools Table:" line
  const searchLines = lines.slice(toolsTableIndex + 1, toolsTableIndex + 11).join('\n');

  const toolInfo: ToolInfo[] = [];
  // The regex now captures:
  //  - Group 1: the tool number (after "T")
  //  - Group 2: the diameter from D=...
  //  - Group 3 (optional): the taper value from TAPER=...deg
  //  - Group 4: the tool name (after the final "-" delimiter)
  // It handles lines starting with either '(' or ';' and accepts either a closing parenthesis or end-of-line.
  const toolRegex =
    /[;(]\s*T(\d+)\s+D=(\d+)(?:\s+CR=\d+)?(?:\s+TAPER=(\d+)deg)?(?:\s+-\s+ZMIN=-?\d+(?:\.\d+)?)?\s+-\s+(.+?)(?:\s*\)|\s*$)/gm;

  let match: RegExpExecArray | null;
  while ((match = toolRegex.exec(searchLines)) !== null) {
    const toolNumber = parseInt(match[1], 10);
    const diameter = parseFloat(match[2]);
    const taper = match[3] ? parseFloat(match[3]) : undefined;
    const name = match[4].trim();
    const isFlat = name.toLowerCase().includes('flat');
    toolInfo.push({
      tool: toolNumber,
      diameter,
      ...(taper !== undefined && { taper }),
      name,
      isFlat,
    });
  }

  return toolInfo;
}
