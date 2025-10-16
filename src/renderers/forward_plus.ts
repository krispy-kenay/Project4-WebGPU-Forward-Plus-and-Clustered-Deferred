import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ForwardPlusRenderer extends renderer.Renderer {
    // TODO-2: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    private forwardPlusSceneBindGroupLayout!: GPUBindGroupLayout;
    private forwardPlusSceneBindGroup!: GPUBindGroup;
    private forwardPlusPipeline!: GPURenderPipeline;
    private depthTexture!: GPUTexture;
    private depthTextureView!: GPUTextureView;

    constructor(stage: Stage) {
        super(stage);

        // TODO-2: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        this.forwardPlusSceneBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "Forward+ scene BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "storage" } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            ]
        });
        
        this.forwardPlusSceneBindGroup = renderer.device.createBindGroup({
            label: "Forward+ scene BG",
            layout: this.forwardPlusSceneBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
                { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
                { binding: 2, resource: { buffer: this.lights.clusterCountsBuffer } },
                { binding: 3, resource: { buffer: this.lights.clusterIndicesBuffer } },
            ]
        });

        this.forwardPlusPipeline = renderer.device.createRenderPipeline({
            label: "Forward+ pipeline",
            layout: renderer.device.createPipelineLayout({
                label: 'Forward+ pipeline layout',
                bindGroupLayouts: [
                  this.forwardPlusSceneBindGroupLayout,
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
                module: renderer.device.createShaderModule({ code: shaders.forwardPlusFragSrc }),
                entryPoint: "main",
                targets: [{ format: renderer.canvasFormat }]
            },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: "less"
            }
        });

        this.depthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
          this.depthTextureView = this.depthTexture.createView();
    }

    private refreshSceneBindGroup() {
        this.forwardPlusSceneBindGroup = renderer.device.createBindGroup({
          label: 'Forward+ scene BG',
          layout: this.forwardPlusSceneBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
            { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
            { binding: 2, resource: { buffer: this.lights.clusterCountsBuffer } },
            { binding: 3, resource: { buffer: this.lights.clusterIndicesBuffer } },
          ],
        });
      }

    override draw() {
        // TODO-2: run the Forward+ rendering pass:
        // - run the clustering compute shader
        // - run the main rendering pass, using the computed clusters for efficient lighting
        this.refreshSceneBindGroup();

        const encoder = renderer.device.createCommandEncoder();
        this.lights.doLightClustering(encoder);

        const colorView = renderer.context.getCurrentTexture().createView();
        const depthView = this.depthTextureView;

        const rpass = encoder.beginRenderPass({
            colorAttachments: [{
                view: colorView,
                loadOp: "clear",
                storeOp: "store",
                clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1.0 }
            }],
            depthStencilAttachment: {
                view: depthView,
                depthLoadOp: "clear",
                depthStoreOp: "store",
                depthClearValue: 1.0
            }
        });

        rpass.setPipeline(this.forwardPlusPipeline);
        rpass.setBindGroup(shaders.constants.bindGroup_scene,   this.forwardPlusSceneBindGroup);

        this.scene.iterate(node => {
            rpass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
          }, material => {
            rpass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
          }, primitive => {
            rpass.setVertexBuffer(0, primitive.vertexBuffer);
            rpass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            rpass.drawIndexed(primitive.numIndices);
          });

        rpass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}
