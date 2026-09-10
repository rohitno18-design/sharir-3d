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
import sys
import threading
import webbrowser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist')
ROOT = os.path.normpath(ROOT)
PREFERRED = [5180, 5181, 5190, 8123, 8124, 0]

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

    def end_headers(self):
        # Big models: let the browser cache them so a reload is instant.
        if self.path.endswith(('.glb', '.json')):
            self.send_header('Cache-Control', 'public, max-age=86400')
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
    """A second double-click should reuse the running server, not fight it for the port."""
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.4):
            return True
    except OSError:
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
