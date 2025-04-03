# Camera Calibration with ChArUco Board

This web application allows you to calibrate a camera using a ChArUco board pattern. It uses OpenCV.js for computer vision tasks.

## Getting Started

1. Print a ChArUco board pattern (you can generate one using OpenCV or find premade patterns online)
2. Open `calibrate.html` in a web browser that supports WebRTC (Chrome, Firefox, Edge)
3. Allow camera access when prompted

## How to Use

1. Configure the ChArUco board parameters to match your printed board:
   - Squares in X/Y direction: Number of squares in each dimension
   - Square Length: Physical size of each square in meters
   - Marker Length: Physical size of each ArUco marker in meters
   - Dictionary: The ArUco dictionary used for the markers

2. Click "Start Camera" to begin the calibration process

3. Position the ChArUco board in different orientations in front of the camera
   - For best results, try to cover different areas of the camera frame
   - Tilt the board in different angles relative to the camera
   - Make sure the board is fully visible in the frame

4. Press "c" or click the "Capture Frame" button when the board is detected properly
   - At least 4 frames are needed for calibration
   - 10-20 frames from different angles will improve accuracy

5. Once you have captured enough frames, press "ESC" or click "Calibrate" to calculate the camera parameters

6. Review the calibration results:
   - Camera Matrix: Internal parameters of the camera
   - Distortion Coefficients: Parameters describing lens distortion
   - Reprojection Error: A measure of calibration accuracy (lower is better)

7. Click "Download Parameters" to save the calibration data as a JSON file for later use

## Troubleshooting

- If corners are not being detected, ensure good lighting and that the board is clearly visible
- If calibration results are poor (high reprojection error), try capturing more frames from varied angles
- The web application requires a modern browser with WebRTC support to access the camera

## Requirements

- Modern web browser with JavaScript enabled
- Camera access permissions
- Printed ChArUco board pattern
