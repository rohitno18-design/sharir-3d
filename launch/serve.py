"""
Tiny static server for Sharir 3D.

The app loads .glb models and .json data with fetch(), which browsers block on file://
URLs, so it needs to be served over http - but only locally, and only to this machine.

Picks a free port automatically, reuses an instance that is already running, and opens
Chrome at it.
"""
import http.server
import os
import socket
import socketserver
import subprocess
import urllib.request
import sys
import threading
import webbrowser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist')
ROOT = os.path.normpath(ROOT)
PREFERRED = [5199, 5198, 5197, 8123, 8124, 0]
MARKER = 'sharir-3d-launcher'

CHROME_PATHS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'),
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.glb': 'model/gltf-binary',
        '.gltf': 'model/gltf+json',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.json': 'application/json',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm',
    }

    def do_GET(self):
        # A second double-click must be able to tell OUR server apart from anything else
        # that happens to be listening (a dev server, another app) before reusing it.
        if self.path == '/__sharir':
            body = MARKER.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        # Big models: let the browser keep them, but check first. 'no-cache' means
        # revalidate, not "don't store" - an unchanged model still comes back as a 304 with
        # no body, so reloads stay instant, while a rebuilt model is picked up immediately
        # instead of being served stale from disk for a day.
        if self.path.endswith(('.glb', '.json')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass          # keep the console quiet


def open_browser(url):
    """Chrome first (this is where the app is developed and tested), default browser otherwise."""
    for exe in CHROME_PATHS:
        if os.path.isfile(exe):
            try:
                subprocess.Popen([exe, '--new-window', url])
                return os.path.basename(exe)
            except OSError:
                pass
    webbrowser.open(url)
    return 'your default browser'


def already_serving(port):
    """True only when OUR launcher is on that port — never hijack somebody else's server."""
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/__sharir', timeout=0.6) as r:
            return r.read().decode(errors='ignore').strip() == MARKER
    except Exception:
        return False


def free_port():
    for p in PREFERRED:
        try:
            s = socket.socket()
            s.bind(('127.0.0.1', p))
            port = s.getsockname()[1]
            s.close()
            return port
        except OSError:
            continue
    return 5180


def main():
    if not os.path.isdir(ROOT):
        print('ERROR: dist/ not found at ' + ROOT)
        print('Build it first:  npm install  &&  npm run build')
        input('\nPress Enter to close...')
        return 1

    # If a previous window is still serving, just point the browser at that one.
    for p in PREFERRED:
        if p and already_serving(p):
            url = 'http://localhost:' + str(p)
            print('')
            print('  Sharir 3D is already running at ' + url)
            print('  Opening it in ' + open_browser(url) + '.')
            print('')
            print('  (The window that started it is the one that stops it.)')
            return 0

    port = free_port()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', port), Handler) as httpd:
        url = 'http://localhost:' + str(port)
        print('')
        print('  SHARIR 3D - Interactive Human Body')
        print('  ------------------------------------------')
        print('  Open in your browser:  ' + url)
        print('  Keep this window open while you use the app.')
        print('  Close this window to stop.')
        print('')
        threading.Timer(0.6, lambda: open_browser(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('')
            print('  Stopped.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
