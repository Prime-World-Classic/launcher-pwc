precision mediump float;

#define VS_POSITION
#define VS_COLOR
#define VS_UV
#define PS_FALLOFF_BLEND
#define SNOW

uniform vec2 uvScroll;

float rnd(float x)
{
    return fract(sin(dot(vec2(x+47.49,38.2467/(x+2.3)), vec2(12.9898, 78.233)))* (43758.5453));
}

float draw_circle(vec2 uv, vec2 cell, int depth)
{
    float size = length(.03 +sin(cell) * .02);
    return smoothstep(.02, .04*pow(1.2,float(depth)), size-length((uv - .7)));

}
void snow( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 iResolution = vec2(1, 0.3);
    float iTime = uvScroll.y;
    vec3 col;
    vec2 pixel = fragCoord/iResolution.xy;
    vec2 uv;
    float totalDepth = 0.0;
    for(int i = 0; i < 3; i++)
    {

        uv = fract(2.0*pow(1.5,float(i+1))*fragCoord/iResolution.y);
        vec2 motion = vec2(.6*cos(iTime  + float(i)),.6*sin(iTime)+(iTime * 3.5)) + uv;    
        vec2 pixel_move = (2.0*pow(1.5,float(i+1))*fragCoord/iResolution.y) + vec2(.6*cos(iTime  + float(i)),.6*sin(iTime)+(iTime * 3.5));
        vec2 cell = floor(pixel_move);
        uv = fract(motion);
        if (rnd(cell.x*cell.y) > .5)
        {
            float circle = draw_circle(uv+.5*sin(rnd(cell.x*cell.y)), cell, i+1);
            col = col + vec3(circle) * ((pixel.x+pixel.y) * 1.0); 
        }

    }

    // Output to screen
    fragColor = vec4(col, 1.0);
}