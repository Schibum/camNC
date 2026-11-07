import applicationLicense from '../../../../LICENSE?raw';
import notice from '../../../../packages/cad/THIRD_PARTY_NOTICES.md?raw';
import lgpl21 from '../../../../packages/cad/licenses/PlaneGCS-LGPL-2.1.txt?raw';
import lgpl20 from '../../../../packages/cad/licenses/FreeCAD-LGPL-2.0.txt?raw';
import eigen from '../../../../packages/cad/licenses/Eigen-MPL-2.0.txt?raw';
import boost from '../../../../packages/cad/licenses/Boost-1.0.txt?raw';
import emscripten from '../../../../packages/cad/licenses/Emscripten-LICENSE.txt?raw';
import manifestText from '../../../../packages/cad/licenses/manifest.json?raw';

const base = '/licenses/planegcs/';
const manifest = JSON.parse(manifestText) as { version: string; sourceArchive: string; upstreamSource: string };

export const solverDistribution = {
  notice,
  noticeUrl: `${base}THIRD_PARTY_NOTICES.md`,
  sourceUrl: `${base}${manifest.sourceArchive}`,
  upstreamSource: manifest.upstreamSource,
  manifestUrl: `${base}manifest.json`,
};

export const applicationDistribution = {
  text: applicationLicense,
  licenseUrl: '/licenses/camNC-Apache-2.0.txt',
};

export const dependencyLicenses = [
  {
    id: 'planegcs',
    name: `PlaneGCS ${manifest.version}`,
    description:
      'JavaScript bindings for the CAD constraint solver. Copyright © 2023 Miroslav Šerý, Salusoft89; generated bindings also credit Jiří Hon.',
    license: 'LGPL 2.1 or later',
    text: lgpl21,
    url: `${base}PlaneGCS-LGPL-2.1.txt`,
  },
  {
    id: 'freecad',
    name: 'FreeCAD PlaneGCS',
    description:
      'Native geometric solver. Copyright notices for Konstantinos Poulios, Victor Titov and other contributors are preserved in the accompanying source.',
    license: 'GNU Library GPL 2 or later',
    text: lgpl20,
    url: `${base}FreeCAD-LGPL-2.0.txt`,
  },
  {
    id: 'eigen',
    name: 'Eigen 3',
    description: 'Linear algebra used by the solver.',
    license: 'Mozilla Public License 2.0',
    text: eigen,
    url: `${base}Eigen-MPL-2.0.txt`,
  },
  {
    id: 'boost',
    name: 'Boost',
    description: 'C++ libraries used by the solver.',
    license: 'Boost Software License 1.0',
    text: boost,
    url: `${base}Boost-1.0.txt`,
  },
  {
    id: 'emscripten',
    name: 'Emscripten 6.0.10',
    description: 'WebAssembly build runtime. Copyright © 2010–2014 Emscripten authors.',
    license: 'MIT / University of Illinois NCSA',
    text: emscripten,
    url: `${base}Emscripten-LICENSE.txt`,
  },
] as const;
