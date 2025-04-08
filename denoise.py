import cv2
import sys
import argparse
import numpy as np

def main():
    # Set up argument parser
    parser = argparse.ArgumentParser(description="Generate a mean frame from a video file.")
    parser.add_argument("video_path", help="Path to the input MP4 video file.")

    # Parse command-line arguments
    args = parser.parse_args()
    video_path = args.video_path

    # Open the video file
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("Error: Cannot open video file.")
        sys.exit(1)

    frame_count = 0
    sum_frame = None

    # Read frames iteratively and accumulate the sum
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if sum_frame is None:
            # Initialize sum_frame with the shape and dtype of the first frame
            # Use float64 to prevent overflow during summation
            sum_frame = np.zeros_like(frame, dtype=np.float64)

        sum_frame += frame
        frame_count += 1

    cap.release()

    if frame_count == 0:
        print("Error: No frames read from video.")
        sys.exit(1)

    # Calculate the mean frame
    mean_frame = (sum_frame / frame_count).astype(np.uint8)

    # Display the output image
    cv2.imshow("Mean Frame", mean_frame)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    # Optionally, save the mean image to disk
    output_filename = "mean_output.png"
    cv2.imwrite(output_filename, mean_frame)
    print(f"Mean frame saved as {output_filename}")

if __name__ == "__main__":
    main()