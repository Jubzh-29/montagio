/** The manifest Task 5 commits: three placeholder samples, no rendered clip yet. */
export const INITIAL_MANIFEST = `schema: montagio/showcase@0.1
# The model every rendered clip was made with.
model: wan22-i2v-a14b-fun-camera
samples:
  - id: landscape-a
    file: samples/landscape-a.jpg
    aspect: '16:9'
    title: { en: Placeholder landscape A, fr: Paysage provisoire A }
    status: placeholder
    credit: Placeholder made with FFmpeg (lavfi); replaced in GPU session S3 by a Z-Image-Turbo image
  - id: landscape-b
    file: samples/landscape-b.jpg
    aspect: '16:9'
    title: { en: Placeholder landscape B, fr: Paysage provisoire B }
    status: placeholder
    credit: Placeholder made with FFmpeg (lavfi); replaced in GPU session S3 by a Z-Image-Turbo image
  - id: portrait-a
    file: samples/portrait-a.jpg
    aspect: '9:16'
    title: { en: Placeholder portrait A, fr: Portrait provisoire A }
    status: placeholder
    credit: Placeholder made with FFmpeg (lavfi); replaced in GPU session S3 by a Z-Image-Turbo image
clips: []
`;
