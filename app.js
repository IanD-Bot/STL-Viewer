import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;

const fileInput = document.querySelector("#file-input");
const wireInput = document.querySelector("#wireframe");
const resetButton = document.querySelector("#reset-view");
const clearButton = document.querySelector("#clear");
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

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(2.4, 1.6, 3.1);

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
keyLight.position.set(6, 10, 7);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8ea4c8, 0.45);
fillLight.position.set(-7, 3, -5);
scene.add(fillLight);

let mesh = null;
let grid = null;
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

function setGrid(span, y) {
  if (grid) {
    scene.remove(grid);
    grid.geometry.dispose();
    disposeMaterial(grid.material);
    grid = null;
  }
  const size = Math.max(span, 1e-4);
  const divisions = size > 1000 ? 10 : 20;
  grid = new THREE.GridHelper(size, divisions, 0x3d4b60, 0x242c39);
  grid.position.y = y;
  scene.add(grid);
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
  camera.position.set(distance * 0.72, distance * 0.5, distance * 0.9);
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

  const footprint = Math.max(size.x, size.z, size.y);
  setGrid(footprint * 1.8, -size.y / 2);
  frameSize(size);
  emptyEl.hidden = true;
  dirty = true;
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
  pixelRatioCap = 2;
  camera.near = 0.1;
  camera.far = 100;
  camera.position.set(2.4, 1.6, 3.1);
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

resetButton.addEventListener("click", () => {
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
  renderer.render(scene, camera);
  dirty = false;
}
frame();
