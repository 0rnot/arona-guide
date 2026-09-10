"""`tl-work` に降りて `_cmp.py`（1 本を 1 発ずつ突き合わせる）を回す。`_runcmp.py` と同じ理由。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_runc.py <vid> --real --raw a2/Normal/0/24
"""
import os
import runpy
import sys

os.chdir('/home/pebkac/arona/tl-work')
sys.path.insert(0, '/home/pebkac/arona/tl-work')
sys.argv = ['_cmp.py'] + sys.argv[1:]
runpy.run_path('/home/pebkac/arona/tl-work/_cmp.py', run_name='__main__')
