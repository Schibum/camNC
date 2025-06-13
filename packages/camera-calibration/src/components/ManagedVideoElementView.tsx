import React, { useEffect, useRef } from "react";
import { useCalibrationStore } from "../store/calibrationStore";

/**
 * A React component that renders the HTMLVideoElement managed by the
 * useCalibrationStore. It directly manipulates the DOM to append/
 * remove the element.
 *
 * Note: This pattern mixes imperative DOM handling with React's declarative
 * approach and should be used cautiously.
 */
export const ManagedVideoElementView: React.FC = () => {
  // Get the video element instance from the store
  const videoElement = useCalibrationStore((state) => state.videoElement);
  // Create a ref for the container div where the video element will be placed
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    // Ensure the container ref is available
    if (!container) {
      console.warn("[ManagedVideoView] Container ref not available.");
      return;
    }

    if (videoElement) {
      // If the video element from the store exists:
      // Check if it's already in the *correct* container. This prevents
      // trying to append it if it's already there (e.g., on re-render).
      if (!container.contains(videoElement)) {
        console.log(
          "[ManagedVideoView] Appending video element from store to container.",
        );
        // Ensure it's not somewhere else unexpectedly before appending
        videoElement.remove(); // Remove from previous parent, if any
        // Apply styles needed for display within this component
        videoElement.style.width = "100%";
        videoElement.style.height = "100%";
        videoElement.style.objectFit = "contain";
        // Append the managed video element to our container div
        container.appendChild(videoElement);
        videoElement.play();
      }
    } else {
      // If the video element in the store is null (e.g., camera stopped):
      // Check if the container currently has any video element (it might be the old one)
      // and remove it.
      // Simple approach: Clear all children if videoElement is null.
      // More robust: Find the specific video element if multiple children could exist.
      if (container.firstChild) {
        console.log(
          "[ManagedVideoView] Video element in store is null, removing child from container.",
        );
        // Remove all children - assumes the video was the only child
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
      }
    }

    // Cleanup function for when the component unmounts
    return () => {
      const currentContainer = containerRef.current; // Capture ref value
      if (
        currentContainer &&
        videoElement &&
        currentContainer.contains(videoElement)
      ) {
        // When the component unmounts, detach the video element from its container
        // but DO NOT destroy the videoElement itself, as it's managed by the store.
        console.log(
          "[ManagedVideoView] Detaching video element from container on unmount.",
        );
        currentContainer.removeChild(videoElement);
      }
    };
    // Re-run the effect if the videoElement instance in the store changes
  }, [videoElement]);

  // Render the container div, the video element will be added imperatively by the useEffect
  return (
    <div
      ref={containerRef}
      className="managed-video-container w-full h-full bg-black" // Use Tailwind classes
    />
  );
};
