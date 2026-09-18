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

## Privacy

The STL stays in browser memory. It is read with the File API (`File.arrayBuffer()`, then text when the file is ASCII), parsed on the page, and never uploaded or fetched. Closing or reloading the tab drops the mesh. The only network request is the Three.js library itself from the CDN, not your model.

## Using it

- Open an `.stl` with the file picker, or drag it onto the page.
- Orbit with the left mouse button, zoom with the scroll wheel, and pan with the right mouse button (or shift + left drag).
- The panel shows the filename, file size, triangle count, and vertex count. Vertices are the triangle corners stored in the STL (three per triangle); the loader does not weld them.
- **Rotate 90°** buttons (X / Y / Z) turn the loaded mesh 90° around that world axis. Rotations stack until you Clear the model.
- Wireframe toggles the material. **Reset view** restores the camera/orbit only (mesh orientation is unchanged). **Clear** removes the mesh from the scene and from memory.
- A colored XYZ axis indicator in the lower-left of the canvas tracks the current view orientation.
