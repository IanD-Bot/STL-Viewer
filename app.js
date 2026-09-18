import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;

const fileInput = document.querySelector("#file-input");
const wireInput = document.querySelector("#wireframe");
const resetButton = document.querySelector("#reset-view");
const clearButton = document.querySelector("#clear");
const rotateXButton = document.querySelector("#rotate-x");
const rotateYButton = document.querySelector("#rotate-y");
const rotateZButton = document.querySelector("#rotate-z");
const statusEl = document.querySelector("#status");
const emptyEl = document.querySelector("#empty");
const dropHint = document.querySelector("#drop-hint");
const stage = document.querySelector("#stage");
const canvas = document.querySelector("#view");
const statName = document.querySelector("#stat-name");
const statSize = document.querySelector("#stat-size");
const statTris = document.querySelector("#stat-tris");
const statVerts = document.querySelector("#stat-verts");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141c);

// CAD-style Z-up: grid lies in XY, Z comes off the plane.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.up.set(0, 0, 1);
camera.position.set(2.4, -3.1, 1.6);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.update();
controls.saveState();

scene.add(new THREE.HemisphereLight(0xc9d7e8, 0x2a241c, 0.95));
const keyLight = new THREE.DirectionalLight(0xfff4e8, 1.7);
keyLight.position.set(6, -7, 10);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8ea4c8, 0.45);
fillLight.position.set(-7, 5, 3);
scene.add(fillLight);

const AXIS_INSET = 96;
const AXIS_MARGIN = 10;
const axesScene = new THREE.Scene();
const axesCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
axesCamera.position.set(0, 0, 2.4);
const axesRoot = new THREE.Group();
axesScene.add(axesRoot);
const worldX = new THREE.Vector3(1, 0, 0);
const worldY = new THREE.Vector3(0, 1, 0);
const worldZ = new THREE.Vector3(0, 0, 1);

function makeAxisLabel(text, colorCss) {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 64;
  labelCanvas.height = 64;
  const ctx = labelCanvas.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = colorCss;
  ctx.font = "700 42px Segoe UI, Helvetica Neue, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 34);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(0.42);
  return sprite;
}

function addAxisLine(dir, color, label, labelCss) {
  const end = dir.clone().multiplyScalar(0.78);
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    end,
  ]);
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  axesRoot.add(new THREE.Line(geometry, material));
  const sprite = makeAxisLabel(label, labelCss);
  sprite.position.copy(dir).multiplyScalar(1.05);
  axesRoot.add(sprite);
}

// World-space axes: same vectors as Rotate X/Y/Z (rotateOnWorldAxis).
addAxisLine(worldX, 0xe05050, "X", "#e86060");
addAxisLine(worldY, 0x45b86a, "Y", "#4cbc6a");
addAxisLine(worldZ, 0x4a8fe0, "Z", "#4a8fe0");

let mesh = null;
let grid = null;
const worldAxesHelper = new THREE.AxesHelper(1);
worldAxesHelper.position.set(0, 0, 0.001);
scene.add(worldAxesHelper);
let loadToken = 0;
let pixelRatioCap = 2;
let dirty = true;

setGrid(8, 0);

function isWs(code) {
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}

function sameWord(word, expected) {
  if (word.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    let code = word.charCodeAt(i);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== expected.charCodeAt(i)) return false;
  }
  return true;
}

function looksLikeSolid(buffer) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  while (offset < bytes.length && isWs(bytes[offset])) offset++;
  const solid = [115, 111, 108, 105, 100];
  if (bytes.length < offset + solid.length) return false;
  for (let i = 0; i < solid.length; i++) {
    let code = bytes[offset + i];
    if (code >= 65 && code <= 90) code += 32;
    if (code !== solid[i]) return false;
  }
  const after = offset + solid.length;
  return after >= bytes.length || isWs(bytes[after]);
}

function isBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;
  const triangles = new DataView(buffer).getUint32(80, true);
  return 84 + triangles * 50 === buffer.byteLength;
}

