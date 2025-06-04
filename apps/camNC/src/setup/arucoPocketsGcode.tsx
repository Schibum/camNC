export const gcodeHeader = `
; Assumes:
; - 3.175mm (1/8in) endmill
; - 30mm aruco tag size = 40mm including white margin + 0.15mm tolerance
; - 4mm pocket depth.
; - XY zero is set to machine zero, so using absolute machine coordinates.
G21
G90
G94
G10 L2 P0 X0 Y0
`;

export const pockets_40 = `
G0 Z8 F1200
X0.267 Y0.287 F9000
Z2.6 F1200
G1 Z2 F480
Z-3.683 F480
X0.253 Y0.306 Z-3.804 F480
X0.231 Y0.333 Z-3.856 F480
X0.206 Y0.356 Z-3.907 F480
X0.179 Y0.377 Z-3.93 F480
X0.15 Y0.395 Z-3.953 F480
X0.119 Y0.41 Z-3.976 F480
X0.08 Y0.422 Z-3.984 F480
X0.04 Y0.43 Z-3.992 F480
X0 Y0.433 Z-4 F480
X-0.113 F1800
G17 G3 X-0.433 Y0.113 J-0.319 F1800
G1 Y-0.113 F1800
G3 X-0.113 Y-0.433 I0.319 F1800
G1 X0.113 F1800
G3 X0.433 Y-0.113 J0.319 F1800
G1 Y0.113 F1800
G3 X0.113 Y0.433 I-0.319 F1800
G1 X0 F1800
G2 X-1.058 Y1.044 J1.221 F1800
G3 X-2.237 Y0.728 I-0.548 J-0.316 F1800
G1 Y-1.918 F1800
G3 X-1.918 Y-2.237 I0.319 F1800
G1 X1.918 F1800
G3 X2.237 Y-1.918 J0.319 F1800
G1 Y1.918 F1800
G3 X1.918 Y2.237 I-0.319 F1800
G1 X-1.918 F1800
G3 X-2.237 Y1.918 J-0.319 F1800
G1 Y0.728 F1800
G2 X-3.14 Y-0.626 I-1.467 F1800
G3 X-4.043 Y-1.98 I0.564 J-1.354 F1800
G1 Y-3.723 F1800
G3 X-3.723 Y-4.043 I0.319 F1800
G1 X3.723 F1800
G3 X4.043 Y-3.723 J0.319 F1800
G1 Y3.723 F1800
G3 X3.723 Y4.043 I-0.319 F1800
G1 X-3.723 F1800
G3 X-4.043 Y3.723 J-0.319 F1800
G1 Y-1.98 F1800
G2 X-4.945 Y-3.333 I-1.467 F1800
G3 X-5.847 Y-4.687 I0.564 J-1.354 F1800
G1 Y-5.528 F1800
G3 X-5.528 Y-5.847 I0.319 F1800
G1 X5.528 F1800
G3 X5.847 Y-5.528 J0.319 F1800
G1 Y5.528 F1800
G3 X5.528 Y5.847 I-0.319 F1800
G1 X-5.528 F1800
G3 X-5.847 Y5.528 J-0.319 F1800
G1 Y-4.687 F1800
G2 X-6.748 Y-6.051 I-1.484 F1800
G3 X-6.42 Y-7.653 I0.328 J-0.767 F1800
G1 X7.333 F1800
G3 X7.653 Y-7.333 J0.319 F1800
G1 Y7.333 F1800
G3 X7.333 Y7.653 I-0.319 F1800
G1 X-7.333 F1800
G3 X-7.653 Y7.333 J-0.319 F1800
G1 Y-7.333 F1800
G3 X-7.333 Y-7.653 I0.319 F1800
G1 X-6.42 F1800
G2 X-5.066 Y-8.555 J-1.467 F1800
G3 X-3.712 Y-9.458 I1.354 J0.564 F1800
G1 X9.138 F1800
G3 X9.458 Y-9.138 J0.319 F1800
G1 Y9.138 F1800
G3 X9.138 Y9.458 I-0.319 F1800
G1 X-9.138 F1800
G3 X-9.458 Y9.138 J-0.319 F1800
G1 Y-9.138 F1800
G3 X-9.138 Y-9.458 I0.319 F1800
G1 X-3.712 F1800
G2 X-2.358 Y-10.36 J-1.467 F1800
G3 X-1.005 Y-11.262 I1.354 J0.564 F1800
G1 X10.943 F1800
G3 X11.262 Y-10.943 J0.319 F1800
G1 Y10.943 F1800
G3 X10.943 Y11.262 I-0.319 F1800
G1 X-10.943 F1800
G3 X-11.262 Y10.943 J-0.319 F1800
G1 Y-10.943 F1800
G3 X-10.943 Y-11.262 I0.319 F1800
G1 X-1.005 F1800
G2 X0.349 Y-12.165 J-1.467 F1800
G3 X1.703 Y-13.068 I1.354 J0.564 F1800
G1 X12.748 F1800
G3 X13.068 Y-12.748 J0.319 F1800
G1 Y12.748 F1800
G3 X12.748 Y13.068 I-0.319 F1800
G1 X-12.748 F1800
G3 X-13.068 Y12.748 J-0.319 F1800
G1 Y-12.748 F1800
G3 X-12.748 Y-13.068 I0.319 F1800
G1 X1.703 F1800
G2 X3.057 Y-13.97 J-1.467 F1800
G3 X4.41 Y-14.873 I1.354 J0.564 F1800
G1 X14.553 F1800
G3 X14.873 Y-14.553 J0.319 F1800
G1 Y14.553 F1800
G3 X14.553 Y14.873 I-0.319 F1800
G1 X-14.553 F1800
G3 X-14.873 Y14.553 J-0.319 F1800
G1 Y-14.553 F1800
G3 X-14.553 Y-14.873 I0.319 F1800
G1 X4.41 F1800
G2 X5.764 Y-15.775 J-1.467 F1800
G3 X7.118 Y-16.677 I1.354 J0.564 F1800
G1 X16.358 F1800
G3 X16.677 Y-16.358 J0.319 F1800
G1 Y16.358 F1800
G3 X16.358 Y16.677 I-0.319 F1800
G1 X-16.358 F1800
G3 X-16.677 Y16.358 J-0.319 F1800
G1 Y-16.358 F1800
G3 X-16.358 Y-16.677 I0.319 F1800
G1 X7.118 F1800
G2 X8.475 Y-17.583 J-1.471 F1800
G3 X9.833 Y-18.487 I1.358 J0.566 F1800
G1 X18.487 F1800
Y18.487 F1800
X-18.487 F1800
Y-18.487 F1800
X9.833 F1800
X9.873 Y-18.484 Z-3.992 F1800
X9.913 Y-18.475 Z-3.984 F1800
X9.951 Y-18.461 Z-3.976 F1800
X9.981 Y-18.445 Z-3.953 F1800
X10.01 Y-18.426 Z-3.93 F1800
X10.036 Y-18.404 Z-3.907 F1800
X10.06 Y-18.38 Z-3.856 F1443
X10.081 Y-18.352 Z-3.804 F1443
X10.094 Y-18.332 Z-3.683 F1223
G0 Z8 F1200
`;

