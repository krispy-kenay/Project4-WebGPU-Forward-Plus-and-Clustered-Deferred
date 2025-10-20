// TODO-2: implement the light clustering compute shader

// ------------------------------------
// Calculating cluster bounds:
// ------------------------------------
// For each cluster (X, Y, Z):
//     - Calculate the screen-space bounds for this cluster in 2D (XY).
//     - Calculate the depth bounds for this cluster in Z (near and far planes).
//     - Convert these screen and depth bounds into view-space coordinates.
//     - Store the computed bounding box (AABB) for the cluster.

// ------------------------------------
// Assigning lights to clusters:
// ------------------------------------
// For each cluster:
//     - Initialize a counter for the number of lights in this cluster.

//     For each light:
//         - Check if the light intersects with the cluster’s bounding box (AABB).
//         - If it does, add the light to the cluster's light list.
//         - Stop adding lights if the maximum number of lights is reached.

//     - Store the number of lights assigned to this cluster.
struct ClusterCountsRW { data: array<atomic<u32>> }
struct ClusterIndicesRW { data: array<u32> }

@group(0) @binding(0) var<storage, read>       lightSet : LightSet;
@group(0) @binding(1) var<uniform>             camera   : CameraUniforms;
@group(0) @binding(2) var<storage, read_write> counts   : ClusterCountsRW;
@group(0) @binding(3) var<storage, read_write> indices  : ClusterIndicesRW;

@compute @workgroup_size(${clusteringWorkgroupSize})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
    let lightIdx = globalId.x;
    if (lightIdx >= lightSet.numLights) { return; }

    let screenW = f32(camera.screenParams.x);
    let screenH = f32(camera.screenParams.y);

    let Y_SLICES = u32(ceil(f32(X_SLICES) * (screenH / screenW)));
    let tileSizeX = screenW / f32(X_SLICES);
    let tileSizeY = screenH / f32(Y_SLICES);

    let Lw = lightSet.lights[lightIdx];
    let lightPosView = (camera.viewMat * vec4f(Lw.pos, 1.0)).xyz;

    let depth = -lightPosView.z;
    let near = camera.nearFar.x;
    let far = camera.nearFar.y;

    if (depth <= near || depth >= far) { return; }

    let light = lightSet.lights[lightIdx];
    let radius = f32(LIGHT_RADIUS);
    let sliceMin = slice_from_depth_linear(max(near, depth - radius), near, far);
    let sliceMax = slice_from_depth_linear(min(far  - 1e-4, depth + radius), near, far);

    let screen = vec2f(f32(camera.screenParams.x), f32(camera.screenParams.y));
    let rect = light_screen_bounds_px(lightPosView, radius, screen, camera.projMat);

    if (rect.z <= rect.x || rect.w <= rect.y) { return; }
    
    let nx_f = ceil(screen.x / f32(tileSizeX));
    let ny_f = ceil(screen.y / f32(tileSizeY));
    let nx = u32(nx_f);
    let ny = u32(ny_f);

    let tileMinX = u32(clamp(floor(rect.x / f32(tileSizeX)), 0.0, nx_f - 1.0));
    let tileMaxX = u32(clamp(floor(rect.z / f32(tileSizeX)), 0.0, nx_f - 1.0));
    let tileMinY = u32(clamp(floor(rect.y / f32(tileSizeY)), 0.0, ny_f - 1.0));
    let tileMaxY = u32(clamp(floor(rect.w / f32(tileSizeY)), 0.0, ny_f - 1.0));

    if (tileMaxX < tileMinX || tileMaxY < tileMinY) { return; }

    for (var iz = sliceMin; iz <= sliceMax; iz++) {
        for (var iy = tileMinY; iy <= tileMaxY; iy++) {
            for (var ix = tileMinX; ix <= tileMaxX; ix++) {
                let clusterIdx = cluster_index(ix, iy, iz, nx, ny);

                let countPtr = &counts.data[clusterIdx];
                let old = atomicAdd(countPtr, 1u);
                if (old < MAX_LIGHTS_PER_CLUSTER) {
                    indices.data[clusterIdx * MAX_LIGHTS_PER_CLUSTER + old] = lightIdx;
                }
            }
        }
    }
}