function parseBinarySTL(buffer) {
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  if (triangles === 0) {
    throw new Error("STL contains no triangles.");
  }
  const needed = 84 + triangles * 50;
  if (buffer.byteLength < needed) {
    throw new Error("Binary STL is truncated.");
  }

  let positions;
  let normals;
  try {
    positions = new Float32Array(triangles * 9);
    normals = new Float32Array(triangles * 9);
  } catch {
    throw new Error("Not enough memory to load this STL.");
  }

  if (LITTLE_ENDIAN) {
    const src = new Uint8Array(buffer);
    const positionBytes = new Uint8Array(positions.buffer);
    const normalBytes = new Uint8Array(normals.buffer);
    let srcOffset = 84;
    let dstOffset = 0;
    for (let i = 0; i < triangles; i++) {
      const normal = src.subarray(srcOffset, srcOffset + 12);
      normalBytes.set(normal, dstOffset);
      normalBytes.set(normal, dstOffset + 12);
      normalBytes.set(normal, dstOffset + 24);
      positionBytes.set(src.subarray(srcOffset + 12, srcOffset + 48), dstOffset);
      srcOffset += 50;
      dstOffset += 36;
    }
  } else {
    let offset = 84;
    let cursor = 0;
    for (let i = 0; i < triangles; i++) {
      const nx = view.getFloat32(offset, true);
      const ny = view.getFloat32(offset + 4, true);
      const nz = view.getFloat32(offset + 8, true);
      offset += 12;
      for (let vertex = 0; vertex < 3; vertex++) {
        positions[cursor] = view.getFloat32(offset, true);
        positions[cursor + 1] = view.getFloat32(offset + 4, true);
        positions[cursor + 2] = view.getFloat32(offset + 8, true);
        normals[cursor] = nx;
        normals[cursor + 1] = ny;
        normals[cursor + 2] = nz;
        offset += 12;
        cursor += 3;
      }
      offset += 2;
    }
  }

  return { positions, normals, triangles, format: "binary" };
}

function countWord(text, word) {
  const length = text.length;
  const width = word.length;
  let count = 0;
  for (let i = 0; i < length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== word.charCodeAt(0)) continue;
    if (i > 0 && !isWs(text.charCodeAt(i - 1))) continue;
    if (i + width > length) break;
    let matches = true;
    for (let k = 1; k < width; k++) {
      code = text.charCodeAt(i + k);
      if (code >= 65 && code <= 90) code += 32;
      if (code !== word.charCodeAt(k)) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const after = i + width;
    if (after === length || isWs(text.charCodeAt(after))) count++;
    i += width - 1;
  }
  return count;
}

function parseAsciiSTL(text) {
  const length = text.length;
  let index = 0;

  function skipWs() {
    while (index < length && isWs(text.charCodeAt(index))) index++;
  }

  function readWord() {
    skipWs();
    const start = index;
    while (index < length && !isWs(text.charCodeAt(index))) index++;
    return text.slice(start, index);
  }

  function readNumber() {
    skipWs();
    if (index >= length) throw new Error("ASCII STL ended while reading a number.");
    const start = index;
    let code = text.charCodeAt(index);
    if (code === 43 || code === 45) index++;
    let sawDigit = false;
    let sawDot = false;
    while (index < length) {
      code = text.charCodeAt(index);
      if (code >= 48 && code <= 57) {
        sawDigit = true;
        index++;
        continue;
      }
      if (code === 46 && !sawDot) {
        sawDot = true;
        index++;
        continue;
      }
      if (code === 101 || code === 69) {
        index++;
        if (index < length) {
          code = text.charCodeAt(index);
          if (code === 43 || code === 45) index++;
        }
        const exponentStart = index;
        while (index < length) {
          code = text.charCodeAt(index);
          if (code < 48 || code > 57) break;
          index++;
        }
        if (index === exponentStart) throw new Error("ASCII STL has a broken exponent.");
        break;
      }
      break;
    }
    if (!sawDigit) throw new Error("ASCII STL expected a number.");
    const value = Number(text.slice(start, index));
    if (!Number.isFinite(value)) throw new Error("ASCII STL has a non-finite coordinate.");
    return value;
  }

  function expectWord(expected) {
    const word = readWord();
    if (!sameWord(word, expected)) {
      throw new Error(`ASCII STL expected "${expected}" but found "${word || "end of file"}".`);
    }
  }

  function expectOuterLoop() {
    const word = readWord();
    if (sameWord(word, "outerloop")) return;
    if (sameWord(word, "outer")) {
      expectWord("loop");
      return;
    }
    throw new Error(`ASCII STL expected "outer loop" but found "${word || "end of file"}".`);
  }

  function expectEnd(kind) {
    const word = readWord();
    if (sameWord(word, "end" + kind)) return;
    if (sameWord(word, "end")) {
      expectWord(kind);
      return;
    }
    throw new Error(`ASCII STL expected "end${kind}" but found "${word || "end of file"}".`);
  }

  const first = readWord();
  if (!first) throw new Error("ASCII STL is empty.");
  if (sameWord(first, "solid")) {
    while (index < length) {
      const code = text.charCodeAt(index);
      index++;
      if (code === 10 || code === 13) break;
    }
  } else if (!sameWord(first, "facet")) {
    throw new Error('ASCII STL must start with "solid" or "facet".');
  } else {
    index = 0;
  }

  const counted = Math.max(countWord(text, "facet"), 1);
  let capacity = counted;
  let positions;
  let normals;
  try {
    positions = new Float32Array(capacity * 9);
    normals = new Float32Array(capacity * 9);
  } catch {
    throw new Error("Not enough memory to load this STL.");
  }

  let triangles = 0;
  while (index < length) {
    const word = readWord();
    if (!word || sameWord(word, "endsolid")) break;
    if (!sameWord(word, "facet")) {
      throw new Error(`ASCII STL expected "facet" but found "${word}".`);
    }
    expectWord("normal");
    const nx = readNumber();
    const ny = readNumber();
    const nz = readNumber();
    expectOuterLoop();
    if (triangles === capacity) {
      const next = capacity * 2;
      const grownPositions = new Float32Array(next * 9);
      const grownNormals = new Float32Array(next * 9);
      grownPositions.set(positions);
      grownNormals.set(normals);
      positions = grownPositions;
      normals = grownNormals;
      capacity = next;
    }
    const base = triangles * 9;
    for (let vertex = 0; vertex < 3; vertex++) {
      expectWord("vertex");
      const offset = base + vertex * 3;
      positions[offset] = readNumber();
      positions[offset + 1] = readNumber();
      positions[offset + 2] = readNumber();
      normals[offset] = nx;
      normals[offset + 1] = ny;
      normals[offset + 2] = nz;
    }
    expectEnd("loop");
    expectEnd("facet");
    triangles++;
  }

  if (triangles === 0) throw new Error("STL contains no triangles.");
  if (triangles !== capacity) {
    positions = positions.subarray(0, triangles * 9);
    normals = normals.subarray(0, triangles * 9);
  }
  return { positions, normals, triangles, format: "ascii" };
}

