"""Run inside the WASM port by tools/preview.mjs: draw the plugin at set times.

The screen is a 128x128 image, as the Art Matrix hands a plugin, and the clock is
held still by standing in for time.time(), time.gmtime(), timezones.utc_offset()
and the plugin's seconds(). Each frame goes to /out/<name>.raw as RGBA.
"""

import builtins
import sys
import time

# the WASM port puts PicoVector's names in builtins on import, as the firmware has them
import badgeware  # noqa: F401

builtins.screen = image(128, 128)
sys.path.insert(0, "/lib")
sys.path.insert(0, "/lib/plugins")

import rail_clock as plugin  # noqa: E402
import timezones  # noqa: E402


class Clock:
    """time, with time() held where at() puts it."""

    now = 0
    ticks_ms = staticmethod(time.ticks_ms)
    ticks_diff = staticmethod(time.ticks_diff)

    def time(self):
        return self.now


clock = Clock()
plugin.time = clock


def at(hour, minute, second, year=2026):
    """Draw a frame at hour:minute:second, the second with its fraction."""
    clock.now = (year - 2000) * 31536000 + hour * 3600 + minute * 60 + int(second)
    timezones.utc_offset = lambda _now: 0
    plugin.time.gmtime = lambda _t: (year, 11, 19, hour, minute, int(second), 3, 323)
    plugin.seconds = lambda _whole: second
    plugin.update()


def shot(name):
    with open(f"/out/{name}.raw", "wb") as handle:
        handle.write(bytes(memoryview(screen)))


def ink(surface, box):
    """The box round every pixel in `box` brighter than the background, as x0, y0, x1, y1."""
    buffer = memoryview(surface)
    left, top, width, height = box
    x0 = y0 = 10**6
    x1 = y1 = -1
    for y in range(top, top + height):
        for x in range(left, left + width):
            offset = (y * surface.width + x) * 4
            if buffer[offset] + buffer[offset + 1] + buffer[offset + 2] > 60:
                x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
    return x0, y0, x1, y1


print(f"scale {plugin.SCALE:.3f}: outer ring r {plugin.OUTER * plugin.SCALE:.1f} px, "
      f"inner r {plugin.INNER * plugin.SCALE:.1f} px, stroke {plugin.STROKE * plugin.SCALE:.2f} px, "
      f"time size {plugin.SIZE:.1f}, time box {plugin.TIME_BOX}")

# Until NTP has set the clock: the board's placeholder.
at(13, 50, 7.0, year=2021)
shot("rail_clock_waiting")
# On the minute the chevrons meet at the top as the double arrow, and at the bottom on
# the half minute.
at(13, 50, 0.0)
shot("rail_clock_minute")
at(13, 50, 7.0)
shot("rail_clock")
at(13, 50, 15.0)
shot("rail_clock_quarter")
at(13, 50, 30.0)
shot("rail_clock_half")

# The digits' ink should sit centred on the face, inside the time's box.
x0, y0, x1, y1 = ink(plugin.face, plugin.TIME_BOX)
left, top, width, height = plugin.TIME_BOX
inside = left < x0 and x1 < left + width - 1 and top < y0 and y1 < top + height - 1
print(f"13:50 ink x {x0}..{x1} (centre {(x0 + x1 + 1) / 2}), y {y0}..{y1} "
      f"(centre {(y0 + y1 + 1) / 2}), face centre {plugin.CX}, {plugin.CY}, "
      f"{'inside' if inside else 'NOT inside'} its box")

# A minute, sped up four times at 15 frames a second: 13:50:00 to 13:51:00.
frames = 15 * 15
for frame in range(frames + 1):
    second = frame * 60.0 / frames
    if second >= 60:
        at(13, 51, 0.0)
    else:
        at(13, 50, second)
    shot(f"sweep_{frame:04d}")

# Twelve hour, set from the config page (which imports the plugin afresh, so the
# time is drawn again straight away).
plugin.twelve_hour = True
plugin.minute_end = 0
at(13, 50, 7.0)
shot("rail_clock_12h")

# Each frame drawn as the panel draws it, putting back only what the chevrons
# covered, must match the same frame drawn whole on a fresh surface. A is kept
# frame to frame; B is new to the plugin every time, so it gets the full face.
plugin.twelve_hour = False
plugin.minute_end = 0
A, B = image(128, 128), image(128, 128)
mismatched = []
steps = 60 * 15
for frame in range(steps + 30):
    second = frame * 60.0 / steps
    minute = 50 + int(second // 60)
    if frame == steps // 2:
        # what bind() does to a surface it hands to a plugin new to it
        A.pen = color.rgb(0, 0, 0)
        A.clear()
    if frame == steps + 10:
        plugin.twelve_hour = True
        plugin.minute_end = 0
    builtins.screen = A
    at(13, minute, second % 60)
    builtins.screen = B
    at(13, minute, second % 60)
    plugin.surface, plugin.pixels = A, memoryview(A)
    if bytes(memoryview(A)) != bytes(memoryview(B)):
        mismatched.append(frame)
print(f"incremental vs whole: {steps + 30} frames, {len(mismatched)} differ {mismatched[:10]}")
