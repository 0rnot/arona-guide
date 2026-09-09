"""`tl-work` に降りて `pcount.py`（回帰）を回す。`_runcmp.py` と同じ理由。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_runpc.py
"""
import os
import runpy
import sys

os.chdir('/home/pebkac/arona/tl-work')
sys.path.insert(0, '/home/pebkac/arona/tl-work')
sys.argv = ['pcount.py'] + sys.argv[1:]
runpy.run_path('/home/pebkac/arona/tl-work/pcount.py', run_name='__main__')
