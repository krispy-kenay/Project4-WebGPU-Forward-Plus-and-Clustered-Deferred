// TODO-3: implement the Clustered Deferred fullscreen fragment shader

// Similar to the Forward+ fragment shader, but with vertex information coming from the G-buffer instead.
struct ClusterCountsRO { data: array<u32> }
struct ClusterIndicesRO { data: array<u32> }

@group(${bindGroup_scene}) @binding(0) var<uniform> camera : CameraUniforms;
@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet : LightSet;
@group(${bindGroup_scene}) @binding(2) var<storage, read> counts : ClusterCountsRO;
@group(${bindGroup_scene}) @binding(3) var<storage, read> indices : ClusterIndicesRO;

@group(1) @binding(0) var gbufPosition : texture_2d<f32>;
@group(1) @binding(1) var gbufNormal : texture_2d<f32>;
@group(1) @binding(2) var gbufAlbedo : texture_2d<f32>;
@group(1) @binding(3) var gbufSampler : sampler;

struct FragInput {
    @location(0) uv : vec2f,
    @builtin(position) fragCoord : vec4f,
};

struct FragOutput {
    @location(0) color : vec4f,
};

@fragment
fn main(input : FragInput) -> FragOutput {
    let posWorld = textureSample(gbufPosition, gbufSampler, input.uv).xyz;
    let norWorld = normalize(textureSample(gbufNormal, gbufSampler, input.uv).xyz);
    let albedo = textureSample(gbufAlbedo, gbufSampler, input.uv).rgb;

    let screenW = f32(camera.screenParams.x);
    let screenH = f32(camera.screenParams.y);

    let Y_SLICES = u32(ceil(f32(X_SLICES) * (screenH / screenW)));
    let tileSizeX = screenW / f32(X_SLICES);
    let tileSizeY = screenH / f32(Y_SLICES);

    let nx = u32(ceil(screenW / f32(tileSizeX)));
    let ny = u32(ceil(screenH / f32(tileSizeY)));

    let tileX = u32(floor(input.fragCoord.x / f32(tileSizeX)));
    let tileY = u32(floor(input.fragCoord.y / f32(tileSizeY)));

    let viewPos = (camera.viewMat * vec4f(posWorld, 1.0)).xyz;
    let depth = -viewPos.z;
    let zSlice = slice_from_depth_linear(depth, camera.nearFar.x, camera.nearFar.y);

    let clusterIdx = cluster_index(tileX, tileY, zSlice, nx, ny);

    let lightCount = min(counts.data[clusterIdx], ${maxLightsPerCluster});
    var totalLight = vec3f(0.0);

    for (var i = 0u; i < lightCount && i < ${maxLightsPerCluster}; i++) {
        let lightIdx = indices.data[clusterIdx * ${maxLightsPerCluster} + i];
        let light = lightSet.lights[lightIdx];
        totalLight += calculateLightContrib(light, posWorld, norWorld);
    }

    var out : FragOutput;
    out.color = vec4f(albedo * totalLight, 1.0);
    return out;
}