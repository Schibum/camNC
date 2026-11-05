#!/usr/bin/env node
// Writes one <id>.step per board in boards.json: each part's polygon extruded straight up, where it lies on the board.
//   node generate.mjs          write the STEP files
//   node generate.mjs --check  fail if the checked-in files differ from what this script writes
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('./', import.meta.url);

// Short but exact: sources have 0.1 mm coordinates, unit vectors need the digits to stay on their lines.
const real = (v, digits) => {
  const s = v.toFixed(digits).replace(/0+$/, '');
  return s === '-0.' ? '0.' : s;
};
const signedArea = loop =>
  loop.reduce((s, [x, y], i) => s + x * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * y, 0) / 2;
const withoutRepeats = loop =>
  loop.filter(([x, y], i) => {
    const [px, py] = loop[(i + loop.length - 1) % loop.length];
    return x !== px || y !== py;
  });
const wound = (loop, ccw) => (signedArea(loop) > 0 === ccw ? loop : [...loop].reverse());

/** AP203 B-rep of closed prisms in millimetres, planes and lines only; shared points and directions keep it small. */
export function stepFile(board) {
  const rows = [];
  const ent = s => {
    rows.push(`#${rows.length + 1}=${s};`);
    return `#${rows.length}`;
  };
  const once = (cache, key, make) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };
  const dirs = new Map();
  const direction = ([x, y, z]) => {
    const text = `${real(x, 11)},${real(y, 11)},${real(z, 11)}`;
    return once(dirs, text, () => ent(`DIRECTION('',(${text}))`));
  };
  const up = direction([0, 0, 1]);
  const down = direction([0, 0, -1]);
  const right = direction([1, 0, 0]);

  const solids = board.parts.map(part => {
    const points = new Map();
    const edges = new Map();
    const point = p => {
      const text = p.map(v => real(v, 3)).join(',');
      return once(points, text, () => {
        const at = ent(`CARTESIAN_POINT('',(${text}))`);
        return { at, vertex: ent(`VERTEX_POINT('',${at})`) };
      });
    };
    const orientedEdge = (a, b) => {
      const [pa, pb] = [point(a), point(b)];
      const [key, reversed] = pa.vertex < pb.vertex ? [`${pa.vertex}|${pb.vertex}`, false] : [`${pb.vertex}|${pa.vertex}`, true];
      const edge = once(edges, key, () => {
        const delta = b.map((v, i) => v - a[i]);
        const length = Math.hypot(...delta);
        const vector = ent(`VECTOR('',${direction(delta.map(v => v / length))},${real(length, 6)})`);
        return { curve: ent(`EDGE_CURVE('',${pa.vertex},${pb.vertex},${ent(`LINE('',${pa.at},${vector})`)},.T.)`), reversed };
      });
      return ent(`ORIENTED_EDGE('',*,*,${edge.curve},${edge.reversed === reversed ? '.T.' : '.F.'})`);
    };
    const loopOf = pts => ent(`EDGE_LOOP('',(${pts.map((p, i) => orientedEdge(p, pts[(i + 1) % pts.length])).join(',')}))`);
    const plane = (origin, normal, refDir) => ent(`PLANE('',${ent(`AXIS2_PLACEMENT_3D('',${point(origin).at},${normal},${refDir})`)})`);

    // Material on the left of every loop, seen from above: the outline counter-clockwise, its holes clockwise.
    const outer = wound(withoutRepeats(part.outer), true);
    const holes = part.holes.map(h => wound(withoutRepeats(h), false));
    const t = board.thickness;
    const level = (loop, z) => loop.map(([x, y]) => [x, y, z]);
    const cap = (z, normal, order) => {
      const [first, ...rest] = [outer, ...holes].map(l => loopOf(order(level(l, z))));
      const bounds = [ent(`FACE_OUTER_BOUND('',${first},.T.)`), ...rest.map(l => ent(`FACE_BOUND('',${l},.T.)`))];
      return ent(`ADVANCED_FACE('',(${bounds.join(',')}),${plane(level(outer, z)[0], normal, right)},.T.)`);
    };
    const faces = [cap(0, down, l => [...l].reverse()), cap(t, up, l => l)];
    for (const loop of [outer, ...holes])
      loop.forEach((a, i) => {
        const b = loop[(i + 1) % loop.length];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const along = [(b[0] - a[0]) / length, (b[1] - a[1]) / length, 0];
        const bound = ent(
          `FACE_OUTER_BOUND('',${loopOf([
            [...a, 0],
            [...b, 0],
            [...b, t],
            [...a, t],
          ])},.T.)`
        );
        const outward = direction([along[1], -along[0], 0]);
        faces.push(ent(`ADVANCED_FACE('',(${bound}),${plane([...a, 0], outward, direction(along))},.T.)`));
      });
    return { name: part.name, brep: ent(`MANIFOLD_SOLID_BREP('${part.name}',${ent(`CLOSED_SHELL('',(${faces.join(',')}))`)})`) };
  });

  const mm = ent('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const rad = ent('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const sr = ent('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = ent(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.000001),${mm},'distance_accuracy_value','')`);
  const ctx = ent(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('',''))`
  );
  const app = ent("APPLICATION_CONTEXT('configuration controlled 3d designs of mechanical parts and assemblies')");
  const productContext = ent(`PRODUCT_CONTEXT('',${app},'mechanical')`);
  const definitionContext = ent(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`);
  // One product per solid, like the CAD exports next to this folder: it's the product's name a body gets on import.
  for (const { name, brep } of solids) {
    const product = ent(`PRODUCT('${name}','${name}','',(${productContext}))`);
    const formation = ent(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',${product},.NOT_KNOWN.)`);
    const definition = ent(`PRODUCT_DEFINITION('design','',${formation},${definitionContext})`);
    const shape = ent(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
    ent(`SHAPE_DEFINITION_REPRESENTATION(${shape},${ent(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${brep}),${ctx})`)})`);
  }

  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('Generated test geometry, polygon extrusions'),'2;1');",
    `FILE_NAME('${board.id}.step','2026-01-01T00:00:00',(''),(''),'','','');`,
    "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));",
    'ENDSEC;',
    'DATA;',
    ...rows,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

const check = process.argv.includes('--check');
const boards = JSON.parse(readFileSync(new URL('boards.json', dir), 'utf8'));
const stale = [];
for (const board of boards) {
  const url = new URL(`${board.id}.step`, dir);
  const text = stepFile(board);
  if (!check) writeFileSync(url, text);
  else if (readFileSync(url, 'utf8') !== text) stale.push(board.id);
}
if (stale.length) {
  console.error(`Out of date, run generate.mjs: ${stale.join(', ')}`);
  process.exit(1);
}
