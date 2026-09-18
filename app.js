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

const AXIS_INSET = 96;
const AXIS_MARGIN = 10;
const axesScene = new THREE.Scene();
const axesCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
const worldX = new THREE.Vector3(1, 0, 0);
const worldY = new THREE.Vector3(0, 1, 0);
const worldZ = new THREE.Vector3(0, 0, 1);
const axesCamOffset = new THREE.Vector3();

function makeAxisLabel(text, colorCss) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = colorCss;
  ctx.font = "700 42px Segoe UI, Helvetica Neue, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 34);
  const texture = new THREE.CanvasTexture(canvas);
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
  axesScene.add(new THREE.Line(geometry, material));
  const sprite = makeAxisLabel(label, labelCss);
  sprite.position.copy(dir).multiplyScalar(1.05);
  axesScene.add(sprite);
}

addAxisLine(worldX, 0xe05050, "X", "#e86060");
addAxisLine(worldY, 0x45b86a, "Y", "#4cbc6a");
addAxisLine(worldZ, 0x4a8fe0, "Z", "#4a8fe0");

let mesh = null;
let grid = null;
let loadToken = 0;
let pixelRatioCap = 2;
let dirty = true;

setGrid(8, 0);

// CONTENT_CONTINUES_FROM_PATH_READ_TEXT