export const gcodeSuffix = `
G0 G53 Z0 F900
G0 X0 Y0 F9000
`;

export interface Point {
  x: number;
  y: number;
}

export function getPocketsGcode(corners: Point[], tagSize: number): string {
  if (tagSize !== 30) throw new Error('Only 30mm tag size is supported');
  return gcodeHeader + repeatGCodeAtCorners(pockets_40, corners) + gcodeSuffix;
}

// Repeat a block of G‑code at four arbitrary corner points.
function repeatGCodeAtCorners(gcode: string, corners: Point[]): string {
  if (corners.length !== 4) {
    throw new Error(`Expected 4 corner points, got ${corners.length}.`);
  }

  const srcLines = gcode.split(/\r?\n/);
  const out: string[] = [];

  corners.forEach(({ x: ox, y: oy }, idx) => {
    out.push(`;(--- COPY ${idx + 1}: offset X${ox} Y${oy} ---)`);
    srcLines.forEach(line => out.push(applyOffset(line, ox, oy)));
  });

  return out.join('\n');
}

function applyOffset(line: string, ox: number, oy: number): string {
  // Regex matches X or Y word followed by numeric literal, in either case.
  return line
    .replace(/([Xx])(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g, (m, axis, num) => {
      const shifted = parseFloat(num) + ox;
      return `${axis}${formatFloat(shifted)}`;
    })
    .replace(/([Yy])(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g, (m, axis, num) => {
      const shifted = parseFloat(num) + oy;
      return `${axis}${formatFloat(shifted)}`;
    });
}

function formatFloat(val: number): string {
  return parseFloat(val.toFixed(4)).toString();
}
