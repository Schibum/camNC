declare module 'occt-import-js' {
  export interface OcctMesh {
    name: string;
    color?: [number, number, number];
    brep_faces: { first: number; last: number; color: [number, number, number] | null }[];
    attributes: { position: { array: number[] }; normal?: { array: number[] } };
    index: { array: number[] };
  }
  export interface OcctNode {
    name: string;
    meshes: number[];
    children: OcctNode[];
  }
  export interface OcctResult {
    success: boolean;
    root: OcctNode;
    meshes: OcctMesh[];
  }
  export interface OcctParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }
  export interface OcctModule {
    ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
    ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult;
    ReadBrepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  }
  export default function occtimportjs(opts?: { locateFile?: (path: string) => string }): Promise<OcctModule>;
}
