// TODO-2: implement the Forward+ fragment shader

// See naive.fs.wgsl for basic fragment shader setup; this shader should use light clusters instead of looping over all lights

// ------------------------------------
// Shading process:
// ------------------------------------
// Determine which cluster contains the current fragment.
// Retrieve the number of lights that affect the current fragment from the cluster’s data.
// Initialize a variable to accumulate the total light contribution for the fragment.
// For each light in the cluster:
//     Access the light's properties using its index.
//     Calculate the contribution of the light based on its position, the fragment’s position, and the surface normal.
//     Add the calculated contribution to the total light accumulation.
// Multiply the fragment’s diffuse color by the accumulated light contribution.
// Return the final color, ensuring that the alpha component is set appropriately (typically to 1).

struct ClusterCountsRO { data: array<u32> }
struct ClusterIndicesRO { data: array<u32> }

@group(${bindGroup_scene}) @binding(0) var<uniform> camera  : CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read_write> counts  : ClusterCountsRO;
@group(${bindGroup_scene}) @binding(3) var<storage, read> indices : ClusterIndicesRO;

@group(1) @binding(0) var<uniform> modelMat : mat4x4f;
@group(2) @binding(0) var diffuseTex : texture_2d<f32>;
@group(2) @binding(1) var diffuseSampler : sampler;

struct FragInput {
    @location(0) posWorld : vec3f,
    @location(1) norWorld : vec3f,
    @location(2) uv : vec2f,
    @builtin(position) fragCoord : vec4f,
};

struct FragOutput {
    @location(0) color : vec4f,
};

@fragment
fn main(input : FragInput) -> FragOutput {
    let colorTex = textureSample(diffuseTex, diffuseSampler, input.uv);

    let screenW = f32(camera.screenParams.x);
    let screenH = f32(camera.screenParams.y);
    let nx = u32(ceil(screenW / f32(TILE_SIZE)));
    let ny = u32(ceil(screenH / f32(TILE_SIZE)));

    let tileX = u32(floor(input.fragCoord.x / f32(TILE_SIZE)));
    let tileY = u32(floor(input.fragCoord.y / f32(TILE_SIZE)));

    let viewPos = (camera.viewMat * vec4f(input.posWorld, 1.0)).xyz;
    let depth = -viewPos.z;

    let zSlice = slice_from_depth_linear(depth, camera.nearFar.x, camera.nearFar.y);

    let clusterIdx = cluster_index(tileX, tileY, zSlice, nx, ny);

    let lightCount = min(counts.data[clusterIdx], ${maxLightsPerCluster});
    var totalLight = vec3f(0.0);

    for (var i = 0u; i < lightCount && i < ${maxLightsPerCluster}; i++) {
        let lightIdx = indices.data[clusterIdx * ${maxLightsPerCluster} + i];
        let light = lightSet.lights[lightIdx];
        totalLight += calculateLightContrib(light, input.posWorld, normalize(input.norWorld));
    }

    var outColor : FragOutput;
    outColor.color = vec4f(colorTex.rgb * totalLight, 1.0);
    return outColor;
}

