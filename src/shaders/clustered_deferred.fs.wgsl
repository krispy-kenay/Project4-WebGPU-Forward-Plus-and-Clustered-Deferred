// TODO-3: implement the Clustered Deferred G-buffer fragment shader

// This shader should only store G-buffer information and should not do any shading.
@group(${bindGroup_scene}) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(${bindGroup_model}) @binding(0) var<uniform> modelMat : mat4x4f;
@group(${bindGroup_material}) @binding(0) var diffuseTex : texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler : sampler;

struct FragmentInput {
    @location(0) pos : vec3f,
    @location(1) nor : vec3f,
    @location(2) uv : vec2f,
};

struct GBufferOutput {
    @location(0) posOut : vec4f,
    @location(1) normalOut : vec4f,
    @location(2) albedoOut : vec4f,
};

@fragment
fn main(in: FragmentInput) -> GBufferOutput {
    let diffuseColor = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (diffuseColor.a < 0.5f) {
        discard;
    }

    var out : GBufferOutput;
    out.posOut    = vec4f(in.pos, 1.0);
    out.normalOut = vec4f(normalize(in.nor), 0.0);
    out.albedoOut = vec4f(diffuseColor.rgb, 1.0);
    return out;
}