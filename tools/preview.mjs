// Draws the Rail Clock plugin without an Art Matrix: its own code, run under Pimoroni's
// badgeware WASM port (real MicroPython, PicoVector and font rasteriser) on a 128x128
// image standing in for the matrix, with the firmware's own timezones and plugin_config.
//
//   node tools/preview.mjs            # shots/*.png, shots/rail_clock.gif, thumbnail.png
//   node tools/preview.mjs other.py   # run another script against the plugin instead
//
// BADGEWARE_RUNTIME names micropython.mjs from a badgeware-wasm release, and ARTMATRIX a
// checkout of github.com/pimoroni/artmatrix. Both default to build/ (see README.md).
// Needs node 25 or newer and ImageMagick.

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const RUNTIME = process.env.BADGEWARE_RUNTIME || join(ROOT, "build", "badgeware-runtime", "micropython.mjs")
const ARTMATRIX = process.env.ARTMATRIX || join(ROOT, "build", "artmatrix")
const PLUGIN = join(ROOT, "rail_clock")
// What to run against it: tools/preview.py, unless another script is named.
const SCRIPT = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "tools", "preview.py")
const FRAMES = join(ROOT, "build", "frames")
const SHOTS = join(ROOT, "shots")
const SIZE = 128

for (const [what, path] of [["BADGEWARE_RUNTIME", RUNTIME], ["ARTMATRIX", ARTMATRIX]]) {
  if (!existsSync(path)) {
    console.error(`${what}: nothing at ${path} (see README.md)`)
    process.exit(1)
  }
}

const { loadMicroPython } = await import(pathToFileURL(RUNTIME).href)
globalThis.blitrgba = () => {}
globalThis.backlight = () => {}
globalThis.sim_buttons = () => 0

const mp = await loadMicroPython({
  stdout: (line) => process.stdout.write(line + "\n"),
  stderr: (line) => process.stderr.write(line + "\n"),
  linebuffer: true,
  heapsize: 64 * 1024 * 1024,
})

// Where the firmware keeps a plugin, and the frozen modules it imports beside it.
stage(PLUGIN, "/lib/plugins/rail_clock")
for (const name of ["timezones.py", "plugin_config.py"]) {
  mp.FS.writeFile(`/lib/${name}`, readFileSync(join(ARTMATRIX, "modules", "python", name)))
}
mp.FS.writeFile("/lib/config.py", 'time_zone = "uk"\n')
mkdirp("/out")

let failed = false
try {
  await mp.runPython(readFileSync(SCRIPT, "utf8"))
} catch (error) {
  failed = true
  console.error(String(error?.message ?? error))
}

rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
const raws = mp.FS.readdir("/out").filter((name) => name.endsWith(".raw")).sort()
for (const name of raws) {
  const raw = join(FRAMES, name)
  writeFileSync(raw, mp.FS.readFile(`/out/${name}`))
  png(raw, raw.replace(/\.raw$/, ".png"))
}

// The still shots, as the matrix shows them and blown up as lit LEDs.
for (const name of raws.filter((name) => !name.startsWith("sweep_"))) {
  const flat = join(FRAMES, name.replace(/\.raw$/, ".png"))
  execFileSync("magick", [flat, join(SHOTS, name.replace(/\.raw$/, ".png"))])
  leds(flat, join(SHOTS, name.replace(/\.raw$/, "_leds.png")))
}
if (existsSync(join(FRAMES, "rail_clock.png"))) {
  // The settings page's picture: the matrix as it is, 128x128 RGB. Stripped of the
  // dates ImageMagick stamps in, so it only changes, and with it the package's hash,
  // when the picture does.
  execFileSync("magick", [join(FRAMES, "rail_clock.png"), "-alpha", "off", "-type", "TrueColor",
                          "-strip", "-define", "png:exclude-chunks=date,time",
                          `PNG24:${join(PLUGIN, "thumbnail.png")}`])
}

// A minute sped up four times, as LEDs.
const sweep = raws.filter((name) => name.startsWith("sweep_"))
if (sweep.length) {
  const blown = sweep.map((name) => {
    const out = join(FRAMES, name.replace(/\.raw$/, "_leds.png"))
    leds(join(FRAMES, name.replace(/\.raw$/, ".png")), out)
    return out
  })
  execFileSync("magick", ["-delay", "7", "-loop", "0", ...blown, "-layers", "Optimize",
                          join(SHOTS, "rail_clock.gif")])
}

console.log(`${raws.length} frame(s); shots in ${SHOTS}`)
process.exit(failed ? 1 : 0)

function png(raw, out) {
  // The surface is RGBA; everything the clock draws lands opaque.
  execFileSync("magick", ["-size", `${SIZE}x${SIZE}`, "-depth", "8", `rgba:${raw}`,
                          "-alpha", "off", out])
}

function leds(flat, out) {
  // Each pixel as a round LED on a dark board, four times the size.
  const dot = join(FRAMES, "dot.png")
  if (!existsSync(dot)) {
    execFileSync("magick", ["-size", "4x4", "xc:#141414", "-fill", "white",
                            "-draw", "circle 1.5,1.5 1.5,0", dot])
  }
  execFileSync("magick", [flat, "-filter", "point", "-resize", "400%",
                          "(", "-size", `${SIZE * 4}x${SIZE * 4}`, `tile:${dot}`, ")",
                          "-compose", "multiply", "-composite", out])
}

function stage(from, to) {
  mkdirp(to)
  for (const name of readdirSync(from)) {
    if (name === "__pycache__") continue
    const path = join(from, name)
    if (statSync(path).isDirectory()) {
      stage(path, `${to}/${name}`)
      continue
    }
    mp.FS.writeFile(`${to}/${name}`, readFileSync(path))
  }
}

function mkdirp(path) {
  let built = ""
  for (const part of path.split("/").filter(Boolean)) {
    built += `/${part}`
    try {
      mp.FS.mkdir(built)
    } catch {
      // already there
    }
  }
}
