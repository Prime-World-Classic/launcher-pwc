// Uber shader. Leave first line non functional
#ifdef VS_POSITION
attribute vec3 vertPosition;
#endif

#ifdef VS_TANGENT
attribute vec4 vertTangent;
#endif

#ifdef VS_NORMAL
attribute vec3 vertNormal;
varying vec3 fragNormal;
#endif

#if defined(VS_UV)
attribute vec2 vertTexCoord;
#endif

#if defined(VS_UV16)
attribute vec2 vertTexCoord;
#endif
varying vec2 fragTexCoord;

#if defined(VS_UV2) || defined(VS_UV2_UNUSED)
attribute vec2 vertTexCoord2;
varying vec2 fragTexCoord2;
#endif

#ifdef VS_COLOR
attribute vec4 vertColor;
varying vec4 fragColor;
#endif

// Skinning: bone indices and weights are bytes (weights sum to 255),
// bones[] holds 3 rows of the affine skin matrix per bone (SKIN_MAX_BONES is set by Castle.loadResources)
#ifdef VS_SKIN
attribute vec4 vertBoneIdx;
attribute vec4 vertBoneWeight;
uniform vec4 bones[SKIN_MAX_BONES * 3];
#endif

#ifdef RENDER_PASS_COLOR
uniform mat4 lightViewProj;

varying vec4 v_projectedTexcoord;
#endif

#ifdef PS_GRID
varying vec2 posXZ;
#endif
#ifdef SNOW
varying float posDepth;
#endif

uniform mat4 mWorld;
uniform mat4 mViewProj;

uniform vec4 startFreq;
uniform vec4 endAmp;
uniform vec4 animDirVertFreq;
uniform vec4 time;

// Pizdos. Ebaniy webgl cannot convert half to float natively
// Also there's no bitwise operations so I had to use floats only
vec2 half_to_float(vec2 h)
{
  vec2 signBit = vec2(step(h.x, 32768.0), step(h.y, 32768.0));
  vec2 exponentBits = floor((h - (1.0 - signBit) * 32768.0) / 1024.0);
  vec2 fractionBits = h - (1.0 - signBit) * 32768.0 - exponentBits * 1024.0;

  vec2 sign = signBit * 2.0 - 1.0;
  vec2 exponent = exp2(exponentBits - 15.0);
  vec2 fraction = 1.0 + fractionBits / 1024.0;
  return sign * exponent * fraction;
}

float minimum_distance(vec3 v, vec3 w, vec3 p) {
  // Return minimum distance between line segment vw and point p
  float l2 = dot(v-w, v-w);  // i.e. |w-v|^2 -  avoid a sqrt
  //if (l2 == 0.0) return distance(p, v);   // v == w case
  // Consider the line extending the segment, parameterized as v + t (w - v).
  // We find projection of point p onto the line. 
  // It falls where t = [(p-v) . (w-v)] / |w-v|^2
  // We clamp t from [0,1] to handle points outside the segment vw.
  float t = max(0.0, min(1.0, dot(p - v, w - v) / l2));
  vec3 projection = v + t * (w - v);  // Projection falls on the segment
  return distance(p, projection);
}

float rand(float n){return fract(sin(n) * 43758.5453123);}

void main()
{
#if defined(VS_UV) || defined(VS_UV16)
  #ifdef VS_UV
    fragTexCoord = vertTexCoord;
  #endif
  #ifdef VS_UV16
    fragTexCoord = half_to_float(vertTexCoord);
  #endif
#else
  fragTexCoord = vec2(vertPosition.xy); //fract(vertPosition.xx);
#endif

#ifdef VS_UV2
  fragTexCoord2 = vertTexCoord2;
#endif
#ifdef VS_COLOR
  fragColor = vertColor / 255.0;
#endif
// Skinning
  vec3 skinnedPosition = vertPosition;
#ifdef VS_NORMAL
  vec3 skinnedNormal = vertNormal;
#endif
#ifdef VS_SKIN
  vec4 boneWeight = vertBoneWeight / 255.0;
  int b0 = int(vertBoneIdx.x) * 3;
  int b1 = int(vertBoneIdx.y) * 3;
  int b2 = int(vertBoneIdx.z) * 3;
  int b3 = int(vertBoneIdx.w) * 3;
  vec4 row0 = bones[b0] * boneWeight.x + bones[b1] * boneWeight.y + bones[b2] * boneWeight.z + bones[b3] * boneWeight.w;
  vec4 row1 = bones[b0 + 1] * boneWeight.x + bones[b1 + 1] * boneWeight.y + bones[b2 + 1] * boneWeight.z + bones[b3 + 1] * boneWeight.w;
  vec4 row2 = bones[b0 + 2] * boneWeight.x + bones[b1 + 2] * boneWeight.y + bones[b2 + 2] * boneWeight.z + bones[b3 + 2] * boneWeight.w;
  vec4 bindPosition = vec4(vertPosition, 1.0);
  skinnedPosition = vec3(dot(row0, bindPosition), dot(row1, bindPosition), dot(row2, bindPosition));
  #ifdef VS_NORMAL
  skinnedNormal = vec3(dot(row0.xyz, vertNormal), dot(row1.xyz, vertNormal), dot(row2.xyz, vertNormal));
  #endif
#endif
// Vertex animation
  vec3 animatedVertPosition = skinnedPosition;
// 1. Weight animation
  float weight = minimum_distance(startFreq.xyz, endAmp.xyz, vertPosition);
// 2. Wave animation
  float animation = sin((fract((vertPosition.x + vertPosition.y + vertPosition.z) * animDirVertFreq.w) + time.x) * startFreq.w) * endAmp.w * weight;
// 3. Add up animated value
  animatedVertPosition += (animDirVertFreq.xyz * animation);

// Transforms
  
  vec4 worldPos = mWorld * vec4(animatedVertPosition, 1.0);
  gl_Position = mViewProj * worldPos;
#ifdef VS_NORMAL
  vec4 worldNormal = mWorld * vec4(normalize(skinnedNormal), 0.0);
  fragNormal = (worldNormal.xyz);
#endif

// Unused, but neccesary for input assembler
#if defined(VS_TANGENT)
  gl_Position += vertTangent.xxxx * 0.0000001; // TODO: Implement
#endif
#if defined(VS_UV2) || defined(VS_UV2_UNUSED)
  gl_Position += vertTexCoord2.xxxx * 0.001; // TODO: Implement
#endif

// SM projection
#ifdef RENDER_PASS_COLOR
  v_projectedTexcoord = lightViewProj * worldPos;
#endif

#ifdef PS_GRID
posXZ = vertPosition.xz;
#endif
#ifdef SNOW
posDepth = gl_Position.w;
#endif
}