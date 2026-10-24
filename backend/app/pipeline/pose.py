"""Pose on the uploaded video with MediaPipe: the same models as the live camera, so the
reference and the learner are compared like for like."""
import os
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/tmp/shadow-models"))


def _model() -> str:
    path = MODEL_DIR / "pose_landmarker_full.task"
    if not path.exists():
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, path)
    return str(path)


def extract(video: Path, on_progress=None) -> dict:
    """Per frame: 33 points (x, y, z, visibility) in image coordinates and in metres (world).
    Frames with nobody found are NaN. Uses the most prominent person in each frame."""
    opts = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=_model()),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.4,
        min_tracking_confidence=0.5,
    )
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    image, world = [], []
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / fps))
            if res.pose_landmarks:
                image.append([[p.x, p.y, p.z, p.visibility] for p in res.pose_landmarks[0]])
                world.append([[p.x, p.y, p.z] for p in res.pose_world_landmarks[0]])
            else:
                image.append([[np.nan] * 4] * 33)
                world.append([[np.nan] * 3] * 33)
            i += 1
            if on_progress and i % 30 == 0:
                on_progress(i / total)
    cap.release()
    return {"fps": fps, "width": width, "height": height, "image": np.array(image, dtype=np.float32), "world": np.array(world, dtype=np.float32)}
