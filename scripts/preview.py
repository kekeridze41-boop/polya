"""Serve only public Polya files for local desktop and Wi-Fi checks."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = {'index.html', 'app.js', 'styles.css', 'book-motion.js', 'paper-grain.png', 'reference-catalog.js', 'reference-palette.js', 'reference-deck.js', 'own-references.js',
          'references.js', 'sticker-finish.js', 'sticker-store.js', 'stickers.js'}


class PreviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        try:
            path = Path(self.translate_path(self.path)).resolve().relative_to(ROOT)
        except ValueError:
            self.send_error(404)
            return None
        if path.parts and path.as_posix() not in PUBLIC and path.parts[0] not in ('assets', 'data', 'textures'):
            self.send_error(404)
            return None
        if any(part.startswith('.') for part in path.parts):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    with ThreadingHTTPServer((args.bind, args.port), partial(PreviewHandler, directory=str(ROOT))) as server:
        print(f'Поля: http://{args.bind}:{server.server_port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