function parseSTL(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error("Expected an ArrayBuffer.");
  if (buffer.byteLength < 15) throw new Error("File is too small to be an STL.");
  if (isBinarySTL(buffer)) return parseBinarySTL(buffer);
  if (!looksLikeSolid(buffer)) {
    throw new Error('Unrecognized STL. Expected a binary file or ASCII starting with "solid".');
  }
  return parseAsciiSTL(new TextDecoder("utf-8").decode(buffer));
}

function normalsUsable(normals) {
  const stride = Math.max(9, (Math.floor(normals.length / 90) || 1) * 3);
  for (let i = 0; i + 2 < normals.length; i += stride) {
    const lengthSq = normals[i] * normals[i] + normals[i + 1] * normals[i + 1] + normals[i + 2] * normals[i + 2];
    if (lengthSq > 1e-8) return true;
  }
  return false;
}

function disposeMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
    return;
  }
  material.dispose();
}

function disposeMesh() {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry.dispose();
  disposeMaterial(mesh.material);
  mesh = null;
}

function setGrid(span, z) {
  if (grid) {
    scene.remove(grid);
    grid.geometry.dispose();
    disposeMaterial(grid.material);
    grid = null;
  }
  const size = Math.max(span, 1e-4);
  const divisions = size > 1000 ? 10 : 20;
  grid = new THREE.GridHelper(size, divisions, 0x3d4b60, 0x242c39);
  // GridHelper is XZ by default; rotate so it lies in XY with Z up.
  grid.rotation.x = Math.PI / 2;
  grid.position.z = z;
  scene.add(grid);
  worldAxesHelper.scale.setScalar(Math.max(size * 0.12, 0.5));
  worldAxesHelper.position.set(0, 0, z + 0.001);
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 2 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function formatCount(value) {
  return value.toLocaleString("en-US");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", Boolean(isError && message));
}

function setStats(file, parsed) {
  if (!file || !parsed) {
    statName.textContent = "—";
    statName.title = "";
    statSize.textContent = "—";
    statTris.textContent = "—";
    statVerts.textContent = "—";
    document.title = "STL Viewer";
    return;
  }
  statName.textContent = file.name;
  statName.title = file.name;
  statSize.textContent = formatBytes(file.size);
  statTris.textContent = formatCount(parsed.triangles);
  statVerts.textContent = formatCount(parsed.positions.length / 3);
  document.title = `${file.name} — STL Viewer`;
}

function frameSize(size) {
  const span = Math.max(size.x, size.y, size.z, 1e-4);
  const distance = (span / 2) / Math.tan((camera.fov * Math.PI) / 360) * 1.55;
  camera.near = span / 200;
  camera.far = Math.max(span * 80, distance * 20);
  camera.up.set(0, 0, 1);
  camera.position.set(distance * 0.72, -distance * 0.9, distance * 0.5);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = span * 0.02;
  controls.maxDistance = span * 40;
  controls.update();
  controls.saveState();
}

function showMesh(parsed) {
  disposeMesh();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(parsed.positions, 3));
  if (normalsUsable(parsed.normals)) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(parsed.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  geometry.boundingBox.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0xd7c4a3,
    metalness: 0.08,
    roughness: 0.46,
    side: THREE.DoubleSide,
    wireframe: wireInput.checked,
  });
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const footprint = Math.max(size.x, size.y, size.z);
  setGrid(footprint * 1.8, -size.z / 2);
  frameSize(size);
  emptyEl.hidden = true;
  emptyEl.setAttribute('hidden', '');
  dirty = true;
}

