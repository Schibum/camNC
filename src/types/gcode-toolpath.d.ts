declare module 'gcode-toolpath' {
  export interface Vector3D {
    x: number;
    y: number;
    z: number;
  }

  export interface Modal {
    motion?: string;
    tool?: number;
    [key: string]: any;
  }

  export interface GCodeToolpathOptions {
    position?: Vector3D;
    addLine?: (modal: Modal, v1: Vector3D, v2: Vector3D) => void;
    addArcCurve?: (modal: Modal, v1: Vector3D, v2: Vector3D, v0: Vector3D) => void;
  }

  export interface GCodeCommand {
    type: string;
    x?: number;
    y?: number;
    z?: number;
    tool?: number;
    rapid?: boolean;
    [key: string]: any;
  }

  export default class GCodeToolpath {
    constructor(options?: GCodeToolpathOptions);
    loadFromFile(filePath: string, callback?: (err?: Error) => void): void;
    loadFromStringSync(gcode: string, callback?: (err?: Error) => void): void;
    forEach(callback: (command: GCodeCommand) => void): void;
  }
}
