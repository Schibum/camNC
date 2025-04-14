document.addEventListener("DOMContentLoaded", () => {
  const chessboardContainer = document.getElementById("chessboard-container");
  const printButton = document.getElementById("print-button");
  const fullscreenButton = document.getElementById("fullscreen-button");
  // 9x6 internal corners = 10x7 squares
  const cols = 10;
  const rows = 7;
  let wakeLock = null;

  function renderChessboardSVG(widthUnits, heightUnits) {
    chessboardContainer.innerHTML = ""; // Clear previous content

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    const squareSize = 100; // Keep consistent base unit
    const margin = squareSize / 2;
    const totalWidth = widthUnits * squareSize;
    const totalHeight = heightUnits * squareSize;
    const viewBoxWidth = totalWidth + 2 * margin;
    const viewBoxHeight = totalHeight + 2 * margin;
    const viewBox = `-${margin} -${margin} ${viewBoxWidth} ${viewBoxHeight}`;

    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("shape-rendering", "crispEdges");

    // Add white background rectangle for the margin
    const bgRect = document.createElementNS(svgNS, "rect");
    bgRect.setAttribute("x", `-${margin}`);
    bgRect.setAttribute("y", `-${margin}`);
    bgRect.setAttribute("width", viewBoxWidth.toString());
    bgRect.setAttribute("height", viewBoxHeight.toString());
    bgRect.setAttribute("fill", "white");
    svg.appendChild(bgRect);

    // Use the passed units for loop bounds
    for (let r = 0; r < heightUnits; r++) {
      for (let c = 0; c < widthUnits; c++) {
        const rect = document.createElementNS(svgNS, "rect");
        const x = c * squareSize;
        const y = r * squareSize;
        rect.setAttribute("x", x.toString());
        rect.setAttribute("y", y.toString());
        rect.setAttribute("width", squareSize.toString());
        rect.setAttribute("height", squareSize.toString());
        rect.setAttribute("fill", (r + c) % 2 === 0 ? "black" : "white");
        // No stroke for seamless pattern
        // rect.setAttribute("stroke", "none");
        svg.appendChild(rect);
      }
    }

    chessboardContainer.appendChild(svg);
  }

  // Helper functions for specific orientations
  function renderLandscape() {
    renderChessboardSVG(cols, rows);
  }

  function renderPortrait() {
    renderChessboardSVG(rows, cols);
  }

  // --- Wake Lock --- Fucntionality
  async function requestWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        console.log("Screen Wake Lock is active.");
        wakeLock.addEventListener("release", () => {
          console.log("Screen Wake Lock was released.");
          wakeLock = null; // Reset wakeLock variable when released
        });
      } catch (err) {
        console.error(`${err.name}, ${err.message}`);
      }
    } else {
      console.warn("Wake Lock API is not supported in this browser.");
    }
  }

  async function releaseWakeLock() {
    if (wakeLock !== null) {
      try {
        await wakeLock.release();
        wakeLock = null;
      } catch (err) {
        console.error(`${err.name}, ${err.message}`);
      }
    }
  }

  // --- Fullscreen --- Functionality
  function isFullscreen() {
    return document.fullscreenElement !== null;
  }

  function enterFullscreen() {
    const elem = chessboardContainer; // Request fullscreen on the container
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch((err) => {
        console.error(
          `Error attempting to enable full-screen mode: ${err.message} (${err.name})`
        );
      });
    }
  }

  function exitFullscreen() {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch((err) => {
        console.error(
          `Error attempting to disable full-screen mode: ${err.message} (${err.name})`
        );
      });
    }
  }

  function handleFullscreenChange() {
    if (isFullscreen()) {
      requestWakeLock();
      adjustFullscreenOrientation(); // Initial check
      // Listen for window resize events while fullscreen
      window.addEventListener("resize", adjustFullscreenOrientation);
    } else {
      releaseWakeLock();
      chessboardContainer.classList.remove("rotate-fullscreen");
      // Remove window resize listener on exit
      window.removeEventListener("resize", adjustFullscreenOrientation);

      // Restore default landscape orientation on exit
      // renderChessboardSVG(cols, rows); // No longer needed here, handled by restoreDefaultView if print initiated fullscreen exit
      restoreDefaultView(); // Use the common restore function
    }
  }

  function adjustFullscreenOrientation() {
    if (!isFullscreen()) return;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    // No need to check for SVG existence, we will re-render

    // Define board aspect based on the *original* viewBox (9x6)
    const boardWidthUnits = 9;
    const boardHeightUnits = 6;

    // Calculate potential scale factors if we were to fit the *original* viewBox
    const fitNormalScale = Math.min(
      screenWidth / boardWidthUnits,
      screenHeight / boardHeightUnits
    );
    // Calculate potential scale factors if we were to fit the *rotated* pattern (6x9) within the screen
    const fitRotatedScale = Math.min(
      screenWidth / boardHeightUnits,
      screenHeight / boardWidthUnits
    );

    // Re-render SVG with the optimal dimensions
    if (fitRotatedScale > fitNormalScale) {
      // Render portrait (6x9)
      renderPortrait();
    } else {
      // Render landscape (9x6)
      renderLandscape();
    }
  }

  // --- Event Listeners ---
  printButton.addEventListener("click", () => {
    // Render the portrait version for printing
    renderPortrait();
    window.print();
  });

  fullscreenButton.addEventListener("click", () => {
    if (isFullscreen()) {
      exitFullscreen();
    } else {
      // Ensure landscape is rendered before entering fullscreen
      renderLandscape();

      enterFullscreen();
    }
  });

  // Listen for fullscreen changes to manage wake lock and orientation
  document.addEventListener("fullscreenchange", handleFullscreenChange);

  // Add click listener to chessboard for entering fullscreen
  chessboardContainer.addEventListener("click", () => {
    if (!isFullscreen()) {
      renderLandscape(); // Ensure correct orientation before entering
      enterFullscreen();
    }
  });

  // Initial render (landscape)
  renderLandscape();
});
