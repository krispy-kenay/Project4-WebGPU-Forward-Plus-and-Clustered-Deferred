import { vec3 } from "wgpu-matrix";
import { device, canvas } from "../renderer";

import * as shaders from '../shaders/shaders';
import { Camera } from "./camera";

// h in [0, 1]
function hueToRgb(h: number) {
    let f = (n: number, k = (n + h * 6) % 6) => 1 - Math.max(Math.min(k, 4 - k, 1), 0);
    return vec3.lerp(vec3.create(1, 1, 1), vec3.create(f(5), f(3), f(1)), 0.8);
}

export class Lights {
    private camera: Camera;

    numLights = 20;
    static readonly maxNumLights = 5000;
    static readonly numFloatsPerLight = 8; // vec3f is aligned at 16 byte boundaries

    static readonly lightIntensity = 0.1;

    lightsArray = new Float32Array(Lights.maxNumLights * Lights.numFloatsPerLight);
    lightSetStorageBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    moveLightsComputeBindGroupLayout: GPUBindGroupLayout;
    moveLightsComputeBindGroup: GPUBindGroup;
    moveLightsComputePipeline: GPUComputePipeline;

    // TODO-2: add layouts, pipelines, textures, etc. needed for light clustering here
    clusterCountsBuffer!: GPUBuffer;
    clusterIndicesBuffer!: GPUBuffer;
    clusteringComputeBindGroupLayout!: GPUBindGroupLayout;
    clusteringComputeBindGroup!: GPUBindGroup;
    clusteringComputePipeline!: GPUComputePipeline;
    private totalClusters = 0;

