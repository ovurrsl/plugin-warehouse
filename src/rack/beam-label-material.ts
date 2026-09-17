import * as THREE from 'three'

export function createBeamLipLabelMaterial(
  atlasTexture: THREE.Texture,
  cols: number,
  rows: number,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    map: atlasTexture,
    transparent: false,
    side: THREE.FrontSide,
  })

  material.customProgramCacheKey = () => 'beam-lip-label-material'

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uUvScale = {
      value: new THREE.Vector2(1 / cols, 1 / rows),
    }

    shader.vertexShader = `
      attribute vec2 aUvOffset;
      uniform vec2 uUvScale;
      ${shader.vertexShader}
    `.replace(
      '#include <uv_vertex>',
      `
      #include <uv_vertex>
      #ifdef USE_UV
        vUv = uv * uUvScale + aUvOffset;
      #endif
      `,
    )
  }

  return material
}
