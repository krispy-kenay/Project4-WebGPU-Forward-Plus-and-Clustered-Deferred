import Stats from 'stats.js';
import { GUI } from 'dat.gui';

import { initWebGPU, Renderer } from './renderer';
import { NaiveRenderer } from './renderers/naive';
import { ForwardPlusRenderer } from './renderers/forward_plus';
import { ClusteredDeferredRenderer } from './renderers/clustered_deferred';

import { setupLoaders, Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';

await initWebGPU();
setupLoaders();

let scene = new Scene();
await scene.loadGltf('./scenes/sponza/Sponza.gltf');

const camera = new Camera();
const lights = new Lights(camera);

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const gui = new GUI();
gui.add(lights, 'numLights').min(1).max(Lights.maxNumLights).step(1).onChange(() => {
    lights.updateLightSetUniformNumLights();
});

const stage = new Stage(scene, lights, camera, stats);

var renderer: Renderer | undefined;

function setRenderer(mode: string) {
    renderer?.stop();

    switch (mode) {
        case renderModes.naive:
            renderer = new NaiveRenderer(stage);
            break;
        case renderModes.forwardPlus:
            renderer = new ForwardPlusRenderer(stage);
            break;
        case renderModes.clusteredDeferred:
            renderer = new ClusteredDeferredRenderer(stage);
            break;
    }
}

const renderModes = { naive: 'naive', forwardPlus: 'forward+', clusteredDeferred: 'clustered deferred' };
let renderModeController = gui.add({ mode: renderModes.naive }, 'mode', renderModes);
renderModeController.onChange(setRenderer);

setRenderer(renderModeController.getValue());

const benchmarkSettings = { runBenchmark: () => runBenchmark() };
gui.add(benchmarkSettings, 'runBenchmark').name('Run Benchmark');

async function resetScene() {
    scene = new Scene();
    await scene.loadGltf('./scenes/sponza/Sponza.gltf');
}

async function runBenchmark() {
    if (!renderer) return;
    console.log('Starting benchmark...');

    const FRAMES_PER_RUN = 300;
    const WARMUP_FRAMES = 10;
    const results: number[] = [];

    let startTime = 0;
    let frameCount = 0;

    await resetScene();

    renderer.setFrameCallback((time) => {
        if (frameCount === 0) startTime = time;
        frameCount++;

        if (frameCount === WARMUP_FRAMES) {
            startTime = time;
        } else if (frameCount >= FRAMES_PER_RUN) {
            const duration = time - startTime;
            const fps = 1000 * (frameCount - 1) / duration;
            results.push(fps);
            renderer.setFrameCallback(undefined);
        }
    });

    await new Promise<void>((resolve) => {
        const check = () => {
            if (!renderer['onFrameCallback']) resolve();
            else requestAnimationFrame(check);
        }
        check();
    });

    const avgFPS = results.reduce((a, b) => a + b, 0) / results.length;
    console.log(`Benchmark complete — Average FPS: ${avgFPS.toFixed(2)}`);
}

const countNumClusters = { countClusters: () => countClusters() };
gui.add(countNumClusters, 'countClusters').name('Count # of Clusters');

async function countClusters() {
    if (!renderer) return;
    lights.readClusterCounts().then(() => {});
}