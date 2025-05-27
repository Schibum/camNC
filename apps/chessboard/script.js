// Rounded‑edge calibration checkerboard
// (board outer dimensions exactly equal widthUnits × squareSize and
// heightUnits × squareSize — the caps live *inside* that box)
// -----------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const chessboardContainer = document.getElementById("chessboard-container");
  const printButton = document.getElementById("print-button");
  const fullscreenButton = document.getElementById("fullscreen-button");

  // 9×6 internal‑corner pattern → 10×7 squares
  const cols = 10;
  const rows = 7;
  const squareSize = 100; // ← the single size knob
  const radius = squareSize / 2; // ← half‑circle radius (always ½ a square)

  let wakeLock = null;

  // ---------------------------------------------------------------------------
  // SVG RENDERER – draws the board so the *total* bounding box is
  //   widthUnits × squareSize  by  heightUnits × squareSize.
  // ---------------------------------------------------------------------------
  function renderChessboardSVG(widthUnits, heightUnits) {
    chessboardContainer.innerHTML = ""; // clear previous

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");

    const boardWidth = widthUnits * squareSize;
    const boardHeight = heightUnits * squareSize;

    svg.setAttribute("viewBox", `0 0 ${boardWidth} ${boardHeight}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.style.width = "100%"; // responsive (optional)
    svg.style.height = "100%";

    // Solid white background the exact board size (caps stay inside!)
    const bg = document.createElementNS(svgNS, "rect");
    bg.setAttribute("width", boardWidth);
    bg.setAttribute("height", boardHeight);
    bg.setAttribute("fill", "white");
    svg.appendChild(bg);

    // Helper to drop a black cap; the *whole* circle is painted, but
    // half of it sits outside a shrunken black rectangle so we see a
    // perfect semicircle.
    const addCap = (cx, cy) => {
      const cap = document.createElementNS(svgNS, "circle");
      cap.setAttribute("cx", cx);
      cap.setAttribute("cy", cy);
      cap.setAttribute("r", radius);
      cap.setAttribute("fill", "black");
      svg.appendChild(cap);
    };

    // -----------------------------------------------------------------
    // Loop through every square
    // -----------------------------------------------------------------
    for (let r = 0; r < heightUnits; r++) {
      for (let c = 0; c < widthUnits; c++) {
        const isBlack = (r + c) % 2 === 0;
        const isTop = r === 0;
        const isBottom = r === heightUnits - 1;
        const isLeft = c === 0;
        const isRight = c === widthUnits - 1;

        // Base (un‑modified) position
        const xBase = c * squareSize;
        const yBase = r * squareSize;

        // Shrink the black edge‑squares inward by "radius" so that when we
        // add the semicircle the board’s outer size *does not* grow.
        let rectX = xBase;
        let rectY = yBase;
        let rectW = squareSize;
        let rectH = squareSize;

        if (isBlack) {
          if (isLeft) {
            rectX += radius;
            rectW -= radius;
          }
          if (isRight) {
            rectW -= radius;
          }
          if (isTop) {
            rectY += radius;
            rectH -= radius;
          }
          if (isBottom) {
            rectH -= radius;
          }
        }

        // Draw the square (black or white)
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", rectX);
        rect.setAttribute("y", rectY);
        rect.setAttribute("width", rectW);
        rect.setAttribute("height", rectH);
        rect.setAttribute("fill", isBlack ? "black" : "white");
        svg.appendChild(rect);

        // Now place the caps *after* the rectangle so they visibly sit on top
        if (!isBlack) continue; // only black squares get caps

        if (isLeft) addCap(radius, yBase + radius);
        if (isRight) addCap(boardWidth - radius, yBase + radius);
        if (isTop) addCap(xBase + radius, radius);
        if (isBottom) addCap(xBase + radius, boardHeight - radius);
      }
    }

    chessboardContainer.appendChild(svg);
  }

  // --------------------------- Orientation helpers ---------------------------
  const renderLandscape = () => renderChessboardSVG(cols, rows);
  const renderPortrait = () => renderChessboardSVG(rows, cols);

  // ---------------------------- Wake‑lock helpers ----------------------------
  async function requestWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => (wakeLock = null));
      } catch (err) {
        console.error(err);
      }
    }
  }
  const releaseWakeLock = async () => {
    if (!wakeLock) return;
    try {
      await wakeLock.release();
    } finally {
      wakeLock = null;
    }
  };

  // ------------------------------ Full‑screen -------------------------------
  const isFullscreen = () => document.fullscreenElement !== null;
  const enterFullscreen = async () => {
    await chessboardContainer
      .requestFullscreen?.()
      .catch((err) => console.error("FS error:", err));
    screen?.orientation?.lock(screen.orientation.type);
  };
  const exitFullscreen = () =>
    document.exitFullscreen?.().catch((err) => console.error("FS error:", err));

  function handleFullscreenChange() {
    if (isFullscreen()) {
      adjustFullscreenOrientation();
      window.addEventListener("resize", adjustFullscreenOrientation);
    } else {
      releaseWakeLock();
      window.removeEventListener("resize", adjustFullscreenOrientation);
      renderLandscape();
    }
  }

  function adjustFullscreenOrientation() {
    if (!isFullscreen()) return;

    const sw = window.innerWidth;
    const sh = window.innerHeight;

    const normalScale = Math.min(sw / 9, sh / 6);
    const rotatedScale = Math.min(sw / 6, sh / 9);

    if (rotatedScale > normalScale) {
      renderPortrait();
    } else {
      renderLandscape();
    }
  }

  // ----------------------------- UI bindings --------------------------------
  printButton.addEventListener("click", () => {
    renderPortrait();
    window.print();
  });
  fullscreenButton.addEventListener("click", () => {
    if (isFullscreen()) {
      exitFullscreen();
    } else {
      requestWakeLock();
      renderLandscape();
      enterFullscreen();
    }
  });
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  chessboardContainer.addEventListener("click", () => {
    if (!isFullscreen()) {
      renderLandscape();
      enterFullscreen();
    }
  });

  // ---------------------------------------------------------------------------
  // Initial paint
  // ---------------------------------------------------------------------------
  renderLandscape();
});
