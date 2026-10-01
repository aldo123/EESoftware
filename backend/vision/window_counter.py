"""
window_counter.py — Time-windowed event counting for the single-frame inspection
methods in inspection_methods.py (Color Ratio, Border Overflow, Presence, Bright
Band, OCR). Samples the ROI repeatedly over N seconds and counts how many separate
times the method transitions from NG to OK, with a debounce so one continuously
present object isn't counted every sample.

Kept separate from blob_counter.py (which does its own frame-to-frame contour
tracking, not a simple ok/value sample) so each counting strategy can be debugged
on its own.

Also publishes progress to vision.live_status (countdown only — these methods
don't have per-blob positions the way Contour Blob does) so a Camera Feed widget
can show a live countdown while this runs.
"""
import time

from vision import live_status


def count_events_over_time(get_frame_fn, roi_x, roi_y, roi_w, roi_h, method_func, params, duration,
                            camera_id="", sample_interval=0.1, debounce_seconds=0.5):
    """
    get_frame_fn: () -> BGR frame or None.
    method_func: one of inspection_methods.METHOD_FUNCS[...] — (roi_bgr, params) -> (ok, value).
    Returns the number of distinct OK "events" seen during the window.
    """
    x1, y1 = max(0, int(roi_x)), max(0, int(roi_y))
    x2, y2 = x1 + max(0, int(roi_w)), y1 + max(0, int(roi_h))

    count = 0
    was_ok = False
    last_transition = 0.0
    start = time.time()

    if camera_id:
        live_status.start(camera_id, duration)

    try:
        while time.time() - start < duration:
            frame = get_frame_fn()
            if frame is not None:
                roi = frame[y1:y2, x1:x2]
                if roi.size:
                    ok, _value = method_func(roi, params)
                    now = time.time()
                    if ok and not was_ok and (now - last_transition) >= debounce_seconds:
                        count += 1
                        last_transition = now
                    was_ok = ok

            if camera_id:
                live_status.update(camera_id, time.time() - start, count, [])

            time.sleep(sample_interval)
    finally:
        if camera_id:
            live_status.stop(camera_id)

    return count
