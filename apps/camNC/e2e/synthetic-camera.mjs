/**
 * Browser-only camera fixture. Install with page.addInitScript(installSyntheticCamera).
 *
 * The application still receives a real canvas MediaStream, finds image corners in
 * its OpenCV worker, and runs its normal calibration/PnP solvers. Nothing reaches
 * into the application stores or replaces detector/solver results.
 *
 * Use window.__camncSmokeCamera.setPose(index) between calibration captures, then
 * setScene('markers') for the machine-position steps. Poses stay still until the
 * test advances them, so capture progress can drive the test instead of sleeps.
 */
export function installSyntheticCamera() {
  const width = 960;
  const height = 720;
  const focalLength = 900;
  const fps = 10;
  const deviceId = 'camnc-smoke-camera';
  const label = 'camNC smoke camera';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The synthetic camera requires Canvas 2D');

  // Opposite tilts differ by 80 degrees. Adjacent depth layers differ by more
  // than the board diagonal. Both exceed the real pose uniqueness gate.
  const poses = [15, 28, 41].flatMap(z => [-40, 40].flatMap(rx => [-40, 40].map(ry => ({ rx, ry, rz: 0, x: 0, y: 0, z }))));
  const markerPositions = [
    [50, 50, 0],
    [50, 450, 0],
    [550, 450, 0],
    [550, 50, 0],
  ];
  const tagSize = 50;
  // OpenCV DICT_4X4_50 IDs 0..3, interior rows, white=1. Every tag also
  // includes a one-cell black border; there are six cells across its width.
  const markerBits = [
    ['1011', '0101', '0011', '0010'],
    ['0000', '1111', '1001', '1010'],
    ['0011', '0011', '0010', '1101'],
    ['1001', '1001', '0100', '0110'],
  ];
  let poseIndex = 0;
  let scene = 'chessboard';
  let mediaRequests = 0;
  const tracks = new Set();

  function projectBoard(x, y) {
    const pose = poses[poseIndex];
    const rx = (pose.rx * Math.PI) / 180;
    const ry = (pose.ry * Math.PI) / 180;
    // R = Ry * Rx, followed by translation. Board units are square widths.
    const tiltedY = Math.cos(rx) * y;
    const tiltedZ = Math.sin(rx) * y;
    const cameraX = Math.cos(ry) * x + Math.sin(ry) * tiltedZ + pose.x;
    const cameraY = tiltedY + pose.y;
    const cameraZ = -Math.sin(ry) * x + Math.cos(ry) * tiltedZ + pose.z;
    return [width / 2 + (focalLength * cameraX) / cameraZ, height / 2 + (focalLength * cameraY) / cameraZ];
  }

  function projectMachine(x, y) {
    // Top-down camera at world [300,250,850], R=diag(1,-1,-1),
    // t=[-300,250,850]. Machine +Y points toward the top of the image.
    return [width / 2 + (focalLength * (x - 300)) / 850, height / 2 + (focalLength * (250 - y)) / 850];
  }

  function polygon(points, color) {
    context.fillStyle = color;
    context.beginPath();
    points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)));
    context.closePath();
    context.fill();
  }

  function boardRectangle(x, y, rectangleWidth, rectangleHeight, color) {
    polygon(
      [
        projectBoard(x, y),
        projectBoard(x + rectangleWidth, y),
        projectBoard(x + rectangleWidth, y + rectangleHeight),
        projectBoard(x, y + rectangleHeight),
      ],
      color
    );
  }

  function machineSquare(left, top, size, color) {
    polygon(
      [
        projectMachine(left, top),
        projectMachine(left + size, top),
        projectMachine(left + size, top - size),
        projectMachine(left, top - size),
      ],
      color
    );
  }

  function render() {
    context.fillStyle = scene === 'chessboard' ? '#b8b8b8' : '#ffffff';
    context.fillRect(0, 0, width, height);
    if (scene === 'chessboard') {
      // 10x7 squares produce the application's default 9x6 internal corners.
      // A white outer margin helps the SB detector recognise boundary squares.
      boardRectangle(-5.75, -4.25, 11.5, 8.5, '#ffffff');
      for (let row = 0; row < 7; row++) {
        for (let column = 0; column < 10; column++) {
          if ((row + column) % 2 === 0) boardRectangle(column - 5, row - 3.5, 1, 1, '#000000');
        }
      }
    } else if (scene === 'markers') {
      const cell = tagSize / 6;
      markerPositions.forEach(([x, y], id) => {
        const left = x - tagSize / 2;
        const top = y + tagSize / 2;
        machineSquare(left, top, tagSize, '#000000');
        markerBits[id].forEach((row, rowIndex) => {
          [...row].forEach((bit, columnIndex) => {
            if (bit === '1') machineSquare(left + (columnIndex + 1) * cell, top - (rowIndex + 1) * cell, cell, '#ffffff');
          });
        });
      });
    }
  }

  render();
  // Drawing unchanged pixels still produces live frames. A test must be able to
  // wait for a capture without changing the board while the detector is busy.
  setInterval(render, 1000 / fps);

  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices) throw new Error('Run the smoke test on HTTPS or localhost');
  Object.defineProperty(mediaDevices, 'enumerateDevices', {
    configurable: true,
    value: async () => [
      {
        kind: 'videoinput',
        deviceId,
        groupId: deviceId,
        label,
        toJSON() {
          return { kind: this.kind, deviceId, groupId: deviceId, label };
        },
      },
    ],
  });
  Object.defineProperty(mediaDevices, 'getUserMedia', {
    configurable: true,
    value: async constraints => {
      if (!constraints?.video) throw new Error('The synthetic camera supports video requests only');
      mediaRequests++;
      // Each request owns fresh tracks. Stopping the permission-probe stream or
      // reconnecting the app must not stop a later stream from this canvas.
      const stream = canvas.captureStream(fps);
      stream.getVideoTracks().forEach(track => {
        tracks.add(track);
        const getSettings = track.getSettings.bind(track);
        Object.defineProperty(track, 'label', { configurable: true, value: label });
        Object.defineProperty(track, 'getSettings', {
          configurable: true,
          value: () => ({ ...getSettings(), deviceId, groupId: deviceId, facingMode: 'environment' }),
        });
      });
      return stream;
    },
  });

  window.__camncSmokeCamera = {
    width,
    height,
    poses,
    cameraMatrix: [
      [focalLength, 0, width / 2],
      [0, focalLength, height / 2],
      [0, 0, 1],
    ],
    markers: { positions: markerPositions, tagSize, bounds: [0, 0, 600, 500], cameraPosition: [300, 250, 850] },
    setPose(index) {
      if (!Number.isInteger(index) || !poses[index]) throw new Error(`Unknown synthetic camera pose: ${index}`);
      poseIndex = index;
      scene = 'chessboard';
      render();
    },
    setScene(nextScene) {
      if (!['chessboard', 'markers', 'blank'].includes(nextScene)) throw new Error(`Unknown synthetic camera scene: ${nextScene}`);
      scene = nextScene;
      render();
    },
    snapshot() {
      return { scene, poseIndex, mediaRequests, liveTracks: [...tracks].filter(track => track.readyState === 'live').length };
    },
  };
}
