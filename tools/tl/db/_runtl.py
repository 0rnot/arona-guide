"""`tl-work` に降りて、そこの道具を名前で回す（このセッションは `cd` を通せない）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_runtl.py _aimwhy.py B7GPFRbI1vk
"""
import os
import runpy
import sys

os.chdir('/home/pebkac/arona/tl-work')
sys.path.insert(0, '/home/pebkac/arona/tl-work')
name = sys.argv[1]
sys.argv = [name] + sys.argv[2:]
runpy.run_path('/home/pebkac/arona/tl-work/' + name, run_name='__main__')
