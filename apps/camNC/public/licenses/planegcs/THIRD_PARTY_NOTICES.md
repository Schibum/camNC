# CAD solver third-party notices

camNC loads the unmodified JavaScript bindings and separate WebAssembly module
from **`@salusoft89/planegcs` 1.3.0**. The surrounding application is Apache-2.0;
that license does not replace the licenses below. All files in this notice's
`licenses/` directory are also distributed at `/licenses/planegcs/` in the built
web application, with this notice named `THIRD_PARTY_NOTICES.md`.

## PlaneGCS wrapper and FreeCAD solver

- Wrapper: Copyright (C) 2023 Miroslav Šerý, Salusoft89. Generated bindings also
  credit Jiří Hon. Source headers specify LGPL-2.1-or-later; the npm metadata says
  LGPL-2.0-or-later. The full upstream LGPL-2.1 license is preserved in
  `PlaneGCS-LGPL-2.1.txt`.
- Native solver: FreeCAD PlaneGCS, including copyright notices of Konstantinos
  Poulios, Victor Titov and other contributors preserved in the source archive.
  Those source headers specify GNU Library GPL version 2 or later. Its full
  version 2 license is in `FreeCAD-LGPL-2.0.txt`.
- Published package: https://www.npmjs.com/package/@salusoft89/planegcs/v/1.3.0
- Pinned wrapper/build source:
  https://github.com/Salusoft89/planegcs/tree/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7
- The pinned source's `planegcs/commit.txt` identifies FreeCAD commit
  `5f8eac49f31626354ee69bf40616bac801ca5560`.

The npm tarball includes wrapper TypeScript and compiled JavaScript/WASM, but
does **not** include the native C++ solver source. The accompanying
`planegcs-1.3.0-source.tgz` therefore preserves the pinned upstream native
solver, wrapper, bindings generator, build scripts and notices, plus the
published generated TypeScript bindings. It contains source, not compiled
outputs. `manifest.json` records provenance and SHA-256 checksums of the source
archive, license files and exact distributed WASM binary.

To rebuild the library, extract the archive, follow its README's Developing
section, and use its Dockerfile/package scripts (`build:docker`,
`build:bindings`, `build:wasm`, `prepack`). The native bindings are generated from
the included C++ headers. The upstream Dockerfile pins Emscripten 6.0.10 but
installs Eigen and Boost through unversioned apt packages; their exact original
versions were not recorded upstream. This source enables modification and
rebuilding; a bit-identical reproduction of upstream's binary is not asserted.

To use a modified library, replace the dependency with your rebuilt package and
rebuild camNC, or replace the separately served `planegcs-*.wasm` asset in a local
deployment with an ABI-compatible rebuild. The application's adapter source is
in `packages/cad/src/solver.ts`. Nothing in the application's license restricts
reverse engineering needed to debug modifications to this LGPL library.

## Compiled-in build dependencies

- **Eigen 3**: Mozilla Public License 2.0, `Eigen-MPL-2.0.txt`.
  Source and per-file copyright notices: https://gitlab.com/libeigen/eigen
- **Boost**: Boost Software License 1.0, `Boost-1.0.txt`.
  Source and per-file copyright notices: https://www.boost.org/
- **Emscripten 6.0.10**: MIT and University of Illinois/NCSA dual license,
  `Emscripten-LICENSE.txt`. Copyright (c) 2010-2014 Emscripten authors.
  https://github.com/emscripten-core/emscripten/tree/6.0.10

These notices describe the solver's known upstream build dependencies, not a
complete license inventory for every package in the application. The original
copyright and license notices remain in the accompanying source files.
