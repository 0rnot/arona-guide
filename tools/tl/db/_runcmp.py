"""`tl-work` に降りて `scorecmp.py` を回す（このセッションは `cd` を通せない）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_runcmp.py --seeds 15 --json <out>
"""
import os
import runpy
import sys

os.chdir('/home/pebkac/arona/tl-work')
sys.path.insert(0, '/home/pebkac/arona/tl-work')
sys.argv = ['scorecmp.py'] + sys.argv[1:]
runpy.run_path('/home/pebkac/arona/tl-work/scorecmp.py', run_name='__main__')
