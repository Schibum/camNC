/* eslint-disable @typescript-eslint/no-unused-vars */
export const cv2 = {
  matFromArray: (_rows: number, _cols: number, _type: number, data: number[]) => ({
    data32F: new Float32Array(data),
    delete: () => {},
  }),
  Mat: {
    zeros: (_rows: number, _cols: number, _type: number) => ({
      data32F: new Float32Array(5).fill(0),
      delete: () => {},
    }),
  },
  solvePnP: () => true,
  SOLVEPNP_AP3P: 0,
  Rodrigues: (rvec: any, R: any) => {
    // Simulate a rotation matrix
    R.data32F = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  },
};
