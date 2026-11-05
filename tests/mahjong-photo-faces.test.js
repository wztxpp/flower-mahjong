import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { MAHJONG_PHOTO_URL, PHOTO_FACE_CENTERS, photoFaceTransform } from '../src/mahjong-photo-faces.js'

test('photo face atlas covers all 18 distinct bamboo and dots tiles', () => {
  assert.equal(PHOTO_FACE_CENTERS.length, 18)
  assert.equal(new Set(PHOTO_FACE_CENTERS.map(String)).size, 18)
  for (let tile = 0; tile < 18; tile++) {
    const [u, v] = PHOTO_FACE_CENTERS[tile]
    const matrix = photoFaceTransform(tile).slice(7, -1).split(' ').map(Number)
    assert.equal(matrix.length, 6)
    assert.ok(matrix.every(Number.isFinite))
    const [a, b, c, d, e, f] = matrix
    const x = u + .59 * v
    const y = -.45 * u + v
    assert.ok(Math.abs(a * x + c * y + e - 30) < 1e-8)
    assert.ok(Math.abs(b * x + d * y + f - 40) < 1e-8)
  }
})

test('invalid and hidden tile values have no photo face lookup', () => {
  for (const tile of [null, undefined, -1, 18, .5, '0', NaN, Infinity]) {
    assert.equal(photoFaceTransform(tile), null)
  }
})

test('original reference photograph is bundled unchanged, not hotlinked', () => {
  assert.equal(MAHJONG_PHOTO_URL, '/assets/tiles/reference-mahjong.jpg')
  const photo = readFileSync(new URL('../public/assets/tiles/reference-mahjong.jpg', import.meta.url))
  assert.equal(photo[0], 0xff)
  assert.equal(photo[1], 0xd8)
  assert.equal(createHash('sha256').update(photo).digest('hex'), '260bda485e82697b25547d1d60255398c084445cbbd19b3b3da6e1c200ae897b')
})

test('back tiles never render the photo face and accessible tile names remain', () => {
  const component = readFileSync(new URL('../src/MahjongTile.vue', import.meta.url), 'utf8')
  assert.match(component, /v-if="back"/)
  assert.match(component, /v-else-if="faceTransform"/)
  assert.match(component, /:aria-label="label"/)
  assert.match(component, /:aria-pressed="interactive \? selected : undefined"/)
  assert.doesNotMatch(component, /circlePositions|bambooPositions/)
})