function rotateMesh90(axis) {
  if (!mesh) {
    setStatus("Load an STL before rotating.", true);
    return;
  }
  mesh.rotateOnWorldAxis(axis, Math.PI / 2);
  mesh.updateMatrixWorld(true);
  dirty = true;
}

function axesInsetSize(width, height) {
  return Math.max(64, Math.min(AXIS_INSET, Math.floor(Math.min(width, height) * 0.22)));
}

function renderAxesGizmo(width, height) {
  const inset = axesInsetSize(width, height);
  const margin = Math.min(AXIS_MARGIN, Math.max(4, Math.floor(inset * 0.1)));
  // Lock gizmo orientation to the main camera quaternion so world X/Y/Z in
  // the corner match rotateOnWorldAxis(worldX/Y/Z) in the main view.
  axesRoot.quaternion.copy(camera.quaternion).invert();
  axesCamera.position.set(0, 0, 2.4);
  axesCamera.up.set(0, 1, 0);
  axesCamera.lookAt(0, 0, 0);
  axesCamera.updateProjectionMatrix();

  renderer.clearDepth();
  renderer.setScissorTest(true);
  renderer.setScissor(margin, margin, inset, inset);
  renderer.setViewport(margin, margin, inset, inset);
  renderer.render(axesScene, axesCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
}

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width === 0 || height === 0) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.setSize(width, height, false);
  dirty = true;
}

async function loadFile(file) {
  if (!file) return;
  const token = ++loadToken;
  pixelRatioCap = 2;
  setStatus("Reading file…");
  try {
    const buffer = await file.arrayBuffer();
    if (token !== loadToken) return;
    setStatus("Parsing mesh…");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (token !== loadToken) return;
    const parsed = parseSTL(buffer);
    if (token !== loadToken) return;
    pixelRatioCap = parsed.triangles > 1_000_000 ? 1 : 2;
    resize();
    showMesh(parsed);
    setStats(file, parsed);
    const kind = parsed.format === "binary" ? "Binary" : "ASCII";
    setStatus(`${kind} STL · ${formatCount(parsed.triangles)} triangles`);
  } catch (error) {
    if (token !== loadToken) return;
    setStatus(error instanceof Error ? error.message : "Could not read that STL.", true);
  } finally {
    fileInput.value = "";
  }
}

function clearModel() {
  loadToken++;
  disposeMesh();
  wireInput.checked = false;
  setGrid(8, 0);
  setStats(null, null);
  setStatus("");
  emptyEl.hidden = false;
  emptyEl.removeAttribute('hidden');
  pixelRatioCap = 2;
  camera.near = 0.1;
  camera.far = 100;
  camera.up.set(0, 0, 1);
  camera.position.set(2.4, -3.1, 1.6);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = 0;
  controls.maxDistance = Infinity;
  controls.update();
  controls.saveState();
  resize();
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) loadFile(file);
});

wireInput.addEventListener("change", () => {
  if (mesh) mesh.material.wireframe = wireInput.checked;
  dirty = true;
});

rotateXButton.addEventListener("click", () => rotateMesh90(worldX));
rotateYButton.addEventListener("click", () => rotateMesh90(worldY));
rotateZButton.addEventListener("click", () => rotateMesh90(worldZ));

resetButton.addEventListener("click", () => {
  // Camera / orbit only — mesh orientation stays until Clear.
  controls.reset();
  dirty = true;
});

clearButton.addEventListener("click", clearModel);

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth++;
  dropHint.hidden = false;
});
window.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropHint.hidden = true;
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) loadFile(file);
});

new ResizeObserver(resize).observe(stage);
resize();

function frame() {
  requestAnimationFrame(frame);
  if (controls.update()) dirty = true;
  if (!dirty) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width > 0 && height > 0) {
    renderer.setViewport(0, 0, width, height);
    renderer.render(scene, camera);
    renderAxesGizmo(width, height);
  }
  dirty = false;
}
frame();
