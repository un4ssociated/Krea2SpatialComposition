"""Krea2 Spatial Composition 3x3.

Composes a region-aware prompt from nine cell descriptions plus an optional base
prompt, and renders an optional layout guide image.

The geometry is expressed as natural-language prompt guidance. This node does not
build masks, per-region conditioning, or pixel-accurate placement constraints.
"""

import json
import logging
import textwrap

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

POSITIONS = (
    "Top-left", "Top-center", "Top-right",
    "Middle-left", "Center", "Middle-right",
    "Bottom-left", "Bottom-center", "Bottom-right",
)

# Kept in sync with DEFAULT_LAYOUT in web/spatial_editor.js.
DEFAULT_LAYOUT = {
    "x": [1 / 3, 2 / 3],
    "y": [1 / 3, 2 / 3],
    "anchors": [[(c + 0.5) / 3, (r + 0.5) / 3] for r in range(3) for c in range(3)],
}

# Dividers are clamped to this margin from the edge, and to this minimum gap
# between each other, so no region can collapse to zero width or height.
EDGE_MARGIN = 0.08
MIN_GAP = 0.08


def _clamp_dividers(values):
    lo, hi = sorted(max(EDGE_MARGIN, min(1.0 - EDGE_MARGIN, float(v))) for v in values)
    if hi - lo < MIN_GAP:
        mid = (lo + hi) / 2.0
        lo = max(EDGE_MARGIN, min(1.0 - EDGE_MARGIN - MIN_GAP, mid - MIN_GAP / 2.0))
        hi = lo + MIN_GAP
    return [lo, hi]


def _layout(raw):
    default = {k: list(v) if isinstance(v, list) else v for k, v in DEFAULT_LAYOUT.items()}
    default["anchors"] = [list(a) for a in DEFAULT_LAYOUT["anchors"]]

    try:
        data = json.loads(raw) if raw else {}
        x = data.get("x", DEFAULT_LAYOUT["x"])
        y = data.get("y", DEFAULT_LAYOUT["y"])
        anchors = data.get("anchors", DEFAULT_LAYOUT["anchors"])
        if len(x) != 2 or len(y) != 2 or len(anchors) != 9:
            raise ValueError("Invalid layout dimensions")

        clean_anchors = []
        for item in anchors:
            if len(item) != 2:
                raise ValueError("Invalid anchor")
            clean_anchors.append([
                max(0.0, min(1.0, float(item[0]))),
                max(0.0, min(1.0, float(item[1]))),
            ])
        return {"x": _clamp_dividers(x), "y": _clamp_dividers(y), "anchors": clean_anchors}
    except Exception as exc:
        logging.warning("[Krea2 Spatial] Ignoring invalid layout_json (%s); using default 3x3 thirds.", exc)
        return default


