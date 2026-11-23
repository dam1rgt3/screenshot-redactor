# Screenshot Redactor

Hide private details before sharing a screenshot. Open an image, review the email addresses and phone numbers the app finds, and cover anything else by hand. Copy the cleaned image into a message or save it as a PNG.

**[Open the live demo](https://dam1rgt3.github.io/screenshot-redactor/)** and choose **Try a sample** to start with a fictional screenshot.

## Run locally

Install Node.js 20 or later. From this directory, run:

```sh
npm ci
npm start
```

Open [Screenshot Redactor on this computer](http://127.0.0.1:8772/). Dependency installation requires internet access. Once installed, the app and its English text-recognition model run locally. The server binds to the loopback interface.

## Try a sample

1. Choose **Try a sample** to open a fictional customer support message. The app scans the image and suggests two areas to cover.
2. Use **Draw area** to cover the door code in the delivery note. For a precise rectangle, choose **Add area by coordinates** and enter its bounds in original image pixels.
3. Choose **Export preview** to inspect the result. Then select **Copy cleaned image** or **Download PNG**. Open the saved file and compare it with the source.

For your own screenshots, paste from the clipboard, drop a file, or use **Choose image**. The app accepts PNG, JPEG and WebP files up to 30 MiB, 32 megapixels and 16,384 pixels per side. Copying an image to the clipboard requires browser support and permission on localhost or HTTPS.

## What the app detects

The English OCR model reads text and returns word locations. The app looks for email and phone patterns on each line and adds a small margin around matching words. Clear, high-resolution text works best. Review the whole image for names, door codes, account numbers, addresses, QR codes and anything the scan missed. Deselect a suggestion to keep it visible. **Undo** reverses a selection or a manual rectangle.

## How images are handled

The screenshot is decoded in browser memory. A local worker runs OCR. The web server serves static application files, including the worker, language model and font. It has no upload endpoint. **Clear image** removes the current image and findings from the editor.

The review view highlights suggested regions so you can read them. Export starts with a fresh canvas at the source resolution and replaces selected pixels with a solid, opaque color. Copy and download use the same PNG encoder. The original file stays on your device.

## Development

- `src/app.js` handles image input, the OCR worker, review and export.
- `src/redactions.js` maps recognized text to image coordinates and paints selected rectangles.
- `src/sample.js` draws the fictional sample, which goes through the same scanner as an uploaded file.
- `npm run build` produces a static site in `dist/` with all runtime dependencies. To serve an existing build, run `npm run serve`.

Run the unit and browser tests with:

```sh
npm test
npx playwright install chromium
npm run test:browser
```

To use an existing Chrome installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path instead of installing Chromium. The browser tests scan two different images, exercise file selection, paste and drag-and-drop, and check the exported pixels against the original. They also compare the clipboard payload with the downloaded PNG, check that image processing makes only local requests, and exercise manual redaction when the model is unavailable.

OCR is provided by [Tesseract.js](https://github.com/naptha/tesseract.js) with [English trained data](https://github.com/naptha/tessdata). The interface uses [DM Sans](https://github.com/googlefonts/dm-fonts) served from the local bundle. Bundled library and font notices are copied to `dist/vendor/licenses/`.
