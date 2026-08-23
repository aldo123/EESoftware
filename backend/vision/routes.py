"""
routes.py — Flask endpoints for the vision (camera) engine. Kept separate from
capture_worker.py so HTTP wiring problems (wrong status code, bad JSON, etc.) can be
told apart from camera/threading problems.
"""
import time
import cv2
from flask import Blueprint, request, jsonify, Response

from vision import capture_worker, live_status
from vision.camera_engine import get_raw_frame

vision_bp = Blueprint("vision", __name__)


@vision_bp.get("/api/vision/cameras")
def list_cameras():
    return jsonify({"cameras": capture_worker.list_cameras()})


@vision_bp.get("/api/vision/count-status/<camera_id>")
def count_status(camera_id):
    """Live progress of any 'Count Over Time' node currently running against this
    camera — countdown + currently-visible blob positions, for a Camera Feed
    widget to render on top of the stream. Purely observability, no effect on
    the actual counting logic in blob_counter.py / window_counter.py."""
    return jsonify(live_status.get(camera_id))


@vision_bp.post("/api/vision/cameras/<camera_id>/start")
def start_camera(camera_id):
    cfg = request.get_json() or {}
    result = capture_worker.start_camera(camera_id, cfg)
    return jsonify({"success": True, **result})


@vision_bp.post("/api/vision/cameras/<camera_id>/stop")
def stop_camera(camera_id):
    stopped = capture_worker.stop_camera(camera_id)
    return jsonify({"success": True, "stopped": stopped})


@vision_bp.get("/api/vision/stream/<camera_id>")
def stream_camera(camera_id):
    """MJPEG live view — usable directly as an <img src="..."> or Page Builder widget src."""
    def generate():
        boundary = b"--frame"
        while True:
            jpg = capture_worker.get_latest_jpg(camera_id)
            if jpg is not None:
                yield (boundary + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
                       + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
            time.sleep(0.05)

    return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=frame")


@vision_bp.get("/api/vision/stream-threshold/<camera_id>")
def stream_camera_threshold(camera_id):
    """Same live view, but run through the exact grayscale+blur+binary-threshold
    step the 'Contour Blob' method uses — lets you see precisely what counts as
    'bright enough' before tuning the threshold value, same idea as Buble Tester's
    Frame/Threshold toggle."""
    try:
        threshold = int(request.args.get("threshold", 165))
    except (TypeError, ValueError):
        threshold = 165

    def generate():
        boundary = b"--frame"
        while True:
            frame = get_raw_frame(camera_id)
            if frame is not None:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                blurred = cv2.GaussianBlur(gray, (9, 9), 2)
                _, thresh = cv2.threshold(blurred, threshold, 255, cv2.THRESH_BINARY)
                thresh_bgr = cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR)
                ok, jpg = cv2.imencode(".jpg", thresh_bgr, [cv2.IMWRITE_JPEG_QUALITY, 75])
                if ok:
                    jpg_bytes = jpg.tobytes()
                    yield (boundary + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
                           + str(len(jpg_bytes)).encode() + b"\r\n\r\n" + jpg_bytes + b"\r\n")
            time.sleep(0.05)

    return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=frame")
