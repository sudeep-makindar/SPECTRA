import cv2
import numpy as np
import sys

def create_video():
    width, height = 640, 480
    fps = 30
    duration = 2
    out = cv2.VideoWriter('data/test_loop.mp4', cv2.VideoWriter_fourcc(*'mp4v'), fps, (width, height))
    
    if not out.isOpened():
        print("Failed to open VideoWriter")
        sys.exit(1)

    for i in range(fps * duration):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        # Moving circle
        x = int(width / 2 + np.sin(i / 10.0) * 100)
        y = int(height / 2 + np.cos(i / 10.0) * 100)
        cv2.circle(frame, (x, y), 30, (0, 255, 0), -1)
        cv2.putText(frame, f"Frame {i}", (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        out.write(frame)
        
    out.release()
    print("Created data/test_loop.mp4")

if __name__ == "__main__":
    create_video()