class Krea2SpatialComposition3x3:
    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "base_prompt": ("STRING", {
                "default": "",
                "multiline": True,
                "tooltip": "Overall scene description. Prepended to the composed region prompt.",
            }),
            "top_left": ("STRING", {"default": "", "multiline": True}),
            "top_center": ("STRING", {"default": "", "multiline": True}),
            "top_right": ("STRING", {"default": "", "multiline": True}),
            "middle_left": ("STRING", {"default": "", "multiline": True}),
            "center": ("STRING", {"default": "", "multiline": True}),
            "middle_right": ("STRING", {"default": "", "multiline": True}),
            "bottom_left": ("STRING", {"default": "", "multiline": True}),
            "bottom_center": ("STRING", {"default": "", "multiline": True}),
            "bottom_right": ("STRING", {"default": "", "multiline": True}),
            "layout_json": ("STRING", {
                "default": json.dumps(DEFAULT_LAYOUT),
                "multiline": False,
                "tooltip": "Region geometry: {\"x\":[..2],\"y\":[..2],\"anchors\":[[x,y] x9]}. Written by the visual editor; edit by hand only if you know the format.",
            }),
            "canvas_width": ("INT", {"default": 1152, "min": 64, "max": 4096, "step": 8}),
            "canvas_height": ("INT", {"default": 2048, "min": 64, "max": 4096, "step": 8}),
        }
        return {"required": required}

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("prompt", "layout_guide")
    FUNCTION = "build"
    CATEGORY = "Krea2/Composition"

    DESCRIPTION = (
        "Composes a region-aware prompt from nine cell descriptions. Each non-empty cell becomes a "
        "sentence naming its position, its proportional area, its focal point, and the description. "
        "Optionally renders a layout-guide image showing the regions and focal markers. "
        "This is prompt-level guidance only: it does not create masks, per-region conditioning, or "
        "guaranteed object placement."
    )

    def build(self, base_prompt, top_left, top_center, top_right,
              middle_left, center, middle_right, bottom_left,
              bottom_center, bottom_right, layout_json, canvas_width, canvas_height):
        cell_texts = (top_left, top_center, top_right, middle_left, center,
                      middle_right, bottom_left, bottom_center, bottom_right)
        layout = _layout(layout_json)
        xs = [0.0] + layout["x"] + [1.0]
        ys = [0.0] + layout["y"] + [1.0]
        sections = []
        for idx, (position, description) in enumerate(zip(POSITIONS, cell_texts)):
            description = (description or "").strip()
            if not description:
                continue
            row, col = divmod(idx, 3)
            ax, ay = layout["anchors"][idx]
            box = f"x {xs[col]*100:.0f}-{xs[col+1]*100:.0f}%, y {ys[row]*100:.0f}-{ys[row+1]*100:.0f}%"
            sections.append(f"{position} region ({box}), focal placement at ({ax*100:.0f}% from left, {ay*100:.0f}% from top): {description}")

        parts = []
        if (base_prompt or "").strip():
            parts.append((base_prompt or "").strip())
        if sections:
            parts.append("Spatial composition map for a portrait frame. Keep the following subjects within their specified regions and preserve their relative visual hierarchy: " + "; ".join(sections) + ".")
        prompt = "\n\n".join(parts).strip()
        guide = self._make_guide(cell_texts, layout, max(64, int(canvas_width)), max(64, int(canvas_height)))
        image = torch.from_numpy(np.asarray(guide, dtype=np.float32) / 255.0)[None,]
        return (prompt, image)

    @staticmethod
    def _make_guide(cell_texts, layout, width, height):
        scale = min(1024 / width, 1536 / height, 1.0)
        out_w, out_h = max(384, int(width * scale)), max(384, int(height * scale))
        image = Image.new("RGB", (out_w, out_h), (24, 27, 33))
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default()
        xs = [0.0] + layout["x"] + [1.0]
        ys = [0.0] + layout["y"] + [1.0]
        for idx, (position, description) in enumerate(zip(POSITIONS, cell_texts)):
            row, col = divmod(idx, 3)
            x0, y0 = int(xs[col] * out_w), int(ys[row] * out_h)
            x1, y1 = int(xs[col + 1] * out_w), int(ys[row + 1] * out_h)
            draw.rectangle((x0, y0, x1, y1), outline=(150, 160, 175), width=2)
            draw.text((x0 + 10, y0 + 10), position.upper(), fill=(225, 230, 238), font=font)
            ax, ay = layout["anchors"][idx]
            px, py = int(ax * out_w), int(ay * out_h)
            r = max(5, int(min(out_w, out_h) * 0.009))
            draw.ellipse((px-r, py-r, px+r, py+r), fill=(245, 178, 70), outline=(20, 20, 20), width=2)
            text = (description or "").strip()
            if text:
                max_chars = max(16, int((x1 - x0 - 20) / 7))
                y = y0 + 28
                for line in textwrap.wrap(text, width=max_chars)[:10]:
                    draw.text((x0 + 10, y), line, fill=(190, 200, 215), font=font)
                    y += 15
        return image


NODE_CLASS_MAPPINGS = {"Krea2SpatialComposition3x3": Krea2SpatialComposition3x3}
NODE_DISPLAY_NAME_MAPPINGS = {"Krea2SpatialComposition3x3": "Krea2 Spatial Composition 3x3 — Visual Editor"}
