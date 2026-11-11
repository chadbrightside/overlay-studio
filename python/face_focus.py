#!/usr/bin/env python3
"""Find where the subject's face is in a picture, so the card can centre on it.
Usage: face_focus.py IMAGE  -> prints JSON {"x": 0..1, "y": 0..1, "faces": n, "w": .., "h": ..}
Uses OpenCV's Haar cascades, offline. With no face found it returns the centre, slightly high."""
import json, sys

def main():
    path = sys.argv[1]
    try:
        import cv2
    except Exception:
        print(json.dumps({"x": 0.5, "y": 0.45, "faces": 0, "error": "opencv missing"})); return
    img = cv2.imread(path)
    if img is None:
        print(json.dumps({"x": 0.5, "y": 0.45, "faces": 0, "error": "unreadable"})); return
    h, w = img.shape[:2]
    scale = 900.0 / max(w, h) if max(w, h) > 900 else 1.0
    small = cv2.resize(img, None, fx=scale, fy=scale) if scale != 1.0 else img
    gray = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
    faces = []
    for name in ("haarcascade_frontalface_default.xml", "haarcascade_frontalface_alt2.xml", "haarcascade_profileface.xml"):
        c = cv2.CascadeClassifier(cv2.data.haarcascades + name)
        found = c.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(28, 28))
        faces = [tuple(int(v) for v in f) for f in found]
        if faces:
            break
    sw, sh = small.shape[1], small.shape[0]
    if not faces:
        print(json.dumps({"x": 0.5, "y": 0.45, "faces": 0})); return
    faces.sort(key=lambda f: f[2] * f[3], reverse=True)
    big = faces[0]
    # keep the faces that are at least a third of the largest one; the focus is the centre of their union
    keep = [f for f in faces if f[2] * f[3] >= 0.33 * big[2] * big[3]]
    x0 = min(f[0] for f in keep); y0 = min(f[1] for f in keep)
    x1 = max(f[0] + f[2] for f in keep); y1 = max(f[1] + f[3] for f in keep)
    cx = (x0 + x1) / 2.0 / sw
    cy = (y0 + (y1 - y0) * 0.45) / sh  # a little above the box centre, towards the eyes
    print(json.dumps({"x": round(cx, 3), "y": round(cy, 3), "faces": len(keep), "w": round((x1 - x0) / sw, 3), "h": round((y1 - y0) / sh, 3)}))

if __name__ == "__main__":
    main()
