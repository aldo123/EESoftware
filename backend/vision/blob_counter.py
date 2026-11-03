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

ROI modes (params["roi_mode"]):
  "crop"   (default) the frame is cut to the ROI first, so only what is inside the box is looked at.
  "center" like the original Buble Tester programs: the WHOLE frame is thresholded and a blob counts when the CENTRE of
           its enclosing circle lies inside the ROI. A bubble that only touches the edge of the box is not counted, and
           a bubble inside it keeps its full size for the min / max contour filter.
"""
import time
import cv2
import numpy as np

from vision import live_status


def find_blobs(frame, roi_x, roi_y, roi_w, roi_h, params):
    """The blobs visible in the ROI of ONE frame as [(cx, cy, radius)] in full-frame pixels.
    Used by the counting loop below and by the live preview (/api/vision/blob-preview), so both always agree."""
    threshold   = int(params.get("threshold", 165))
    min_contour = float(params.get("min_contour", 250))
    max_contour = float(params.get("max_contour", 3000))
    center_mode = str(params.get("roi_mode", "crop") or "crop").strip().lower() == "center"

    x1, y1 = max(0, int(roi_x)), max(0, int(roi_y))
    x2, y2 = x1 + max(0, int(roi_w)), y1 + max(0, int(roi_h))

    # "center": threshold the full frame; "crop": only the ROI (its offset is added back below)
    ox, oy = (0, 0) if center_mode else (x1, y1)
    area = frame if center_mode else frame[y1:y2, x1:x2]
    if area.size == 0:
        return []

    gray = cv2.cvtColor(area, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (9, 9), 2)
    _, thresh = cv2.threshold(blurred, threshold, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    blobs = []
    for contour in contours:
        if not (min_contour < cv2.contourArea(contour) < max_contour):
            continue
        (cx, cy), radius = cv2.minEnclosingCircle(contour)
        cx, cy = ox + cx, oy + cy
        if center_mode and not (x1 < cx < x2 and y1 < cy < y2):   # strict, exactly like the original (y_top < y < y_bottom)
            continue
        blobs.append((cx, cy, radius))
    return blobs


def detect_blobs(frame, roi_x, roi_y, roi_w, roi_h, params):
    """Same as find_blobs, as dicts: [{"cx", "cy", "r"}] — what the live preview endpoint returns."""
    return [{"cx": cx, "cy": cy, "r": r} for cx, cy, r in find_blobs(frame, roi_x, roi_y, roi_w, roi_h, params)]


def count_blobs_over_time(get_frame_fn, roi_x, roi_y, roi_w, roi_h, params, duration, camera_id="", sample_interval=0.1):
    """
    get_frame_fn: () -> BGR frame (numpy array) or None — e.g. camera_engine.get_raw_frame
    bound to one camera_id. Returns the number of distinct blobs counted.
    """
    match_dist   = float(params.get("match_dist", 70))
    debounce_s   = float(params.get("debounce_seconds", 0.5))

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
                now = time.time()
                detected_this_frame = set()

                for cx, cy, radius in find_blobs(frame, roi_x, roi_y, roi_w, roi_h, params):
                    center = (int(cx), int(cy))
                    # Report in full-frame coordinates so the frontend can overlay directly on the raw stream.
                    live_blobs.append({"cx": cx, "cy": cy, "r": radius})

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
