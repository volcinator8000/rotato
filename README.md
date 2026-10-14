# Slider / Disk calculator

Static web app: convert between the pin distance on the disk, the % the slider moves, and the fraction of disk turns, with a live schematic that must fit the 31 × 31 cm box. All maths runs in your browser (`core.js`); there is no server.

## Current design
The slotted bar stands straight up (90° to the rail), like a Scotch yoke. With the default 28 cm disk (R14) and the pin 13.5 cm from the centre, the carriage moves 27 cm, which is 96.4 % of the 28 cm travel, while the disk turns half a turn. The last 1 cm can't be used because the 3 cm carriage block also has to fit inside the 31 cm box.

Build notes:
- The disk passes 2.5 cm under the rail, so mount the rail on raised end supports. The carriage and bar then ride above the disk.
- At the two ends of the stroke the slot is tangent to the pin's circle, so pushing the slider there can't start the disk turning (the dead point). Start and stop the motion a little short of the ends, or use a sweep under 180°.

Live site: https://volcinator8000.github.io/rotato/

## Put it on GitHub Pages
1. Create a new GitHub repository (public, or private on a paid plan).
2. Upload `index.html`, `core.js`, `.nojekyll` and this README to the repository root (drag and drop on github.com works).
3. Open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then Save.
4. After a minute the site is at `https://<your-username>.github.io/<repo-name>/`.

You can also open `index.html` straight from disk: no server needed.

## Files
- `index.html`: the page.
- `core.js`: the geometry, box-fit, conversion and SVG drawing maths (a port of the Python version, checked against it).
- `slider_disk.py`: optional original Python version (`python3 slider_disk.py` for the local web page, `--cli` for the terminal).

Your settings are remembered in your browser's local storage.
