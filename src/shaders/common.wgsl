// CHECKITOUT: code that you add here will be prepended to all shaders
const TILE_SIZE : u32 = ${clusterTileSizePx};
const Z_SLICES : u32 = ${numZSlices};
const MAX_LIGHTS_PER_CLUSTER : u32 = ${maxLightsPerCluster};
const LIGHT_RADIUS : u32 = 2;

struct Light {
    pos: vec3f,
    color: vec3f
}

struct LightSet {
    numLights: u32,
    lights: array<Light>
}

// TODO-2: you may want to create a ClusterSet struct similar to LightSet

struct CameraUniforms {
    // TODO-1.3: add an entry for the view proj mat (of type mat4x4f)
    viewProjMat: mat4x4f,
    viewMat: mat4x4f,
    projMat: mat4x4f,
    screenParams: vec4<u32>,
    nearFar: vec4f,
}

// CHECKITOUT: this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 {
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / (distance * distance);
}

fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);

    let lambert = max(dot(nor, normalize(vecToLight)), 0.f);
    return light.color * lambert * rangeAttenuation(distToLight);
}

fn cluster_index(ix: u32, iy: u32, iz: u32, nx: u32, ny: u32) -> u32 {
    return iz * nx * ny + iy * nx + ix;
}

fn slice_from_depth_linear(depth: f32, near: f32, far: f32) -> u32 {
    let t = clamp((depth - near) / max(1e-6, (far - near)), 0.0, 0.999999);
    return u32(floor(t * f32(Z_SLICES)));
}

fn ndc_xy_w_from_view(p_view: vec3f, proj: mat4x4f) -> vec3f {
    let p4 = proj * vec4f(p_view, 1.0);
    return vec3f(p4.xy / p4.w, p4.w);
}

fn light_screen_bounds_px(light_view: vec3f, radius: f32, screen: vec2f, proj: mat4x4f) -> vec4f {
    let centerNdc_w = ndc_xy_w_from_view(light_view, proj);
    let w = centerNdc_w.z;
    if (w <= 0.0) {
        return vec4f(1e9, 1e9, -1e9, -1e9);
    }

    let centerPx = vec2f(
        (centerNdc_w.x * 0.5 + 0.5) * screen.x - 0.5,
        (0.5 - 0.5 * centerNdc_w.y) * screen.y - 0.5
    );

    let rightNdc_w = ndc_xy_w_from_view(light_view + vec3f(radius, 0.0, 0.0), proj);
    let upNdc_w    = ndc_xy_w_from_view(light_view + vec3f(0.0, radius, 0.0), proj);

    let r_px = abs((rightNdc_w.x - centerNdc_w.x) * 0.5 * screen.x);
    let r_py = abs((upNdc_w.y    - centerNdc_w.y) * 0.5 * screen.y);

    let minPx = centerPx - vec2f(r_px, r_py);
    let maxPx = centerPx + vec2f(r_px, r_py);
    return vec4f(minPx, maxPx);
}