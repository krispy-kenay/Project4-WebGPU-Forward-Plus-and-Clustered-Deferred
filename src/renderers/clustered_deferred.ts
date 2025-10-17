import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    // TODO-3: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    private clusterDeferredSceneBindGroupLayout!: GPUBindGroupLayout;
    private clusterDeferredSceneBindGroup!: GPUBindGroup;
    private clusterDeferredGBufferBindGroupLayout!: GPUBindGroupLayout;
    private clusterDeferredGBufferBindGroup!: GPUBindGroup;
    private clusterDeferredGBufferSampler!: GPUSampler;
    private clusterDeferredGBufferPipeline!: GPURenderPipeline;
    private clusterDeferredFullscreenPipeline!: GPURenderPipeline;

    private GBufferPosition!: GPUTexture;
    private GBufferPositionView!: GPUTextureView;
    private GBufferNormal!: GPUTexture;
    private GBufferNormalView!: GPUTextureView;
    private GBufferAlbedo!: GPUTexture;
    private GBufferAlbedoView!: GPUTextureView;
    private depthTexture!: GPUTexture;
    private depthTextureView!: GPUTextureView;

    constructor(stage: Stage) {
        super(stage);

        // TODO-3: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        // you'll need two pipelines: one for the G-buffer pass and one for the fullscreen pass
        this.clusterDeferredSceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "CD scene BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            ],
        });

        this.clusterDeferredSceneBindGroup = renderer.device.createBindGroup({
            label: "CD scene BG",
            layout: this.clusterDeferredSceneBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterCountsBuffer } },
                { binding: 3, resource: { buffer: this.lights.clusterIndicesBuffer } },
            ],
        });

        const w = renderer.canvas.width, h = renderer.canvas.height;
        this.GBufferPosition = renderer.device.createTexture({
            label: "GBuffer Position", size: [w, h], format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.GBufferNormal = renderer.device.createTexture({
            label: "GBuffer Normal", size: [w, h], format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.GBufferAlbedo = renderer.device.createTexture({
            label: "GBuffer Albedo", size: [w, h], format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });

        this.GBufferPositionView = this.GBufferPosition.createView();
        this.GBufferNormalView = this.GBufferNormal.createView();
        this.GBufferAlbedoView = this.GBufferAlbedo.createView();

        this.depthTexture = renderer.device.createTexture({
            label: "GBuffer Depth", size: [w, h], format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthTextureView = this.depthTexture.createView();
        
        this.clusterDeferredGBufferSampler = renderer.device.createSampler({
            label: "GBuffer Sampler", magFilter: "linear", minFilter: "linear"
        });

        this.clusterDeferredGBufferBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "GBuffer sample BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            ],
        });
        this.clusterDeferredGBufferBindGroup = renderer.device.createBindGroup({
            label: "GBuffer sample BG",
            layout: this.clusterDeferredGBufferBindGroupLayout,
            entries: [
                { binding: 0, resource: this.GBufferPositionView },
                { binding: 1, resource: this.GBufferNormalView },
                { binding: 2, resource: this.GBufferAlbedoView },
                { binding: 3, resource: this.clusterDeferredGBufferSampler },
            ],
        });

        this.clusterDeferredGBufferPipeline = renderer.device.createRenderPipeline({
            label: "Clustered Deferred GBuffer",
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [
                    this.clusterDeferredSceneBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout,
                ],
            }),
            vertex: {
                module: renderer.device.createShaderModule({ code: shaders.naiveVertSrc }),
                entryPoint: "main",
                buffers: [renderer.vertexBufferLayout],
            },
            fragment: {
                module: renderer.device.createShaderModule({ code: shaders.clusteredDeferredFragSrc }),
                entryPoint: "main",
                targets: [
                    { format: "rgba16float" },
                    { format: "rgba16float" },
                    { format: "rgba8unorm"  },
                ],
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
            primitive: { topology: "triangle-list", cullMode: "back" },
        });

        this.clusterDeferredFullscreenPipeline = renderer.device.createRenderPipeline({
            label: "Clustered Deferred Fullscreen",
            layout: renderer.device.createPipelineLayout({
                bindGroupLayouts: [
                this.clusterDeferredSceneBindGroupLayout,
                this.clusterDeferredGBufferBindGroupLayout,
                ],
            }),
            vertex: {
                module: renderer.device.createShaderModule({ code: shaders.clusteredDeferredFullscreenVertSrc }),
                entryPoint: "main",
            },
            fragment: {
                module: renderer.device.createShaderModule({ code: shaders.clusteredDeferredFullscreenFragSrc }),
                entryPoint: "main",
                targets: [{ format: renderer.canvasFormat }],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
        });
    }

    private refreshSceneBindGroup() {
        this.clusterDeferredSceneBindGroup = renderer.device.createBindGroup({
            label: 'Forward+ scene BG',
            layout: this.clusterDeferredSceneBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterCountsBuffer } },
                { binding: 3, resource: { buffer: this.lights.clusterIndicesBuffer } },
            ],
        });
    }

    override draw() {
        // TODO-3: run the Forward+ rendering pass:
        // - run the clustering compute shader
        // - run the G-buffer pass, outputting position, albedo, and normals
        // - run the fullscreen pass, which reads from the G-buffer and performs lighting calculations
        this.refreshSceneBindGroup();

        const encoder = renderer.device.createCommandEncoder();
        this.lights.doLightClustering(encoder);

        const gBufferPass = encoder.beginRenderPass({
            label: "CD GBuffer Pass",
            colorAttachments: [
                { view: this.GBufferPositionView, loadOp: "clear", storeOp: "store", clearValue: { r:0, g:0, b:0, a:1 } },
                { view: this.GBufferNormalView,   loadOp: "clear", storeOp: "store", clearValue: { r:0, g:0, b:0, a:1 } },
                { view: this.GBufferAlbedoView,   loadOp: "clear", storeOp: "store", clearValue: { r:0, g:0, b:0, a:1 } },
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 1.0,
            },
        });

        gBufferPass.setPipeline(this.clusterDeferredGBufferPipeline);
        gBufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.clusterDeferredSceneBindGroup);

        this.scene.iterate(node => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            gBufferPass.setVertexBuffer(0, primitive.vertexBuffer);
            gBufferPass.setIndexBuffer(primitive.indexBuffer, "uint32");
            gBufferPass.drawIndexed(primitive.numIndices);
        });

        gBufferPass.end();

        const colorView = renderer.context.getCurrentTexture().createView();
        const fullscreenPass = encoder.beginRenderPass({
            label: "CD Fullscreen Pass",
            colorAttachments: [{ view: colorView, loadOp: "clear", storeOp: "store", clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 }, }],
        });

        fullscreenPass.setPipeline(this.clusterDeferredFullscreenPipeline);
        fullscreenPass.setBindGroup(shaders.constants.bindGroup_scene, this.clusterDeferredSceneBindGroup);
        fullscreenPass.setBindGroup(1, this.clusterDeferredGBufferBindGroup);

        fullscreenPass.draw(3);
        fullscreenPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
