SHARIR 3D - how to open it
==========================

DOUBLE-CLICK "Sharir 3D.cmd" ON YOUR DESKTOP.

A small black window opens and your browser opens the app.
Keep the black window open while you use it. Close it to stop.

That is all. It needs no internet and no Claude session.


If you change the code
----------------------
Rebuild before the launcher will show your changes:

    cd C:\Users\rohit\Projects\anatomy-3d
    npm run build

("npm run dev" is the live-reload version for development, on port 5180.)


If it says Python was not found
-------------------------------
Install Python from https://python.org and tick "Add python.exe to PATH"
during setup. Then double-click the launcher again.


What the launcher does
----------------------
The app loads 3D models (.glb) and data (.json) using fetch(), which browsers
refuse to do from a plain file:// path. So the launcher runs a tiny local web
server on your own machine (nothing is exposed to the internet) and points your
browser at it. It picks a free port automatically.
