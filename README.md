# Slider / Disk calculator

Static web app: convert between the pin distance on the disk, the % the slider moves, and the fraction of disk turns, with a live schematic that must fit the 31 × 31 cm box. All maths runs in your browser (`core.js`); there is no server.

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
