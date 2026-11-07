/** Two thick parts and one thin back: enough for two boards, without CAD import or pocketing in layout tests. */
export function boardLayoutFile(
  boxes = [
    { x: 0, w: 560, h: 360, t: 8 },
    { x: 600, w: 560, h: 350, t: 8 },
    { x: 1200, w: 300, h: 400, t: 3 },
  ]
): File {
  const triangles = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const data = new ArrayBuffer(84 + boxes.length * triangles.length * 50);
  const view = new DataView(data);
  view.setUint32(80, boxes.length * triangles.length, true);
  let offset = 84;
  for (const { x, w, h, t } of boxes) {
    const vertices = [
      [x, 0, 0],
      [x + w, 0, 0],
      [x + w, h, 0],
      [x, h, 0],
      [x, 0, t],
      [x + w, 0, t],
      [x + w, h, t],
      [x, h, t],
    ];
    for (const triangle of triangles) {
      triangle.flatMap(i => vertices[i]).forEach((value, i) => view.setFloat32(offset + 12 + i * 4, value, true));
      offset += 50;
    }
  }
  return new File([data], 'board-layout.stl');
}
