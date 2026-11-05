// Exact original artwork supplied by the user. Only the viewport is transformed;
// the JPEG is retained intact so tile counts, brushwork, and colours are not redrawn.
export const MAHJONG_PHOTO_URL = '/assets/tiles/reference-mahjong.jpg'
export const MAHJONG_PHOTO_SOURCE = 'https://b0.bdstatic.com/ugc/personal_page_ai/MLwwl9fZ-MKPaOZU4DLCuw2593740273fcd0025b048d136e631f45.jpg'

// Centers in the deskewed photograph coordinate system (bamboo 1–9, dots 1–9).
// Every requested face is present in the 800 × 800 source photograph.
export const PHOTO_FACE_CENTERS = [
  [-192.07, 486.35], [-110.80, 488.86], [-30.05, 490.28],
  [52.40, 488.68], [132.08, 488.03], [212.34, 486.94],
  [291.42, 488.27], [366.97, 486.88], [443.20, 486.94],
  [-192.41, 393.46], [-110.37, 393.41], [-28.55, 393.94],
  [51.61, 394.31], [130.66, 394.55], [208.61, 395.24],
  [283.82, 395.65], [361.08, 396.35], [435.72, 396.72],
]

// One affine camera correction is sufficient for the nearly planar photo.
// u = (x - .59y) / 1.2655; v = (.45x + y) / 1.2655.
// The bird needs a slightly wider viewport; other faces exclude photo tile edges.
export function photoFaceTransform(tile) {
  if (!Number.isInteger(tile) || tile < 0 || tile >= PHOTO_FACE_CENTERS.length) return null
  const [u, v] = PHOTO_FACE_CENTERS[tile]
  const sx = 60 / (tile === 0 ? 78 : 70)
  const sy = 80 / (tile === 0 ? 90 : 84)
  const determinant = 1.2655
  return `matrix(${sx / determinant} ${sy * .45 / determinant} ${-sx * .59 / determinant} ${sy / determinant} ${30 - sx * u} ${40 - sy * v})`
}
