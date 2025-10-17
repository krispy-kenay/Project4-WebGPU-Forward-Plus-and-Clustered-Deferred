// TODO-3: implement the Clustered Deferred fullscreen vertex shader

// This shader should be very simple as it does not need all of the information passed by the the naive vertex shader.
struct VertOutput {
    @builtin(position) position : vec4f,
    @location(0) uv : vec2f,
};

@vertex
fn main(@builtin(vertex_index) vid : u32) -> VertOutput {
    var out : VertOutput;

    let pos = array<vec2f, 3>(
        vec2f(-1.0, -3.0),
        vec2f(3.0,  1.0),
        vec2f(-1.0, 1.0)
    );
    out.position = vec4f(pos[vid], 0.0, 1.0);

    out.uv = vec2f(out.position.x * 0.5 + 0.5, 1.0 - (out.position.y * 0.5 + 0.5));
    return out;
}