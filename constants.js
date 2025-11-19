export const srcsetResolveTags = {
  img: 'srcset',
  source: 'srcset',
}

export const srcResolveTags = {
  img: ['src'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  input: ['src'], // only if type="image"
  script: ['src', 'href', 'xlink:href'], // href and xlink:href for svg scripts
  embed: ['src'],
  object: ['data'],

  // SVG
  use: ['href', 'xlink:href'],
  feImage: ['href', 'xlink:href'],
  image: ['href', 'xlink:href'],
  linearGradient: ['href', 'xlink:href'],
  filter: ['href', 'xlink:href'],
  mpath: ['href', 'xlink:href'],
  pattern: ['href', 'xlink:href'],
  radialGradient: ['href', 'xlink:href'],
  textPath: ['href', 'xlink:href'],
}

export const elementTypes = {
  element: 0,
  component: 1,
  dynamicComponent: 2,
  teleport: 3
}

export const cacheCheckpoint = Symbol("cache_checkpoint")