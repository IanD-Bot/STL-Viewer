# STL Viewer

Static viewer for binary and ASCII STL meshes. There is no backend. The file is parsed and drawn in the browser with Three.js.

## Live demo

GitHub Pages serves the app at **https://iand-bot.github.io/STL-Viewer/**. After a push to `main`, the site usually updates within about 10 minutes.

## Run locally

From this directory, start any static file server:

```bash
python3 -m http.server
```

Then open the URL it prints (usually http://localhost:8000). Use a local server rather than opening `index.html` as a `file://` URL, so the browser can load the Three.js module.


## Open a file from a workstation path

Browsers cannot silently read arbitrary disk paths. Pass a fetchable URL instead:

```text
http://localhost:8000/index.html?file=https://example.com/model.stl
http://localhost:8000/index.html?stl=/models/brain.stl
```

Supported query keys (first non-empty wins): `file`, `stl`, `path`.

### Helper: open a local `.stl` on Windows / macOS / Linux

From this repo:

```powershell
# Windows — starts a tiny local server and opens the viewer with the mesh loaded
.\scripts\open-stl.ps1 -StlPath "D:\exports\brain.stl"
```

```bash
# macOS / Linux
./scripts/open-stl.sh /path/to/brain.stl
```

The helper serves the viewer and the STL over `http://127.0.0.1`, then opens
`index.html?file=/model.stl` so loading starts immediately. Drag-and-drop and
the file picker still work as before.

## Privacy

The STL stays in browser memory and is parsed on the page. Drag-and-drop / file-picker loads use the File API only (never uploaded). A `?file=` / `?stl=` / `?path=` launch fetches that URL into memory (still no upload to a backend of ours). Closing or reloading the tab drops the mesh. Three.js still loads from the CDN.

## Using it

- Open an `.stl` with the file picker, or drag it onto the page.
- Orbit with the left mouse button, zoom with the scroll wheel, and pan with the right mouse button (or shift + left drag).
- The panel shows the filename, file size, triangle count, and vertex count. Vertices are the triangle corners stored in the STL (three per triangle); the loader does not weld them.
- **Rotate 90°** buttons (X / Y / Z) turn the loaded mesh 90° around that world axis. Rotations stack until you Clear the model.
- Wireframe toggles the material. **Reset view** restores the camera/orbit only (mesh orientation is unchanged). **Clear** removes the mesh from the scene and from memory.
- A colored XYZ axis indicator in the lower-left of the canvas tracks the current view orientation.
- The viewer is **Z-up** (CAD-style): the grid is the XY plane, and **Z** is vertical off the grid. Rotate Z spins around the vertical axis.