    constructor(camera: Camera) {
        this.camera = camera;

        this.lightSetStorageBuffer = device.createBuffer({
            label: "lights",
            size: 16 + this.lightsArray.byteLength, // 16 for numLights + padding
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this.populateLightsBuffer();
        this.updateLightSetUniformNumLights();

        this.timeUniformBuffer = device.createBuffer({
            label: "time uniform",
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.moveLightsComputeBindGroupLayout = device.createBindGroupLayout({
            label: "move lights compute bind group layout",
            entries: [
                { // lightSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // time
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.moveLightsComputeBindGroup = device.createBindGroup({
            label: "move lights compute bind group",
            layout: this.moveLightsComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.lightSetStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer }
                }
            ]
        });

        this.moveLightsComputePipeline = device.createComputePipeline({
            label: "move lights compute pipeline",
            layout: device.createPipelineLayout({
                label: "move lights compute pipeline layout",
                bindGroupLayouts: [ this.moveLightsComputeBindGroupLayout ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "move lights compute shader",
                    code: shaders.moveLightsComputeSrc
                }),
                entryPoint: "main"
            }
        });

        // TODO-2: initialize layouts, pipelines, textures, etc. needed for light clustering here
        const allocateClusterBuffers = () => {
            const screenW = canvas.width;
            const screenH = canvas.height;
            const nx = shaders.constants.numXSlices;
            const ny = Math.ceil(nx * (screenH / screenW));;
            const nz = shaders.constants.numZSlices;
            const total = nx * ny * nz;

            if (total === this.totalClusters && this.clusterCountsBuffer && this.clusterIndicesBuffer) {
                return;
            }

            this.totalClusters = total;

            this.clusterCountsBuffer = device.createBuffer({
                label: "cluster counts (u32 per cluster)",
                size: Math.max(4, total * 4),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
            });

            this.clusterIndicesBuffer = device.createBuffer({
                label: "cluster indices (u32 light indices)",
                size: Math.max(4, total * shaders.constants.maxLightsPerCluster * 4),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });

            this.clusteringComputeBindGroup = device.createBindGroup({
                label: "clustering compute bind group",
                layout: this.clusteringComputeBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.lightSetStorageBuffer } },
                    { binding: 1, resource: { buffer: this.camera.uniformsBuffer } },
                    { binding: 2, resource: { buffer: this.clusterCountsBuffer } },
                    { binding: 3, resource: { buffer: this.clusterIndicesBuffer } }
                ]
            });
        };

        this.clusteringComputeBindGroupLayout = device.createBindGroupLayout({
            label: "clustering compute bind group layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }
            ]
        });

        this.clusteringComputePipeline = device.createComputePipeline({
            label: "clustering compute pipeline",
            layout: device.createPipelineLayout({
                label: "clustering compute pipeline layout",
                bindGroupLayouts: [ this.clusteringComputeBindGroupLayout ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "clustering compute shader",
                    code: shaders.clusteringComputeSrc
                }),
                entryPoint: "main"
            }
        });

        allocateClusterBuffers();
        (this as any)._allocateClusterBuffers = allocateClusterBuffers;
    }

    private populateLightsBuffer() {
        for (let lightIdx = 0; lightIdx < Lights.maxNumLights; ++lightIdx) {
            // light pos is set by compute shader so no need to set it here
            const lightColor = vec3.scale(hueToRgb(Math.random()), Lights.lightIntensity);
            this.lightsArray.set(lightColor, (lightIdx * Lights.numFloatsPerLight) + 4);
        }

        device.queue.writeBuffer(this.lightSetStorageBuffer, 16, this.lightsArray);
    }

    async readClusterCounts() {
        await device.queue.onSubmittedWorkDone();

        const readbackBuffer = device.createBuffer({
            size: this.totalClusters * 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const commandEncoder = device.createCommandEncoder();
            commandEncoder.copyBufferToBuffer(
            this.clusterCountsBuffer, 0,
            readbackBuffer, 0,
            this.totalClusters * 4
        );
        device.queue.submit([commandEncoder.finish()]);
          
        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const arrayBuf = readbackBuffer.getMappedRange();
        const counts = new Uint32Array(arrayBuf);

        let sum = 0, max = 0, empty = 0;
        for (let i = 0; i < this.totalClusters; ++i) {
            const c = counts[i];
            sum += c;
            if (c === 0) empty++;
            if (c > max) max = c;
        }
        const avg = sum / this.totalClusters;
        const emptyPct = (empty / this.totalClusters) * 100;
          
        console.log(
            `Clusters: ${this.totalClusters}, avg lights: ${avg.toFixed(2)}, max: ${max}, empty: ${emptyPct.toFixed(1)}%`
        );
          
        readbackBuffer.unmap();
    }

    updateLightSetUniformNumLights() {
        device.queue.writeBuffer(this.lightSetStorageBuffer, 0, new Uint32Array([this.numLights]));
    }

    doLightClustering(encoder: GPUCommandEncoder) {
        // TODO-2: run the light clustering compute pass(es) here
        // implementing clustering here allows for reusing the code in both Forward+ and Clustered Deferred
        (this as any)._allocateClusterBuffers();
        const zeroArray = new Uint32Array(this.totalClusters);
        device.queue.writeBuffer(this.clusterCountsBuffer, 0, zeroArray);

        const cpass = encoder.beginComputePass();
        cpass.setPipeline(this.clusteringComputePipeline);
        cpass.setBindGroup(0, this.clusteringComputeBindGroup);
        const wgSize = shaders.constants.clusteringWorkgroupSize;
        const groups = Math.ceil(this.numLights / wgSize);
        cpass.dispatchWorkgroups(groups);

        cpass.end();
    }

    // CHECKITOUT: this is where the light movement compute shader is dispatched from the host
    onFrame(time: number) {
        device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

        // not using same encoder as render pass so this doesn't interfere with measuring actual rendering performance
        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.moveLightsComputePipeline);

        computePass.setBindGroup(0, this.moveLightsComputeBindGroup);

        const workgroupCount = Math.ceil(this.numLights / shaders.constants.moveLightsWorkgroupSize);
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        device.queue.submit([encoder.finish()]);
    }
}
