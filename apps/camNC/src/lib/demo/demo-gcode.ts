/**
 * The demo job: a 200 × 100 mm nameplate with rounded corners, four mounting holes and an engraved
 * border. 6 mm flat endmill, work zero at the lower left corner of the part, Z zero on top of the
 * stock. It exercises lines, arcs and several depth passes, and fits the demo machine's bed.
 */
export const kDemoGcodeName = 'camNC demo nameplate.nc';

const kCornerRadius = 12;
const kWidth = 200;
const kHeight = 100;
const kTool = 6;

/**
 * Counter-clockwise tool path around the part, `offset` mm outside the outline (negative: inside).
 * Starts at the bottom edge, after the first corner.
 */
function profile(offset: number) {
  const r = kCornerRadius + offset;
  const x0 = -offset;
  const y0 = -offset;
  const x1 = kWidth + offset;
  const y1 = kHeight + offset;
  return {
    start: { x: x0 + r, y: y0 },
    cut: (depth: number) => [
      `G1 Z${depth} F400`,
      `G1 X${x1 - r} Y${y0} F1500`,
      `G3 X${x1} Y${y0 + r} I0 J${r}`,
      `G1 X${x1} Y${y1 - r}`,
      `G3 X${x1 - r} Y${y1} I${-r} J0`,
      `G1 X${x0 + r} Y${y1}`,
      `G3 X${x0} Y${y1 - r} I0 J${-r}`,
      `G1 X${x0} Y${y0 + r}`,
      `G3 X${x0 + r} Y${y0} I${r} J0`,
    ],
  };
}

function hole(cx: number, cy: number, radius: number, depth: number) {
  return ['G0 Z5', `G0 X${cx + radius} Y${cy}`, `G1 Z${depth} F400`, `G3 X${cx + radius} Y${cy} I${-radius} J0 F1200`];
}

export function demoGcode() {
  const border = profile(-10);
  const outline = profile(kTool / 2);
  const lines = [
    '(camNC demo nameplate)',
    `(Tool: ${kTool} mm flat endmill, work zero lower left, Z zero on top of the stock)`,
    'G21 G90 G17',
    'M3 S12000',
    'G0 Z5',
    '(engraved border, 1.5 mm deep)',
    `G0 X${border.start.x} Y${border.start.y}`,
    ...border.cut(-1.5),
    '(mounting holes, 4 mm deep)',
    ...[
      [20, 20],
      [kWidth - 20, 20],
      [kWidth - 20, kHeight - 20],
      [20, kHeight - 20],
    ].flatMap(([x, y]) => hole(x!, y!, 2, -4)),
    '(outline, three passes)',
    ...[-4, -8, -12].flatMap(depth => ['G0 Z5', `G0 X${outline.start.x} Y${outline.start.y}`, ...outline.cut(depth)]),
    'G0 Z10',
    'M5',
    'G0 X0 Y0',
    'M30',
  ];
  return lines.join('\n') + '\n';
}
