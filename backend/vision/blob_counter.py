"""
blob_counter.py — Time-windowed blob counting: samples a camera ROI repeatedly over
N seconds, tracks contours frame-to-frame (matching by pixel distance + a debounce
window) so each physical blob is counted exactly once even though it's visible
across many samples. This is the "Contour Blob" method for the Logic Builder
"Count Over Time" node — kept in its own file, separate from inspection_methods.py
(single-frame methods) and window_counter.py's generic event counter, so a problem
specific to blob tracking can be debugged here without touching either of those.

Ported from the bubble-counting block inside Buble Tester V1's process_images()
(backend/bubble_backend.py) — same matching rule: a contour within `match_dist`
px of a previously-seen center is the same blob; it's counted once, the first time
it's confirmed present for at least `debounce_seconds`.

Also publishes progress to vision.live_status (countdown + currently-visible blob
positions) purely so a Camera Feed widget can show a live countdown/highlight —
that status has no bearing on the counting/pass-fail logic itself.
"""
import time
import cv2
import numpy as np

from vision import live_status


def count_blobs_over_time(get_frame_fn, roi_x, roi_y, roi_w, roi_h, params, duration, camera_id="", sample_interval=0.1):
    """
    get_frame_fn: () -> BGR frame (numpy array) or None — e.g. camera_engine.get_raw_frame
    bound to one camera_id. Returns the number of distinct blobs counted.
    """
    threshold    = int(params.get("threshold", 165))
    min_contour  = float(params.get("min_contour", 250))
    max_contour  = float(params.get("max_contour", 3000))
    match_dist   = float(params.get("match_dist", 70))
    debounce_s   = float(params.get("debounce_seconds", 0.5))

    x1, y1 = max(0, int(roi_x)), max(0, int(roi_y))
    x2, y2 = x1 + max(0, int(roi_w)), y1 + max(0, int(roi_h))

    tracking = {}  # center (int,int) -> (first_seen_time, counted_flag)
    count = 0
    start = time.time()

    if camera_id:
        live_status.start(camera_id, duration)

    try:
        while time.time() - start < duration:
            frame = get_frame_fn()
            live_blobs = []
            if frame is not None:
                roi = frame[y1:y2, x1:x2]
                if roi.size:
                    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                    blurred = cv2.GaussianBlur(gray, (9, 9), 2)
                    _, thresh = cv2.threshold(blurred, threshold, 255, cv2.THRESH_BINARY)
                    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

                    now = time.time()
                    detected_this_frame = set()

                    for contour in contours:
                        area = cv2.contourArea(contour)
                        if not (min_contour < area < max_contour):
                            continue
                        (cx, cy), radius = cv2.minEnclosingCircle(contour)
                        center = (int(cx), int(cy))
                        # Report in full-frame coordinates (ROI offset added back)
                        # so the frontend can overlay directly on the raw stream.
                        live_blobs.append({"cx": x1 + cx, "cy": y1 + cy, "r": radius})

                        matched = False
                        for old_center in list(tracking.keys()):
                            dist = np.linalg.norm(np.array(center) - np.array(old_center))
                            if dist < match_dist:
                                matched = True
                                detected_this_frame.add(old_center)
                                first_seen, counted = tracking[old_center]
                                if not counted and (now - first_seen) <= debounce_s:
                                    count += 1
                                    tracking[old_center] = (first_seen, True)
                                break
                        if not matched:
                            tracking[center] = (now, False)
                            detected_this_frame.add(center)

                    for old_center in list(tracking.keys()):
                        if old_center not in detected_this_frame:
                            del tracking[old_center]

            if camera_id:
                live_status.update(camera_id, time.time() - start, count, live_blobs)

            time.sleep(sample_interval)
    finally:
        if camera_id:
            live_status.stop(camera_id)

    return count
