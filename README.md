# PDF Composer

Open a PDF (or start from blank pages), place images and text anywhere on the pages, and export the result as a new PDF. Works on desktop and mobile.

- Import one or more PDFs, add blank A4/Letter pages, and reorder, duplicate or delete pages.
- Drag images and text boxes anywhere, including onto other pages; resize, layer, duplicate, set opacity.
- Text uses font, size, bold/italic, alignment and colour, and is exported as real, selectable PDF text.
- Undo/redo, keyboard shortcuts, drag-and-drop files, and pinch to zoom on phones.
- Original PDF pages are copied into the export unchanged, so their text and vector graphics stay sharp.

## Privacy: the server is stateless

Everything happens in your browser. PDFs and images are read, rendered, composed and exported locally with [pdf.js](https://mozilla.github.io/pdf.js/) and [pdf-lib](https://pdf-lib.js.org/). The server only serves the app's static files:

- **No uploads:** the server answers `GET`/`HEAD` only. Every other method gets `405`, and request bodies are never read.
- **No storage:** there is no database, no temp directory, no sessions, and the server never writes to disk. The Docker image runs as a non-root user and is meant to run with `--read-only`.
- **Nowhere else to send data:** a strict Content-Security-Policy (`default-src 'self'`, `connect-src 'self' blob: data:`, `form-action 'none'`) stops the page from sending your files to any other host.

Your work lives only in the browser tab. Closing or reloading it discards everything, so export first; the app warns you before you lose work.

The tests in [`test/server.test.js`](test/server.test.js) and the CI smoke test (which checks that `docker diff` stays empty) enforce these properties.

## Run with Docker

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  -p 8000:8000 ghcr.io/clems4ever/pdf-composer:latest
```

Then open http://localhost:8000. `PORT` changes the listening port. `GET /healthz` returns `ok` for health checks.

## Develop

```sh
npm install
npm start        # http://localhost:8000
npm test
```

There is no build step. The front end is plain HTML/CSS/JS in [`public/`](public/), and [`server.js`](server.js) is a small Express static server.

## Releasing

Run the **Release** workflow from the repository's Actions tab. Choose a `patch`/`minor`/`major` bump from the latest `v*` tag, or enter an exact version. The workflow:

1. runs the tests,
2. builds a multi-arch image (`linux/amd64`, `linux/arm64`) and pushes it to `ghcr.io/clems4ever/pdf-composer` tagged `X.Y.Z`, `X.Y` and `latest`,
3. creates the `vX.Y.Z` tag and a GitHub release with generated notes.

The tag is created only after the image has been published, so a failed build never leaves a dangling tag.

## Limitations

- Text uses the standard PDF fonts (Helvetica, Times, Courier), which cover Western European characters. Other characters, such as emoji or non-Latin scripts, are replaced with `?`.
- PDFs that need a password to open can't be imported. PDFs with only permission restrictions (no printing, no editing, and so on) can be imported, but the exported PDF doesn't keep those restrictions.
